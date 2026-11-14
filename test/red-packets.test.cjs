/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const {once} = require('node:events')
const {readWechatRedPacket} = require('../dist/util/WechatRedPacket')
const {redPacketCoverURL} = require('../dist/util/RedPacketCover')
const {createArticleCoverLoader,articleCoverURL} = require('../dist/util/ArticleCover')
const {RedPacketService,redPacketOutcome,requestRedPacketOpen} = require('../dist/service/RedPacketService')
const {handleRedPacketCallback} = require('../dist/service/RedPacketTelegram')
const {redPacketOwnedBy} = require('../dist/webui/red-packets')
const id = '10000000000000000001'
const xml = (extra = '',packetId = id) => `<msg><appmsg><type>2001</type><wcpayinfo><receivertitle><![CDATA[祝福 <&>]]></receivertitle><paymsgid>${packetId}</paymsgid><nativeurl><![CDATA[wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=${packetId}&sign=private-payment-token]]></nativeurl>${extra}</wcpayinfo></appmsg></msg>`
const accepted = (packetId = id) => ({status:200,data:{Code:0,Success:true,Data:{retcode:0,sendId:packetId,receiveId:'receipt-1',amount:123}}})
async function fixture(t,send) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'red-packet-test-')), file = path.join(directory,'journal.db')
  let session = {accountId:'self',ownerId:123,baseURL:'http://127.0.0.1:1/api'},calls = []
  const transport = async(...args)=>{calls.push(args);return send ? send(...args) : accepted()}
  let service = new RedPacketService(async()=>session,transport,file)
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true})})
  const input = {accountId:'self',conversation:'room@chatroom',remoteId:'900000000000000001',source:xml(),chatId:-100,threadId:77}
  const entry = await service.register(input)
  return {get service(){return service},input,entry,calls,file,setSession:value=>{session = value},
    async restart(){await service.close();service = new RedPacketService(async()=>session,transport,file)}}
}

test('packet parsing preserves exact IDs, separates unopened/detail/bubble artwork and rejects unsafe actions', () => {
  const extra = '<senderc2cshowsourceurl>https://snssvppicb.video.qq.com/sender.png</senderc2cshowsourceurl><receiverc2cshowsourceurl>https://snssvppicc.video.qq.com/receiver.png</receiverc2cshowsourceurl><recshowsourceurl>https://snssvppicb.video.qq.com/unopened.png</recshowsourceurl><detailshowsourceurl>https://snssvppicc.video.qq.com/opened.png</detailshowsourceurl>'
  const packet = readWechatRedPacket(JSON.stringify({Content:xml(extra)}))
  assert.equal(packet.sendId,id);assert.equal(packet.claimable,true);assert.equal(packet.title,'祝福 <&>')
  assert.equal(readWechatRedPacket('sender:\n' + xml()).xml,xml())
  assert.equal(packet.coverUrl,'https://snssvppicb.video.qq.com/unopened.png')
  assert.equal(packet.openedCoverUrl,'https://snssvppicc.video.qq.com/opened.png')
  assert.equal(packet.bubbleCoverUrl,'https://snssvppicc.video.qq.com/receiver.png')
  const outgoing = readWechatRedPacket(xml(extra),true)
  assert.equal(outgoing.coverUrl,packet.coverUrl)
  assert.equal(outgoing.openedCoverUrl,packet.openedCoverUrl)
  assert.equal(outgoing.bubbleCoverUrl,'https://snssvppicb.video.qq.com/sender.png')
  assert.equal(readWechatRedPacket(xml().replace('2001','2000')),undefined)
  assert.equal(readWechatRedPacket('<!DOCTYPE msg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml()),undefined)
  assert.equal(readWechatRedPacket(xml().replace(`sendid=${id}`,'sendid=other-packet')).claimable,false)
  assert.equal(readWechatRedPacket(xml().replace('wxpay:','https:')).claimable,false)
  assert.equal(readWechatRedPacket(xml('<paymsgid>duplicate</paymsgid>')).claimable,false)
  assert.equal(readWechatRedPacket(xml('<iconurl>http://127.0.0.1/private</iconurl>')).coverUrl,'')
  assert.equal(readWechatRedPacket('x'.repeat(524289)),undefined)
  assert.equal(readWechatRedPacket(xml().replace('</msg>','')),undefined)
  assert.equal(readWechatRedPacket(xml().replace('</wcpayinfo>','</wrong>')),undefined)
  assert.equal(redPacketOwnedBy(JSON.stringify({FromUserName:'other',ToUserName:'old-account'}),'self'),false)
  assert.equal(redPacketOwnedBy(JSON.stringify({FromUserName:'self',ToUserName:'room@chatroom'}),'self'),true)
})

test('missing/unsafe unopened covers never fall back to opened details or chat banners', () => {
  const alternatives = '<detailshowsourceurl>https://wx.gtimg.com/opened.png</detailshowsourceurl><receiverc2cshowsourceurl>https://wx.gtimg.com/banner.png</receiverc2cshowsourceurl><senderc2cshowsourceurl>https://wx.gtimg.com/sender-banner.png</senderc2cshowsourceurl>'
  for(const outgoing of [false,true]){
    for(const cover of ['', '<recshowsourceurl>http://127.0.0.1/private</recshowsourceurl>']){
      assert.equal(readWechatRedPacket(xml(alternatives + cover),outgoing).coverUrl,'')
      assert.equal(readWechatRedPacket(xml(alternatives + cover + '<iconurl>https://wx.gtimg.com/generic.png</iconurl>'),outgoing).coverUrl,'https://wx.gtimg.com/generic.png')
    }
  }
  assert.equal(readWechatRedPacket(xml('<detailshowsourceurl>https://wxapp.tenpay.com/pay</detailshowsourceurl>')).openedCoverUrl,'')
})

test('cover fetching is bounded, re-encoded and rejects redirects to payment/private hosts without broadening article URLs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'red-cover-test-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  for(const url of ['https://wxapp.tenpay.com/pay','wxpay://c2cbizmessagehandler/hongbao/receivehongbao','https://wx.gtimg.com.evil.example/a','https://u:p@wx.gtimg.com/a','http://127.0.0.1/a'])assert.equal(redPacketCoverURL(url),'')
  assert.equal(articleCoverURL('https://wx.gtimg.com/a.png'),'','article allowlist stays independent')
  let calls = 0
  const rejected = createArticleCoverLoader(path.join(directory,'bad'),async()=>{calls++;return {status:302,headers:{location:'http://127.0.0.1/private'},data:Buffer.alloc(0)}},redPacketCoverURL)
  await assert.rejects(rejected('https://wx.gtimg.com/a.png'),error=>error.code === 'coverUnavailable');assert.equal(calls,1)
  const png = await require('sharp')({create:{width:32,height:48,channels:3,background:'#882233'}}).png().toBuffer()
  const good = createArticleCoverLoader(path.join(directory,'good'),async(_url,options)=>{
    assert.equal(options.maxRedirects,0);assert(options.maxContentLength <= 3 * 1024 * 1024)
    return {status:200,headers:{},data:png}
  },redPacketCoverURL)
  assert.equal((await require('sharp')(await good('http://wx.gtimg.com/a.png')).metadata()).format,'jpeg')
})

test('only matching positive native receipts are successful; empty Go structs and ambiguous transport responses stay unknown', () => {
  assert.deepEqual(redPacketOutcome(accepted(),id),{state:'received',canOpen:false,amountFen:123})
  for(const response of [undefined,{status:200,data:{Code:0,Success:true,Data:{}}},{status:500,data:{}},
    {status:200,data:{Code:0,Success:true,Data:{retcode:0,amount:123}}},accepted('different-packet')])assert.equal(redPacketOutcome(response,id).state,'unknown')
  const rejected = accepted();rejected.data.Data.retcode = 1001;rejected.data.Data.retmsg = 'private-payment-token'
  assert.deepEqual(redPacketOutcome(rejected,id),{state:'unavailable',canOpen:false,reason:'wechatRejected'})
  assert.equal(redPacketOutcome({status:404,data:{}},id).reason,'routeUnavailable')
})

test('registering, viewing and cancelling never claim; confirmation is account/owner/scope-bound', async t => {
  const f = await fixture(t), service = f.service
  assert.equal(fs.statSync(f.file).mode & 0o777,0o600)
  const preview = await service.prepare(f.entry.token,'webui:1')
  assert.equal(f.calls.length,0)
  await assert.rejects(service.open(f.entry.token,preview.confirmation,'webui:2'),e=>e.code === 'redPacketConfirmationExpired')
  const cancelled = await service.prepare(f.entry.token,'webui:1')
  await service.cancel(cancelled.confirmation,'webui:1')
  await assert.rejects(service.open(f.entry.token,cancelled.confirmation,'webui:1'))
  const prepared = await service.prepare(f.entry.token,'webui:1')
  f.setSession({accountId:'different-account',ownerId:123,baseURL:'unused'})
  await assert.rejects(service.open(f.entry.token,prepared.confirmation,'webui:1'))
  f.setSession({accountId:'self',ownerId:456,baseURL:'unused'})
  await assert.rejects(service.open(f.entry.token,prepared.confirmation,'webui:1'))
  assert.equal(f.calls.length,0)
})

test('expiry and final authorization checks stop dispatch and do not permanently consume a never-sent packet', async t => {
  const f = await fixture(t)
  const expired = await f.service.prepare(f.entry.token,'webui:1')
  f.service.confirmations.get(expired.confirmation).expires = 0
  await assert.rejects(f.service.open(f.entry.token,expired.confirmation,'webui:1'))
  const valid = await f.service.prepare(f.entry.token,'webui:1')
  let checks = 0
  await assert.rejects(f.service.open(f.entry.token,valid.confirmation,'webui:1',async()=>++checks < 2))
  assert.equal(f.calls.length,0);assert.equal((await f.service.status(f.entry.token)).state,'ready')
  const switched = await f.service.prepare(f.entry.token,'webui:1')
  checks = 0
  await assert.rejects(f.service.open(f.entry.token,switched.confirmation,'webui:1',async()=>{
    if(++checks === 2)f.setSession({accountId:'other',ownerId:123,baseURL:'unused'})
    return true
  }))
  assert.equal(f.calls.length,0,'an account switch during the final binding guard still prevents dispatch')
})

test('concurrent WebUI/Telegram clicks and duplicate message IDs share one durable money operation', async t => {
  let finish,entered
  const pending = new Promise(resolve=>{finish = resolve}),started = new Promise(resolve=>{entered = resolve})
  const f = await fixture(t,()=>{entered();return pending})
  const duplicate = await f.service.register({...f.input,remoteId:'900000000000000002'})
  assert.equal(duplicate.token,f.entry.token)
  const confirmations = await Promise.all(Array.from({length:8},(_,i)=>f.service.prepare(f.entry.token,`scope:${i}`)))
  const openings = confirmations.map((entry,i)=>f.service.open(f.entry.token,entry.confirmation,`scope:${i}`))
  await started
  assert.equal(f.calls.length,1);finish(accepted())
  await Promise.all(openings)
  assert.equal(f.calls.length,1)
  assert.equal((await f.service.status(f.entry.token)).amountFen,123)
  await f.restart()
  assert.equal((await f.service.register(f.input)).state,'received')
  await f.service.open(f.entry.token,'already-consumed','webui:1')
  assert.equal(f.calls.length,1)
})

test('timeouts, 5xx and malformed success replies never retry after restart', async t => {
  const f = await fixture(t,async()=>{throw Object.assign(new Error('sensitive XML'),{code:'ETIMEDOUT'})})
  const prepared = await f.service.prepare(f.entry.token,'webui:1')
  assert.equal((await f.service.open(f.entry.token,prepared.confirmation,'webui:1')).state,'unknown')
  await f.restart()
  assert.equal((await f.service.prepare(f.entry.token,'webui:1')).canOpen,false)
  assert.equal((await f.service.open(f.entry.token,'anything','webui:1')).state,'unknown')
  assert.equal(f.calls.length,1)
  const row = await f.service.row(f.entry.token)
  assert.equal(row.xml,null,'payment XML is cleared after an attempted claim')
})

test('interrupted opening becomes unknown on startup and is never replayed', async t => {
  const f = await fixture(t)
  await f.service.run('UPDATE red_packets SET state=\'opening\' WHERE token=?',[f.entry.token])
  await f.restart()
  assert.equal((await f.service.status(f.entry.token)).state,'unknown')
  assert.equal((await f.service.prepare(f.entry.token,'webui:1')).confirmation,undefined)
  assert.equal(f.calls.length,0)
})

test('registered AutoHongBao route is used once without redirects or SDK logging', async t => {
  const received = []
  const server = http.createServer(async(req,res)=>{
    let raw = '';for await(const chunk of req)raw += chunk
    received.push({url:req.url,body:JSON.parse(raw)})
    res.writeHead(302,{Location:'/api/TenPay/OpenHongBao'});res.end('{}')
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const response = await requestRedPacketOpen({accountId:'self',ownerId:123,baseURL:`http://127.0.0.1:${server.address().port}/api`},xml(),'room@chatroom')
  assert.equal(response.status,302);assert.equal(received.length,1)
  assert.equal(received[0].url,'/api/TenPay/AutoHongBao')
  assert.equal(received[0].body.SendUserName,'room@chatroom')
})

test('Telegram opening is owner-only and topic-scoped, with bounded callbacks and private result alerts', async t => {
  const f = await fixture(t), replies = [], alerts = [], edits = []
  const ctx = {from:{id:456},chat:{id:-100},callbackQuery:{message:{message_id:9,message_thread_id:77}},
    answerCbQuery:async(...args)=>alerts.push(args),reply:async(...args)=>replies.push(args),editMessageText:async(...args)=>edits.push(args)}
  const resolve = async()=>({wxId:'room@chatroom'})
  await handleRedPacketCallback(ctx,`rp:${f.entry.token}`,123,resolve,f.service)
  assert.equal(replies.length,0);assert.equal(f.calls.length,0)
  ctx.from.id = 123;ctx.callbackQuery.message.message_thread_id = 88
  await handleRedPacketCallback(ctx,`rp:${f.entry.token}`,123,resolve,f.service)
  assert.equal(replies.length,0)
  ctx.callbackQuery.message.message_thread_id = 77
  await handleRedPacketCallback(ctx,`rp:${f.entry.token}`,123,resolve,f.service)
  const buttons = replies[0][1].reply_markup.inline_keyboard[0]
  assert(buttons.every(button=>Buffer.byteLength(button.callback_data) <= 64))
  assert.equal(f.calls.length,0)
  await handleRedPacketCallback(ctx,buttons[0].callback_data,123,resolve,f.service)
  assert.equal(f.calls.length,1);assert(!edits[0][0].includes('1.23'))
  await handleRedPacketCallback(ctx,`rp:${f.entry.token}`,123,resolve,f.service)
  assert.match(alerts.at(-1)[0],/1\.23/);assert.equal(alerts.at(-1)[1].show_alert,true)
})

test('HTTP routes require owner authentication and explicit confirmation, never accept private protocol input or enable demo claims', async t => {
  const f = await fixture(t), {createWebUIServer} = require('../dist/webui/server')
  const token = 'synthetic-red-packet-owner-token'
  const options = {file:path.join(path.dirname(f.file),'settings.json'),token,environment:{},mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    redPacketStatus:async()=>f.service.prepare(f.entry.token,'webui:1'),
    openRedPacket:async(_id,confirmation)=>f.service.open(f.entry.token,confirmation,'webui:1'),
    redPacketCover:async()=>Buffer.from('synthetic jpg'),
  }}
  const server = createWebUIServer(options);server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const origin = `http://127.0.0.1:${server.address().port}`, endpoint = origin + '/api/messages/1/red-packet'
  assert.equal((await fetch(endpoint)).status,401)
  assert.equal((await fetch(origin + '/api/media/red-packet/1')).status,401)
  const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
  for(const body of [{confirm:false,confirmation:'a'.repeat(32)},{confirm:true,confirmation:'a'.repeat(32),Xml:'forged'},{confirm:true}])assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)})).status,400)
  assert.equal(f.calls.length,0)
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({confirm:true,confirmation:'a'.repeat(32),Xml:xml()})})).status,413)
  const preview = await (await fetch(endpoint,{headers})).json()
  assert(!JSON.stringify(preview).includes('private-payment-token'));assert.equal(f.calls.length,0)
  const result = await (await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({confirm:true,confirmation:preview.confirmation})})).json()
  assert.equal(result.state,'received');assert.equal(f.calls.length,1)
  const image = await fetch(origin + '/api/media/red-packet/1',{headers});assert.equal(image.headers.get('cache-control'),'no-store')
  const demo = createWebUIServer({...options,demo:true});demo.listen(0,'127.0.0.1');await once(demo,'listening')
  t.after(async()=>{demo.closeAllConnections();await new Promise(resolve=>demo.close(resolve))})
  assert.equal((await fetch(`http://127.0.0.1:${demo.address().port}/api/messages/1/red-packet`,{method:'POST',headers,body:JSON.stringify({confirm:true,confirmation:preview.confirmation})})).status,403)
  assert.equal(f.calls.length,1)
})