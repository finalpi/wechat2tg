/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {TelegramOutbox} = require('../dist/repository/TelegramOutbox')
const {MessageBufferService} = require('../dist/util/MessageBufferService')
const {telegramDeliveryUncertain,telegramRetryable} = require('../dist/webui/delivery')
const account = 'synthetic-bot:synthetic-wechat'
const message = (id,extra = {})=>({id,chatId:-100,threadId:77,wxId:'peer',conversationWxId:'peer',senderId:'peer',sender:'Name',content:'private synthetic body',type:0,...extra})
const logger = {info:()=>undefined,warn:()=>undefined,error:()=>undefined}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'telegram-outbox-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  return path.join(directory,'outbox.db')
}
async function settle(worker){await worker.drain();await worker.idle()}

test('outbox persists text/media, exact destination and deduplicates accepted messages across restart', async t=>{
  const file = fixture(t)
  let store = new TelegramOutbox(file)
  const text = message('text'),media = message('media',{type:1,file:{file:Buffer.from([0,1,255]),fileName:'sample.bin',sendType:'document'}})
  const textKey = await store.enqueue(account,text),mediaKey = await store.enqueue(account,media)
  assert.equal(await store.enqueue(account,text),textKey)
  assert.equal((await store.stats(account)).reduce((n,row)=>n + row.count,0),2)
  await store.close();store = new TelegramOutbox(file)
  t.after(()=>store.close())
  assert.deepEqual(await store.message(textKey),text)
  assert.deepEqual(await store.message(mediaKey),media)
  assert.equal((await store.due(account,'message',Date.now(),10)).length,1)
  await store.finish(textKey,'sent',1)
  assert.equal(await store.enqueue(account,text),textKey)
  assert.equal((await store.row(textKey)).state,'sent')
  await assert.rejects(store.message(textKey),/unavailable/)
  assert.equal(fs.statSync(file).mode & 0o777,0o600)
})

test('restart requeues reservations but retains in-flight writes as unknown, never sent or automatically replayed', async t=>{
  const file = fixture(t)
  let store = new TelegramOutbox(file)
  const reserved = await store.enqueue(account,message('reserved')),sending = await store.enqueue(account,message('sending',{chatId:-200}))
  await store.claim(reserved,account);await store.claim(sending,account);await store.begin(sending,account)
  await store.close();store = new TelegramOutbox(file)
  t.after(()=>store.close())
  assert.equal((await store.row(reserved)).state,'queued')
  assert.equal((await store.row(sending)).state,'unknown')
  assert.deepEqual((await store.due(account,'message',Date.now(),10)).map(row=>row.key),[reserved])
  assert.equal((await store.message(sending)).content,'private synthetic body')
  await store.cleanup(Date.now() + 365 * 86400000)
  assert.equal((await store.row(sending)).state,'unknown','unknown and queued payloads cannot expire')
  assert.equal((await store.row(reserved)).state,'queued')
})

test('pre-connect failures retry beyond the configured cap and old five-minute TTL, then recover once', async t=>{
  let now = 1000000,calls = 0,healthy = false
  const store = new TelegramOutbox(fixture(t))
  const worker = new MessageBufferService(store,{maxRetries:1,retryDelay:10,intervalMs:0,now:()=>now,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  worker.configure(()=>account,async(_message,key)=>{
    assert(await worker.beginAttempt(key));calls++
    return healthy ? {success:true} : {success:false,retryable:true}
  })
  const key = await worker.addMessage(message('recover'))
  await settle(worker)
  for(let i = 0;i < 7;i++){now += 3600000;await settle(worker)}
  assert.equal(calls,8)
  assert.equal((await store.row(key)).state,'queued')
  assert(await worker.hasScheduledMessage('recover'))
  healthy = true;now += 3600000;await settle(worker)
  assert.equal(calls,9)
  assert.equal((await store.row(key)).state,'sent')
  assert.equal(await worker.hasScheduledMessage('recover'),false)
  await worker.addMessage(message('recover'));await settle(worker)
  assert.equal(calls,9,'a second SDK delivery cannot enqueue a second Telegram write')
})

test('unknown and permanently rejected messages stay durable without being auto-resubmitted', async t=>{
  let now = 1000000,calls = 0
  const store = new TelegramOutbox(fixture(t))
  const worker = new MessageBufferService(store,{maxRetries:1,retryDelay:10,intervalMs:0,now:()=>now,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  worker.configure(()=>account,async(row,key)=>{await worker.beginAttempt(key);calls++;return {success:false,deliveryUncertain:row.id === 'unknown'}})
  const unknown = await worker.addMessage(message('unknown'))
  const rejected = await worker.addMessage(message('rejected',{chatId:-200}))
  await settle(worker);now += 100;await settle(worker)
  assert.equal((await store.row(unknown)).state,'unknown')
  assert.equal((await store.row(rejected)).state,'failed')
  assert.equal(calls,3)
  now += 86400000;await settle(worker)
  assert.equal(calls,3)
  assert.equal((await store.message(rejected)).id,'rejected')
  await worker.externallySent(message('unknown'))
  assert.equal((await store.row(unknown)).state,'sent')
})

test('account isolation and the request-time guard prevent sending an old account payload', async t=>{
  let active = account,switched = false
  const store = new TelegramOutbox(fixture(t))
  const worker = new MessageBufferService(store,{intervalMs:0,retryDelay:1,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  const key = await store.enqueue(account,message('scoped'))
  worker.configure(()=>active,async(_row,id)=>{
    active = 'other-bot:other-wechat';switched = true
    assert.equal(await worker.beginAttempt(id),false)
    return {success:false,deferred:true}
  })
  await settle(worker)
  assert(switched)
  assert.equal((await store.row(key)).state,'queued')
  assert.equal((await store.due(active,'message',Date.now() + 1000,10)).length,0)
  await store.externallySent(active,'scoped','peer')
  assert.equal((await store.row(key)).state,'queued')
})

test('acknowledged text chunks and frozen rendering/destination survive restart', async t=>{
  const file = fixture(t)
  let store = new TelegramOutbox(file)
  const key = await store.enqueue(account,message('chunks',{chatId:0,threadId:undefined}))
  const progress = await store.textProgress(key,['first','second','third'],message('chunks'))
  progress.ids.push(91,92);await store.checkpoint(key,progress)
  await store.close();store = new TelegramOutbox(file)
  t.after(()=>store.close())
  assert.deepEqual(await store.textProgress(key,['changed configuration']),{chunks:['first','second','third'],ids:[91,92]})
  assert.equal((await store.message(key)).chatId,-100)
  assert.equal((await store.message(key)).threadId,77)
})

test('a pending recall cancels an unsent original rather than resurrecting it after recovery', async t=>{
  const store = new TelegramOutbox(fixture(t));t.after(()=>store.close())
  const key = await store.enqueue(account,message('original'))
  await store.enqueue(account,message('recall',{type:6,revokeMsgId:'original'}))
  assert.equal((await store.row(key)).state,'cancelled')
  assert.equal((await store.due(account,'message',Date.now(),10)).length,0)
  assert.equal((await store.due(account,'recall',Date.now(),10)).length,1)
})

test('a recall can cancel a reservation before HTTP starts and late completion cannot resurrect it', async t=>{
  const store = new TelegramOutbox(fixture(t));t.after(()=>store.close())
  const key = await store.enqueue(account,message('reserved'))
  await store.claim(key,account)
  await store.enqueue(account,message('recall',{type:6,revokeMsgId:'reserved'}))
  assert.equal(await store.begin(key,account),false)
  await store.finish(key,'queued',1,Date.now())
  assert.equal((await store.row(key)).state,'cancelled')
  assert.equal(await store.active(account,'reserved'),false)
})

test('a failed journal completion write is retried without repeating the successful Telegram request', {timeout:10000}, async t=>{
  const store = new TelegramOutbox(fixture(t))
  const worker = new MessageBufferService(store,{intervalMs:0,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  let sends = 0,writes = 0
  const finish = store.finish.bind(store)
  store.finish = async(...args)=>{writes++;if(writes === 1)throw new Error('synthetic disk error');return finish(...args)}
  worker.configure(()=>account,async(_row,key)=>{await worker.beginAttempt(key);sends++;return {success:true}})
  const key = await worker.addMessage(message('journal'));await settle(worker)
  assert.equal(sends,1)
  assert.equal(writes,2)
  assert.equal((await store.row(key)).state,'sent')
})

test('uploads have a separate bounded budget and do not consume text recovery slots', async t=>{
  const store = new TelegramOutbox(fixture(t))
  const started = [],gates = []
  const worker = new MessageBufferService(store,{intervalMs:0,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  for(let i = 0;i < 4;i++)await store.enqueue(account,message('file' + i,{chatId:-100 - i,type:1,file:{file:Buffer.from('a'),fileName:'a.bin'}}))
  await store.enqueue(account,message('text'))
  worker.configure(()=>account,async row=>{started.push(row.id);if(row.type === 1)await new Promise(resolve=>gates.push(resolve));return {success:true}})
  await worker.drain()
  // SQL reads can complete after the scan has queued the bounded tasks.
  while(started.length < 3)await new Promise(resolve=>setImmediate(resolve))
  assert(started.includes('text'))
  assert.equal(started.filter(id=>id.startsWith('file')).length,2)
  // Pause dispatch before releasing uploads; queued files stay on disk.
  worker.configure(()=>undefined,async()=>({success:true}))
  gates.forEach(resolve=>resolve());await worker.idle()
})

test('429 minimum delay is respected and generic timeouts are not classified as safe retries', async t=>{
  const connect = Object.assign(new Error('connect timeout'),{code:'ETIMEDOUT',syscall:'connect'})
  const ambiguous = Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})
  assert.equal(telegramDeliveryUncertain(connect),false)
  assert.equal(telegramRetryable(connect),true)
  assert.equal(telegramDeliveryUncertain(ambiguous),true)
  assert.equal(telegramRetryable(ambiguous),false)
  assert.equal(telegramRetryable({response:{error_code:429}}),true)
  assert.equal(telegramDeliveryUncertain({response:{error_code:429}}),false)
  let now = 1000000,calls = 0
  const store = new TelegramOutbox(fixture(t))
  const worker = new MessageBufferService(store,{intervalMs:0,retryDelay:10,now:()=>now,logger,notify:()=>undefined})
  t.after(()=>worker.destroy())
  worker.configure(()=>account,async()=>{calls++;return {success:false,retryable:true,retryAfterMs:120000}})
  const key = await worker.addMessage(message('limited'));await settle(worker)
  assert.equal((await store.row(key)).nextAt,1120000)
  now += 119999;await settle(worker);assert.equal(calls,1)
  now++;await settle(worker);assert.equal(calls,2)
})