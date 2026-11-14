/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const plain = value => JSON.parse(JSON.stringify(value))

// Reproduces the delivery failure: a nested keyboard made the Bot API payload
// carry `text: undefined`, Telegram rejected it, and the solitaire was dropped.
function senderFixture() {
  const calls = []
  const telegram = {
    sendMessage: async (...args) => {calls.push(args); return {message_id: 9}},
    sendChatAction: async () => ({ok: true}),
    editMessageText: async () => ({ok: true}),
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/message/TelegramBotApiMessageSender.js'), 'utf8'), {
    exports, console, Buffer, setTimeout, clearTimeout, Promise,
    require: name => {
      if (name === 'telegraf') return require('telegraf')
      if (name === 'abort-controller') return {default: globalThis.AbortController}
      if (name === '../util/TelegramKeyboard') return require('../dist/util/TelegramKeyboard')
      if (name === '../base/BaseClient') return {AbstractClient: class {static getSpyClient() {return {client: {telegram}}}}}
      // Minimal base class: the real one reaches into the client registry.
      if (name === './MessageSender') return {MessageSender: class {sendAction() {}}}
      if (name === '../config') return {config: {WECHAT_CUSTOM_EMOJI_ENABLED: false}}
      if (name === '../util/WechatCustomEmoji') return {renderWechatCustomEmojiHtml: text => text}
      if (name === '../util/TelegramPresentation') return require('./helpers/telegram-presentation')()
      return {}
    },
  })
  const sender = new exports.TelegramBotApiMessageSender({telegram})
  return {sender, calls}
}

test('the solitaire button reaches Telegram as one row with text and callback data', async () => {
  const {sender, calls} = senderFixture()
  await sender.sendText(-100123, '接龙正文', {
    parse_mode: 'HTML', message_thread_id: 77,
    inline_keyboard: [{text: '参与接龙', callback_data: 'sl:abc123'}],
  })
  const [, text, options] = calls[0]
  assert.equal(text, '接龙正文')
  assert.equal(options.message_thread_id, 77)
  assert.deepEqual(plain(options.reply_markup), {inline_keyboard: [[{text: '参与接龙', callback_data: 'sl:abc123'}]]})
})

test('nested rows are normalised instead of sending undefined button text', async () => {
  const {sender, calls} = senderFixture()
  await sender.sendText(1, 'body', {inline_keyboard: [[{text: '参与接龙', callback_data: 'sl:abc'}]]})
  const payload = calls[0][2].reply_markup.inline_keyboard
  assert.deepEqual(plain(payload), [[{text: '参与接龙', callback_data: 'sl:abc'}]])
  assert.equal(JSON.stringify(calls).includes('undefined'), false)
})

test('a malformed keyboard never blocks the message itself', async () => {
  const {sender, calls} = senderFixture()
  await sender.sendText(1, '必须送达', {inline_keyboard: [{}]})
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], '必须送达')
  assert.equal(calls[0][2].reply_markup, undefined)
})

test('legacy query-style buttons and multiple buttons still render', async () => {
  const {sender, calls} = senderFixture()
  await sender.sendText(1, 'x', {inline_keyboard: [{text: 'A', query: 'q1'}, {text: 'B', callback_data: 'q2'}]})
  assert.deepEqual(plain(calls[0][2].reply_markup), {inline_keyboard: [[
    {text: 'A', callback_data: 'q1'}, {text: 'B', callback_data: 'q2'},
  ]]})
})