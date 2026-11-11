/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {TelegramDisplayPolicy,customEmojiRejected} = require('../dist/util/TelegramDisplayPolicy')
const {handleTelegramDisplayCommand} = require('../dist/util/TelegramDisplayCommand')
const {renderWechatEmojiFallbackHtml,renderWechatCustomEmojiHtml,splitTelegramHtml} = require('../dist/util/WechatCustomEmoji')
const {WECHAT_EMOJI_IMAGE_NAMES} = require('../dist/util/WechatCustomEmojiData')
const {wechatRedPacketNotice} = require('../dist/util/WechatRedPacket')
const presentation = require('./helpers/telegram-presentation')
function fixture(t,mode = 'auto'){
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'display-policy-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const file = path.join(directory,'display.json'),policy = new TelegramDisplayPolicy(file,mode)
  policy.configure(100,200)
  return {file,policy,...presentation({policy,fallback:'links'})}
}

test('auto uses only configured owner updates, expires membership and isolates bot/owner changes',t=>{
  const {file} = fixture(t)
  let now = 1000
  const p = new TelegramDisplayPolicy(file,'auto',()=>now);p.configure(100,200)
  assert.equal(p.ownerPremium(),undefined);assert.equal(p.allows('customEmoji',-10),false)
  p.observeOwner({id:201,is_premium:true});assert.equal(p.ownerPremium(),undefined)
  p.observeOwner({id:200,is_bot:true,is_premium:true});assert.equal(p.ownerPremium(),undefined)
  p.observeOwner({id:200,is_premium:true});assert.equal(p.allows('customEmoji',-10),true)
  now += 24 * 60 * 60 * 1000;assert.equal(p.ownerPremium(),undefined)
  p.observeOwner({id:200});assert.equal(p.ownerPremium(),false)
  p.observeOwner({id:200,is_premium:true});p.configure(101,200);assert.equal(p.ownerPremium(),undefined)
  p.observeOwner({id:200,is_premium:true});p.configure(101,202);assert.equal(p.ownerPremium(),undefined)
})
test('global and per-chat preferences persist privately; inheritance and rejection expiry remain feature-scoped',t=>{
  const {file} = fixture(t);let now = 1000
  const p = new TelegramDisplayPolicy(file,'auto',()=>now);p.configure(100,200)
  p.setMode('enhanced');p.setMode('compatible',-10)
  assert.equal(p.allows('richMessage',-10),false);assert.equal(p.allows('richMessage',-11),true)
  const next = new TelegramDisplayPolicy(file);next.configure(100,200)
  assert.equal(next.mode(-10),'compatible');assert.equal(next.mode(-11),'enhanced')
  assert.equal(fs.statSync(file).mode & 0o777,0o600)
  assert.equal(next.ownerPremium(),undefined,'membership is not persisted')
  next.configure(101,200);assert.equal(next.mode(-10),'auto','other bots cannot inherit preferences')
  p.setMode('inherit',-10);assert.equal(p.mode(-10),'enhanced')
  p.reject('customEmoji',-10)
  assert.equal(p.allows('customEmoji',-10),false);assert.equal(p.allows('richMessage',-10),true);assert.equal(p.allows('customEmoji',-11),true)
  now += 6 * 60 * 60 * 1000;assert.equal(p.allows('customEmoji',-10),true)
  p.setMode('inherit');assert.equal(p.mode(-10),'auto')
})
test('invalid files fail closed and failed persistence never changes active settings',t=>{
  const {file} = fixture(t);fs.writeFileSync(file,'invalid json')
  const p = new TelegramDisplayPolicy(file,'enhanced');p.configure(100,200)
  assert.equal(p.mode(-10),'compatible')
  fs.unlinkSync(file);fs.mkdirSync(file)
  assert.throws(()=>p.setMode('enhanced'));assert.equal(p.mode(-10),'compatible')
})
test('display commands are owner-only, validate arguments and retain a plain-text compatibility control',async t=>{
  const {policy,file} = fixture(t),replies = []
  const context = {from:{id:201,is_premium:true},chat:{id:-10},payload:'global enhanced',reply:async text=>replies.push(text)}
  await handleTelegramDisplayCommand(context,200,100,policy)
  assert.equal(fs.existsSync(file),false);assert.equal(policy.ownerPremium(),undefined)
  context.from.id = 200
  await handleTelegramDisplayCommand(context,200,100,policy)
  assert.equal(policy.mode(-11),'enhanced');assert.equal(policy.ownerPremium(),true)
  context.payload = 'compatible';await handleTelegramDisplayCommand(context,200,100,policy)
  assert.equal(policy.mode(-10),'compatible');assert.equal(policy.mode(-11),'enhanced')
  context.payload = 'enhanced garbage';await handleTelegramDisplayCommand(context,200,100,policy)
  assert.equal(policy.mode(-10),'compatible')
  context.payload = 'inherit';await handleTelegramDisplayCommand(context,200,100,policy,true)
  assert.equal(policy.mode(-10),'enhanced');assert.match(replies.at(-1),/Client versions cannot be detected/)
})
test('existing authorized user session refreshes only the configured owner membership',async t=>{
  const f = fixture(t),exports = {},vm = require('node:vm')
  let identity = {id:{toString:()=> '201'},premium:true},fail = false
  const user = {client:{getMe:async()=>{if(fail)throw Error('unavailable');return identity}}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/client/TelegramBotClient.js'),'utf8'),{exports,require:name=>({
    '../base/BaseClient':{AbstractClient:class {static getSpyClient(){return user}}},
    '../util/TelegramPresentation':f,
  }[name] || {})})
  const client = Object.create(exports.TelegramBotClient.prototype);client.logger = {debug:()=>undefined}
  client.refreshDisplayMembership();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.policy.ownerPremium(),undefined)
  identity = {id:{toString:()=> '200'},premium:true}
  client.refreshDisplayMembership();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.policy.ownerPremium(),true)
  fail = true;client.refreshDisplayMembership();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.policy.ownerPremium(),true,'a network failure does not invent a non-premium update')
})
test('a compatible directory callback cannot reopen a rich avatar even for a premium owner',async t=>{
  const f = fixture(t,'enhanced'),replies = []
  const ctx = {chat:{id:-10},callbackQuery:{message:{chat:{id:-10},message_id:1}},reply:async(text,options)=>replies.push({text,options}),telegram:{callApi:async()=>{throw Error('must not send rich content')}}}
  assert.equal(f.useRichDirectory(ctx),false)
  assert.equal(await f.replyDirectoryText(ctx,'name',{inline_keyboard:[]},{image:Buffer.from('avatar'),label:'头像'}),true)
  assert.equal(replies.length,1)
  ctx.callbackQuery.message.rich_message = {blocks:[]}
  assert.equal(f.useRichDirectory(ctx),true)
  f.policy.setMode('compatible',-10);assert.equal(f.useRichDirectory(ctx),false)
})

test('all link aliases reference verified WebP names and preserve English/Chinese labels',()=>{
  const files = new Set(require('../src/webui/public/emoji/manifest.json').files.map(file=>file.source))
  for(const [alias,name] of Object.entries(WECHAT_EMOJI_IMAGE_NAMES)){
    assert(files.has(name + '.webp'),alias)
    const html = renderWechatEmojiFallbackHtml(alias)
    assert(html.includes(`/${encodeURIComponent(name)}.webp`));assert(html.endsWith(`>${alias}</a>`))
  }
  const input = '<b>[微笑] 🙂</b><a href="https://example.test/[微笑]">[微笑]</a><code>[微笑]</code><pre>[微笑]</pre> [not-known]'
  const rendered = renderWechatEmojiFallbackHtml(input)
  assert(rendered.includes('<a href="https://example.test/[微笑]">[微笑]</a>'))
  assert(rendered.includes('<code>[微笑]</code><pre>[微笑]</pre> [not-known]'))
  assert.equal(renderWechatEmojiFallbackHtml(rendered),rendered,'idempotent final rendering')
  assert.equal((renderWechatEmojiFallbackHtml('[微笑]'.repeat(105)).match(/<a /g) || []).length,100)
})
test('non-premium/unknown owners get links even with custom emoji enabled; premium and explicit compatibility select correctly',t=>{
  const f = fixture(t)
  assert.match(f.renderTelegramHtml('[微笑]',true,undefined,-10),/<a href=/)
  f.policy.observeOwner({id:200,is_premium:true})
  const native = f.renderTelegramHtml('[微笑]',true,undefined,-10)
  assert.match(native,/<tg-emoji/)
  f.policy.setMode('compatible',-10)
  assert.match(f.renderTelegramHtml(native,true,undefined,-10),/<a href=/)
  assert(!f.renderTelegramHtml(native,true,undefined,-10).includes('tg-emoji'))
  f.policy.observeOwner({id:200});assert.match(f.renderTelegramHtml('[Facepalm]',true,undefined,-11),/<a href=/)
})
test('caption fallback does not expand already-rendered emoji beyond Telegram limits',t=>{
  const f = fixture(t)
  const native = renderWechatCustomEmojiHtml('x'.repeat(1022) + '[微笑]',true)
  const html = f.renderTelegramHtml(native,true,1024,-10)
  assert.equal(splitTelegramHtml(html,1024).length,1)
  assert(!html.includes('tg-emoji'))
})
test('only explicit custom-emoji rejection permits one fallback, preserving uncertainty and timeout cancellation',async t=>{
  const f = fixture(t,'enhanced'),sent = []
  const rejection = {response:{error_code:400,description:'Bad Request: CUSTOM_EMOJI_NOT_ALLOWED'}}
  const id = await f.sendTelegramHtml(-10,'[微笑]',true,4096,async html=>{
    sent.push(html);if(sent.length === 1)throw rejection;return 77
  })
  assert.equal(id,77);assert.equal(sent.length,2);assert.match(sent[0],/<tg-emoji/);assert.match(sent[1],/<a href=/)
  assert.equal(f.policy.allows('customEmoji',-10),false)
  for(const error of [new Error('ETIMEDOUT'),{response:{error_code:500,description:'CUSTOM_EMOJI_NOT_ALLOWED'}},{response:{error_code:429,description:'retry'}},{response:{error_code:403,description:'Forbidden'}},{response:{error_code:400,description:'chat not found'}}]){
    let calls = 0
    await assert.rejects(f.sendTelegramHtml(-11,'[微笑]',true,4096,async()=>{calls++;throw error}),e=>e === error)
    assert.equal(calls,1);assert.equal(customEmojiRejected(error),false)
  }
  let calls = 0
  await assert.rejects(f.sendTelegramHtml(-12,'[微笑]',true,4096,async()=>{calls++;throw rejection},()=>false))
  assert.equal(calls,1,'never issue a fallback after the outer send has timed out')
})
test('legacy red-packet reminder survives unknown type without parsing private payment payloads',()=>{
  assert.equal(wechatRedPacketNotice('red_packet','<xml>secret payment data</xml>'),'🧧 收到红包，请在微信客户端查看。')
  assert.equal(wechatRedPacketNotice('unknown','收到红包，请在手机上查看'),'🧧 收到红包，请在微信客户端查看。')
  for(const [type,text] of [['text','收到红包，请在手机上查看'],['unknown','今天发红包吗'],['transfer','payment']])assert.equal(wechatRedPacketNotice(type,text),undefined)
})