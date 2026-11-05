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

test('a nickname that literally reads "undefined" is sent verbatim', () => {
  assert.equal(solitaireJoinBody({wxid: 'a', toWxid: 'r@chatroom', content: 'undefined', newMsgId: '1'}),
    '{"Wxid":"a","ToWxid":"r@chatroom","Content":"undefined","NewMsgID":1}')
})

for (const blank of ['', '   ', '\n']) {
  test(`join body still refuses blank content ${JSON.stringify(blank)}`, () => {
    assert.throws(() => solitaireJoinBody({wxid: 'a', toWxid: 'r@chatroom', content: blank, newMsgId: '1'}))
  })
}

test('create body carries Title/Content/Tail and never a message id', () => {
  const body = serviceApi.solitaireCreateBody({wxid: 'wxid_self', toWxid: 'room@chatroom', title: ' 周五聚餐 ', content: ' 报名 ', tail: ' 截止周四 '})
  assert.equal(body, '{"Wxid":"wxid_self","ToWxid":"room@chatroom","Title":"周五聚餐","Content":"报名","Tail":"截止周四"}')
  assert(!body.includes('MsgID'))
  assert.equal(serviceApi.solitaireCreateBody({wxid: 'a', toWxid: 'r@chatroom', title: 't', content: 'c'}),
    '{"Wxid":"a","ToWxid":"r@chatroom","Title":"t","Content":"c"}')
})

for (const bad of [
  {wxid: '', toWxid: 'r@chatroom', title: 't', content: 'c'},
  {wxid: 'a', toWxid: '', title: 't', content: 'c'},
  {wxid: 'a', toWxid: 'r@chatroom', title: '  ', content: 'c'},
  {wxid: 'a', toWxid: 'r@chatroom', title: 't', content: '   '},
]) {
  test(`create body rejects invalid input ${JSON.stringify(bad)}`, () => {
    assert.throws(() => serviceApi.solitaireCreateBody(bad))
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

const serviceApi = require('../dist/service/SolitaireService')

function fixture({loggedIn = true, groupName = '我的群昵称', result = {status: 'joined'}, createResult = {status: 'joined'}, binding = {chatId: -100123, wxId: 'room@chatroom', type: 1}} = {}) {
  solitaireJoins.clear()
  const replies = [], names = [], bodies = []
  const i18n = {t: (key, params = {}) => Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{{${name}}}`, replacement), zh[key] || key)}
  const wxClient = {hasLogin: loggedIn, wxInfo: {wxid: 'wxid_self', nickName: '微信昵称'}}
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/TelegramBotClient.js'), 'utf8'), {
    exports, console, Buffer,
    require: name => ({
      '../i18n': {getInstance: () => i18n},
      '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return wxClient}}},
      '../service/SolitaireService': {solitaireJoins, solitaireJoinBody, solitaireCreateBody: serviceApi.solitaireCreateBody,
        sendSolitaireJoin: async body => {bodies.push(body); return result},
        sendSolitaireCreate: async body => {bodies.push(body); return createResult}},
      '../service/GroupMemberNameService': {createGroupMemberNameResolver: () => async (roomId, senderId, fallback) => {
        names.push({roomId, senderId, fallback})
        return groupName
      }},
      '../util/DirectoryPageDelivery': require('../dist/util/DirectoryPageDelivery'),
      // __importDefault wraps this object, so expose the methods directly.
      '../service/TelegramCommandHelper': {setCommand: noop, setSimpleCommandHandler: noop},
      '../util/TelegramTopicUtils': require('../dist/util/TelegramTopicUtils'),
    }[name] || {}),
  })
  const client = Object.create(exports.TelegramBotClient.prototype)
  Object.assign(client, {
    i18n,
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    configurationService: {getConfig: async () => ({chatId: 456})},
    bindGroupService: {resolveTelegram: async () => binding},
    messageSender: {sendText: noop},
  })
  const commands = new Map()
  client.onBotCommand({command: (name, handler) => commands.set(name, handler), start: noop, help: noop,
    telegram: {setMyCommands: async () => undefined},
    action: noop, use: noop, on: noop, hears: noop})
  const reply = async text => {replies.push(text); return {message_id: 2}}
  const ctx = fromId => ({from: {id: fromId}, chat: {id: -100123, type: 'supergroup'},
    callbackQuery: {message: {message_id: 1}}, answerCbQuery: async () => true, reply})
  const command = (name, {payload = '', fromId = 456, type = 'supergroup'} = {}) => {
    const record = {payload, replies}
    const context = {from: {id: fromId}, chat: {id: -100123, type}, payload,
      message: {message_id: 3}, reply, answerCbQuery: async () => true,
      telegram: {}}
    return commands.get(name)(context).then(() => record)
  }
  return {client, ctx, replies, names, bodies, command, setPendingConsume: text => client.dealWithCommand(ctx(456), text)}
}

function tokenFor(ownerId = 456) {
  return solitaireJoins.add({ownerId, toWxid: 'room@chatroom', selfId: 'wxid_self', msgId: '42', newMsgId: '9007199254740993123'})
}

test('owner taps the button: group nickname goes through the server join API', async () => {
  const f = fixture()
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [], 'a successful join stays silent: WeChat forwards the updated solitaire')
  assert.deepEqual(f.names, [{roomId: 'room@chatroom', senderId: 'wxid_self', fallback: '微信昵称'}])
  assert.deepEqual(f.bodies,
    ['{"Wxid":"wxid_self","ToWxid":"room@chatroom","Content":"我的群昵称","NewMsgID":9007199254740993123}'])
})

test('a nickname that reads "undefined" is a real name and joins normally', async () => {
  const f = fixture({groupName: 'undefined'})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [])
  assert.equal(JSON.parse(f.bodies[0]).Content, 'undefined')
})

test('a genuinely empty name is refused instead of sending anything', async () => {
  const f = fixture({groupName: '   '})
  await f.client.handleSolitaireJoin(f.ctx(456), `sl:${tokenFor()}`)
  assert.deepEqual(f.replies, [zh['solitaire.no_name']])
  assert.equal(f.bodies.length, 0)
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
  assert.deepEqual(f.replies, ['微信没有接受：未找到接龙消息'])
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

test('/join sends the typed text verbatim, replacing the nickname', async () => {
  const f = fixture()
  solitaireJoins.remember({token: 't', ownerId: 456, toWxid: 'room@chatroom', selfId: 'wxid_self', newMsgId: '9007199254740993123', expiresAt: Date.now() + 60000})
  await f.command('join', {payload: '  2 份  '})
  assert.deepEqual(f.replies, [])
  assert.equal(JSON.parse(f.bodies[0]).Content, '2 份')
  assert.equal(JSON.parse(f.bodies[0]).NewMsgID, 9007199254740993000)
})

test('/join without text arms the reply path and asks for content', async () => {
  const f = fixture()
  solitaireJoins.remember({token: 't', ownerId: 456, toWxid: 'room@chatroom', selfId: 'wxid_self', newMsgId: '7', expiresAt: Date.now() + 60000})
  await f.command('join', {payload: ''})
  assert.deepEqual(f.replies, [zh['solitaire.custom_prompt']])
  assert.equal(f.bodies.length, 0)
})

test('/join without any known solitaire is refused', async () => {
  const f = fixture()
  await f.command('join', {payload: '2 份'})
  assert.deepEqual(f.replies, [zh['solitaire.no_target']])
  assert.equal(f.bodies.length, 0)
})

test('a reply after the custom prompt is consumed exactly once', async () => {
  const f = fixture()
  solitaireJoins.remember({token: 't', ownerId: 456, toWxid: 'room@chatroom', selfId: 'wxid_self', newMsgId: '7', expiresAt: Date.now() + 60000})
  const token = solitaireJoins.add({ownerId: 456, toWxid: 'room@chatroom', selfId: 'wxid_self', newMsgId: '7'})
  await f.client.handleSolitaireCustom(f.ctx(456), `slc:${token}`)
  assert.deepEqual(f.replies, [zh['solitaire.custom_prompt']])
  assert.equal(await f.client.dealWithCommand({from: {id: 456}, chat: {id: -100123, type: 'supergroup'}}, '带家属 3 人'), true)
  assert.equal(JSON.parse(f.bodies[0]).Content, '带家属 3 人')
  assert.equal(await f.client.dealWithCommand({from: {id: 456}, chat: {id: -100123, type: 'supergroup'}}, '随便一句'), false)
})

test('/solitaire starts a new solitaire in the bound WeChat group', async () => {
  const f = fixture()
  await f.command('solitaire', {payload: '周五聚餐 | 报名 | 截止周四'})
  const body = JSON.parse(f.bodies[0])
  assert.deepEqual(body, {Wxid: 'wxid_self', ToWxid: 'room@chatroom', Title: '周五聚餐', Content: '报名', Tail: '截止周四'})
  assert.deepEqual(f.replies, [], 'create also stays silent; WeChat publishes the message')
})

test('/solitaire without a bound WeChat group is refused with usage', async () => {
  for (const binding of [null, {chatId: -100123, wxId: 'wxid_person', type: 0}]) {
    const f = fixture({binding})
    await f.command('solitaire', {payload: '周五聚餐 | 报名'})
    assert.deepEqual(f.replies, [zh['solitaire.create_group_only']])
    assert.equal(f.bodies.length, 0)
  }
  const bad = fixture()
  await bad.command('solitaire', {payload: '只有标题'})
  assert.deepEqual(bad.replies, [zh['solitaire.create_usage']])
  assert.equal(bad.bodies.length, 0)
})
