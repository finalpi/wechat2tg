/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture({legacy, topic, failure, inbound = {kind: 'legacy'}} = {}) {
  const calls = {saved: [], removed: [], options: [], topicRequests: [], chatReads: 0}
  const repository = {getByWxId: async () => legacy, getByChatId: async () => {calls.chatReads++; return legacy},
    createOrUpdate: async row => {calls.saved.push(row); return row},
    removeByChatIdOrWxId: async (...args) => calls.removed.push(args)}
  const forum = {forWechat: async (...args) => {calls.topicRequests.push(args); if (failure) throw failure; return topic},
    forTelegram: async () => inbound,
    setTopicOptions: async (...args) => calls.options.push(args)}
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/service/BindGroupService.js'), 'utf8'), {exports, require: name => {
    if (name === '../entity/BindGroup') return {BindGroup: class {}}
    if (name === '../repository/BindGroupRepository') return {BindGroupRepository: {getInstance: () => repository}}
    if (name === './OfficialAccountForumService') return {OfficialAccountForumService: {getInstance: () => forum}}
    return {}
  }})
  return {service: new exports.BindGroupService(), calls}
}

test('confirmed non-prefix official destination preserves legacy binding and preferences', async () => {
  const legacy = {wxId: 'brand_news', chatId: -10, isReceive: false, isForwardOthers: true}
  const topic = {wxId: 'brand_news', chatId: -100123, threadId: 11, type: 0, isReceive: false, isForwardOthers: true}
  const f = fixture({legacy, topic})
  const route = await f.service.resolveWechat('brand_news', 'Publisher')
  assert.equal(route.threadId, 11)
  assert.equal(legacy.chatId, -10)
  assert.equal(f.calls.topicRequests[0][2].isReceive, false)
  await f.service.createOrUpdate({...route, isReceive: true})
  assert.equal(f.calls.saved.length, 0)
  assert.equal(f.calls.options[0][0], -100123)
  assert.equal(f.calls.options[0][1], 11)
})

test('unknown classification preserves only an existing explicit destination and does not create one', async () => {
  const failure = Object.assign(new Error('unknown'), {code: 'contactClassificationUnavailable'})
  const legacy = {wxId: 'unknown_contact', chatId: -10}
  const existing = fixture({legacy, failure})
  assert.equal(await existing.service.resolveWechat('unknown_contact', 'Unknown'), legacy)
  const absent = fixture({failure})
  await assert.rejects(absent.service.resolveWechat('unknown_contact', 'Unknown'), {code: failure.code})
  assert.equal(absent.calls.saved.length, 0)
  const provisionFailure = fixture({legacy, failure: new Error('Telegram creation uncertain')})
  await assert.rejects(provisionFailure.service.resolveWechat('unknown_contact', 'Unknown'), /creation uncertain/)
})

test('General/disabled forum never falls back to a chat-only recipient or allows legacy rebinding', async () => {
  const f = fixture({legacy: {chatId: -100123, wxId: 'wrong_account'}, inbound: {kind: 'blocked', reason: 'General'}})
  assert.equal(await f.service.resolveTelegram(-100123), undefined)
  assert.equal(f.calls.chatReads, 0)
  await assert.rejects(f.service.createOrUpdate({chatId: -100123, wxId: 'wrong_account'}))
  await assert.rejects(f.service.removeByChatIdOrWxId(-100123, 'wrong_account'))
  assert.equal(f.calls.saved.length + f.calls.removed.length, 0)
})

test('WeChat groups and the synthetic notice destination never require contact classification', async () => {
  const legacy = {chatId: -10}
  const f = fixture({legacy, failure: new Error('must not classify')})
  assert.equal(await f.service.resolveWechat('room@chatroom', 'Room'), legacy)
  assert.equal(await f.service.resolveWechat('app', 'Service notices'), legacy)
  assert.equal(f.calls.topicRequests.length, 0)
})