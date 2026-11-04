/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {EventEmitter} = require('node:events')

// Run the real compiled client methods without booting Telegram or SQLite.
function clientClass(config = {}, spies = {}, schedule = callback => queueMicrotask(callback)) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/WechatClient.js'), 'utf8'), {
    exports,
    process: {env: {WEBUI_ENABLED: 'false'}},
    // Keep bounded login-retry tests deterministic without real sleeps.
    setTimeout: schedule,
    require(name) {
      if (name === '../base/BaseClient') return {AbstractClient: class {static getSpyClient(key) {return spies[key]}}}
      if (name === '../i18n') return {getInstance: () => ({t: key => key})}
      if (name === '../config') return {config}
      if (name === '../service/WechatAccountClassificationService') return {WechatAccountClassificationService: {getInstance: () => ({isOfficialAccount: async (_id, flag) => require('wx2tg-puppet').isOfficialAccountVerifyFlag(flag)})}}
      if (name === '../webui/message-visibility') return {isControlMessage: () => false}
      if (name === '../entity/BindGroup') return {BindGroup: class {}}
      if (name === '../util/TelegramTopicUtils') return require('../dist/util/TelegramTopicUtils')
      if (name === '../util/FormatUtils') return {FormatUtils: {transformTitleStr: () => ''}}
      if (name === '../util/EmojiUtils') return {EmojiConverter: class {convert(value) {return value}}}
      if (name === 'wx2tg-puppet') return {Message: {Type: {Text: 1, Quote: 99}, getXmlToJson: () => ({msg: {appmsg: {refermsg: {type: 1, content: 'quoted preview'}}}})}}
      return {}
    },
  })
  return exports.WeChatClient
}

function fixture(config, spies, schedule) {
  const Client = clientClass(config, spies, schedule)
  const client = Object.create(Client.prototype)
  client.client = new EventEmitter()
  client.startTime = 10
  client.loginReady = Promise.resolve()
  client.logger = {debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined}
  return client
}

const oldMessage = {date: () => 0, type: () => 1, text: () => 'synthetic', newMsgId: '1'}

test('an immediate callback waits for asynchronous login initialization', async () => {
  const client = fixture()
  let release
  let entered = false
  client.client.info = () => new Promise(resolve => {release = resolve})
  client.loginSuccess = async () => undefined
  client.logger.debug = () => {entered = true}
  client.init()
  client.client.emit('login')
  const pending = client.onMessage(oldMessage)
  await Promise.resolve()
  assert.equal(entered, false)
  release({wxid: 'wxid_test'})
  await pending
  assert.equal(entered, true)
})

test('failed initialization rejects message processing instead of using missing account state', async () => {
  const client = fixture()
  let entered = false
  client.logger.debug = () => {entered = true}
  client.loginReady = Promise.reject(new Error('synthetic login failure'))
  await assert.rejects(client.onMessage(oldMessage), /synthetic login failure/)
  assert.equal(entered, false)
})

test('message event handler observes asynchronous failures', async () => {
  const client = fixture()
  const errors = []
  client.logger.error = (...args) => errors.push(args)
  client.onMessage = async () => {throw new Error('synthetic processing failure')}
  client.init()
  client.client.emit('message', oldMessage)
  // The merged capture path adds an async hop before its final error handler.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors.length, 1)
  assert.match(errors[0][0], /Wechat message handling failed/)
})

test('transient account lookup is retried before delivering the same message', async () => {
  const client = fixture()
  client.loginReady = undefined
  let attempts = 0
  client.client.info = async () => {
    if (++attempts === 1) throw new Error('temporary account lookup failure')
    return {wxid: 'wxid_test'}
  }
  await client.onMessage(oldMessage)
  assert.equal(attempts, 2)
  assert.equal(client._wxInfo.wxid, 'wxid_test')
})

test('exhausted account lookup can recover on the next message', async () => {
  const client = fixture()
  client.loginReady = undefined
  client.client.info = async () => {throw new Error('account temporarily unavailable')}
  await assert.rejects(client.onMessage(oldMessage), /temporarily unavailable/)
  assert.equal(client.loginReady, undefined)
  client.client.info = async () => ({wxid: 'wxid_test'})
  await client.onMessage(oldMessage)
  assert.equal(client._wxInfo.wxid, 'wxid_test')
})

test('optional login maintenance failure does not block subsequent messages', async () => {
  const client = fixture()
  let entered = false
  client.client.info = async () => ({wxid: 'wxid_test'})
  client.loginSuccess = async () => {throw new Error('binding maintenance failed')}
  client.logger.debug = () => {entered = true}
  client.init()
  client.client.emit('login')
  await client.onMessage(oldMessage)
  assert.equal(entered, true)
  await client.onMessage(oldMessage)
})

test('startup metadata sync delays between completed updates instead of scheduling all groups at 500ms', async () => {
  const timers = [], started = [], warnings = []
  const client = fixture({}, {botClient: {client: {telegram: {sendMessage: async () => undefined}}}},
    (callback, delay) => timers.push({callback, delay}))
  client.configurationService = {getConfig: async () => ({syncWechat: true, chatId: 1})}
  client.bindGroupService = {fixGroup: async () => undefined, getAll: async () => [{chatId: 1}, {chatId: 2}, {chatId: 3}]}
  client.logger.warn = (...args) => warnings.push(args)
  let release, active = 0, maximum = 0
  client.updateGroupByChatId = async id => {
    started.push(id)
    maximum = Math.max(maximum, ++active)
    if (id === 1) await new Promise(resolve => {release = resolve})
    active--
    if (id === 2) throw new Error('optional metadata unavailable')
  }
  await client.loginSuccess()
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 10000)
  const synchronization = timers.shift().callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers.length, 1, 'Only the next group should be scheduled')
  assert.equal(timers[0].delay, 500)
  timers.shift().callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, [1])
  assert.equal(timers.length, 0, 'Wait for the active update, not just its timer')
  release()
  for (const id of [2, 3]) {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(timers.length, 1)
    assert.equal(timers[0].delay, 500)
    timers.shift().callback()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(started.at(-1), id)
  }
  await synchronization
  assert.equal(maximum, 1)
  assert.equal(warnings.length, 1, 'A failed group must not abort subsequent optional updates')
})

test('startup metadata repository failures are caught at the timer boundary', async () => {
  const timers = [], warnings = []
  const client = fixture({}, {botClient: {client: {telegram: {sendMessage: async () => undefined}}}},
    callback => timers.push(callback))
  client.configurationService = {getConfig: async () => ({syncWechat: true, chatId: 1})}
  client.bindGroupService = {fixGroup: async () => undefined, getAll: async () => {throw new Error('database unavailable')}}
  client.logger.warn = (...args) => warnings.push(args)
  await client.loginSuccess()
  await assert.doesNotReject(timers.shift()())
  assert.equal(warnings.length, 1)
  assert.equal(timers.length, 0)
})

for (const enabled of [false, true]) {
  test(`automatic group creation can be ${enabled ? 'enabled' : 'disabled for migration'}`, async () => {
    const client = fixture({AUTO_CREATE_GROUPS: enabled})
    client._wxInfo = {wxid: 'wxid_owner'}
    client.creatingGroups = new Map()
    client.messageService = {getByWxMsgId: async () => null}
    client.configurationService = {getConfig: async () => ({selfMessage: true})}
    client.bindGroupService = {getByWxId: async () => null, resolveWechat: async () => null}
    let creates = 0
    client.groupOperate = {createGroup: async () => {creates++; return null}}
    const contact = {_wxid: 'wxid_contact', verifyFlag: 0, _alias: '', alias: async () => '', name: () => 'contact', avatar: async () => ''}
    await client.onMessage({...oldMessage, date: () => 20, self: () => false, room: async () => null, from: async () => contact})
    assert.equal(creates, enabled ? 1 : 0)
  })
}

for (const quoted of [false, true]) {
  test(`WeChat official ${quoted ? 'quote' : 'text'} carries the resolved topic with independent-group creation disabled`, async () => {
    const sent = []
    const client = fixture({AUTO_CREATE_GROUPS: false, OFFICIAL_ACCOUNT_TOPICS_ENABLED: true}, {botClient: {sendMessage: async message => sent.push(message)}})
    client._wxInfo = {wxid: 'self'}
    client.configurationService = {getConfig: async () => ({receivePublicAccount: true})}
    client.messageService = {getByWxMsgId: async id => id === 'quoted' ? {chatId: -100123, threadId: 88, tgBotMsgId: 4} : null}
    client.bindGroupService = {resolveWechat: async () => ({wxId: 'brand_news', chatId: -100123, threadId: 77, type: 0, isReceive: true})}
    client.groupOperate = {createGroup: async () => {throw new Error('Must not create a separate group')}}
    const contact = {_wxid: 'brand_news', verifyFlag: 24, _alias: '', alias: async () => '', name: () => 'Publisher'}
    await client.onMessage({...oldMessage, date: () => 20, type: () => quoted ? 99 : 1, self: () => false,
      room: async () => null, from: async () => contact, mentionSelf: async () => false, refer: {svrid: 'quoted'}})
    assert.equal(sent.length, 1)
    assert.equal(sent[0].chatId, -100123)
    assert.equal(sent[0].threadId, 77)
    assert.equal(sent[0].conversationWxId, 'brand_news')
    if (quoted) assert.match(sent[0].content, /quoted preview/)
    assert.equal(sent[0].param?.reply_id, undefined, 'a quote in another topic must not become a Telegram reply')
  })
}