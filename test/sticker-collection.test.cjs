/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const {createHash} = require('node:crypto')
const {StickerCollection,stickerMedia} = require('../dist/service/StickerCollection')
const botInfo = {id:99,username:'collection_test_bot'}
const media = {fileId:'same-image',kind:'static'}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sticker-test-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const file = path.join(directory,'telegram-sticker-collection.json'),calls = [],sets = new Map()
  const api = {
    async prepare(input) {return {source:Buffer.from(input.fileId),format:'static',digest:createHash('sha256').update(input.fileId).digest('hex'),trimmed:false}},
    async call(method,payload) {
      calls.push({method,payload})
      if(method === 'getStickerSet') {
        if(!sets.has(payload.name))throw {response:{error_code:400,description:'Bad Request: STICKERSET_INVALID'}}
        return sets.get(payload.name)
      }
      if(method === 'uploadStickerFile')return {file_id:payload.sticker.source.toString(),file_unique_id:payload.sticker.source.toString()}
      if(method === 'createNewStickerSet')sets.set(payload.name,{stickers:payload.stickers.map(s=>({file_unique_id:s.sticker}))})
      if(method === 'addStickerToSet')sets.get(payload.name).stickers.push({file_unique_id:payload.sticker.sticker})
      return true
    },
  }
  return {directory,file,calls,sets,api,service:new StickerCollection(file,api)}
}

test('collection creates a pack once, serializes concurrent triggers and deduplicates across restart', async t=>{
  const f = fixture(t)
  const results = await Promise.all([f.service.collect(botInfo,7,media),f.service.collect(botInfo,7,media)])
  assert.equal(results[0].duplicate,false)
  assert.equal(results[1].duplicate,true)
  assert.equal(results[0].url,results[1].url)
  assert.equal(f.calls.filter(c=>c.method === 'createNewStickerSet').length,1)
  assert.equal((await new StickerCollection(f.file,f.api).collect(botInfo,7,media)).duplicate,true)
  assert.equal(f.calls.filter(c=>c.method === 'uploadStickerFile').length,1)
  const intent = JSON.parse(fs.readFileSync(f.file))
  assert.equal(Object.values(intent.items)[0].status,'done')
})

test('120 stickers rolls into another pack and owners/bots stay isolated', async t=>{
  const f = fixture(t)
  const first = await f.service.collect(botInfo,7,media)
  f.sets.get(first.url.split('/').pop()).stickers = Array.from({length:120},()=>({}))
  const second = await f.service.collect(botInfo,7,{...media,fileId:'second'})
  assert.notEqual(first.url,second.url)
  assert.match(second.url,/_2_by_/)
  assert.notEqual((await f.service.collect(botInfo,8,media)).url,first.url)
  assert.notEqual((await f.service.collect({...botInfo,id:100},7,media)).url,first.url)
})

test('lost remote acknowledgement reconciles after restart without creating a duplicate', async t=>{
  const f = fixture(t),call = f.api.call
  f.api.call = async(method,payload)=>{
    const result = await call(method,payload)
    if(method === 'createNewStickerSet')throw new Error('timeout after acceptance')
    return result
  }
  await assert.rejects(f.service.collect(botInfo,7,media),/未完成/)
  assert.equal(Object.values(JSON.parse(fs.readFileSync(f.file)).items)[0].status,'pending')
  const result = await new StickerCollection(f.file,f.api).collect(botInfo,7,media)
  assert.equal(result.duplicate,true)
  assert.equal(f.calls.filter(c=>c.method === 'createNewStickerSet').length,1)
})

test('uncertain unconfirmed mutation stays blocked, definite rejection allows explicit retry', async t=>{
  const f = fixture(t),call = f.api.call
  f.api.call = async(method,payload)=>{
    if(method === 'createNewStickerSet')throw new Error('connection lost')
    return call(method,payload)
  }
  await assert.rejects(f.service.collect(botInfo,7,media),/未完成/)
  await assert.rejects(new StickerCollection(f.file,f.api).collect(botInfo,7,media),/尚未确认/)
  assert.equal(f.calls.filter(c=>c.method === 'uploadStickerFile').length,1)
  f.api.call = async(method,payload)=>{
    if(method === 'createNewStickerSet')throw {response:{error_code:429,description:'Too Many Requests'}}
    return call(method,payload)
  }
  const other = {...media,fileId:'other'}
  await assert.rejects(f.service.collect(botInfo,7,other),/未完成/)
  f.api.call = call
  assert.equal((await f.service.collect(botInfo,7,other)).duplicate,false)
})

test('media index persists topics and bot/chat/message isolation; corrupt state fails closed', t=>{
  const f = fixture(t)
  f.service.remember(99,{chat:{id:-10},message_id:5,message_thread_id:20,animation:{file_id:'gif'}})
  assert.equal(new StickerCollection(f.file,f.api).lookup(99,-10,5).threadId,20)
  assert.equal(f.service.lookup(98,-10,5),undefined)
  assert.equal(f.service.lookup(99,-11,5),undefined)
  assert.equal(stickerMedia({document:{file_id:'x',mime_type:'text/html'}}),undefined)
  assert.equal(stickerMedia({sticker:{file_id:'x',is_animated:true}}).kind,'animated')
  fs.writeFileSync(f.file,'{broken')
  assert.throws(()=>new StickerCollection(f.file,f.api),/损坏/)
  assert.equal(fs.readFileSync(f.file,'utf8'),'{broken')
})

const captionedGif = {
  chat:{id:-10},message_id:12,message_thread_id:20,caption:'转发说明',
  animation:{file_id:'animation-file',file_size:1024,mime_type:'video/mp4'},
  document:{file_id:'legacy-document',mime_type:'video/mp4'},
}

test('captioned Telegram GIF uses animation over the compatibility document',()=>{
  assert.deepEqual(stickerMedia(captionedGif),{fileId:'animation-file',size:1024,kind:'video',threadId:20})
  assert.equal(stickerMedia({document:captionedGif.document}),undefined,'ordinary MP4 documents are not GIFs')
})

function telegramFixture(t,options = {}) {
  const f = fixture(t),exports = {},out = []
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/service/StickerCollectionTelegram'),'utf8'),{exports,require(name) {
    if(name === './StickerCollectionMedia')return {prepareCollectedSticker:(_telegram,input)=>f.api.prepare(input)}
    if(name === './StickerCollection')return {StickerCollection,stickerMedia}
    return require(name)
  },Date,Error})
  const bot = {botInfo,telegram:{async callApi(method,payload) {
    if(method === 'sendPhoto')return {chat:{id:payload.chat_id},message_id:12,message_thread_id:20,photo:[{file_id:'same-image'}]}
    if(method === 'sendAnimation')return {...captionedGif,chat:{id:payload.chat_id}}
    return f.api.call(method,payload)
  },async sendMessage(chat,text,extra) {out.push({chat,text,extra})}},use(fn) {this.handler = fn}}
  exports.installStickerCollection(bot,{directory:f.directory,owner:async()=>7,allowed:async(chat,thread)=>chat === 7 || (chat === -10 && thread === 20),now:()=>100000,...options})
  const invoke = async(update)=>{
    let forwarded = false
    const message = update.message,reaction = update.message_reaction
    const ctx = {update,message,botInfo,from:message?.from || reaction?.user,chat:message?.chat || reaction?.chat}
    await bot.handler(ctx,async()=>{forwarded = true})
    return forwarded
  }
  return {...f,bot,invoke,out,updates:exports.STICKER_COLLECTION_UPDATES}
}
const replyUpdate = (overrides = {})=>({message:{message_id:100,date:101,from:{id:7},chat:{id:-10},message_thread_id:20,text:'收藏',reply_to_message:{message_id:12,photo:[{file_id:'same-image'}]},...overrides}})
const reactionUpdate = (overrides = {})=>({message_reaction:{date:101,user:{id:7},chat:{id:-10},message_id:12,old_reaction:[],new_reaction:[{type:'emoji',emoji:'👍'}],...overrides}})

test('reply 收藏 consumes the command, returns a pack link in the same topic, and does not forward', async t=>{
  const f = telegramFixture(t)
  assert.equal(await f.invoke(replyUpdate()),false)
  assert.match(f.out[0].text,/https:\/\/t.me\/addstickers\//)
  assert.equal(f.out[0].extra.message_thread_id,20)
  assert.equal(f.out[0].extra.reply_parameters.message_id,12)
  assert.equal(await f.invoke(replyUpdate({text:'普通聊天'})),true)
  assert.equal(await f.invoke(replyUpdate({text:'/collect@different_bot'})),true)
})

test('new owner thumbs-up uses a persisted outgoing receipt; repeated reaction and removal do nothing', async t=>{
  const f = telegramFixture(t)
  assert.ok(f.updates.includes('message_reaction'))
  await f.bot.telegram.callApi('sendPhoto',{chat_id:-10})
  await f.invoke(reactionUpdate())
  assert.match(f.out[0].text,/已加入/)
  assert.equal(f.out[0].extra.message_thread_id,20)
  await f.invoke(reactionUpdate({old_reaction:[{type:'emoji',emoji:'👍'}]}))
  await f.invoke(reactionUpdate({new_reaction:[]}))
  await f.invoke(reactionUpdate({new_reaction:[{type:'emoji',emoji:'❤'}]}))
  assert.equal(f.out.length,1)
  await f.invoke(replyUpdate())
  assert.match(f.out[1].text,/已收藏过/)
})

test('👍 collects a newly forwarded GIF with a caption and both Bot API media fields',async t=>{
  const f = telegramFixture(t)
  await f.bot.telegram.callApi('sendAnimation',{chat_id:-10})
  await f.invoke(reactionUpdate())
  assert.match(f.out[0].text,/已加入/)
  assert.equal(f.calls.find(c=>c.method === 'uploadStickerFile').payload.sticker.source.toString(),'animation-file')
})

test('reply collects an unindexed historical GIF and backfills the receipt for later 👍',async t=>{
  const f = telegramFixture(t)
  assert.equal(await f.invoke(replyUpdate({reply_to_message:captionedGif})),false)
  assert.match(f.out[0].text,/已加入/)
  await f.invoke(reactionUpdate())
  assert.match(f.out[1].text,/已收藏过/)
  assert.equal(f.calls.filter(c=>c.method === 'uploadStickerFile').length,1)
})

test('owner 👍 recovers an unindexed message in its real topic without a prior reply',async t=>{
  let lookups = 0
  const f = telegramFixture(t,{findHistory:async(...args)=>{
    assert.deepEqual(args,[-10,12,99,7]);lookups++
    return {threadId:20,prepare:()=>f.api.prepare({fileId:'same-image'})}
  }})
  await f.invoke(reactionUpdate())
  assert.match(f.out[0].text,/已加入/)
  assert.equal(f.out[0].extra.message_thread_id,20)
  assert.equal(f.out[0].extra.reply_parameters.message_id,12)
  await f.invoke(replyUpdate())
  assert.match(f.out[1].text,/已收藏过/)
  assert.equal(f.calls.filter(c=>c.method === 'uploadStickerFile').length,1)
  assert.equal(lookups,1)
})

test('no history read by non-owner; unbound history topic or changed owner never uploads',async t=>{
  let owner = 7,reads = 0,downloads = 0,threadId = 21
  const f = telegramFixture(t,{owner:async()=>owner,findHistory:async()=>{
    reads++
    return {threadId,prepare:async()=>{downloads++;owner = 8;return f.api.prepare({fileId:'same-image'})}}
  }})
  await f.invoke(reactionUpdate({user:{id:8}}))
  await f.invoke(reactionUpdate())
  assert.equal(reads,1)
  assert.equal(downloads,0)
  threadId = 20
  await f.invoke(reactionUpdate())
  assert.equal(downloads,1)
  assert.equal(f.calls.length,0)
  assert.equal(f.out.length,0)
})

test('non-owner, anonymous actor, unbound chat and stale updates cannot collect', async t=>{
  const f = telegramFixture(t)
  await f.bot.telegram.callApi('sendPhoto',{chat_id:-10})
  for(const update of [replyUpdate({from:{id:8}}),replyUpdate({chat:{id:-11}}),replyUpdate({date:99}),
    reactionUpdate({user:{id:8}}),reactionUpdate({actor_chat:{id:-10}}),reactionUpdate({date:99})])
    await f.invoke(update)
  assert.equal(f.out.length,0)
  assert.equal(f.calls.length,0)
})

test('unknown historical reaction gives reply fallback, unsupported reply gives help, and neither uploads', async t=>{
  const f = telegramFixture(t)
  await f.invoke(reactionUpdate({chat:{id:7}}))
  assert.match(f.out[0].text,/回复原消息发送 \/collect/)
  await f.invoke(replyUpdate({reply_to_message:{message_id:12,text:'plain'}}))
  assert.match(f.out[1].text,/请回复图片/)
  assert.equal(f.calls.length,0)
})