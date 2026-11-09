/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm')
const {createRequire} = require('node:module')
const {once} = require('node:events')
const http = require('node:http')
const {Telegram} = require('telegraf')
const {installTelegramPollingHealth,TELEGRAM_POLL_DEADLINE_MS,TELEGRAM_POLL_STALE_MS} = require('../dist/util/TelegramPollingHealth')
const settle = ()=>new Promise(resolve=>setImmediate(resolve))
const abortError = ()=>Object.assign(new Error('aborted'),{name:'AbortError'})

function fakeClock() {
  let now = 1000
  const tasks = new Map()
  return {
    now:()=>now,
    setTimeout(callback,delay){const handle = {unref:()=>undefined};tasks.set(handle,{callback,at:now + delay});return handle},
    clearTimeout(handle){tasks.delete(handle)},
    tick(ms){
      const end = now + ms
      for(;;){
        const next = [...tasks].filter(([,entry])=>entry.at <= end).sort((a,b)=>a[1].at - b[1].at)[0]
        if(!next)break
        now = next[1].at;tasks.delete(next[0]);next[1].callback()
      }
      now = end
    },
    pending:()=>tasks.size,
  }
}
function fixture(handler,extra = {}) {
  const clock = fakeClock(),logs = [],changes = [],calls = []
  const telegram = {callApi:async function(...args){assert.equal(this,telegram);calls.push(args);return handler(...args)}}
  const original = telegram.callApi
  const monitor = installTelegramPollingHealth(telegram,{clock,logger:{info:message=>logs.push(['info',message]),warn:message=>logs.push(['warn',message])},onChange:()=>changes.push(monitor.snapshot()),...extra})
  return {clock,logs,changes,calls,telegram,monitor,original}
}
const waitForAbort = (_method,_payload,{signal})=>new Promise((_resolve,reject)=>{
  if(signal.aborted)reject(abortError())
  else signal.addEventListener('abort',()=>reject(abortError()),{once:true})
})

test('empty successful getUpdates is healthy and records real request completion, not getMe/login',async()=>{
  let finish
  const f = fixture(()=>new Promise(resolve=>{finish = resolve}))
  f.monitor.start()
  assert.equal(f.monitor.snapshot().healthy,false)
  assert.equal(f.monitor.snapshot().state,'starting')
  const result = f.telegram.callApi('getUpdates',{timeout:50,offset:12,allowed_updates:['message']})
  assert.equal(f.monitor.snapshot().inFlight,true)
  f.clock.tick(50_000);finish([]);assert.deepEqual(await result,[])
  const status = f.monitor.snapshot()
  assert.equal(status.healthy,true)
  assert.equal(status.lastAttemptAt,1000)
  assert.equal(status.lastSuccessAt,51000)
  assert.equal(status.lastDurationMs,50_000)
  assert.equal(status.requestTimeoutMs,85_000)
  assert.equal(f.calls[0][1].timeout,50,'server long-poll timeout stays unchanged')
  assert(f.logs.some(([level])=>level === 'info'))
  f.monitor.dispose();assert.equal(f.clock.pending(),0)
})

test('85-second deadline aborts the actual request and becomes a retryable FetchError, then recovery is logged',async()=>{
  let waiting = true
  const f = fixture((...args)=>waiting ? waitForAbort(...args) : [])
  f.monitor.start()
  const request = f.telegram.callApi('getUpdates',{timeout:50})
  const rejected = assert.rejects(request,error=>error.name === 'FetchError' && error.code === 'ETIMEDOUT')
  const signal = f.calls[0][2].signal
  f.clock.tick(TELEGRAM_POLL_DEADLINE_MS - 1);assert.equal(signal.aborted,false)
  f.clock.tick(1);assert.equal(signal.aborted,true)
  await rejected
  assert.equal(f.monitor.snapshot().state,'retrying')
  assert.equal(f.monitor.snapshot().consecutiveFailures,1)
  assert.equal(f.monitor.snapshot().lastError,'ETIMEDOUT')
  waiting = false
  await f.telegram.callApi('getUpdates',{timeout:50})
  assert.equal(f.monitor.snapshot().healthy,true)
  assert.equal(f.monitor.snapshot().consecutiveFailures,0)
  assert(f.logs.some(([level,text])=>level === 'warn' && text.includes('ETIMEDOUT')))
  assert(f.logs.some(([level,text])=>level === 'info' && text.includes('恢复')))
  f.monitor.dispose()
})

test('parent cancellation and already-aborted signals remain shutdown, not a polling failure',async()=>{
  const f = fixture(waitForAbort)
  f.monitor.start()
  const parent = new AbortController()
  const request = f.telegram.callApi('getUpdates',{timeout:50},{signal:parent.signal})
  const rejected = assert.rejects(request,{name:'AbortError'})
  parent.abort();await rejected
  assert.equal(f.monitor.snapshot().consecutiveFailures,0)
  assert.equal(f.logs.length,0)
  assert.equal(f.calls[0][2].signal.aborted,true)
  await assert.rejects(f.telegram.callApi('getUpdates',{timeout:50},{signal:parent.signal}),{name:'AbortError'})
  assert.equal(f.calls.length,1)
  f.monitor.dispose();assert.equal(f.clock.pending(),0)
})

test('uploads and all non-getUpdates methods preserve payload/options identity and have no new deadline',async()=>{
  let finish
  const f = fixture(()=>new Promise(resolve=>{finish = resolve}))
  const payload = {chat_id:1,document:{source:Buffer.from('file')}},options = {signal:new AbortController().signal}
  const request = f.telegram.callApi('sendDocument',payload,options)
  f.clock.tick(500_000)
  assert.equal(options.signal.aborted,false)
  assert.equal(f.calls[0][1],payload)
  assert.equal(f.calls[0][2],options)
  assert.equal(f.clock.pending(),0)
  finish({message_id:1});assert.deepEqual(await request,{message_id:1})
  f.monitor.dispose();assert.equal(f.telegram.callApi,f.original)
})

test('missing progress becomes stalled without a probe, and offset-sync calls cannot fake healthy polling',async()=>{
  const f = fixture(()=>[])
  f.monitor.start()
  await f.telegram.callApi('getUpdates',{offset:15,limit:1})
  assert.equal(f.monitor.snapshot().lastSuccessAt,null)
  await f.telegram.callApi('getUpdates',{timeout:50})
  f.clock.tick(TELEGRAM_POLL_STALE_MS - 1);assert.equal(f.monitor.snapshot().healthy,true)
  f.clock.tick(1)
  assert.equal(f.monitor.snapshot().state,'stalled')
  assert.equal(f.monitor.snapshot().healthy,false)
  assert.equal(f.calls.length,2,'no extra getMe/status polling request')
  assert.equal(f.changes.at(-1).state,'stalled')
  await f.telegram.callApi('getUpdates',{timeout:50})
  assert.equal(f.monitor.snapshot().healthy,true)
  assert(f.logs.some(([,text])=>text.includes('恢复')))
  f.monitor.stop();assert.equal(f.monitor.snapshot().healthy,false)
  f.monitor.dispose()
})

test('failure logs are rate-limited, credential-free, and original HTTP errors are preserved',async()=>{
  let error = Object.assign(new Error('https://api.telegram.org/bot123:PRIVATE/getUpdates?payload=SECRET'),{name:'FetchError',code:'ECONNRESET'})
  const f = fixture(()=>{throw error})
  f.monitor.start()
  for(let i = 0;i < 3;i++)await assert.rejects(f.telegram.callApi('getUpdates',{timeout:50}),value=>value === error)
  assert.equal(f.monitor.snapshot().consecutiveFailures,3)
  assert.equal(f.logs.filter(([level])=>level === 'warn').length,1)
  f.clock.tick(60_000)
  error = Object.assign(new Error('PRIVATE'),{code:429,response:{error_code:429}})
  await assert.rejects(f.telegram.callApi('getUpdates',{timeout:50}),value=>value === error)
  assert.equal(f.monitor.snapshot().lastError,'HTTP_429')
  assert.equal(f.logs.filter(([level])=>level === 'warn').length,2)
  assert(!JSON.stringify({logs:f.logs,status:f.monitor.snapshot()}).match(/PRIVATE|SECRET|telegram\.org/))
  f.monitor.dispose()
})

test('malformed update results are not reported as a successful poll',async()=>{
  const f = fixture(()=>({not:'an array'}))
  f.monitor.start()
  await assert.rejects(f.telegram.callApi('getUpdates',{timeout:50}),{name:'InvalidPollingResponse'})
  assert.equal(f.monitor.snapshot().healthy,false)
  assert.equal(f.monitor.snapshot().lastSuccessAt,null)
  assert.equal(f.monitor.snapshot().lastError,'INVALID_RESPONSE')
  f.monitor.dispose()
})

test('real Telegraf polling retries the deadline without advancing offset, preserves updates and ignores shutdown offset-sync for health',async()=>{
  const filename = path.join(path.dirname(require.resolve('telegraf')),'core/network/polling.js')
  const realRequire = createRequire(filename),exports = {},delays = []
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{exports,require:name=>name === 'util' ? {promisify:()=>async ms=>{delays.push(ms)}} : realRequire(name),setTimeout})
  let requests = 0
  const f = fixture((method,payload,options)=>{
    if(!payload.timeout)return []
    if(requests++ === 0)return waitForAbort(method,payload,options)
    return [{update_id:41,message:{text:'synthetic'}}]
  })
  f.monitor.start()
  const poller = new exports.Polling(f.telegram,['message']),handled = []
  const loop = poller.loop(async update=>{handled.push(update.update_id);poller.stop()})
  f.clock.tick(85_000);await settle();await loop
  assert.deepEqual(handled,[41])
  assert.deepEqual(delays,[5000])
  assert.deepEqual(f.calls.map(([,payload])=>payload.offset),[0,0,42])
  assert.equal(f.monitor.snapshot().lastSuccessAt,86000)
  assert.equal(f.monitor.snapshot().consecutiveFailures,0)
  assert(f.logs.some(([,text])=>text.includes('恢复')))
  f.monitor.dispose()
})

test('real Telegraf HTTP getUpdates is aborted at the wrapper deadline without modifying transport defaults', {timeout:10000}, async t=>{
  let closed
  const closure = new Promise(resolve=>{closed = resolve})
  const server = http.createServer((req,res)=>{req.resume();res.on('close',closed)})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const telegram = new Telegram('123:synthetic',{apiRoot:`http://127.0.0.1:${server.address().port}`})
  const options = telegram.options
  const monitor = installTelegramPollingHealth(telegram,{timeoutMs:200,logger:{warn:()=>undefined,info:()=>undefined},onChange:()=>undefined})
  t.after(()=>monitor.dispose());monitor.start()
  await assert.rejects(telegram.callApi('getUpdates',{timeout:50}),error=>error.name === 'FetchError' && error.code === 'ETIMEDOUT')
  await closure
  assert.equal(telegram.options,options)
  assert.equal(monitor.snapshot().consecutiveFailures,1)
})