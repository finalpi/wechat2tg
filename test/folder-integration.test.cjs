/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Api} = require('telegram')
const {returnBigInt} = require('telegram/Helpers')

function load(file, modules) {
  const exports = {}, logs = {info: [], warn: [], error: []}
  const console = Object.fromEntries(Object.keys(logs).map(key => [key, (...args) => logs[key].push(args)]))
  console.log = () => undefined
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), {
    exports, console, Buffer,
    require: name => {
      if (Object.hasOwn(modules, name)) return modules[name]
      if (name === 'telegram' || name === 'telegram/Helpers') return require(name)
      return {}
    },
  }, {filename: file})
  return {exports, logs}
}

function groupFixture(addChat, failCreation = false) {
  const order = [], saved = [], requests = []
  const client = {invoke: async request => {
    requests.push(request)
    if (request instanceof Api.messages.CreateChat) {
      if (failCreation) throw new Error('USER_RESTRICTED')
      order.push('created')
      return {updates: {chats: [{id: returnBigInt(42)}]}}
    }
    if (request instanceof Api.messages.EditChatAdmin) return true
    throw new Error('Unexpected group RPC')
  }}
  const {exports, logs} = load('service/TelegramGroupOperateService.js', {
    '../entity/BindGroup': {BindGroup: class {}},
    './ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig: async () => ({chatId: 1, botId: 2})})}},
    './TelegramChatFolderService': {TelegramChatFolderService: {forClient: current => {
      assert.equal(current, client)
      return {addChat: id => {order.push('folder'); assert.equal(saved.length, 1); return addChat(id)}}
    }}},
  })
  const bindings = {getByWxId: async () => undefined, removeByChatIdOrWxId: async () => undefined,
    createOrUpdate: async row => {order.push('bound'); saved.push(row); return row}}
  const service = new exports.TelegramGroupOperateService(bindings, client)
  service.updateGroup = async () => undefined
  return {service, saved, order, requests, logs}
}

test('folder quota exhaustion never turns a created and persisted group into a failure', async () => {
  const f = groupFixture(async id => {
    assert.equal(id, -42)
    return {status: 'skipped', reason: 'folder-limit'}
  })
  const binding = await f.service.createGroup({wxId: 'contact', name: 'Contact', type: 0})
  assert.equal(binding.chatId, -42)
  assert.equal(f.saved[0], binding)
  assert.deepEqual(f.order, ['created', 'bound', 'folder'])
  assert.equal(f.logs.error.length, 0)
})

test('slow folder organization cannot delay successful group creation or forwarding', async t => {
  let complete
  const f = groupFixture(() => new Promise(resolve => {complete = resolve}))
  let timer
  t.after(() => clearTimeout(timer))
  const timeout = new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('Group waited for optional folder RPC')), 500)})
  const binding = await Promise.race([f.service.createGroup({wxId: 'contact', name: 'Contact', type: 0}), timeout])
  assert.equal(binding.chatId, -42)
  complete({status: 'skipped', reason: 'unavailable'})
  await Promise.resolve()
  assert.equal(f.logs.error.length, 0)
})

test('unexpected folder rejection is consumed, but real group creation failures remain failures', async () => {
  const f = groupFixture(async () => {throw new Error('Folder connection unavailable')})
  const binding = await f.service.createGroup({wxId: 'contact', name: 'Contact', type: 0})
  assert.equal(binding.chatId, -42)
  await f.service.addToFolder(-42)
  assert.equal(f.logs.error.length, 0)
  assert.ok(f.logs.warn.length > 0)
  const broken = groupFixture(async () => {throw new Error('must not run')}, true)
  assert.equal(await broken.service.createGroup({wxId: 'contact', name: 'Contact', type: 0}), null)
  assert.equal(broken.saved.length, 0)
  assert(!broken.order.includes('folder'))
})

test('startup folder preparation is optional even when config or folder allocation fails', async () => {
  for (const failingConfig of [false, true]) {
    let calls = 0
    const {exports, logs} = load('client/UserMTProtoClient.js', {
      '../base/BaseClient': {AbstractClient: class {}},
      '../service/ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig: async () => {
        if (failingConfig) throw new Error('Config unavailable')
        return {botId: 2}
      }})}},
      '../service/TelegramChatFolderService': {TelegramChatFolderService: {forClient: () => ({ensurePrimaryFolder: async id => {
        calls++; assert.equal(id, 2); throw new Error('Folder allocation failed')
      }})}},
    })
    const client = Object.create(exports.UserMTProtoClient.prototype)
    client.client = {}
    await assert.doesNotReject(client.createFolder())
    assert.equal(calls, failingConfig ? 0 : 1)
    assert.equal(logs.error.length, 0)
  }
})

test('a ready official-account forum remains usable if optional folder placement rejects', async () => {
  const channel = new Api.Channel({id: returnBigInt(123), title: 'Forum', forum: true, megagroup: true})
  const placements = []
  const {exports} = load('service/OfficialAccountForumAdapters.js', {
    './TelegramChatFolderService': {TelegramChatFolderService: {forClient: () => ({addChat: async id => {
      placements.push(id); throw new Error('DIALOG_FILTERS_TOO_MUCH')
    }})}},
  })
  const adapter = new exports.GramJsOfficialForumTelegram()
  let permitted = true
  adapter.clients = async () => ({
    config: {botId: 2, chatId: 1},
    user: {checkAuthorization: async () => true, getEntity: async () => channel, invoke: async request => {
      assert(request instanceof Api.channels.GetParticipant || request instanceof Api.channels.EditAdmin)
      return {}
    }},
    bot: {getMe: async () => ({id: 2, username: 'synthetic_bot'}), getChat: async () => ({type: 'supergroup', is_forum: true}),
      getChatMember: async () => ({status: 'administrator', can_manage_topics: permitted, can_invite_users: true, can_delete_messages: true})},
  })
  await assert.doesNotReject(adapter.ensureForumReady(-1000000000123))
  assert.deepEqual(placements, [-1000000000123])
  permitted = false
  await assert.rejects(adapter.ensureForumReady(-1000000000123), /not ready/)
  assert.equal(placements.length, 1, 'actual forum permission failures must not be hidden')
})