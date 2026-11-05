/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const os = require('node:os')
const {Message: WxMessage} = require('wx2tg-puppet')

const title = '#接龙\n\n周五活动 <确认> & 准时\n\n1. 张三 001\n2. 李四 [微笑]'
const xml = '<msg><appmsg><title><![CDATA[' + title + ']]></title><type>53</type><extinfo><solitaire_info><![CDATA[<solitaire><content><i><u>synthetic</u><c>001</c></i></content></solitaire>]]></solitaire_info></extinfo></appmsg></msg>'

function fixture() {
  const sent = [], exports = {}
  const bot = {sendMessage: async message => {sent.push(message); return true}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/WechatClient.js'), 'utf8'), {
    exports, process: {env: {WEBUI_ENABLED: 'false'}},
    require: name => {
      if (name === '../base/BaseClient') return {AbstractClient: class {static getSpyClient() {return bot}}}
      if (name === '../config') return {config: {AUTO_CREATE_GROUPS: false, WECHAT_CUSTOM_EMOJI_ENABLED: true}}
      if (name === 'wx2tg-puppet') return require('wx2tg-puppet')
      if (name === '../util/FormatUtils') return {FormatUtils: {transformTitleStr: () => '<b>Sender</b>', escapeHtml: require('../dist/util/FormatUtils').FormatUtils.escapeHtml}}
      if (name === '../util/EmojiUtils') return {EmojiConverter: class {convert(value) {return value}}}
      if (name === '../webui/message-visibility') return {isControlMessage: () => false}
      if (name === '../util/WechatCallStatus') return require('../dist/util/WechatCallStatus')
      if (name === '../util/MessageTypeUtils') return require('../dist/util/MessageTypeUtils')
      if (name === '../util/TelegramTopicUtils') return require('../dist/util/TelegramTopicUtils')
      if (name === '../service/SolitaireService') return require('../dist/service/SolitaireService')
      if (name === '../i18n') return {getInstance: () => ({t: key => ({
        'solitaire.join_button': '参与接龙', 'solitaire.custom_button': '自定义参与',
      }[key] || key)})}
      if (name === '../service/WechatAccountClassificationService') return {WechatAccountClassificationService: {getInstance: () => ({isOfficialAccount: async () => false})}}
      return {}
    },
  })
  const client = Object.create(exports.WeChatClient.prototype)
  client.loginReady = Promise.resolve()
  client.startTime = 1
  client._wxInfo = {wxid: 'self'}
  client.logger = {debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined}
  client.messageService = {getByWxMsgId: async () => null}
  client.configurationService = {getConfig: async () => ({selfMessage: true, receivePublicAccount: true, chatId: 456})}
  client.bindGroupService = {resolveWechat: async () => ({chatId: -100123, wxId: 'room@chatroom', type: 1, isReceive: true})}
  client.groupOperate = {createGroup: async () => {throw Error('Must preserve existing group')}}
  const message = new WxMessage({MsgType: 49, Content: xml, xml, MsgId: '1', NewMsgId: '9007199254740993123', FromUserName: 'sender', ToUserName: 'self', CreateTime: 2, RoomId: 'room@chatroom'})
  message.from = async () => ({_wxid: 'sender', _alias: '', alias: async () => '', name: () => 'Sender'})
  message.room = async () => ({chatroomId: 'room@chatroom', name: 'Room'})
  message.self = () => false
  return {client, message, sent}
}

test('fresh solitaire capture is visible, pending and retains subtype 49 protocol source', async t => {
  const {WebMessageStore} = require('../dist/webui/message-store')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solitaire-capture-'))
  const store = new WebMessageStore(path.join(directory, 'fixture.db'))
  t.after(async () => {await store.ready; await new Promise(resolve => store.db.close(resolve)); fs.rmSync(directory, {recursive: true})})
  const {message} = fixture()
  await store.observe(message)
  const row = await store.byRemoteId('room@chatroom', message.newMsgId)
  assert.equal(row.type, 'solitaire')
  assert.equal(row.body, title)
  assert.equal(row.telegramStatus, 'pending')
  assert.equal(row.hidden, 0)
  const source = JSON.parse(row.source)
  assert.equal(source.MsgType, 49)
  assert.equal(source.Content, xml)
  assert.equal(new WxMessage(source).text(), title)
})

test('solitaire still respects disabled receiving and unbound-conversation policy', async () => {
  for (const binding of [null, {chatId: -100123, wxId: 'room@chatroom', type: 1, isReceive: false}]) {
    const {client, message, sent} = fixture()
    client.bindGroupService.resolveWechat = async () => binding
    await client.onMessage(message)
    assert.equal(sent.length, 0)
  }
})

test('real SDK appmsg 53 reaches the normal group forwarding path with visible solitaire text', async () => {
  const {client, message, sent} = fixture()
  await client.onMessage(message)
  assert.equal(sent.length, 1, 'solitaire must not disappear as undefined/unknown')
  assert.equal(sent[0].chatId, -100123)
  assert.equal(sent[0].conversationWxId, 'room@chatroom')
  assert.equal(sent[0].source_type, 'solitaire')
  assert.equal(sent[0].content, title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  assert.equal(message._xml, xml, 'raw protocol source remains unchanged')
  assert(!sent[0].content.includes('<appmsg>'))
})
test('group solitaire attaches an owner-scoped join button resolving to the real message ids', async () => {
  const {solitaireJoins} = require('../dist/service/SolitaireService')
  const {client, message, sent} = fixture()
  await client.onMessage(message)
  assert.equal(Array.isArray(sent[0].param.inline_keyboard[0]), false)
  const buttons = sent[0].param.inline_keyboard
  assert.equal(buttons.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(buttons.map(button => button.text))), ['参与接龙', '自定义参与'])
  assert(buttons[1].callback_data.startsWith('slc:'))
  assert.match(buttons[0].callback_data, /^sl:[a-z0-9]+$/)
  assert(buttons[0].callback_data.length <= 64)
  const target = solitaireJoins.resolve(buttons[0].callback_data.slice(3), 456)
  const remembered = solitaireJoins.latest(456, 'room@chatroom')
  assert.equal(remembered.newMsgId, target.newMsgId, 'the newest solitaire is remembered for /join')
  assert.equal(remembered.toWxid, target.toWxid)
  assert.equal(target.toWxid, 'room@chatroom')
  assert.equal(target.selfId, 'self')
  assert.equal(target.msgId, '1')
  assert.equal(target.newMsgId, message.newMsgId)
  assert.equal(solitaireJoins.resolve(buttons[0].callback_data.slice(3), 999), undefined)
})

test('a one-to-one solitaire also offers the join button targeting that contact', async () => {
  const {solitaireJoins} = require('../dist/service/SolitaireService')
  const {client, message, sent} = fixture()
  client.bindGroupService.resolveWechat = async () => ({chatId: -100124, wxId: 'wxid_friend', type: 0, isReceive: true})
  message.room = async () => null
  await client.onMessage(message)
  assert.equal(sent.length, 1)
  assert.equal(Array.isArray(sent[0].param.inline_keyboard[0]), false)
  const buttons = sent[0].param.inline_keyboard
  assert.equal(buttons[0].text, '参与接龙')
  const target = solitaireJoins.resolve(buttons[0].callback_data.slice(3), 456)
  assert.equal(target.toWxid, 'sender', 'one-to-one targets the counterpart WeChat id')
  assert.equal(target.newMsgId, message.newMsgId)
})