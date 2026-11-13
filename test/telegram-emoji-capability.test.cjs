/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {once} = require('node:events')
const {TelegramEmojiCapability} = require('../dist/util/TelegramEmojiCapability')
const {TelegramEmojiProbe} = require('../dist/util/TelegramEmojiProbe')
const {TelegramDisplayPolicy} = require('../dist/util/TelegramDisplayPolicy')
const {WECHAT_CUSTOM_EMOJI} = require('../dist/util/WechatCustomEmojiData')
const {createWebUIServer} = require('../dist/webui/server')
const presentation = require('./helpers/telegram-presentation')
const emoji = WECHAT_CUSTOM_EMOJI['[微笑]']
const html = `<tg-emoji emoji-id="${emoji.id}">${emoji.emoji}</tg-emoji>`
const message = (entities = [])=>({message_id:1,text:emoji.emoji,entities})
const buttonMessage = (supported = true)=>({message_id:1,text:'Control message',reply_markup:{inline_keyboard:[[{text:'Check',...(supported ? {icon_custom_emoji_id:emoji.id} : {})}]]}})
const entity = {type:'custom_emoji',custom_emoji_id:emoji.id,offset:0,length:2}
const rejection = {response:{error_code:400,description:'CUSTOM_EMOJI_NOT_ALLOWED'}}

test('new installations default to automatic emoji and explicit disable remains authoritative',()=>{
  const vm = require('node:vm'),ts = require('typescript')
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/config.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText
  const dependencies = {dotenv:{config:()=>undefined},'./webui/store':{loadPersistentEnvironment:()=>undefined},'./util/MessageTemplates':{resolveMessageTemplates:()=>({})}}
  for(const [environment,enabled] of [[{},true],[{WECHAT_CUSTOM_EMOJI_ENABLED:'false'},false],[{WECHAT_CUSTOM_EMOJI_ENABLED:'true'},true]]) {
    const exports = {}
    vm.runInNewContext(source,{exports,process:{env:environment},require:name=>dependencies[name]})
    assert.equal(exports.config.WECHAT_CUSTOM_EMOJI_ENABLED,enabled)
    assert.equal(exports.config.TELEGRAM_DISPLAY_MODE,'auto')
  }
})

test('capability verifies exact entities, captions and transport identity, with bounded lifetimes',()=>{
  let now = 1000
  const c = new TelegramEmojiCapability(()=>now)
  c.observe(1,html,message([entity]));assert.equal(c.snapshot(1).state,'supported')
  assert.equal(c.snapshot(2).state,'unknown');assert.equal(c.snapshot(1,'mtproto').state,'unknown')
  c.observe(2,html,{caption:emoji.emoji,caption_entities:[entity]});assert.equal(c.snapshot(2).state,'supported')
  c.observe(3,html,{message:emoji.emoji,entities:[{className:'MessageEntityCustomEmoji',documentId:{toString:()=>emoji.id}}]},'mtproto')
  assert.equal(c.snapshot(3,'mtproto').state,'supported');assert.equal(c.snapshot(3).state,'unknown')
  c.observe(4,html,message([{...entity,custom_emoji_id:'999'}]));assert.equal(c.snapshot(4).state,'unsupported')
  c.observe(5,html,true);assert.equal(c.snapshot(5).state,'unknown')
  now += 6 * 60 * 60 * 1000
  assert.equal(c.snapshot(4).state,'unknown');assert.equal(c.snapshot(4).reason,'expired')
  assert.equal(c.snapshot(1).state,'supported')
  now += 18 * 60 * 60 * 1000
  assert.equal(c.snapshot(1).state,'unknown')
  c.clear();assert.equal(c.snapshot(1).checkedAt,null)
})

test('auto observes a bot owned by someone else, preserves manual switches and does not resend stripped messages',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-capability-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'))
  policy.configure(100,200);policy.observeOwner({id:200,is_premium:false})
  const f = presentation({policy,fallback:'links'}),sent = []
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async text=>{sent.push(text);return message([entity])})
  assert.equal(policy.emoji.snapshot(200).state,'supported');assert.equal(policy.ownerPremium(),false)
  assert.equal(policy.allows('richMessage',200),false,'emoji evidence does not enable unrelated rich layouts')
  await f.sendTelegramHtml(201,'[微笑]',true,4096,async text=>{sent.push(text);return message()})
  assert.equal(sent.length,2,'accepted plain fallback is never sent again')
  assert.equal(policy.emoji.snapshot(201).state,'unsupported')
  assert.match(f.renderTelegramHtml('[微笑]',true,4096,201),/<a /)
  assert.match(f.renderTelegramHtml('[微笑]',false,4096,200),/<a /)
  policy.setMode('compatible',200);assert.match(f.renderTelegramHtml('[微笑]',true,4096,200),/<a /)
  policy.configure(101,200);assert.equal(policy.emoji.snapshot(200).state,'unknown')
})

test('only explicit rejection retries once; transient errors and stale identities do not create another send',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-errors-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'));policy.configure(100,200)
  const f = presentation({policy,fallback:'links'})
  let calls = 0
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async()=>{if(++calls === 1)throw rejection;return message()})
  assert.equal(calls,2);assert.equal(policy.emoji.snapshot(200).reason,'rejected')
  for(const error of [{response:{error_code:429,description:'Too Many Requests'}},{response:{error_code:500,description:'Internal error'}},Error('ETIMEDOUT')]) {
    calls = 0
    await assert.rejects(f.sendTelegramHtml(201,'[微笑]',true,4096,async()=>{calls++;throw error}))
    assert.equal(calls,1);assert.equal(policy.emoji.snapshot(201).state,'unknown')
  }
  policy.emoji.record(201,'supported','confirmed')
  await assert.rejects(f.sendTelegramHtml(201,'[微笑]',true,4096,async()=>{throw Error('timeout')}))
  assert.equal(policy.emoji.snapshot(201).state,'supported','network errors preserve valid confirmed evidence')
  await f.sendTelegramHtml(202,'[微笑]',true,4096,async()=>{policy.configure(102,200);return message([entity])})
  assert.equal(policy.emoji.snapshot(202).state,'unknown')
})

test('manual probes are single-flight, rate limited and report stripped emoji without sending a fallback',async()=>{
  const c = new TelegramEmojiCapability(),probe = new TelegramEmojiProbe(c)
  let release,calls = 0
  const send = async()=>{calls++;return new Promise(resolve=>{release = resolve})}
  const first = probe.run(200,send),second = probe.run(200,send)
  release(buttonMessage());await Promise.all([first,second]);assert.equal(calls,1)
  assert.equal(probe.status(200).state,'supported');assert(probe.status(200).checkedAt > 0)
  await assert.rejects(probe.run(200,send),error=>error.code === 'emojiProbeRateLimited')
  c.clear();await probe.run(200,async()=>buttonMessage(false));assert.equal(probe.status(200).state,'unsupported')
  c.clear();await probe.run(200,async()=>true)
  assert.equal(probe.status(200).state,'unknown');assert.equal(probe.status(200).lastProbeFailed,true)
})

test('button preflight runs before the business message and preserves explicit switches',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-preflight-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'));policy.configure(100,200)
  const f = presentation({policy,fallback:'links'}),events = []
  policy.prepareEmoji = async()=>{events.push('check');return false}
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async text=>{events.push(text.includes('<tg-emoji') ? 'native' : 'compatible');return message()})
  assert.deepEqual(events,['check','compatible'])
  events.length = 0
  await f.sendTelegramHtml(200,'[微笑]',false,4096,async()=>{events.push('sent');return message()})
  assert.deepEqual(events,['sent'])
  policy.setMode('compatible',200);events.length = 0
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async()=>{events.push('sent');return message()})
  assert.deepEqual(events,['sent'])
  policy.setMode('auto',200);events.length = 0
  policy.prepareEmoji = async()=>{events.push('check');return true}
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async text=>{events.push(text.includes('<tg-emoji') ? 'native' : 'compatible');return message([entity])})
  assert.deepEqual(events,['check','native'])
  assert.equal(policy.emoji.snapshot(200).state,'supported')
})

test('a stripped normal message is edited by receipt once, and an edit failure never resends accepted content',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-same-message-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'));policy.configure(100,200)
  const f = presentation({policy,fallback:'links'})
  let sends = 0,edits = 0
  const send = async()=>{sends++;return message()}
  const result = await f.sendTelegramHtml(200,'[微笑]',true,4096,send,()=>true,'botApi',async(receipt,text)=>{
    edits++;assert.equal(receipt.message_id,1);assert.match(text,/<a /)
  })
  assert.equal(result.message_id,1);assert.equal(sends,1);assert.equal(edits,1)
  const accepted = await f.sendTelegramHtml(201,'[微笑]',true,4096,send,()=>true,'botApi',async()=>{edits++;throw Error('edit timeout')})
  assert.equal(accepted.message_id,1);assert.equal(sends,2);assert.equal(edits,2)
})

test('control-message receipts survive restart and are isolated by bot and bound user',t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-control-receipt-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const file = path.join(directory,'receipt.json')
  const first = new TelegramEmojiProbe(new TelegramEmojiCapability(),Date.now,15000,file)
  assert.equal(first.messageId(100,200),undefined)
  first.remember(100,200,300)
  const restored = new TelegramEmojiProbe(new TelegramEmojiCapability(),Date.now,15000,file)
  assert.equal(restored.messageId(100,200),300);assert.equal(restored.messageId(101,200),undefined);assert.equal(restored.messageId(100,201),undefined)
  fs.writeFileSync(file,'invalid')
  assert.equal(new TelegramEmojiProbe(new TelegramEmojiCapability(),Date.now,15000,file).messageId(100,200),undefined)
})

test('preflight uncertainty selects compatibility and cancellation stops before submitting a business message',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-preflight-unknown-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'));policy.configure(100,200)
  const f = presentation({policy,fallback:'links'})
  let sends = 0
  policy.prepareEmoji = async()=>{throw Error('preflight timeout')}
  await f.sendTelegramHtml(200,'[微笑]',true,4096,async text=>{sends++;assert(!text.includes('<tg-emoji'));return message()})
  assert.equal(policy.emoji.snapshot(200).state,'unknown')
  await assert.rejects(f.sendTelegramHtml(201,'[微笑]',true,4096,async()=>{sends++;return message()},()=>false),/cancelled/)
  assert.equal(sends,1)
})

test('probe cancellation reports uncertainty, ignores late success and clears old identity evidence',async()=>{
  const c = new TelegramEmojiCapability(),probe = new TelegramEmojiProbe(c,Date.now,10)
  let release,signal
  await probe.run(200,async(_html,s)=>{signal = s;return new Promise(resolve=>{release = resolve})})
  assert.equal(signal.aborted,true);assert.equal(probe.status(200).state,'unknown');assert.equal(probe.status(200).lastProbeFailed,true)
  release(message([entity]));await new Promise(resolve=>setImmediate(resolve))
  assert.equal(probe.status(200).state,'unknown')
  c.clear()
  await probe.run(200,async()=>{c.clear();return buttonMessage()})
  assert.equal(c.snapshot(200).state,'unknown')
})

test('probe records explicit refusal, while 429 and network errors preserve uncertainty',async()=>{
  for(const [error,state] of [[rejection,'unsupported'],[{response:{error_code:429,description:'limited'}},'unknown'],[Error('network'),'unknown']]) {
    const probe = new TelegramEmojiProbe(new TelegramEmojiCapability())
    await probe.run(200,async()=>{throw error})
    assert.equal(probe.status(200).state,state)
  }
})

test('WebUI probe requires authentication and explicit confirmation, cannot choose a recipient and demo stays isolated',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'emoji-http-'))
  let reads = 0,sends = 0
  const options = {environment:{},token:'synthetic-token',file:path.join(directory,'config.json'),mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    telegramDisplayStatus:async()=>{reads++;return {state:'unknown'}},probeTelegramCustomEmoji:async()=>{sends++;return {state:'supported'}},
  }}
  const server = createWebUIServer(options),demo = createWebUIServer({...options,demo:true})
  server.listen(0,'127.0.0.1');demo.listen(0,'127.0.0.1');await Promise.all([once(server,'listening'),once(demo,'listening')])
  t.after(async()=>{for(const s of [server,demo]){s.closeAllConnections();await new Promise(resolve=>s.close(resolve))}fs.rmSync(directory,{recursive:true,force:true})})
  const route='/api/telegram/emoji-capability',base=`http://127.0.0.1:${server.address().port}`
  const auth = {Authorization:'Bearer synthetic-token','Content-Type':'application/json'}
  const config = await (await fetch(base+'/api/config',{headers:auth})).json()
  assert.equal(config.values.WECHAT_CUSTOM_EMOJI_ENABLED,true);assert.equal(config.values.TELEGRAM_DISPLAY_MODE,'auto')
  const savedDefault = await (await fetch(base+'/api/config',{method:'PATCH',headers:auth,body:JSON.stringify({source:'environment',revision:config.revision,values:{WECHAT_CUSTOM_EMOJI_ENABLED:true,TELEGRAM_DISPLAY_MODE:'auto'}})})).json()
  assert.equal(savedDefault.restartRequired,false)
  const disabled = await (await fetch(base+'/api/config',{method:'PATCH',headers:auth,body:JSON.stringify({source:'environment',revision:savedDefault.revision,values:{WECHAT_CUSTOM_EMOJI_ENABLED:false}})})).json()
  assert.equal(disabled.values.WECHAT_CUSTOM_EMOJI_ENABLED,false)
  const request=(body)=>fetch(base+route,{method:'POST',headers:{Authorization:'Bearer synthetic-token'},body:JSON.stringify(body)})
  assert.equal((await fetch(base+route)).status,401)
  assert.equal((await fetch(base+route,{headers:{Authorization:'Bearer synthetic-token'}})).status,200)
  assert.equal(reads,1);assert.equal(sends,0)
  assert.equal((await request({})).status,400);assert.equal((await request({confirm:true,chatId:999})).status,400)
  const response=await request({confirm:true});assert.equal(response.status,200);assert.equal((await response.json()).state,'supported');assert.equal(sends,1)
  const blocked=await fetch(`http://127.0.0.1:${demo.address().port}`+route,{method:'POST',headers:{Authorization:'Bearer synthetic-token'},body:'{"confirm":true}'})
  assert.equal(blocked.status,403);assert.equal(sends,1)
})
