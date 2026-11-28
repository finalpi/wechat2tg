/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const {XMLParser, XMLValidator} = require('fast-xml-parser')
const {axiosInstance} = require('wx2tg-puppet/dist/utils/axiosInstance')
const {WebMessageStore} = require('../dist/webui/message-store')
const {TelegramOutbox} = require('../dist/webui/telegram-outbox')
const locationUtils = require('../dist/util/WechatLocation')

const nativeId = '9007199254740993123'
const venue = locationUtils.telegramLocationFields(0,-122.12345,'地点 <A> & "B"','地址 \'C\'')
const parse = xml => new XMLParser({ignoreAttributes:false,attributeNamePrefix:''}).parse(xml).msg.location

test('location XML validates coordinate bounds and escapes venue metadata', () => {
  assert.equal(XMLValidator.validate(venue.source_text),true)
  const location = parse(venue.source_text)
  assert.equal(location.x,'0')
  assert.equal(location.y,'-122.12345')
  assert.equal(location.poiname,venue.location.title)
  assert.equal(location.label,venue.location.address)
  for(const [lat,lon] of [[NaN,0],[0,Infinity],[-90.1,0],[0,180.1],['10',0],[0,null]]){
    assert.equal(locationUtils.telegramLocationFields(lat,lon),undefined)
  }
})

test('location uses native WeChat type 48, journals the receipt and does not resend an uncertain result', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'wechat-location-'))
  const store = new WebMessageStore(path.join(directory,'messages.db'))
  t.after(async()=>{await store.close();fs.rmSync(directory,{recursive:true,force:true})})
  const requests = []
  const replies = [
    `{"Code":0,"Success":true,"Data":{"BaseResponse":{"Ret":0},"List":[{"Ret":0,"NewMsgId":${nativeId},"MsgId":123,"CreateTime":123456,"ToUsetName":{"string":"wx_peer"}}]}}`,
    '{"Code":0,"Success":true,"Data":{"List":[{"Ret":0}]}}',
    '{"Code":-1,"Success":false,"Data":{"List":[{"Ret":-1}]}}',
  ]
  const server = http.createServer(async(req,res)=>{
    const chunks = []
    for await(const chunk of req)chunks.push(chunk)
    requests.push({url:req.url,method:req.method,body:JSON.parse(Buffer.concat(chunks).toString())})
    res.setHeader('Content-Type','application/json')
    res.end(replies.shift() || '{}')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const {baseURL,proxy} = axiosInstance.defaults
  axiosInstance.defaults.baseURL = `http://127.0.0.1:${server.address().port}/api`
  axiosInstance.defaults.proxy = false
  t.after(async()=>{axiosInstance.defaults.baseURL = baseURL;axiosInstance.defaults.proxy = proxy;await new Promise(resolve=>server.close(resolve))})

  const exports = {}, notices = [], saved = [], log = [], journal = new TelegramOutbox(store,null)
  const bot = {client:{telegram:{sendMessage:async(...args)=>notices.push(args)}}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/client/WechatClient.js'),'utf8'),{exports,process:{env:{}},require:name=>({
    '../base/BaseClient':{AbstractClient:class {static getSpyClient(){return bot}}},
    '../util/WechatLocation':locationUtils,
    '../config':{config:{SEND_TO_WX_TIMEOUT:3000}},
    '../entity/Message':{Message:class {}},
  })[name] || {}})
  const client = Object.assign(Object.create(exports.WeChatClient.prototype),{
    hasReady:true,hasLogin:true,_wxInfo:{wxid:'self'},telegramOutbox:journal,
    logger:{warn:()=>undefined,error:error=>log.push(error.message)},
    messageService:{createOrUpdate:async value=>{saved.push({...value});return value}},
    bindGroupService:{resolveTelegram:async(chatId,threadId)=>chatId === -100 && threadId === 77 ? {wxId:'wx_peer',type:0,threadId} : undefined},
  })
  const message = (id,threadId = 77)=>({...venue,id,chatId:-100,threadId,senderId:'',wxId:'old_destination',sender:'{me}'})
  assert.equal(await client.sendMessage(message('1')),true)
  assert.equal(await client.sendMessage(message('1')),true)
  assert.equal(await client.sendMessage(message('2',88)),false)
  assert.equal(await client.sendMessage(message('3')),false)
  assert.equal(await client.sendMessage(message('3')),true,'duplicate update does not make another attempt')
  assert.equal(await client.sendMessage(message('4')),false)
  assert.equal(requests.length,3)
  assert.deepEqual(requests[0],{url:'/api/Msg/SendTxt',method:'POST',body:{Wxid:'self',ToWxid:'wx_peer',Type:48,At:'',Content:venue.source_text}})

  const row = await store.byRemoteId('wx_peer',nativeId)
  assert.equal(row.type,'location')
  assert.equal(row.status,'submitted')
  assert.equal(row.telegramStatus,'synced')
  assert.equal(row.body,venue.location.title)
  const details = JSON.parse(row.details), source = JSON.parse(row.source)
  assert.deepEqual([details.latitude,details.longitude,details.address,details.telegram.threadId],[0,-122.12345,venue.location.address,77])
  assert.equal(source.Content,venue.source_text)
  assert.equal(source.MsgType,48)
  assert.equal(source.NewMsgId,nativeId)
  assert.equal(saved.find(row=>row.wxMsgId === nativeId).source_type,'location')
  assert.equal(await store.isManagedEcho({self:()=>true,toId:'wx_peer',newMsgId:nativeId}),true)
  assert.equal((await store.byRequest('telegram:-100:3:location')).status,'unknown')
  assert.equal((await store.byRequest('telegram:-100:4:location')).status,'failed')
  assert.match(notices[0][1],/未确认/)
  assert.match(notices[1][1],/失败/)
  assert.deepEqual(log,['wechatLocationUnconfirmed','wechatLocationSendFailed'])
})