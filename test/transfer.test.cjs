/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),http = require('node:http')
const {once} = require('node:events'),sqlite3 = require('sqlite3'),vm = require('node:vm')
const {readWechatTransfer} = require('../dist/util/WechatTransfer')
const {TransferService,requestTransferAccept} = require('../dist/service/TransferService')
const {handleTransferCallback} = require('../dist/service/TransferTelegram')

const card = (type = 1,time = 1999999999)=>`<msg><appmsg><type>2000</type><wcpayinfo><paysubtype>${type}</paysubtype><transferid>transfer_one</transferid><transcationid>transaction_one</transcationid><invalidtime>${time}</invalidtime><receiver_username>wx_self</receiver_username><feedesc>￥12.30</feedesc><pay_memo><![CDATA[<user note>]]></pay_memo></wcpayinfo></appmsg></msg>`
const destination = {chatId:-10,threadId:42,conversation:'wx_peer'}
const session = {accountId:'wx_self',ownerId:7,baseURL:'http://example.invalid/api'}
async function fixture(t,send,seed) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'transfer-test-'))
  const file = path.join(directory,'transfers.db'),calls = []
  if(seed) {
    const db = new sqlite3.Database(file)
    try {await new Promise((resolve,reject)=>db.exec(seed,error=>error ? reject(error) : resolve()))}
    finally {await new Promise(resolve=>db.close(resolve))}
  }
  let current = session,service
  const open = ()=>service = new TransferService(async()=>current,async(...args)=>{calls.push(args);return send ? send(...args) : {status:200,data:{Code:0,Success:true}}},file)
  open()
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true})})
  return {get service() {return service},open,calls,setSession(value) {current = value}}
}

test('transfer parser separates display-only cards, explicit incoming transfers and native receipts',()=>{
  assert.equal(readWechatTransfer(card()).amountFen,1230)
  assert.equal(readWechatTransfer(card()).memo,'<user note>')
  assert.equal(readWechatTransfer(card()).claimable,true)
  assert.equal(readWechatTransfer(card(3)).received,true)
  assert.equal(readWechatTransfer(card(4)).claimable,false)
  assert.equal(readWechatTransfer(card().replace('transaction_one','a&amp;op=refund')).claimable,false)
  assert.equal(readWechatTransfer(card().replace('transfer_one</transferid>','transfer_one</transferid><transferid>another_id</transferid>')).claimable,false)
  assert.equal(readWechatTransfer(card().replace('<type>2000','<type>2001')),undefined)
  assert.equal(readWechatTransfer('<!DOCTYPE msg>' + card()),undefined)
})

test('only a matching live account and destination can register and use a non-expired transfer',async t=>{
  const f = await fixture(t),s = f.service
  await assert.rejects(s.register(card(1,1000000000),session.accountId,destination))
  await assert.rejects(s.register(card(),session.accountId,{...destination,conversation:'group@chatroom'}))
  await assert.rejects(s.register(card().replace('wx_self','other'),session.accountId,destination))
  const entry = await s.register(card(),session.accountId,destination)
  assert.match(entry.token,/^[a-f0-9]{32}$/)
  await assert.rejects(s.register(card().replace('transaction_one','transaction_two'),session.accountId,destination))
  await assert.rejects(s.accept(entry.token,{...destination,threadId:43},async()=>true))
  await assert.rejects(s.accept(entry.token,destination,async()=>false))
  let checks = 0
  await assert.rejects(s.accept(entry.token,destination,async()=>{
    if(++checks === 2)f.setSession({...session,accountId:'different'})
    return true
  }))
  assert.equal(f.calls.length,0)
  f.setSession(session)
  assert.equal((await s.status(entry.token,destination)).state,'ready')
})

test('a directed group transfer stays bound to its original topic and reaches Collectmoney with the individual payer',async t=>{
  const f = await fixture(t),s = f.service
  const group = {...destination,conversation:'room@chatroom'}
  const envelope = {group:true,sender:'wx_peer',recipient:group.conversation}
  const fromGroup = source=>`wx_peer:\n${source.replace('<receiver_username>','<payer_username>wx_peer</payer_username><receiver_username>')}`
  const source = fromGroup(card())
  const register = (xml = source,origin = envelope)=>s.register(xml,session.accountId,group,origin)
  await assert.rejects(register(source,{...envelope,recipient:'other@chatroom'}))
  await assert.rejects(register(source,{...envelope,group:false}))
  await assert.rejects(register(source,{...envelope,sender:'wx_other'}))
  await assert.rejects(register(source,{...envelope,sender:'wx_peer&op=refund'}))
  await assert.rejects(register(source.replace('<receiver_username>wx_self','<receiver_username>wx_other')))
  await assert.rejects(register(source.replace('<payer_username>','<payer_username>wx_other</payer_username><payer_username>')))
  await assert.rejects(register(source.replace('<paysubtype>1','<paysubtype>4')))
  const {token} = await register()
  assert.equal(f.calls.length,0,'forwarding the card cannot accept it')
  await assert.rejects(s.accept(token,{...group,threadId:99},async()=>true))
  await assert.rejects(s.accept(token,destination,async()=>true))
  assert.equal((await register()).token,token)
  await Promise.all([s.accept(token,group,async()=>true),s.accept(token,group,async()=>true)])
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0][2],'wx_peer','request targets the payer, not the room')
  await s.observeReceipt(fromGroup(card(3)),session.accountId,'other@chatroom')
  await s.observeReceipt(fromGroup(card(3)).replace('wx_peer</payer_username>','wx_other</payer_username>'),session.accountId,group.conversation)
  assert.equal((await s.status(token,group)).state,'unknown')
  await s.observeReceipt(fromGroup(card(3)),session.accountId,group.conversation)
  assert.equal((await s.status(token,group)).state,'received')
})

test('group transfer forwarding adds the receive button only for its intended recipient',async t=>{
  const f = await fixture(t),exports = {}
  // Use the real decorator with a temporary journal, without starting either client.
  const dependencies = {
    './FormatUtils':require('../dist/util/FormatUtils'),
    './WechatTransfer':require('../dist/util/WechatTransfer'),
    '../service/TransferService':{...require('../dist/service/TransferService'),transferService:()=>f.service},
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/util/TransferMessage'),'utf8'),{exports,require:name=>dependencies[name]})
  const original = {chatId:-10,threadId:42,conversationWxId:'room@chatroom'}
  const source = `wx_peer:\n${card()}` // SDK group XML can retain a sender prefix.
  const decorate = (message,xml,outgoing = false)=>exports.decorateTransferMessage(message,xml,'wx_self',outgoing,'wx_peer','room@chatroom',true)
  const mine = {...original}
  await decorate(mine,source)
  assert.match(mine.content,/收到转账 ¥12\.30/)
  assert.match(mine.param.inline_keyboard[0].callback_data,/^tfo:[a-f0-9]{32}$/)
  const another = {...original}
  await decorate(another,source.replace('wx_self','wx_other'))
  assert.match(another.content,/群内转账/)
  assert.equal(another.param,undefined)
  const outgoing = {...original}
  await decorate(outgoing,source,true)
  assert.equal(outgoing.param,undefined)
  assert.equal(f.calls.length,0)
})

test('a pre-group transfer journal migrates without losing its prior callbacks',async t=>{
  const token = 'a'.repeat(32)
  const f = await fixture(t,undefined,`CREATE TABLE transfers (key TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,
    account TEXT NOT NULL,owner INTEGER NOT NULL,conversation TEXT NOT NULL,chatId INTEGER NOT NULL,threadId INTEGER,
    transferId TEXT NOT NULL,transactionId TEXT NOT NULL,invalidTime TEXT NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL);
    INSERT INTO transfers VALUES('old-key','${token}','wx_self',7,'wx_peer',-10,42,'transfer_one','transaction_one','1999999999',1230,'ready');`)
  assert.equal((await f.service.status(token,destination)).state,'ready')
  assert.equal((await f.service.accept(token,destination,async()=>true)).state,'unknown')
  assert.equal(f.calls[0][2],'wx_peer')
  await f.service.close()
  assert.equal((await f.open().status(token,destination)).state,'unknown')
})

test('double-clicks and restart cannot re-dispatch; outer success alone does not mean received',async t=>{
  const f = await fixture(t),s = f.service
  const {token} = await s.register(card(),session.accountId,destination)
  await Promise.all([s.accept(token,destination,async()=>true),s.accept(token,destination,async()=>true)])
  assert.equal(f.calls.length,1)
  assert.equal((await s.status(token,destination)).state,'unknown')
  await s.close();const restarted = f.open()
  assert.equal((await restarted.accept(token,destination,async()=>true)).state,'unknown')
  assert.equal(f.calls.length,1)
  await restarted.observeReceipt(card(3).replace('transaction_one','transaction_two'),session.accountId,destination.conversation)
  assert.equal((await restarted.status(token,destination)).state,'unknown')
  await restarted.observeReceipt(card(3),session.accountId,destination.conversation)
  assert.equal((await restarted.status(token,destination)).state,'received')
})

test('missing route, timeout and receipt racing the request never cause repeated dispatch',async t=>{
  for(const status of [404,'timeout','receipt']) {
    let f
    f = await fixture(t,async()=>{
      if(status === 'timeout')throw new Error('test timeout')
      if(status === 'receipt')await f.service.observeReceipt(card(3),session.accountId,destination.conversation)
      return {status}
    })
    const {token} = await f.service.register(card(),session.accountId,destination)
    const end = status === 404 ? 'unavailable' : status === 'timeout' ? 'unknown' : 'received'
    assert.equal((await f.service.accept(token,destination,async()=>true)).state,end)
    assert.equal((await f.service.accept(token,destination,async()=>true)).state,end)
    assert.equal(f.calls.length,1)
  }
})

test('only owner callback can receive; status button is read-only and edits preserve other controls',async t=>{
  const f = await fixture(t),s = f.service,answers = [],edits = []
  const {token} = await s.register(card(),session.accountId,destination)
  const original = {text:'other button',url:'https://example.invalid'}
  const ctx = {from:{id:8},chat:{id:destination.chatId},callbackQuery:{message:{message_id:13,message_thread_id:42,is_topic_message:true,reply_markup:{inline_keyboard:[[original],[{text:'接收转账',callback_data:`tfo:${token}`}]]}}},
    async answerCbQuery(...args) {answers.push(args)},async editMessageReplyMarkup(value) {edits.push(value)}}
  const resolve = async()=>({wxId:destination.conversation})
  await handleTransferCallback(ctx,`tfo:${token}`,7,resolve,s)
  assert.match(answers[0][0],/仅机器人主人/)
  ctx.from.id = 7
  await handleTransferCallback(ctx,`tfs:${token}`,7,resolve,s)
  assert.equal(f.calls.length,0)
  await handleTransferCallback(ctx,`tfo:${token}`,7,resolve,s)
  assert.equal(f.calls.length,1)
  assert.deepEqual(edits.at(-1).inline_keyboard[0],[original])
  assert.match(edits.at(-1).inline_keyboard[1][0].text,/待核实/)
  assert.equal(edits.at(-1).inline_keyboard[1][0].callback_data,`tfs:${token}`)
})

test('protocol v6 route receives only the exact receive fields and does not follow redirects',async t=>{
  const requests = []
  const server = http.createServer(async(req,res)=>{
    const chunks = [];for await(const chunk of req)chunks.push(chunk)
    let body
    try {body = JSON.parse(Buffer.concat(chunks).toString())} catch {res.writeHead(400);res.end();return}
    requests.push({url:req.url,body})
    res.writeHead(307,{location:'/other'});res.end()
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const result = await requestTransferAccept({...session,baseURL:`http://127.0.0.1:${server.address().port}/api/`},
    {transferId:'transfer_one',transactionId:'transaction_one',invalidTime:'1999999999'},'wx_peer')
  assert.equal(result.status,307)
  assert.deepEqual(requests,[{url:'/api/TenPay/Collectmoney',body:{Wxid:'wx_self',ToUserName:'wx_peer',TransFerId:'transfer_one',TransactionId:'transaction_one',InvalidTime:'1999999999'}}])
})