/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const noop = () => undefined
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

/** Loads the compiled client with only the collaborators each test needs. */
function loadClient({getTranscript = async () => '转写文本', calls = []} = {}) {
  const stubs = {
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
    exports, console, Buffer, setTimeout, clearTimeout, process: {env: {WEBUI_ENABLED: 'false'}},
    require: name => stubs[name] || {},
  })
  return exports.TelegramBotClient
}

function queueFixture(Client) {
  const started = [], finished = []
  let openGate
  const gate = new Promise(resolve => {openGate = resolve})
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    telegramMessageQueue: [],
    chatLanes: new Map(),
    activeWebUISync: new Set(),
    currentRetryAfterMs: undefined,
    currentDeliveryUncertain: false,
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    messageBufferService: {markMessageAsSent: noop, markMessageAsFailed: noop},
    sendBufferedMessage: async message => {
      started.push(message.id)
      if (message.id === 'slow') await gate
      finished.push(message.id)
      return {success: true}
    },
  })
  const item = (id, chatId) => ({message: {id, chatId, type: 0}, messageId: id, isRetry: false})
  return {client, started, finished, release: openGate, item}
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

test('messages inside one chat stay ordered even when the first one is slow', async () => {
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

function fileFixture(Client, calls, {editFails = false} = {}) {
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({autoTranscript: true})},
    messageService: {createOrUpdate: async () => undefined},
    currentDeliveryUncertain: false,
    sendTelegramRequest: async (_chatId, request) => request(),
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
  assert.deepEqual(calls.map(call => call.method), ['sendFile', 'transcript', 'editAudio'])
  assert.equal(calls[0].args[1].caption, '<b>我</b>', 'the audio is sent without waiting for ASR')
  assert.match(calls[2].args[2], /转写文本/)
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
  assert.deepEqual(calls.map(call => call.method), ['sendFile', 'transcript'])
})

test('a failed caption edit does not fail the delivered audio', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = fileFixture(Client, calls, {editFails: true})
  const message = {id: '3', chatId: -1, sender: 'me', type: 1,
    file: {fileName: '语音3.mp3', file: Buffer.from('a'), sendType: 'voice'}}
  await assert.doesNotReject(client.sendFileMessage(message, {}))
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['sendFile', 'transcript', 'editAudio'])
})

test('non-voice files never trigger transcription', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = fileFixture(Client, calls)
  const message = {id: '4', chatId: -1, sender: 'me', type: 1,
    file: {fileName: 'a.pdf', file: Buffer.from('a'), sendType: 'document'}}
  await client.sendFileMessage(message, {})
  await settle()
  assert.deepEqual(calls.map(call => call.method), ['sendFile'])
})
function mediaFixture(Client, calls, {failUpload = false} = {}) {
  const client = Object.create(Client.prototype)
  Object.assign(client, {
    i18n: {t: key => key === 'send.media_preparing' ? '处理中…' : key},
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({autoTranscript: false})},
    messageService: {createOrUpdate: async () => undefined},
    currentDeliveryUncertain: false,
    sendTelegramRequest: async (_chatId, request) => request(),
    messageSender: {
      sendText: async (...args) => {calls.push({method: 'sendText', args}); return {message_id: 77}},
      sendFile: async (...args) => {
        calls.push({method: 'sendFile', args})
        if (failUpload) throw new Error('upload rejected')
        return {message_id: 78}
      },
      deleteMessage: async (...args) => {calls.push({method: 'deleteMessage', args})},
    },
    dealException: noop,
  })
  return client
}

test('media reserves its slot with a placeholder, replies to it, then clears it', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls)
  const message = {id: 'm1', chatId: -5, threadId: 9, sender: 'cap', type: 1,
    file: {fileName: 'a.gif', file: Buffer.from('a'), sendType: 'animation'}}
  const entity = {}
  await client.sendFileMessage(message, entity)
  assert.deepEqual(calls.map(call => call.method), ['sendText', 'sendFile', 'deleteMessage'])
  assert.equal(calls[0].args[2].message_thread_id, 9, 'placeholder goes into the same topic')
  assert.equal(calls[1].args[2].reply_id, 77, 'the upload attaches to the placeholder')
  assert.deepEqual(calls[2].args, [-5, 77])
  assert.equal(entity.tgBotMsgId, 78)
})

test('a failed upload clears its placeholder instead of leaving it stuck', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls, {failUpload: true})
  const message = {id: 'm2', chatId: -5, sender: 'cap', type: 1,
    file: {fileName: 'a.gif', file: Buffer.from('a'), sendType: 'animation'}}
  assert.equal((await client.sendFileMessage(message, {})).success, false)
  assert.deepEqual(calls.map(call => call.method), ['sendText', 'sendFile', 'deleteMessage'])
})

test('large documents keep their existing progress message instead of a placeholder', async () => {
  const calls = []
  const Client = loadClient({calls})
  const client = mediaFixture(Client, calls)
  client.sendLargeDocumentViaTelegramApi = async () => {calls.push({method: 'largeUpload'}); return {message_id: 80}}
  const message = {id: 'm3', chatId: -5, sender: 'cap', type: 1,
    file: {fileName: 'big.zip', file: {length: 60 * 1024 * 1024}, sendType: 'document'}}
  await client.sendFileMessage(message, {})
  assert.deepEqual(calls.map(call => call.method), ['largeUpload'])
})