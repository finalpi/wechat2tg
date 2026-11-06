/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {createWebUIServer} = require('../dist/webui/server')

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-config-revision-'))
  let runtime = {autoTranscript: false, chatId: 1, botId: 1, language: 'zh-CN'}
  const server = createWebUIServer({environment: {AI_API_KEY: 'test-secret-one'}, file: path.join(directory, 'config.json'), token: 'local-revision-token',
    runtime: {read: async () => runtime, save: async patch => {runtime = {...runtime, ...patch}}},
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)},
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true, force: true})})
  const url = `http://127.0.0.1:${server.address().port}/api/config`
  const headers = {Authorization: 'Bearer local-revision-token', 'Content-Type': 'application/json'}
  return {
    setRuntime: value => {runtime = value},
    get: async () => (await fetch(url, {headers})).json(),
    patch: (revision, values, source = 'environment') => fetch(url, {method: 'PATCH', headers, body: JSON.stringify({source, revision, values})}),
  }
}

test('AI settings can save after unrelated runtime identity changes', async t => {
  const api = await fixture(t)
  const before = await api.get()
  api.setRuntime({language: 'zh-CN', botId: 2, chatId: 2, autoTranscript: false})
  const response = await api.patch(before.revision, {AI_API_URL: 'https://ai.example.test/v1', AI_MODEL: 'default'})
  assert.equal(response.status, 200, 'bot identity changes must not invalidate the editable config revision')
  const after = await response.json()
  assert.equal(after.values.AI_MODEL, 'default')
  assert(!JSON.stringify(after).includes('test-secret-one'))
})

test('editable runtime changes still reject stale AI saves without overwriting them', async t => {
  const api = await fixture(t)
  const before = await api.get()
  api.setRuntime({autoTranscript: true, chatId: 1, botId: 1, language: 'zh-CN'})
  const response = await api.patch(before.revision, {AI_MODEL: 'default'})
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {error: 'conflict'})
  const current = await api.get()
  assert.equal(current.values.AI_MODEL, '')
  assert.equal(current.values.autoTranscript, true)
  assert.equal((await api.patch(current.revision, {AI_MODEL: 'default'})).status, 200)
})

test('secret changes remain part of revision even though values are masked', async t => {
  const api = await fixture(t)
  const before = await api.get()
  assert.equal((await api.patch(before.revision, {AI_API_KEY: 'test-secret-two'})).status, 200)
  const current = await api.get()
  assert.notEqual(current.revision, before.revision)
  assert.equal(current.values.AI_API_KEY, '')
  assert.equal((await api.patch(before.revision, {AI_MODEL: 'default'})).status, 409)
})