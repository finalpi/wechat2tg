const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {LoginQrDelivery}=require('../dist/util/LoginQrDelivery')
const {createLoginEventLog}=require('../dist/util/LoginDiagnostics')
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))}
function fixture(t,{send,edit,render,id}={}){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1700000000000})
 const sent=[],edited=[],deleted=[],events=[];let messageId=id
 const telegram={sendPhoto:async(...args)=>{sent.push(args);return send?send(...args):{message_id:42}},editMessageMedia:async(...args)=>{edited.push(args);return edit?edit(...args):true},deleteMessage:async(...args)=>{deleted.push(args)}}
 const delivery=new LoginQrDelivery({context:async()=>({chatId:1,telegram}),render:render|| (async text=>Buffer.from(text)),getMessageId:()=>messageId,setMessageId:id=>{messageId=id},caption:()=> 'scan',event:(event,detail)=>events.push({event,...detail})})
 t.after(()=>delivery.cancel())
 return {delivery,sent,edited,deleted,events,id:()=>messageId,tick:async ms=>{t.mock.timers.tick(ms);await flush()}}
}
test('ECONNRESET is caught and retried without leaving an unhandled rejection',async t=>{
 let calls=0;const f=fixture(t,{send:async()=>{if(++calls===1)throw Object.assign(new Error('private transport request'),{code:'ECONNRESET'});return {message_id:42}}})
 f.delivery.show('synthetic-qr');await flush();assert.equal(f.sent.length,1)
 await f.tick(1000);assert.equal(f.sent.length,2);assert.equal(f.id(),42)
 assert.ok(f.events.some(e=>e.event==='qr-delivery-retry'));assert.ok(!JSON.stringify(f.events).includes('private transport'))
})
test('429 respects retry_after and permanent failures are not retried',async t=>{
 let calls=0;const f=fixture(t,{send:async()=>{if(++calls===1)throw {response:{error_code:429,parameters:{retry_after:3}}};return {message_id:42}}})
 f.delivery.show('synthetic');await flush();await f.tick(2999);assert.equal(calls,1);await f.tick(1);assert.equal(calls,2)
})
test('a missing old QR message falls back to sending a new message',async t=>{
 const f=fixture(t,{id:7,edit:async()=>{throw {response:{error_code:400,description:'Bad Request: message to edit not found'}}}})
 f.delivery.show('synthetic');await flush();assert.equal(f.edited.length,1);assert.equal(f.sent.length,1);assert.equal(f.id(),42)
})
test('login cancellation stops pending retries',async t=>{
 const f=fixture(t,{send:async()=>{throw {code:'ECONNRESET'}}})
 f.delivery.show('synthetic');await flush();f.delivery.cancel();await f.tick(100000);assert.equal(f.sent.length,1)
})
test('only newest QR is delivered and late stale messages are removed',async t=>{
 let finish;const f=fixture(t,{send:async()=>f.sent.length===1?new Promise(resolve=>finish=resolve):{message_id:43}})
 f.delivery.show('old-qr');await flush();f.delivery.show('new-qr');finish({message_id:42});await flush()
 assert.equal(f.sent.length,2);assert.deepEqual(f.deleted,[[1,42]]);assert.equal(f.id(),43)
})
test('expired QRs and permanent Telegram rejections do not retry',async t=>{
 const f=fixture(t,{send:async()=>{throw {response:{error_code:403}}}})
 f.delivery.show('synthetic');await flush();await f.tick(10000);assert.equal(f.sent.length,1)
 f.delivery.show('already-expired',Date.now()-1);await flush();assert.equal(f.sent.length,1)
})
test('render or context failures consume a bounded retry budget',async t=>{
 let calls=0;const f=fixture(t,{render:async()=>{calls++;throw Error('invalid synthetic render')}})
 f.delivery.show('synthetic');await flush()
 for(const delay of [1000,2000,4000,8000,16000,30000,30000])await f.tick(delay)
 assert.equal(calls,8);await f.tick(30000);assert.equal(calls,8);assert.equal(f.sent.length,0)
})
test('login logs retain 30 calendar days, strip credentials, and limit duplicate events',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'wx-login-log-'));let now=Date.parse('2026-11-10T12:00:00Z')
 try{
  fs.writeFileSync(path.join(directory,'login-events-2026-10-01.jsonl'),'old')
  fs.writeFileSync(path.join(directory,'unrelated-file'),'preserve')
  const write=createLoginEventLog(directory,()=>now,5000)
  for(let i=0;i<100;i++)write('qr-check-failed',{stage:'qr-check',code:-8,token:'secret-token',uuid:'secret-uuid',qr:'secret-qr',reason:'https://private.example'})
  const file=path.join(directory,'login-events-2026-11-10.jsonl'),text=fs.readFileSync(file,'utf8')
  assert.equal(text.trim().split('\n').length,1);assert.ok(!text.includes('secret'));assert.ok(!text.includes('private.example'))
  assert.equal(fs.existsSync(path.join(directory,'login-events-2026-10-01.jsonl')),false)
  assert.equal(fs.existsSync(path.join(directory,'unrelated-file')),true)
  now+=60001;write('qr-check-failed',{code:-8});assert.equal(fs.readFileSync(file,'utf8').trim().split('\n').length,2)
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
})
