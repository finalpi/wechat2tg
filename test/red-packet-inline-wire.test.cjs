/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),http = require('node:http')
const {once} = require('node:events'),{Telegraf,Context} = require('telegraf')
const {RedPacketService} = require('../dist/service/RedPacketService')
const {handleRedPacketCallback} = require('../dist/service/RedPacketTelegram')

test('Telegram callback wire edits the exact original photo keyboard without sending another message',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'red-packet-inline-')),requests = []
  let claims = 0
  const service = new RedPacketService(async()=>({accountId:'self',ownerId:123,baseURL:'unused'}),async()=>{
    claims++;return {status:200,data:{Code:0,Success:true,Data:{retcode:0,sendId:'synthetic123',receiveId:'receipt123',amount:123}}}
  },path.join(directory,'journal.db'))
  const server = http.createServer(async(req,res)=>{
    let raw = '';for await(const chunk of req)raw += chunk
    requests.push({method:req.url.split('/').pop(),body:JSON.parse(raw)})
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,result:true}))
  })
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await service.close();fs.rmSync(directory,{recursive:true,force:true})})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const bot = new Telegraf('123:synthetic-test-only',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
  const entry = await service.register({accountId:'self',conversation:'room@chatroom',remoteId:'123',chatId:-100,threadId:77,
    source:'<msg><appmsg><type>2001</type><wcpayinfo><paymsgid>synthetic123</paymsgid><nativeurl>wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=synthetic123</nativeurl></wcpayinfo></appmsg></msg>'})
  const data = `rpo:${entry.token}`,message = {message_id:9,date:0,chat:{id:-100,type:'supergroup'},message_thread_id:77,
    photo:[{file_id:'photo',file_unique_id:'photo',width:100,height:200}],caption:'Original caption',
    reply_markup:{inline_keyboard:[[{text:'Other',callback_data:'other:action'}],[{text:'拆红包',callback_data:data}]]}}
  const ctx = new Context({update_id:1,callback_query:{id:'callback123',chat_instance:'test',from:{id:123,is_bot:false,first_name:'Owner'},message,data}},bot.telegram,{id:456,is_bot:true,first_name:'Test',username:'test_bot'})
  await handleRedPacketCallback(ctx,data,123,async()=>({wxId:'room@chatroom'}),service,async()=>{
    assert.equal(claims,0);assert.equal((await service.status(entry.token)).state,'opening')
    assert.deepEqual(requests.map(x=>x.method),['answerCallbackQuery'])
  })
  assert.equal(claims,1)
  assert.deepEqual(requests.map(x=>x.method),['answerCallbackQuery','editMessageReplyMarkup'])
  for(const {body} of requests.filter(x=>x.method === 'editMessageReplyMarkup')){
    assert.equal(body.chat_id,-100);assert.equal(body.message_id,9)
    assert.deepEqual(body.reply_markup.inline_keyboard[0],[{text:'Other',callback_data:'other:action'}])
    assert.equal(body.caption,undefined);assert.equal(body.text,undefined);assert.equal(body.media,undefined)
    assert.equal(body.reply_markup.inline_keyboard.at(-1)[0].text,'已领取 ¥1.23')
  }
  assert.equal(requests.at(-1).body.reply_markup.inline_keyboard.at(-1)[0].text,'已领取 ¥1.23')
  await handleRedPacketCallback(ctx,`rps:${entry.token}`,123,async()=>({wxId:'room@chatroom'}),service,async()=>assert.fail('status must not wait or claim'))
  const alert = requests.filter(x=>x.method === 'answerCallbackQuery').at(-1).body
  assert.equal(alert.show_alert,true);assert.match(alert.text,/1\.23/);assert.equal(claims,1)
  assert.deepEqual(requests.map(x=>x.method),['answerCallbackQuery','editMessageReplyMarkup','answerCallbackQuery'])
})