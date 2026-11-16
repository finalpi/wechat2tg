/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {Message} = require('wx2tg-puppet')
const {isControlMessage} = require('../dist/webui/message-visibility')
const {WebMessageStore} = require('../dist/webui/message-store')
const {getWechatCallStatus,formatWechatCallStatus} = require('../dist/util/WechatCallStatus')
const {control,invite,cancel,dismiss,bubble} = require('./helpers/wechat-call.cjs')

async function fixture(t){
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'wechat-calls-')),file = path.join(directory,'messages.db')
  let store = new WebMessageStore(file);await store.ready
  const close = async()=>{await store.ready;await store.writes;await new Promise((resolve,reject)=>store.db.close(error=>error ? reject(error) : resolve()))}
  t.after(async()=>{await close();fs.rmSync(directory,{recursive:true,force:true})})
  return {get store(){return store},async restart(){await close();store = new WebMessageStore(file);await store.ready}}
}

test('only complete cancel/dismissapns structures are hidden, including stored source wrappers',()=>{
  for(const xml of [cancel,dismiss,control('<dismissapns/>'),control('<cancel>x</cancel><dismissapns/>'),`<?xml version="1.0"?>\n${cancel.replace('type="ilinkvoip"','type=\'ilinkvoip\'')}`]){
    for(const source of [xml,JSON.stringify({xml}),JSON.stringify({Content:xml})]){
      for(const type of ['voip','unknown','10002'])assert.equal(isControlMessage(type,source),true)
      for(const type of ['text','0','1'])assert.equal(isControlMessage(type,source),false,'user text examples must remain text')
    }
  }
})

test('invites, readable call results, other subtypes and malformed/ambiguous XML are not discarded',()=>{
  for(const source of [invite,bubble,control('<invite>x</invite><cancel>y</cancel>'),control('<notify>missed call</notify>'),
    cancel.replace('ilinkvoip','other'),cancel.replace('</sysmsg>',''),cancel + invite,
    control('<cancel><msg>readable notice</msg></cancel>'),`<!DOCTYPE sysmsg>${cancel}`,
    '<msg><![CDATA[' + cancel + ']]></msg>',control(''),JSON.stringify({xml:invite}),cancel + 'x'.repeat(131073)]){
    assert.equal(isControlMessage('voip',source),false)
  }
  assert.equal(getWechatCallStatus(bubble),'已在其它设备接听')
  assert.equal(formatWechatCallStatus(getWechatCallStatus(bubble)),'[视频/语音] 已在其它设备接听')
  assert.equal(formatWechatCallStatus('<结束> & 未接听'),'[视频/语音] &lt;结束&gt; &amp; 未接听')
})

test('live WebUI capture keeps the invitation and final bubble, not opaque control payloads',async t=>{
  const f = await fixture(t)
  let index = 0
  for(const xml of [invite,cancel,dismiss,bubble]){
    const message = new Message({MsgType:xml === bubble ? 50 : 10002,Content:xml,xml,MsgId:String(++index),NewMsgId:String(index),FromUserName:'peer',ToUserName:'self',CreateTime:index})
    message.self = ()=>false;message.room = async()=>undefined;message.from = async()=>({_wxid:'peer',name:()=>'Peer'})
    await f.store.observe(message)
  }
  const result = await f.store.history('peer')
  assert.equal(result.messages.length,2)
  assert.deepEqual(result.messages.map(message=>message.type),['voip','voip'])
  assert.equal(result.messages[1].body,'已在其它设备接听')
  assert.equal((await f.store.all('SELECT id FROM inbox')).length,2)
})

test('history imports and startup hide only controls without deleting original archives or later calls',async t=>{
  const f = await fixture(t)
  const entries = [invite,cancel,dismiss,bubble,invite,bubble].map((xml,index)=>({wxId:'peer',remoteId:String(index + 1),body:xml === bubble ? '已在其它设备接听' : '[视频/语音]',type:'voip',direction:'incoming',status:'received',telegramStatus:'pending',timestamp:index + 1,source:JSON.stringify({Content:xml})}))
  await f.store.importHistory(entries)
  assert.deepEqual((await f.store.history('peer')).messages.map(row=>row.remoteId),['1','4','5','6'])
  // Simulate rows retained by the older version, including already-synced controls.
  await f.store.run('UPDATE inbox SET hidden=0,telegramStatus=\'synced\',telegramTracked=1')
  await f.restart()
  assert.deepEqual((await f.store.history('peer')).messages.map(row=>row.remoteId),['1','4','5','6'])
  const hidden = await f.store.all('SELECT * FROM inbox WHERE hidden=1')
  assert.equal(hidden.length,2)
  assert(hidden.every(row=>row.telegramStatus === 'excluded' && row.telegramTracked === 0 && row.source))
  for(const row of hidden)assert.equal(await f.store.claimSync(row.id),false)
  assert.equal((await f.store.all('SELECT id FROM inbox')).length,6,'original protocol records are not deleted')
})