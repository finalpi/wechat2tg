/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const {Api,utils} = require('telegram'),{returnBigInt:bigInt} = require('telegram/Helpers'),sharp = require('sharp')
const {findHistoricalSticker} = require('../dist/service/StickerCollectionHistory')

const peer = new Api.PeerChannel({channelId:bigInt(55)})
const chatId = Number(utils.getPeerId(peer))
function original(overrides = {}) {
  return new Api.Message({id:12,peerId:peer,fromId:new Api.PeerUser({userId:bigInt(99)}),
    replyTo:new Api.MessageReplyHeader({forumTopic:true,replyToTopId:20,replyToMsgId:21}),
    date:100,message:'说明文字',media:new Api.MessageMediaPhoto({photo:new Api.Photo({id:bigInt(1),accessHash:bigInt(2),
      date:100,dcId:1,fileReference:Buffer.alloc(0),sizes:[new Api.PhotoSize({type:'x',w:48,h:32,size:1024})]})}),...overrides})
}
function fixture(message,sessionId = 99) {
  let lookups = 0
  const client = {connected:true,async getMe() {return {userId:bigInt(sessionId)}},
    async getInputEntity(id) {assert.equal(id,chatId);return peer},
    async getMessages(input,request) {assert.equal(input,peer);assert.deepEqual(request.ids,[12]);lookups++;return [message]}}
  return {client,get lookups() {return lookups},lookup:()=>findHistoricalSticker(client,chatId,12,99,7)}
}

test('GramJS history uses the exact media message and recovers its topic before downloading',async()=>{
  const message = original(),f = fixture(message)
  let downloads = 0
  const bytes = await sharp({create:{width:48,height:32,channels:3,background:'#22bbcc'}}).jpeg().toBuffer()
  message.downloadMedia = async({thumb})=>{assert.equal(thumb.type,'x');downloads++;return bytes}
  const target = await f.lookup()
  assert.equal(target.threadId,20)
  assert.equal(downloads,0)
  assert.equal((await target.prepare()).format,'static')
  assert.equal(downloads,1)
})

test('history will not use another session, peer, sender, message, or protected media',async()=>{
  const otherSession = fixture(original(),8)
  assert.equal(await otherSession.lookup(),undefined)
  assert.equal(otherSession.lookups,0)
  for(const message of [original({id:13}),original({peerId:new Api.PeerChannel({channelId:bigInt(56)})}),
    original({fromId:new Api.PeerUser({userId:bigInt(8)})}),original({noforwards:true}),original({media:undefined})]) {
    message.downloadMedia = async()=>assert.fail('must not download media')
    assert.equal(await fixture(message).lookup(),undefined)
  }
})

test('historical MP4 is a GIF only when Telegram marks it animated, and size is checked before download',async()=>{
  const message = (attrs)=>original({media:new Api.MessageMediaDocument({document:new Api.Document({id:bigInt(1),accessHash:bigInt(2),
    date:100,dcId:1,fileReference:Buffer.alloc(0),mimeType:'video/mp4',size:bigInt(21 * 1024 * 1024),attributes:attrs})})})
  assert.equal(await fixture(message([])).lookup(),undefined)
  const animation = message([new Api.DocumentAttributeAnimated()])
  animation.downloadMedia = async()=>assert.fail('must not download oversized media')
  const target = await fixture(animation).lookup()
  await assert.rejects(target.prepare(),/20 MB/)
})