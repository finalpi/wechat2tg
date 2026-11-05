/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const zh = require('../dist/i18n/locales/zh-CN').default
const service = require('../dist/service/SolitaireService')

const {solitaireJoinBody, classifySolitaireResponse, SolitaireJoinRegistry, solitaireJoins} = service
const noop = () => undefined

test('join body carries no Title/Tail and keeps uint64 IDs as raw JSON digits', () => {
  const body = solitaireJoinBody({
    wxid: 'wxid_self', toWxid: 'room@chatroom', content: '  我的群昵称\r\n第二行  ',
    newMsgId: '9007199254740993123', msgId: '42',
  })
  assert.equal(body, '{"Wxid":"wxid_self","ToWxid":"room@chatroom","Content":"我的群昵称\\n第二行","NewMsgID":9007199254740993123}')
  assert(!body.includes('Title') && !body.includes('Tail') && !body.includes('SourceXml'))
  assert.equal(String(JSON.parse(body).NewMsgID), '9007199254740993000', 'the wire keeps full digits; JSON.parse would round')
  assert(solitaireJoinBody({wxid: 'a', toWxid: 'r@chatroom', content: 'x', msgId: '42'}).endsWith('"MsgID":42}'))
  assert.equal(solitaireJoinBody({wxid: 'a"b', toWxid: 'r@chatroom', content: 'x"y\\z', msgId: '1'}),
    '{"Wxid":"a\\"b","ToWxid":"r@chatroom","Content":"x\\"y\\\\z","MsgID":1}')
})

for (const input of [
  {wxid: '', toWxid: 'r@chatroom', content: 'x', newMsgId: '1'},
  {wxid: 'a', toWxid: 'r@chatroom', content: '   ', newMsgId: '1'},
  {wxid: 'a', toWxid: 'r@chatroom', content: 'x', newMsgId: '0'},
  {wxid: 'a', toWxid: 'r@chatroom', content: 'x', newMsgId: '1e5'},
  {wxid: 'a', toWxid: 'r@chatroom', content: 'x'},
]) {
  test(`join body rejects invalid input ${JSON.stringify(input)}`, () => {
    assert.throws(() => solitaireJoinBody(input))
  })
}

test('one-to-one conversations are accepted as join targets', () => {
  assert.equal(solitaireJoinBody({wxid: 'a', toWxid: 'wxid_friend', content: '我的名字', newMsgId: '7'}),
    '{"Wxid":"a","ToWxid":"wxid_friend","Content":"我的名字","NewMsgID":7}')
})

for (const bad of ['undefined', 'null', 'undefined ']) {
  test(`join body refuses placeholder content ${JSON.stringify(bad)}`, () => {
    assert.throws(() => solitaireJoinBody({wxid: 'a', toWxid: 'r@chatroom', content: bad, newMsgId: '1'}))
  })
}

test('only an explicit success counts as joined; -8 is a rejection; anything else is uncertain', () => {
  assert.deepEqual(classifySolitaireResponse({Success: true, Code: 0, Data: {}}), {status: 'joined'})
  assert.deepEqual(classifySolitaireResponse({Success: false, Code: -8, Message: ' 未找到接龙消息 '}),
    {status: 'rejected', reason: '未找到接龙消息'})
  assert.deepEqual(classifySolitaireResponse({Success: false, Code: -8}), {status: 'rejected', reason: 'unknown'})
  for (const data of [{Success: false, Code: -13, Message: 'x'}, {Success: true, Code: 7}, {Code: 0}, null, undefined, 'ok', {}]) {
    assert.deepEqual(classifySolitaireResponse(data), {status: 'unknown'})
  }
})

test('callback tokens are owner scoped, expire, and stay bounded', () => {
  let now = 1000
  const registry = new SolitaireJoinRegistry(100, 3, () => now)
  const token = registry.add({ownerId: 7, toWxid: 'r@chatroom', selfId: 'self', newMsgId: '99'})
  assert.match(token, /^[a-z0-9]{1,14}$/)
  assert.equal(`sl:${token}`.length <= 64, true)
  assert.equal(registry.resolve(token, 8), undefined, 'another user must not join with the same token')
  assert.equal(registry.resolve(token, 7).newMsgId, '99')
  now = 1100
  assert.equal(registry.resolve(token, 7), undefined, 'expired tokens fail closed')
  const tokens = Array.from({length: 5}, () => registry.add({ownerId: 7, toWxid: 'r@chatroom', selfId: 'self', msgId: '1'}))
  assert.equal(new Set(tokens).size, 5)
  assert.equal(registry.resolve(tokens[0], 7), undefined, 'oldest entries are evicted beyond capacity')
  assert(registry.resolve(tokens.at(-1), 7))
})

function fixture({loggedIn = true, groupName = '我的群昵称', result = {status: 'joined'}} = {}) {
  const replies = [], names = [], bodies = []
  const i18n = {t: (key, params = {}) => Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{{${name}}}`, replacement), zh[key] || key)}
  const wxClient = {hasLogin: loggedIn, wxInfo: {wxid: 'wxid_self', nickName: '微信昵称'}}
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/TelegramBotClient.js'), 'utf8'), {
    exports, console, Buffer,
    require: name => ({
      '../i18n': {getInstance: () => i18n},
      '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return wxClient}}},
      '../service/SolitaireService': {solitaireJoins, solitaireJoinBody, sendSolitaireJoin: async body => {
        bodies.push(body)
        return result
      }},
      '../service/GroupMemberNameService': {createGroupMemberNameResolver: () => async (roomId, senderId, fallback) => {
        names.push({roomId, senderId, fallback})
        return groupName
      }},
      '../util/DirectoryPageDelivery': require('../dist/util/DirectoryPageDelivery'),
    }[name] || {}),
  })
  const client = Object.create(exports.TelegramBotClient.prototype)
  Object.assign(client, {
    i18n,
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({chatId: 456})},
  })
  const reply = async text => {replies.push(text); return {message_id: 2}}
  const ctx = fromId => ({from: {id: fromId}, chat: {id: -100123, type: 'supergroup'},
    callbackQuery: {message: {message_id: 1}}, answerCbQuery: async () => true, reply})
  return {client, ctx, replies, names, bodies}
}

function tokenFor(ownerId = 456) {
  return solitaireJoins.add({ownerId, toWxid: 'room@chatroom', selfId: 'wxid_self', msgId: '42', newMsgId: '9007199254740993123'})
}

test('owner taps the button: group nickname goes through the server join API', async () => {
  const f = fixture()
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, ['已加入接龙名单：我的群昵称'])
  assert.deepEqual(f.names, [{roomId: 'room@chatroom', senderId: 'wxid_self', fallback: '微信昵称'}])
  assert.deepEqual(f.bodies,
    ['{"Wxid":"wxid_self","ToWxid":"room@chatroom","Content":"我的群昵称","NewMsgID":9007199254740993123}'])
})

test('a placeholder name is never written into the WeChat list', async () => {
  const f = fixture({groupName: 'undefined'})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [zh['solitaire.no_name']])
  assert.equal(f.bodies.length, 0, 'nothing is sent when the name is unusable')
})

test('non-owner taps the button: nothing is sent to WeChat', async () => {
  const f = fixture()
  await f.client.handleSolitaireJoin(f.ctx(999), `sl:${tokenFor(456)}`)
  assert.deepEqual(f.replies, [zh['solitaire.owner_only']])
  assert.equal(f.names.length + f.bodies.length, 0)
})

test('expired or unknown tokens fail closed without sending', async () => {
  const f = fixture()
  await f.client.handleSolitaireJoin(f.ctx(456), 'sl:missing-token')
  assert.deepEqual(f.replies, [zh['solitaire.expired']])
  assert.equal(f.bodies.length, 0)
})

test('server rejection is reported with its reason and never retried', async () => {
  const f = fixture({result: {status: 'rejected', reason: '未找到接龙消息'}})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, ['微信拒绝了接龙请求：未找到接龙消息'])
  assert.equal(f.bodies.length, 1)
})

test('an uncertain outcome says so and does not resend', async () => {
  const f = fixture({result: {status: 'unknown'}})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [zh['solitaire.unknown']])
  assert.equal(f.bodies.length, 1)
})

test('logged-out WeChat refuses before building a request', async () => {
  const f = fixture({loggedIn: false})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [zh['login.please_login_wx']])
  assert.equal(f.bodies.length, 0)
})