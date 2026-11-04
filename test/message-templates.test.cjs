/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {FormatUtils} = require('../dist/util/FormatUtils')
const {MESSAGE_TEMPLATE_DEFAULTS: defaults} = require('../dist/util/MessageTemplates')
const preview = require('../src/webui/public/template-preview')
const {groupApi} = require('wx2tg-puppet/dist/api/GroupApi')
const {createGroupMemberNameResolver} = require('../dist/service/GroupMemberNameService')

const result = list => ({data: {Code: 0, Data: {NewChatroomData: {ChatRoomMember: list}}}})
const member = (id, displayName, nickname = '微信昵称') => ({UserName: {string: id}, DisplayName: displayName, NickName: {string: nickname}, Remark: '绝不能显示的通讯录备注'})

test('member_name is not confused with name, and legacy conditional wrappers keep working', () => {
  const text = FormatUtils.transformTitleStr('#[member_name]|#[name]|#[(alias)]|#[[name]]|#[alias_first]|#[topic]', '备注', '昵称', '群名', '群昵称')
  assert.equal(text, '群昵称|昵称|(备注)|[昵称]|备注|群名')
  assert.equal(FormatUtils.transformTitleStr('#[member_name]', '备注', '昵称', '群名'), '昵称')
  assert.equal(FormatUtils.transformTitleStr('#[(alias)]#[[name]]', '', '昵称', ''), '[昵称]')
  assert.equal(FormatUtils.transformIdentityBodyStr('#[member_name]#[br]#[body]', 'identity', '正文 😀', '<群昵称> & "名"'), '&lt;群昵称&gt; &amp; &quot;名&quot;\n正文 😀')
})

test('all seven defaults and blank-field preview match runtime, without decorative emoji', () => {
  const sample = {alias: '通讯录备注', name: '微信昵称', memberName: '自己的群昵称', topic: '微信群', official: '公众号', groupAlias: '群备注', body: '正文 😀 [微笑]'}
  for (const key of Object.keys(defaults)) {
    if (key === 'MESSAGE_DISPLAY') continue
    const group = key.startsWith('ROOM_'), official = key.startsWith('OFFICIAL_')
    const name = official ? sample.official : sample.name
    const identity = FormatUtils.transformTitleStr(defaults[key], official ? '' : sample.alias, name, group ? sample.topic : '', sample.memberName)
    const expected = FormatUtils.transformIdentityBodyStr(defaults.MESSAGE_DISPLAY, identity, sample.body, sample.memberName)
    for (const value of [undefined, '', ' \n\t ']) {
      assert.equal(preview.example(key, {[key]: value, MESSAGE_DISPLAY: value}, sample, 'group', defaults).text, expected)
    }
    assert(!/[👤🌐📣]/u.test(expected))
    if (group) {
      assert.equal(expected, '<b>自己的群昵称: </b>\n正文 😀 [微笑]')
      assert(!expected.includes(sample.alias))
      assert(!expected.includes(sample.topic))
    }
  }
  assert.equal(preview.example('MESSAGE_DISPLAY', {}, {...sample, memberName: ''}, 'group', defaults).text,
    '<b>微信昵称: </b>\n正文 😀 [微笑]')
  assert.equal(preview.example('CREATE_ROOM_NAME', {CREATE_ROOM_NAME: ''}, sample, 'group', defaults).text, '')
  assert.equal(preview.message('#[member_name]#[br]#[body]', '', sample.body, '<昵称>'),
    FormatUtils.transformIdentityBodyStr('#[member_name]#[br]#[body]', '', sample.body, '<昵称>'))
})

test('real member parsing/cache prefers each group DisplayName, then NickName, never Remark', async t => {
  const calls = []
  t.mock.method(groupApi, 'GetChatRoomMemberDetail', async request => {
    calls.push(request)
    return result([member('sender', request.QID === 'a@chatroom' ? 'A 群昵称' : 'B 群昵称'), member('plain', ''), member('unknown', '', '')])
  })
  let self = 'account-a'
  const resolve = createGroupMemberNameResolver(() => self)
  assert.deepEqual(await Promise.all(Array.from({length: 5}, () => resolve('a@chatroom', 'sender', '联系人昵称'))), Array(5).fill('A 群昵称'))
  assert.equal(calls.length, 1)
  assert.equal(await resolve('a@chatroom', 'plain', '联系人昵称'), '微信昵称')
  assert.equal(await resolve('a@chatroom', 'unknown', '联系人昵称'), '联系人昵称')
  assert.equal(await resolve('a@chatroom', 'missing', '联系人昵称'), '联系人昵称')
  assert.equal(await resolve('b@chatroom', 'sender', '联系人昵称'), 'B 群昵称')
  self = 'account-b'
  assert.equal(await resolve('a@chatroom', 'sender', '联系人昵称'), 'A 群昵称')
  assert.equal(calls.length, 3)
  assert.equal(calls.at(-1).Wxid, 'account-b')
})

test('failed and hanging member enrichment falls back quickly with a per-account/group backoff', async () => {
  let now = 1000, calls = 0, self = 'account-a', mode = 'hang'
  const timers = new Map(), exports = {}
  let nextTimer = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/service/GroupMemberNameService.js'), 'utf8'), {
    exports, Date: class extends Date {static now() {return now}},
    setTimeout: (callback, delay) => {assert.equal(delay, 1500); timers.set(++nextTimer, callback); return nextTimer},
    clearTimeout: id => timers.delete(id),
    require: () => ({createGroupMentionService: () => ({members: async () => {
      calls++
      if (mode === 'hang') return new Promise(() => undefined)
      if (mode === 'fail') throw new Error('upstream unavailable')
      return [{wxId: 'sender', displayName: '恢复后的群昵称'}]
    }})}),
  })
  const resolve = exports.createGroupMemberNameResolver(() => self)
  const pending = resolve('room@chatroom', 'sender', '微信昵称')
  assert.equal(calls, 1)
  timers.values().next().value()
  assert.equal(await pending, '微信昵称')
  assert.equal(timers.size, 0)
  assert.equal(await resolve('room@chatroom', 'sender', '微信昵称'), '微信昵称')
  assert.equal(calls, 1)
  now += 60000
  mode = 'fail'
  assert.equal(await resolve('room@chatroom', 'sender', '微信昵称'), '微信昵称')
  assert.equal(calls, 2)
  self = 'account-b'
  mode = 'success'
  assert.equal(await resolve('room@chatroom', 'sender', '微信昵称'), '恢复后的群昵称')
  assert.equal(calls, 3)
  assert.equal(timers.size, 0)
})

function forwardingFixture() {
  const sent = [], exports = {}
  const bot = {sendMessage: async value => {sent.push(value); return true}}
  const configuration = {...defaults, AUTO_CREATE_GROUPS: false, WECHAT_CUSTOM_EMOJI_ENABLED: false}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/WechatClient.js'), 'utf8'), {
    exports, process: {env: {WEBUI_ENABLED: 'false'}},
    require: name => {
      if (name === '../base/BaseClient') return {AbstractClient: class {static getSpyClient() {return bot}}}
      if (name === '../config') return {config: configuration}
      if (name === '../util/FormatUtils') return {FormatUtils}
      if (name === '../service/GroupMemberNameService') return {createGroupMemberNameResolver}
      if (name === '../webui/message-visibility') return {isControlMessage: () => false}
      if (name === '../util/EmojiUtils') return {EmojiConverter: class {convert(value) {return value}}}
      if (name === 'wx2tg-puppet') return {Message: {Type: {Text: 1}}}
      return {}
    },
  })
  const client = Object.create(exports.WeChatClient.prototype)
  client.loginReady = Promise.resolve()
  client.startTime = 1
  client._wxInfo = {wxid: 'self'}
  const noop = () => undefined
  client.logger = {debug: noop, info: noop, warn: noop, error: noop}
  client.messageService = {getByWxMsgId: async () => null}
  client.configurationService = {getConfig: async () => ({selfMessage: true, receivePublicAccount: true})}
  client.bindGroupService = {resolveWechat: async () => ({chatId: -123, wxId: 'room@chatroom', type: 1, isReceive: true})}
  const sender = {_wxid: 'sender', _alias: '通讯录备注', alias: async () => '通讯录备注', name: () => '微信昵称'}
  const recipient = {_wxid: 'room@chatroom', alias: async () => '错误收件人备注', name: () => '错误收件人昵称'}
  const message = {newMsgId: '1', date: () => 2, type: () => 1, text: () => '正文 😀 [微笑]', self: () => false,
    room: async () => ({chatroomId: 'room@chatroom', name: '群名称'}), from: async () => sender, to: async () => recipient, mentionSelf: async () => false}
  return {client, message, sent, sender, configuration}
}

for (const selfMessage of [false, true]) {
  test(`group forwarding uses the actual sender group nickname and preserves body emoji (self=${selfMessage})`, async t => {
    t.mock.method(groupApi, 'GetChatRoomMemberDetail', async () => result([member('sender', '<群内名字> & "明"')]))
    const f = forwardingFixture()
    f.message.self = () => selfMessage
    await f.client.onMessage(f.message)
    assert.equal(f.sent.length, 1)
    assert.equal(f.sent[0].sender, '<b>&lt;群内名字&gt; &amp; &quot;明&quot;: </b>')
    assert.equal(f.sent[0].memberName, '<群内名字> & "明"')
    assert.equal(f.sent[0].content, '正文 😀 [微笑]')
    assert(!f.sent[0].sender.includes('备注'))
    assert(!f.sent[0].sender.includes('错误收件人'))
  })
}

test('member lookup failure does not drop an incoming group message', async t => {
  t.mock.method(groupApi, 'GetChatRoomMemberDetail', async () => {throw new Error('unavailable')})
  const f = forwardingFixture()
  await f.client.onMessage(f.message)
  assert.equal(f.sent[0].sender, '<b>微信昵称: </b>')
})

test('custom group templates that do not use member_name need no enrichment RPC', async t => {
  let calls = 0
  t.mock.method(groupApi, 'GetChatRoomMemberDetail', async () => {calls++; throw new Error('Must not fetch')})
  const f = forwardingFixture()
  f.configuration.ROOM_MESSAGE_GROUP = '<b>#[name]</b>'
  await f.client.onMessage(f.message)
  assert.equal(f.sent[0].sender, '<b>微信昵称</b>')
  assert.equal(calls, 0)
})