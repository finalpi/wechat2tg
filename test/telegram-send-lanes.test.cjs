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
function loadClient({getTranscript = async () => '转写文本', calls = [], statuses, clock} = {}) {
  const stubs = {
    'node:async_hooks': require('node:async_hooks'),
    '../webui/delivery': require('../dist/webui/delivery'),
    '../webui/message-store': {WebMessageStore: {getInstance: () => ({
      setTelegramStatus: async (id, status) => {statuses?.push({id, status})},
    })}},
    '../i18n': {getInstance: () => ({t: key => key})},
    '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return undefined}}},
    '../config': {config: {TENCENT_SECRET_ID: 'id', TENCENT_SECRET_KEY: 'key', WECHAT_CUSTOM_EMOJI_ENABLED: false}},
    '../util/TelegramTopicUtils': require('../dist/util/TelegramTopicUtils'),
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
    messageBufferService: {markMessageAsSent: noop, markMessageAsFailed: noop},
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

test('unknown, partial and skipRetry delivery are terminal on initial sends and buffer retries', async () => {
  const q = queueFixture(loadClient())
  const sent = [], failed = []
  q.client.messageBufferService = {
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
  assert.deepEqual(sent, ['unknown', 'partial', 'skip'])
  assert.deepEqual(failed, [], 'initial uncertainty never schedules an automatic retry')
  for (const id of ['unknown-retry', 'partial-retry', 'skip-retry']) {
    const result = await q.client.enqueueTelegramRetry({id, chatId: -1, type: 0}, id)
    assert.equal(result.success, true, 'MessageBufferService must terminate its retry chain')
    assert.equal(result.deliveryUncertain, true)
  }
  assert.equal(requests, 2, 'only explicitly queued attempts issue requests')
  assert.deepEqual(failed, [])
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