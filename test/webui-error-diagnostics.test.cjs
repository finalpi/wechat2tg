/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {createWebUIServer} = require('../dist/webui/server')

test('unexpected history failure logs a safe diagnosis rather than silently returning serverError', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-error-'))
  const secret = 'private-token-and-message-body'
  const fault = Object.assign(new Error(`SQLITE_ERROR: no such column: m.example; ${secret}`), {
    name: 'QueryFailedError', code: 'SQLITE_ERROR',
    query: `SELECT '${secret}'`, parameters: [secret],
    stack: `QueryFailedError: ${secret}\n    at history (/app/dist/webui/messages.js:123:45)`,
  })
  const logs = []
  t.mock.method(console, 'error', (...args) => logs.push(args))
  const server = createWebUIServer({environment: {}, token: secret, file: path.join(directory, 'webui.json'),
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)},
    messages: {history: async () => {throw fault}},
  })
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, {recursive: true})})
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/messages?wxId=${secret}&q=${secret}&before=0`, {headers: {Authorization: `Bearer ${secret}`}})
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), {error: 'serverError'})
  assert.equal(logs.length, 1, 'unexpected exceptions must be visible in container stderr')
  const logged = JSON.stringify(logs)
  assert.match(logged, /GET.*\/api\/messages/)
  assert.match(logged, /SQLITE_ERROR/)
  assert.match(logged, /messages.js:123:45/)
  assert(!logged.includes(secret), 'no token, query string, SQL parameters or message content in logs')
})