/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata')
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {DataSource} = require('typeorm')
const {Message} = require('../dist/entity/Message')
const {BindGroup} = require('../dist/entity/BindGroup')
const {conversationMessages, originalTelegramMessage, telegramConversationRecents} = require('../dist/webui/telegram-history')
const {annotateTelegramRecall} = require('../dist/webui/telegram-recall')
const {createWebUIServer} = require('../dist/webui/server')
const {readOverrides} = require('../dist/webui/store')
const {OfficialAccountForum} = require('../dist/entity/OfficialAccountForum')
const {OfficialAccountTopic} = require('../dist/entity/OfficialAccountTopic')

async function database(t) {
  const db = new DataSource({type: 'sqlite', database: ':memory:', entities: [Message, BindGroup], synchronize: true})
  await db.initialize()
  t.after(() => db.destroy())
  return db
}

test('WebUI history isolates two topics sharing a forum while retaining old private-group history', async t => {
  const db = await database(t)
  await db.getRepository(BindGroup).save({chatId: -10, name: 'A old group', wxId: 'gh_a', type: 0})
  await db.getRepository(Message).save([
    {chatId: -10, wxMsgId: '100', tgBotMsgId: 1, content: 'old A', createTime: 10},
    {chatId: -100123, threadId: 11, conversationWxId: 'gh_a', wxMsgId: '101', tgBotMsgId: 2, content: 'new A', createTime: 20},
    {chatId: -100123, threadId: 22, conversationWxId: 'gh_b', wxMsgId: '102', tgBotMsgId: 3, content: 'B must not leak', createTime: 30},
    {chatId: -100123, threadId: 33, wxSenderId: 'gh_a', toWxid: 'self', wxMsgId: '103', tgBotMsgId: 4, content: 'unowned topic', createTime: 40},
  ])
  assert.deepEqual((await (await conversationMessages(db, 'gh_a', 'self')).orderBy('m.id').getMany()).map(m => m.wxMsgId), ['100', '101'])
  assert.deepEqual((await (await conversationMessages(db, 'gh_b', 'self')).getMany()).map(m => m.wxMsgId), ['102'])
  assert.equal(await originalTelegramMessage(db, 'gh_a', '102', 'self'), null)
  const original = await originalTelegramMessage(db, 'gh_a', '100', 'self')
  assert.equal(original.chatId, -10, 'recalls retain the original old-group destination')
  const recent = await telegramConversationRecents(db)
  assert.equal(recent.find(r => r.wxId === 'gh_a').timestamp, 20)
  assert.equal(recent.find(r => r.wxId === 'gh_b').timestamp, 30)
})

test('additive SQLite upgrade preserves legacy messages and bindings', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-schema-'))
  t.after(() => fs.rmSync(directory, {recursive: true}))
  const file = path.join(directory, 'fixture.db')
  const old = new DataSource({type: 'sqlite', database: file, entities: [Message, BindGroup], synchronize: true})
  await old.initialize()
  await old.getRepository(Message).save({chatId: -10, wxMsgId: 'legacy', content: 'preserved'})
  await old.getRepository(BindGroup).save({chatId: -10, wxId: 'gh_old', name: 'old group', type: 0})
  // Downgrade ONLY this disposable fixture to the pre-feature layout.
  await old.query('DROP INDEX idx_message_topic_history')
  await old.query('ALTER TABLE message DROP COLUMN threadId')
  await old.query('ALTER TABLE message DROP COLUMN conversationWxId')
  await old.query('ALTER TABLE bind_group DROP COLUMN avatarHash')
  await old.destroy()
  const upgraded = new DataSource({type: 'sqlite', database: file, entities: [Message, BindGroup, OfficialAccountForum, OfficialAccountTopic], synchronize: true})
  await upgraded.initialize()
  try {
    const message = await upgraded.getRepository(Message).findOneBy({wxMsgId: 'legacy'})
    assert.equal(message.content, 'preserved')
    assert.equal(message.threadId, null)
    assert.equal(message.conversationWxId, null)
    const binding = await upgraded.getRepository(BindGroup).findOneBy({chatId: -10})
    assert.equal(binding.name, 'old group')
    assert.equal(binding.avatarHash, null)
    assert.equal(await upgraded.getRepository(BindGroup).count(), 1)
    assert.equal(await upgraded.getRepository(OfficialAccountForum).count(), 0)
    assert.equal(await upgraded.getRepository(OfficialAccountTopic).count(), 0)
  } finally {await upgraded.destroy()}
})

test('recall notices retain the topic even when the original Telegram message is unavailable', async () => {
  const calls = [], keys = []
  const store = {claimRecallNotice: async key => {keys.push(key); return true}, run: async () => undefined}
  const telegram = {sendMessage: async (...args) => calls.push(args)}
  await annotateTelegramRecall(store, telegram, 'gh_a', '101', -100123, {threadId: 11}, '', 'revoked')
  await annotateTelegramRecall(store, telegram, 'gh_b', '102', -100123, {threadId: 22, tgBotMsgId: 6}, '', 'revoked')
  assert.equal(calls[0][2].message_thread_id, 11)
  assert.equal(calls[0][2].reply_parameters, undefined)
  assert.equal(calls[1][2].message_thread_id, 22)
  assert.equal(calls[1][2].reply_parameters.message_id, 6)
  assert.notEqual(keys[0], keys[1])
})

test('WebUI requires authentication, protects secrets, and saves topic settings without writing .env', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-webui-'))
  const file = path.join(directory, 'webui.json'), envFile = path.join(directory, '.env')
  const env = 'AUTO_CREATE_GROUPS=false\nUSER_SETTING=unchanged\n'
  fs.writeFileSync(envFile, env)
  const token = 'synthetic-webui-token-0001', secret = 'synthetic-private-bot-token'
  const server = createWebUIServer({file, token, environment: {BOT_TOKEN: secret, OFFICIAL_ACCOUNT_TOPICS_ENABLED: false}, mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)}})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true})})
  const url = `http://127.0.0.1:${server.address().port}/api/config`
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, {headers: {Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example'}})).status, 403)
  const current = await (await fetch(url, {headers: {Authorization: `Bearer ${token}`}})).json()
  assert.equal(current.values.BOT_TOKEN, '')
  assert.equal(current.secrets.BOT_TOKEN, true)
  assert(!JSON.stringify(current).includes(secret))
  assert(current.fields.some(f => f.key === 'OFFICIAL_ACCOUNT_TOPICS_ENABLED'))
  assert(current.fields.some(f => f.key === 'WECHAT_CUSTOM_EMOJI_ENABLED' && f.type === 'boolean'))
  assert.equal(current.values.WECHAT_CUSTOM_EMOJI_ENABLED, false)
  const response = await fetch(url, {method: 'PATCH', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({source: 'environment', revision: current.revision, values: {OFFICIAL_ACCOUNT_TOPICS_ENABLED: true, AUTO_CREATE_GROUPS: false, WECHAT_CUSTOM_EMOJI_ENABLED: true}})})
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.restartRequired, true)
  assert.equal(readOverrides(file).OFFICIAL_ACCOUNT_TOPICS_ENABLED, 'true')
  assert.equal(readOverrides(file).WECHAT_CUSTOM_EMOJI_ENABLED, 'true')
  assert.equal(fs.readFileSync(envFile, 'utf8'), env)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('blank message templates save as defaults and never report a spurious restart', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-webui-templates-'))
  const file = path.join(directory, 'webui.json')
  const token = 'synthetic-webui-token-0002'
  const defaults = require('../dist/util/MessageTemplates').MESSAGE_TEMPLATE_DEFAULTS
  const server = createWebUIServer({file, token, environment: {ROOM_MESSAGE_GROUP: '<b>old</b>', BOT_TOKEN: 'synthetic'}})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true})})
  const url = `http://127.0.0.1:${server.address().port}/api/config`
  const headers = {Authorization: `Bearer ${token}`}
  const current = await (await fetch(url, {headers})).json()
  assert.deepEqual(current.templateDefaults, defaults)
  assert.equal(current.values.ROOM_MESSAGE_GROUP, '<b>old</b>')
  const patch = async (revision, values) => (await fetch(url, {method: 'PATCH', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({source: 'environment', revision, values})})).json()
  const reset = await patch(current.revision, {ROOM_MESSAGE_GROUP: '', CONTACT_MESSAGE: '   '})
  assert.equal(reset.values.ROOM_MESSAGE_GROUP, defaults.ROOM_MESSAGE_GROUP)
  assert.equal(reset.values.CONTACT_MESSAGE, defaults.CONTACT_MESSAGE)
  assert.equal(reset.restartRequired, true, 'Replacing a real custom template with its default still changes runtime')
  const blankServer = createWebUIServer({file: path.join(directory, 'blank.json'), token, environment: {}})
  blankServer.listen(0, '127.0.0.1')
  await once(blankServer, 'listening')
  t.after(async () => {blankServer.closeAllConnections(); await new Promise(resolve => blankServer.close(resolve))})
  const blankUrl = `http://127.0.0.1:${blankServer.address().port}/api/config`
  const blank = await (await fetch(blankUrl, {headers})).json()
  const blankSaved = await (await fetch(blankUrl, {method: 'PATCH', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({source: 'environment', revision: blank.revision, values: {ROOM_MESSAGE_GROUP: '  ', CONTACT_MESSAGE: ''}})})).json()
  assert.equal(blankSaved.values.ROOM_MESSAGE_GROUP, defaults.ROOM_MESSAGE_GROUP)
  assert.equal(blankSaved.restartRequired, false, 'Blank still means the unchanged default')
  assert.equal(readOverrides(file).ROOM_MESSAGE_GROUP, '')
  const customized = await (await fetch(url, {headers})).json()
  const saved = await patch(customized.revision, {ROOM_MESSAGE_GROUP: '<b>#[name]</b>'})
  assert.equal(saved.values.ROOM_MESSAGE_GROUP, '<b>#[name]</b>')
  assert.equal(saved.restartRequired, true, 'A real template change still requires a restart')
  assert.equal(readOverrides(file).ROOM_MESSAGE_GROUP, '<b>#[name]</b>')
})
