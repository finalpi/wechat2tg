/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const {once} = require('node:events')
const {createMcpHandler} = require('../dist/mcp/http')
const {McpSettings} = require('../dist/mcp/settings')

const tokens = {read: 'synthetic-read-token-0001', write: 'synthetic-write-token-0001'}

test('MCP authentication separates read-only and write access and does not expose private paths', async t => {
  let uploads = 0
  const handler = createMcpHandler({upload: async (name, preference, stream) => {
    for await (const chunk of stream) assert.equal(chunk.toString(), 'synthetic')
    uploads++
    return {id: 'synthetic-file', name, size: 9, path: '/private/never-expose'}
  }}, tokens)
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))})
  const url = `http://127.0.0.1:${server.address().port}/mcp/media?name=fixture.bin`
  assert.equal((await fetch(url, {method: 'POST', body: 'synthetic'})).status, 401)
  assert.equal((await fetch(url, {method: 'POST', body: 'synthetic', headers: {Authorization: `Bearer ${tokens.read}`, 'Content-Type': 'application/octet-stream'}})).status, 403)
  assert.equal((await fetch(url, {method: 'POST', body: 'synthetic', headers: {Authorization: `Bearer ${tokens.write}`, Origin: 'https://untrusted.example', 'Content-Type': 'application/octet-stream'}})).status, 403)
  assert.equal(uploads, 0)
  const response = await fetch(url, {method: 'POST', body: 'synthetic', headers: {Authorization: `Bearer ${tokens.write}`, 'Content-Type': 'application/octet-stream'}})
  assert.equal(response.status, 201)
  const result = await response.json()
  assert.equal(result.path, undefined)
  assert.equal(uploads, 1)
})

test('MCP persisted settings enforce distinct credentials, revisions and HTTPS for remote access', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-mcp-'))
  t.after(() => fs.rmSync(directory, {recursive: true}))
  const settings = new McpSettings(path.join(directory, 'settings.json'), tokens)
  const metadata = settings.metadata()
  assert(!JSON.stringify(metadata).includes(tokens.read))
  assert(!JSON.stringify(metadata).includes(tokens.write))
  await assert.rejects(settings.update({revision: 'stale', enabled: false}), {code: 'mcpConflict'})
  await assert.rejects(settings.update({revision: metadata.revision, endpoint: 'http://remote.example/mcp'}), {code: 'mcpHTTPSRequired'})
  await assert.rejects(settings.token({revision: metadata.revision, role: 'read', action: 'replace', token: tokens.write}), {code: 'mcpTokensMustDiffer'})
  const saved = await settings.update({revision: metadata.revision, enabled: false, endpoint: 'https://example.com/mcp'})
  assert.equal(saved.enabled, false)
  assert.equal(new McpSettings(path.join(directory, 'settings.json'), tokens).read().enabled, false)
  assert.equal(fs.statSync(path.join(directory, 'settings.json')).mode & 0o777, 0o600)
})