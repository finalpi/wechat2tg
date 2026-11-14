/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const {once} = require('node:events')
const {readWechatRedPacket} = require('../dist/util/WechatRedPacket')
const {redPacketCoverURL} = require('../dist/util/RedPacketCover')
const {createArticleCoverLoader,articleCoverURL} = require('../dist/util/ArticleCover')
const {RedPacketService,redPacketOutcome,requestRedPacketOpen} = require('../dist/service/RedPacketService')
const {handleRedPacketCallback,redPacketTelegramDelay} = require('../dist/service/RedPacketTelegram')
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

function telegramFixture(token,prefix = 'rpo',text = '拆开并领取') {
  const alerts = [],edits = [],unexpected = []
  const other = {text:'其他操作',callback_data:'other:action'}
  const message = {message_id:9,message_thread_id:77,photo:[{file_id:'original-photo'}],caption:'原始说明',
    reply_markup:{inline_keyboard:[[other],[{text,callback_data:`${prefix}:${token}`}]]}}
  const ctx = {from:{id:123},chat:{id:-100},callbackQuery:{message},
    answerCbQuery:async(...args)=>alerts.push(args),
    reply:async()=>unexpected.push('reply'),editMessageText:async()=>unexpected.push('editText'),editMessageCaption:async()=>unexpected.push('editCaption'),
    editMessageReplyMarkup:async markup=>{edits.push(markup);message.reply_markup = markup}}
  return {ctx,alerts,edits,unexpected,other}
}
const packetBinding = async()=>({wxId:'room@chatroom'})
const noWait = async()=>undefined

test('Telegram one-click claim edits only its original keyboard and keeps owner/topic checks and amounts private', async t => {
  const f = await fixture(t),g = telegramFixture(f.entry.token)
  g.ctx.from.id = 456
  await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(g.edits.length,0);assert.equal(f.calls.length,0)
  g.ctx.from.id = 123;g.ctx.callbackQuery.message.message_thread_id = 88
  await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(g.edits.length,0);assert.equal(f.calls.length,0)
  g.ctx.callbackQuery.message.message_thread_id = 77
  let waited = 0
  await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,async()=>{
    waited++;assert.equal(f.calls.length,0);assert.equal(g.edits.length,0)
    assert.equal((await f.service.status(f.entry.token)).state,'opening')
  })
  assert.equal(waited,1);assert.equal(f.calls.length,1);assert.equal(g.edits.length,1)
  assert.match(g.edits[0].inline_keyboard.at(-1)[0].text,/已领取/)
  for(const markup of g.edits){
    assert.deepEqual(markup.inline_keyboard[0],[g.other]);assert(!JSON.stringify(markup).includes('1.23'))
    assert(markup.inline_keyboard.flat().every(button=>Buffer.byteLength(button.callback_data) <= 64))
  }
  assert.deepEqual(g.unexpected,[]);assert.equal(g.ctx.callbackQuery.message.caption,'原始说明')
  assert.deepEqual(g.ctx.callbackQuery.message.photo,[{file_id:'original-photo'}])
  await handleRedPacketCallback(g.ctx,`rps:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.match(g.alerts.at(-1)[0],/1\.23/);assert.equal(g.alerts.at(-1)[1].show_alert,true)
  assert.equal(f.calls.length,1)
})

test('random Telegram delay stays between one and three seconds',()=>{
  for(let i = 0;i < 100;i++){const ms = redPacketTelegramDelay();assert(Number.isInteger(ms) && ms >= 1000 && ms <= 3000)}
})

test('delay reserves durably before waiting and repeated Telegram/WebUI clicks cannot dispatch twice',async t=>{
  const f = await fixture(t),g = telegramFixture(f.entry.token)
  let release,entered
  const gate = new Promise(resolve=>{release = resolve}),waiting = new Promise(resolve=>{entered = resolve})
  const first = handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,async()=>{entered();await gate})
  await waiting
  assert.equal((await f.service.row(f.entry.token)).state,'opening');assert.equal(f.calls.length,0)
  await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  await handleRedPacketCallback(g.ctx,`rps:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal((await f.service.prepare(f.entry.token,'webui:1')).confirmation,undefined)
  assert.equal(g.edits.length,0);release();await first
  assert.equal(f.calls.length,1);assert.equal(g.edits.length,1)
})

test('consent expiry while waiting never dispatches a late claim',async t=>{
  const f = await fixture(t),prepared = await f.service.prepare(f.entry.token,'test')
  const consent = f.service.confirmations.get(prepared.confirmation)
  await assert.rejects(f.service.open(f.entry.token,prepared.confirmation,'test',async()=>true,undefined,async()=>{consent.expires = Date.now() - 1}),e=>e.code === 'redPacketConfirmationExpired')
  assert.equal(f.calls.length,0);assert.equal((await f.service.status(f.entry.token)).state,'ready')
})

test('account, owner and binding changes during the delay prevent dispatch',async t=>{
  for(const change of ['account','owner','binding']){
    const f = await fixture(t),g = telegramFixture(f.entry.token)
    let group = 'room@chatroom'
    await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,async()=>({wxId:group}),f.service,async()=>{
      if(change === 'binding')group = 'other@chatroom'
      else f.setSession({accountId:change === 'account' ? 'other' : 'self',ownerId:change === 'owner' ? 999 : 123,baseURL:'unused'})
    })
    assert.equal(f.calls.length,0);assert.equal((await f.service.row(f.entry.token)).state,'ready')
    assert.deepEqual(g.unexpected,[])
  }
})

test('status buttons never claim, while explicit old open buttons work in place',async t=>{
  const f = await fixture(t),g = telegramFixture(f.entry.token,'rp','查看结果')
  for(const prefix of ['rp','rps'])await handleRedPacketCallback(g.ctx,`${prefix}:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(f.calls.length,0)
  assert.equal(g.edits.at(-1).inline_keyboard.at(-1)[0].callback_data,`rpo:${f.entry.token}`)
  g.ctx.callbackQuery.message.reply_markup = {inline_keyboard:[[{text:'拆红包',callback_data:`rp:${f.entry.token}`}]]}
  await handleRedPacketCallback(g.ctx,`rp:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(f.calls.length,1);assert.deepEqual(g.unexpected,[])
})

test('legacy confirmation and cancellation stay on their originating messages without new replies',async t=>{
  const f = await fixture(t),g = telegramFixture(f.entry.token)
  const scope = 'telegram:-100:77'
  let prepared = await f.service.prepare(f.entry.token,scope)
  await handleRedPacketCallback(g.ctx,`rpx:${prepared.confirmation}`,123,packetBinding,f.service,noWait)
  assert.equal(f.calls.length,0)
  prepared = await f.service.prepare(f.entry.token,scope)
  await handleRedPacketCallback(g.ctx,`rpc:${prepared.confirmation}`,123,packetBinding,f.service,noWait)
  assert.equal(f.calls.length,1);assert.deepEqual(g.unexpected,[])
  assert(g.edits.every(markup=>markup.inline_keyboard.at(-1)[0].callback_data.endsWith(f.entry.token)))
})

test('interrupted waits stop safely; failed result edits and timeouts never repeat claims or edit attempts',async t=>{
  const blocked = await fixture(t),g = telegramFixture(blocked.entry.token)
  await handleRedPacketCallback(g.ctx,`rpo:${blocked.entry.token}`,123,packetBinding,blocked.service,async()=>{throw Error('wait interrupted')})
  assert.equal(blocked.calls.length,0);assert.equal((await blocked.service.status(blocked.entry.token)).state,'ready')
  const f = await fixture(t,async()=>{throw Error('ambiguous timeout')}),h = telegramFixture(f.entry.token)
  let edits = 0
  h.ctx.editMessageReplyMarkup = async()=>{edits++;throw Error('lost Telegram edit')}
  await handleRedPacketCallback(h.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  await f.restart()
  await handleRedPacketCallback(h.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(f.calls.length,1);assert.equal(edits,1);assert.equal((await f.service.status(f.entry.token)).state,'unknown')
  assert.deepEqual(h.unexpected,[])
})

test('unchanged Telegram keyboard is benign and status reads do not downgrade the result',async t=>{
  const f = await fixture(t),g = telegramFixture(f.entry.token)
  await handleRedPacketCallback(g.ctx,`rpo:${f.entry.token}`,123,packetBinding,f.service,noWait)
  let edits = 0
  g.ctx.editMessageReplyMarkup = async()=>{edits++;throw {response:{error_code:400,description:'Bad Request: message is not modified'}}}
  await handleRedPacketCallback(g.ctx,`rps:${f.entry.token}`,123,packetBinding,f.service,noWait)
  assert.equal(edits,0);assert.equal(f.calls.length,1);assert.match(g.alerts.at(-1)[0],/1\.23/)
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