/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const noop = () => undefined
const settle = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(done => {resolve = done})
  return {promise, resolve}
}

/** Loads the compiled client with only the collaborators each test needs. */
function loadClient({getTranscript = async () => '转写文本', calls = [], statuses, clock, prepareArticles = async()=>undefined} = {}) {
  const stubs = {
    'node:async_hooks': require('node:async_hooks'),
    '../webui/delivery': require('../dist/webui/delivery'),
    'entities':require('entities'),
    '../util/TelegramArticleMessage':{...require('../dist/util/TelegramArticleMessage'),prepareTelegramArticles:prepareArticles},
    '../util/FormatUtils': {FormatUtils:{transformIdentityBodyStr:(_template,_sender,content)=>content}},
    '../util/WechatCustomEmoji': require('../dist/util/WechatCustomEmoji'),
    '../util/TelegramTextUtils': require('../dist/util/TelegramTextUtils'),
    '../entity/Message': {Message:class {}},
    '../webui/message-store': {WebMessageStore: {getInstance: () => ({
      setTelegramStatus: async (id, status) => {statuses?.push({id, status})},
    })}},
    '../i18n': {getInstance: () => ({t: key => key})},
    '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return undefined}}},
    '../config': {config: {TENCENT_SECRET_ID: 'id', TENCENT_SECRET_KEY: 'key', WECHAT_CUSTOM_EMOJI_ENABLED: false}},
    '../util/TelegramTopicUtils': require('../dist/util/TelegramTopicUtils'),
    '../util/TelegramPollingHealth': require('../dist/util/TelegramPollingHealth'),
    '../util/SafeError': require('../dist/util/SafeError'),
    '../service/SpeechService': {SpeechService: {getInstance: () => ({
      getTranscript: async buffer => {
        calls.push({method: 'transcript', buffer})
        return getTranscript()
      },
    })}},
    '../message/MessageSender': {MessageSender: class {}},
    './WechatClient': {WechatClient: class {}},
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/TelegramBotClient.js'), 'utf8'), {
    exports, console, Buffer, setTimeout, clearTimeout,
    ...(clock ? {Date: clock.Date, setTimeout: clock.setTimeout} : {}),
    process: {env: {WEBUI_ENABLED: statuses ? 'true' : 'false'}},
    require: name => stubs[name] || {},
  })
  return exports.TelegramBotClient
}

function queueFixture(Client) {
  const started = [], finished = []
  const gate = deferred()
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    telegramMessageQueue: [],
    chatLanes: new Map(),
    activeWebUISync: new Set(),
    telegramQueueBlockedUntil: 0,
    telegramNextGlobalSendAt: 0,
    telegramNextSendAtByChat: new Map(),
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    messageBufferService: {beginAttempt:async()=>true, markMessageAsSent: noop, markMessageAsFailed: noop},
    sendBufferedMessage: async message => {
      started.push(message.id)
      if (message.id === 'slow') await gate.promise
      finished.push(message.id)
      return {success: true}
    },
  })
  const item = (id, chatId, type = 0) => ({message: {id, chatId, type}, messageId: id, isRetry: false})
  return {client, started, finished, release: gate.resolve, item}
}

test('concurrent duplicate arrivals are not acknowledged before durable acceptance succeeds', async()=>{
  const q = queueFixture(loadClient())
  let rejectWrite,completed = 0
  const write = new Promise((_resolve,reject)=>{rejectWrite = reject})
  q.client.messageBufferService = {addMessage:()=>write}
  const first = q.client.sendMessage({id:'same',chatId:-1,type:0}).then(result=>{completed++;return result})
  const second = q.client.sendMessage({id:'same',chatId:-1,type:0}).then(result=>{completed++;return result})
  await settle();assert.equal(completed,0)
  rejectWrite(Object.assign(new Error('synthetic storage full'),{code:'ENOSPC'}))
  assert.deepEqual(await Promise.all([first,second]),[false,false])
  assert.equal(q.started.length,0)
})

test('Telegram startup announces connection attempts before waiting for getMe', async () => {
  const stop = new Error('stop the synthetic retry loop')
  const Client = loadClient({clock: {Date, setTimeout: () => {throw stop}}})
  const client = Object.create(Client.prototype), entries = []
  Object.assign(client, {RECONNECT_BASE_DELAY: 1, logger: {
    info: message => entries.push(message), error: noop, warn: noop,
  }})
  const bot = {telegram:{callApi:async()=>[]},launch: async () => {
    assert.match(entries[0], /正在连接 Telegram Bot API/)
    throw new Error('synthetic connection failure')
  }}
  await assert.rejects(client.botLaunch(bot), error => error === stop)
  assert.equal(client.hasLogin, false)
  assert.equal(client.getPollingHealth().state,'stopped')
  assert.equal(client.getPollingHealth().healthy,false)
  assert(entries.some(message => message.includes('不会放弃重试')))
})

test('a slow message in one chat never blocks another chat', async () => {
  const Client = loadClient()
  const q = queueFixture(Client)
  q.client.enqueueTelegramMessage(q.item('slow', -1))
  q.client.enqueueTelegramMessage(q.item('fast', -2))
  await settle()
  assert.deepEqual(q.finished, ['fast'], 'another chat keeps flowing while one chat is converting')
  q.release()
  await settle()
  assert.deepEqual(q.finished.sort(), ['fast', 'slow'])
})

test('text messages inside one chat stay ordered even when the first one is slow', async () => {
  const Client = loadClient()
  const q = queueFixture(Client)
  q.client.enqueueTelegramMessage(q.item('slow', -1))
  q.client.enqueueTelegramMessage(q.item('after', -1))
  await settle()
  assert.deepEqual(q.started, ['slow'], 'the second message waits for the first in the same chat')
  q.release()
  await settle()
  assert.deepEqual(q.finished, ['slow', 'after'])
})

test('a slow media upload does not block later same-chat text', async () => {
  const q = queueFixture(loadClient())
  q.client.enqueueTelegramMessage(q.item('slow', -1, 1))
  q.client.enqueueTelegramMessage(q.item('text', -1))
  await settle()
  assert.deepEqual(q.started, ['slow', 'text'])
  assert.deepEqual(q.finished, ['text'])
  q.release()
  await settle()
  assert.deepEqual(q.finished, ['text', 'slow'])
  assert.equal(q.client.chatLanes.size, 0)
  assert.equal(q.client.telegramMessageQueue.length, 0)
})

test('same-chat media uploads remain serial while text passes them', async () => {
  const q = queueFixture(loadClient())
  q.client.enqueueTelegramMessage(q.item('slow', -1, 1))
  q.client.enqueueTelegramMessage(q.item('next-media', -1, 1))
  q.client.enqueueTelegramMessage(q.item('text', -1))
  await settle()
  assert.deepEqual(q.started, ['slow', 'text'])
  q.release()
  await settle()
  assert.deepEqual(q.finished, ['text', 'slow', 'next-media'])
})

test('recalls follow earlier media or text without blocking later text', async () => {
  for (const type of [0, 1]) {
    const q = queueFixture(loadClient())
    q.client.enqueueTelegramMessage(q.item('slow', -1, type))
    q.client.enqueueTelegramMessage(q.item('recall', -1, 6))
    q.client.enqueueTelegramMessage(q.item('later-text', -1))
    await settle()
    assert(!q.started.includes('recall'), 'a recall must not overtake the original delivery')
    if (type === 1) assert.deepEqual(q.finished, ['later-text'], 'waiting recall must not hold later text')
    q.release()
    await Promise.all(q.client.chatLanes.values())
    assert(q.finished.indexOf('recall') > q.finished.indexOf('slow'))
  }
})

test('parallel lanes isolate uncertainty and FloodWait while sharing the flood deadline', async () => {
  const statuses = []
  const q = queueFixture(loadClient({statuses}))
  const entered = {uncertain: deferred(), flood: deferred()}
  const release = {uncertain: deferred(), flood: deferred()}
  const errors = {
    uncertain: Object.assign(new Error('socket reset'), {code: 'ECONNRESET'}),
    flood: {response: {error_code: 429, parameters: {retry_after: 7}}},
    rejected: {response: {error_code: 400}},
  }
  q.client.waitForTelegramSendSlot = async () => undefined
  q.client.sendBufferedMessage = async message => {
    try {
      await q.client.sendTelegramRequest(message.chatId, async () => {
        if (errors[message.id]) throw errors[message.id]
      })
      return {success: true}
    } catch {
      if (entered[message.id]) {
        entered[message.id].resolve()
        await release[message.id].promise
      }
      return {success: false}
    }
  }
  // The uncertain media attempt remains active as same-chat text gets FloodWait.
  const uncertain = q.client.mirrorWebUI({id: 'uncertain', chatId: -1, type: 1})
  await entered.uncertain.promise
  const beforeFlood = Date.now()
  const flood = q.client.mirrorWebUI({id: 'flood', chatId: -1, type: 0})
  await entered.flood.promise
  const blockedUntil = q.client.telegramQueueBlockedUntil
  assert(blockedUntil >= beforeFlood + 8000)
  const rejected = await q.client.mirrorWebUI({id: 'rejected', chatId: -2, type: 0})
  const healthy = await q.client.mirrorWebUI({id: 'healthy', chatId: -3, type: 0})
  release.uncertain.resolve()
  const unknown = await uncertain
  release.flood.resolve()
  const limited = await flood
  assert.equal(unknown.success, false)
  assert.equal(unknown.deliveryUncertain, true)
  assert.equal(unknown.retryAfterMs, undefined)
  assert.equal(limited.deliveryUncertain, false)
  assert.equal(limited.retryAfterMs, 8000)
  assert.equal(rejected.deliveryUncertain, false)
  assert.equal(rejected.retryAfterMs, undefined)
  assert.equal(healthy.success, true)
  assert.equal(healthy.deliveryUncertain, false)
  assert.equal(healthy.retryAfterMs, undefined)
  assert.equal(q.client.telegramQueueBlockedUntil, blockedUntil)
  assert.deepEqual(statuses.filter(s => s.status !== 'syncing').map(s => [s.id, s.status]),
    [['rejected', 'failed'], ['healthy', 'synced'], ['uncertain', 'unknown'], ['flood', 'failed']])
})

test('unknown, partial and skipRetry delivery never masquerade as successful buffer retries', async () => {
  const q = queueFixture(loadClient())
  const sent = [], failed = []
  q.client.messageBufferService = {
    beginAttempt:async()=>true,
    markMessageAsSent: id => sent.push(id),
    markMessageAsFailed: (...args) => failed.push(args),
  }
  q.client.waitForTelegramSendSlot = async () => undefined
  let requests = 0
  q.client.sendBufferedMessage = async message => {
    if (message.id.startsWith('unknown')) {
      try {
        await q.client.sendTelegramRequest(-1, async () => {
          requests++
          throw Object.assign(new Error('timeout'), {code: 'ETIMEDOUT'})
        })
      } catch {return {success: false}}
    }
    return {success: false, ...(message.id.startsWith('partial') ? {deliveryUncertain: true} : {skipRetry: true})}
  }
  for (const id of ['unknown', 'partial', 'skip']) q.client.enqueueTelegramMessage(q.item(id, -1))
  await settle()
  assert.deepEqual(sent, [], 'unknown outcomes must not be marked sent')
  assert.deepEqual(failed, [], 'initial uncertainty never schedules an automatic retry')
  for (const id of ['unknown-retry', 'partial-retry', 'skip-retry']) {
    const result = await q.client.enqueueTelegramRetry({id, chatId: -1, type: 0}, id)
    assert.equal(result.success, false, 'the durable outbox retains uncertainty without lying about success')
    assert.equal(result.deliveryUncertain, true)
  }
  assert.equal(requests, 2, 'only explicitly queued attempts issue requests')
  assert.deepEqual(failed, [])
})

test('manual sync racing a new automatic entry cannot duplicate either success or uncertainty', async t=>{
  const {TelegramOutbox} = require('../dist/repository/TelegramOutbox')
  const {MessageBufferService} = require('../dist/util/MessageBufferService')
  for(const uncertain of [false,true]){
    const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'telegram-manual-race-'))
    const store = new TelegramOutbox(path.join(directory,'outbox.db'))
    const worker = new MessageBufferService(store,{intervalMs:0,logger:{info:noop,warn:noop,error:noop},notify:noop})
    t.after(async()=>{await worker.destroy();fs.rmSync(directory,{recursive:true,force:true})})
    const q = queueFixture(loadClient()),entered = deferred(),release = deferred()
    let requests = 0
    q.client.messageBufferService = worker;q.client.waitForTelegramSendSlot = async()=>undefined
    q.client.sendBufferedMessage = async row=>{
      try {
        await q.client.sendTelegramRequest(row.chatId,async()=>{requests++;entered.resolve();await release.promise;if(uncertain)throw Object.assign(new Error('reset'),{code:'ECONNRESET'})})
        return {success:true}
      }catch{return {success:false}}
    }
    worker.configure(()=>'account',(row,key)=>q.client.enqueueTelegramRetry(row,key))
    const row = {id:'same',wxId:'peer',conversationWxId:'peer',chatId:-100,type:0,content:'synthetic'}
    const manual = q.client.mirrorWebUI(row);await entered.promise
    const key = await worker.addMessage(row);await worker.drain();await worker.idle()
    assert.equal(requests,1)
    release.resolve();await manual
    assert.equal((await store.row(key)).state,uncertain ? 'unknown' : 'sent')
    await store.finish(key,'queued',1,0)
    await worker.drain();await worker.idle()
    assert.equal((await store.row(key)).state,uncertain ? 'unknown' : 'sent','late queued results cannot undo the manual outcome')
    assert.equal(requests,1)
  }
})

test('durable text retries resume after the confirmed prefix instead of duplicating or losing chunks', async t=>{
  const {TelegramOutbox} = require('../dist/repository/TelegramOutbox')
  const {MessageBufferService} = require('../dist/util/MessageBufferService')
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'telegram-chunk-recovery-'))
  const store = new TelegramOutbox(path.join(directory,'outbox.db'))
  let now = 1000000,fail = true
  const worker = new MessageBufferService(store,{intervalMs:0,now:()=>now,logger:{info:noop,warn:noop,error:noop},notify:noop})
  t.after(async()=>{await worker.destroy();fs.rmSync(directory,{recursive:true,force:true})})
  const q = queueFixture(loadClient()),calls = [],receipts = []
  q.client.messageBufferService = worker
  q.client.waitForTelegramSendSlot = async()=>undefined
  q.client.bindGroupService = {isManagedForum:async()=>false}
  q.client.messageService = {createOrUpdate:async row=>receipts.push({...row})}
  q.client.messageSender = {sendText:async(_chat,text)=>{
    calls.push(text)
    if(fail && calls.length === 2)throw Object.assign(new Error('offline'),{code:'ECONNREFUSED'})
    return {message_id:100 + calls.length}
  }}
  q.client.sendBufferedMessage = async row=>({success:await q.client.sendTextMsgSynchronously(row)})
  worker.configure(()=>'account',(row,key)=>q.client.enqueueTelegramRetry(row,key))
  const row = {id:'chunked',wxId:'peer',conversationWxId:'peer',senderId:'peer',sender:'Name',chatId:-100,threadId:77,type:0,content:'A'.repeat(4096) + 'B'.repeat(40)}
  const key = await worker.addMessage(row)
  await worker.drain();await worker.idle()
  assert.deepEqual(calls.map(text=>text[0]),['A','B'])
  assert.equal((await store.row(key)).state,'queued')
  fail = false;now += 60000
  await worker.drain();await worker.idle()
  assert.deepEqual(calls.map(text=>text[0]),['A','B','B'],'only the rejected second chunk is retried')
  assert.equal((await store.row(key)).state,'sent')
  assert.equal(receipts.at(-1).tgBotMsgId,101,'reply mapping retains the first confirmed Telegram message')
})

test('real local Telegram HTTP connection refusal recovers through the durable queue', async t=>{
  const http = require('node:http'),{once} = require('node:events'),{Telegram} = require('telegraf')
  const {TelegramOutbox} = require('../dist/repository/TelegramOutbox')
  const {MessageBufferService} = require('../dist/util/MessageBufferService')
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'telegram-http-recovery-'))
  const received = []
  const server = http.createServer(async(req,res)=>{
    const chunks = [];for await(const chunk of req)chunks.push(chunk)
    received.push(JSON.parse(Buffer.concat(chunks).toString()))
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,result:{message_id:11}}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const port = server.address().port
  await new Promise(resolve=>server.close(resolve))
  const api = new Telegram('123:synthetic',{apiRoot:`http://127.0.0.1:${port}`})
  const store = new TelegramOutbox(path.join(directory,'outbox.db'))
  let now = 1000000
  const worker = new MessageBufferService(store,{intervalMs:0,now:()=>now,logger:{info:noop,warn:noop,error:noop},notify:noop})
  t.after(async()=>{await worker.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})})
  const q = queueFixture(loadClient())
  q.client.messageBufferService = worker;q.client.waitForTelegramSendSlot = async()=>undefined
  q.client.sendBufferedMessage = async row=>{
    try {await q.client.sendTelegramRequest(row.chatId,()=>api.sendMessage(row.chatId,row.content,{message_thread_id:77}));return {success:true}}
    catch {return {success:false}}
  }
  worker.configure(()=>'account',(row,key)=>q.client.enqueueTelegramRetry(row,key))
  const key = await worker.addMessage({id:'http',chatId:-100,wxId:'peer',type:0,content:'synthetic'})
  await worker.drain();await worker.idle()
  assert.equal((await store.row(key)).state,'queued')
  server.listen(port,'127.0.0.1');await once(server,'listening')
  now += 60000;await worker.drain();await worker.idle()
  assert.equal((await store.row(key)).state,'sent')
  assert.equal(received.length,1)
  assert.equal(received[0].message_thread_id,77)
})

test('article forwarding retains topic/reply receipts, falls back only on explicit rejection and isolates uncertain sends',async()=>{
  const cases = [null,{response:{error_code:400,description:'Bad Request: rich_message not supported'}},Object.assign(new Error('reset'),{code:'ECONNRESET'}),{response:{error_code:429,parameters:{retry_after:1}}}]
  for(const error of cases){
    const q = queueFixture(loadClient({prepareArticles:async()=>({rich_message:'{"blocks":[]}',article_cover_0:{source:Buffer.from('jpg'),filename:'a.jpg'}})}))
    delete q.client.sendBufferedMessage
    q.client.bindGroupService = {isManagedForum:async()=>true}
    q.client.waitForTelegramSendSlot = async()=>undefined
    const requests = [],stored = [];let texts = 0
    q.client.messageService = {createOrUpdate:async row=>stored.push({...row})}
    q.client.sendTextMsgSynchronously = async()=>{texts++;return true}
    q.client.client = {telegram:{callApi:async(method,payload)=>{requests.push({method,payload});if(error)throw error;return {message_id:123}}}}
    const result = await q.client.mirrorWebUI({id:'article',type:0,chatId:-100,threadId:77,wxId:'publisher',sender:'<b>Publisher</b>',content:'text',param:{reply_id:44},articles:[{title:'Title',description:'',url:'https://example.com',coverUrl:'https://mmbiz.qpic.cn/a'}]})
    assert.equal(requests.length,1);assert.equal(requests[0].method,'sendRichMessage')
    assert.equal(requests[0].payload.message_thread_id,77)
    assert.equal(requests[0].payload.reply_parameters.message_id,44)
    assert.equal(texts,error?.response?.error_code === 400 ? 1 : 0)
    if(!error)assert.equal(stored.at(-1).tgBotMsgId,123)
    if(error?.code === 'ECONNRESET'){assert.equal(result.success,false);assert.equal(result.deliveryUncertain,true)}
    if(error?.response?.error_code === 429){assert.equal(result.retryable,true);assert.equal(result.deliveryUncertain,false)}
  }
})

test('an existing text checkpoint prevents switching a partially sent article to a fresh rich card',async()=>{
  let preparations = 0,texts = 0
  const q = queueFixture(loadClient({prepareArticles:async()=>{preparations++;return {rich_message:'{}'}}}))
  delete q.client.sendBufferedMessage
  q.client.bindGroupService = {isManagedForum:async()=>false}
  q.client.messageBufferService.hasTextCheckpoint = async()=>true
  q.client.sendTextMsgSynchronously = async()=>{texts++;return true}
  const result = await q.client.enqueueTelegramRetry({id:'article',type:0,chatId:-100,articles:[{title:'Title',coverUrl:'https://mmbiz.qpic.cn/a'}]},'stored-key')
  assert.equal(result.success,true);assert.equal(preparations,0);assert.equal(texts,1)
})

test('both lanes retain per-chat/global spacing and the shared flood deadline', async () => {
  let now = 10000
  const waits = []
  const Client = loadClient({clock: {
    Date: {now: () => now},
    setTimeout: (resolve, ms) => {waits.push(ms); setImmediate(() => {now += ms; resolve()})},
  }})
  const q = queueFixture(Client)
  const requests = []
  q.client.sendBufferedMessage = async message => {
    await q.client.sendTelegramRequest(message.chatId, async () => {requests.push([message.id, now])})
    return {success: true}
  }
  q.client.enqueueTelegramMessage(q.item('media', -1, 1))
  q.client.enqueueTelegramMessage(q.item('text', -1))
  await Promise.all(q.client.chatLanes.values())
  assert.deepEqual(requests, [['media', 10000], ['text', 13200]])
  await q.client.sendTelegramRequest(-2, async () => {requests.push(['other', now])})
  assert.deepEqual(requests.at(-1), ['other', 13300])
  q.client.recordTelegramRetryAfter({response: {error_code: 429, parameters: {retry_after: 2}}})
  await q.client.sendTelegramRequest(-3, async () => {requests.push(['after-flood', now])})
  assert.deepEqual(requests.at(-1), ['after-flood', 16300])
  assert.deepEqual(waits, [3200, 100, 3000])
})

function fileFixture(Client, calls, {editFails = false} = {}) {
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({autoTranscript: true})},
    messageService: {createOrUpdate: async () => undefined},
    currentDeliveryUncertain: false,
    sendTelegramRequest: async (chatId, request) => {calls.push({method: 'request', chatId}); return request()},
    messageSender: {
      sendFile: async (...args) => {calls.push({method: 'sendFile', args}); return {message_id: 11}},
      editAudio: async (...args) => {
        calls.push({method: 'editAudio', args})
        if (editFails) throw new Error('edit rejected')
      },
    },
    dealException: noop,
  })
  return client
}

test('voice audio is delivered first and the transcript caption is edited afterwards', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = fileFixture(Client, calls)
  const message = {id: '1', chatId: -1, threadId: 7, sender: '<b>我</b>', type: 1,
    file: {fileName: '语音1.mp3', file: Buffer.from('a'), sendType: 'voice'}}
  const entity = {}
  await client.sendFileMessage(message, entity)
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['request', 'sendFile', 'transcript', 'request', 'editAudio'])
  assert.equal(calls[1].args[1].caption, '<b>我</b>', 'the audio is sent without waiting for ASR')
  assert.equal(calls[3].chatId, -1, 'the detached caption edit uses the shared request wrapper')
  assert.match(calls[4].args[2], /转写文本/)
  assert.equal(entity.tgBotMsgId, 11)
})

test('a failed transcription leaves the delivered audio untouched', async () => {
  const calls = []
  const Client = loadClient({calls, getTranscript: async () => {throw new Error('asr down')}})
  const client = fileFixture(Client, calls)
  const message = {id: '2', chatId: -1, sender: 'me', type: 1,
    file: {fileName: '语音2.mp3', file: Buffer.from('a'), sendType: 'voice'}}
  await client.sendFileMessage(message, {})
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['request', 'sendFile', 'transcript'])
})

test('a failed caption edit does not fail the delivered audio', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = fileFixture(Client, calls, {editFails: true})
  const message = {id: '3', chatId: -1, sender: 'me', type: 1,
    file: {fileName: '语音3.mp3', file: Buffer.from('a'), sendType: 'voice'}}
  await assert.doesNotReject(client.sendFileMessage(message, {}))
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['request', 'sendFile', 'transcript', 'request', 'editAudio'])
})

test('non-voice files never trigger transcription', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = fileFixture(Client, calls)
  const message = {id: '4', chatId: -1, sender: 'me', type: 1,
    file: {fileName: 'a.pdf', file: Buffer.from('a'), sendType: 'document'}}
  await client.sendFileMessage(message, {})
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['request', 'sendFile'])
})
function mediaFixture(Client, calls, {failUpload = false} = {}) {
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({autoTranscript: false})},
    messageService: {createOrUpdate: async () => undefined},
    currentDeliveryUncertain: false,
    sendTelegramRequest: async (_chatId, request) => request(),
    messageSender: {
      sendFile: async (...args) => {
        calls.push({method: 'sendFile', args})
        if (failUpload) throw new Error('upload rejected')
        return {message_id: 78}
      },
    },
    dealException: noop,
  })
  return client
}

test('media is sent directly after conversion, without a placeholder', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls)
  const message = {id: 'm1', chatId: -5, threadId: 9, sender: 'cap', type: 1,
    file: {fileName: 'a.gif', file: Buffer.from('a'), sendType: 'animation'}}
  const entity = {}
  await client.sendFileMessage(message, entity)
  assert.deepEqual(calls.map(call => call.method), ['sendFile'])
  assert.equal(calls[0].args[2].message_thread_id, 9, 'media goes into the same topic')
  assert.equal(calls[0].args[2].reply_id, undefined, 'no placeholder reply is attached')
  assert.equal(entity.tgBotMsgId, 78)
})

test('a failed upload fails without any leftover placeholder', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls, {failUpload: true})
  const message = {id: 'm2', chatId: -5, sender: 'cap', type: 1,
    file: {fileName: 'a.gif', file: Buffer.from('a'), sendType: 'animation'}}
  assert.equal((await client.sendFileMessage(message, {})).success, false)
  assert.deepEqual(calls.map(call => call.method), ['sendFile'])
})

test('large documents use the MTProto upload path directly', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls)
  client.sendLargeDocumentViaTelegramApi = async () => {calls.push({method: 'largeUpload'}); return {message_id: 80}}
  const message = {id: 'm3', chatId: -5, sender: 'cap', type: 1,
    file: {fileName: 'big.zip', file: {length: 60 * 1024 * 1024}, sendType: 'document'}}
  await client.sendFileMessage(message, {})
  assert.deepEqual(calls.map(call => call.method), ['largeUpload'])
})