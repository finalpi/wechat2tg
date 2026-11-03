/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture({binding, legacy, autoCreate = false, routeError} = {}) {
  const sent = [], created = []
  let finished
  const completion = new Promise(resolve => {finished = resolve})
  const row = {id: 1, wxId: 'gh_test', remoteId: '101', status: 'received', telegramStatus: 'pending', direction: 'incoming', senderId: 'gh_test', senderName: 'Publisher', type: 'text', body: 'synthetic', timestamp: 1}
  const store = {
    byId: async () => row,
    all: async () => [],
    claimSync: async () => true,
    run: async (sql, args = []) => {
      if (sql === 'UPDATE inbox SET telegramStatus=? WHERE id=?') finished(args[0])
    },
  }
  const wx = {hasLogin: true, wxInfo: {wxid: 'self'}, client: {Contact: {find: async () => ({name: () => 'Publisher'})}}}
  const bot = {hasLogin: true, isWebUISyncActive: () => false, mirrorWebUI: async message => {sent.push(message); return {success: true}}}
  const bindings = {getByWxId: async () => legacy, resolveWechat: async () => {
    if (routeError) throw new Error('forum provisioning failed')
    return binding
  }}
  const dependencies = {
    '../data-sourse': {AppDataSource: {}, getGeWeChatDataSource: () => ({isInitialized: false})},
    '../base/BaseClient': {AbstractClient: {getSpyClient: key => key === 'wxClient' ? wx : key === 'botClient' ? bot : {hasLogin: true, client: {}}}},
    '../entity/BindGroup': {BindGroup: class {}},
    '../service/BindGroupService': {BindGroupService: {getInstance: () => bindings}},
    '../service/ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig: async () => ({language: 'zh-CN'})})}},
    '../service/TelegramGroupOperateService': {TelegramGroupOperateService: class {
      async createGroup(value) {created.push(value); return {...value, chatId: -200, isReceive: true}}
    }},
    '../config': {config: {AUTO_CREATE_GROUPS: autoCreate}},
    './mentions': {createGroupMentionService: () => ({})},
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/webui/messages.js'), 'utf8'), {exports, require: name => dependencies[name] || {}})
  return {center: exports.createMessageCenter(store, {}), sent, created, completion}
}

test('WebUI/MCP mirroring uses the topic even for a previously bound official account', {timeout: 2000}, async () => {
  const f = fixture({legacy: {chatId: -10, wxId: 'gh_test'}, binding: {chatId: -100123, threadId: 20, wxId: 'gh_test', isReceive: true}})
  await f.center.sync(1)
  assert.equal(await f.completion, 'synced')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent[0].chatId, -100123)
  assert.equal(f.sent[0].threadId, 20)
  assert.equal(f.sent[0].conversationWxId, 'gh_test')
})

test('WebUI/MCP cannot bypass disabled automatic group creation', {timeout: 2000}, async () => {
  const f = fixture()
  await f.center.sync(1)
  assert.equal(await f.completion, 'failed')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent.length, 0)
})

test('forum setup failure never falls back to the old group or creates a replacement', {timeout: 2000}, async () => {
  const f = fixture({legacy: {chatId: -10, wxId: 'gh_test'}, autoCreate: true, routeError: true})
  await f.center.sync(1)
  assert.equal(await f.completion, 'failed')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent.length, 0)
})

test('muted topic is excluded and ordinary legacy auto-create remains available when enabled', {timeout: 2000}, async () => {
  const muted = fixture({binding: {chatId: -100123, threadId: 20, wxId: 'gh_test', isReceive: false}})
  await muted.center.sync(1)
  assert.equal(await muted.completion, 'excluded')
  assert.equal(muted.sent.length, 0)
  const ordinary = fixture({autoCreate: true})
  await ordinary.center.sync(1)
  assert.equal(await ordinary.completion, 'synced')
  assert.equal(ordinary.created.length, 1)
  assert.equal(ordinary.sent[0].chatId, -200)
  assert.equal(ordinary.sent[0].threadId, undefined)
})