/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {EventEmitter} = require('node:events')

// Run the real compiled client methods without booting Telegram or SQLite.
function clientClass(config = {}) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/WechatClient.js'), 'utf8'), {
    exports,
    // Keep bounded login-retry tests deterministic without real sleeps.
    setTimeout: callback => queueMicrotask(callback),
    require(name) {
      if (name === '../base/BaseClient') return {AbstractClient: class {}}
      if (name === '../i18n') return {getInstance: () => ({})}
      if (name === '../config') return {config}
      if (name === '../entity/BindGroup') return {BindGroup: class {}}
      return {}
    },
  })
  return exports.WeChatClient
}

function fixture(config) {
  const Client = clientClass(config)
  const client = Object.create(Client.prototype)
  client.client = new EventEmitter()
  client.startTime = 10
  client.loginReady = Promise.resolve()
  client.logger = {debug: () => undefined, error: () => undefined}
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
  await Promise.resolve()
  assert.equal(errors.length, 1)
  assert.match(errors[0][1].message, /synthetic processing failure/)
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

for (const enabled of [false, true]) {
  test(`automatic group creation can be ${enabled ? 'enabled' : 'disabled for migration'}`, async () => {
    const client = fixture({AUTO_CREATE_GROUPS: enabled})
    client._wxInfo = {wxid: 'wxid_owner'}
    client.creatingGroups = new Map()
    client.messageService = {getByWxMsgId: async () => null}
    client.configurationService = {getConfig: async () => ({selfMessage: true})}
    client.bindGroupService = {getByWxId: async () => null}
    let creates = 0
    client.groupOperate = {createGroup: async () => {creates++; return null}}
    const contact = {_wxid: 'wxid_contact', _alias: '', alias: async () => '', name: () => 'contact', avatar: async () => ''}
    await client.onMessage({...oldMessage, date: () => 20, self: () => false, room: async () => null, from: async () => contact})
    assert.equal(creates, enabled ? 1 : 0)
  })
}