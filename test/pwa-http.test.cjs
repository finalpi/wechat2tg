/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata')
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {createWebUIServer} = require('../dist/webui/server')

async function serverFor(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-pwa-http-'))
  const server = createWebUIServer({environment: {}, file: path.join(directory, 'settings.json'), token: 'synthetic-pwa-token',
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)}})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, {recursive: true, force: true})
  })
  return `http://127.0.0.1:${server.address().port}`
}

test('HTTP serves install metadata, real PNG sizes, and an uncached root-scoped worker', async t => {
  const base = await serverFor(t)
  const response = await fetch(base + '/manifest.webmanifest')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /^application\/manifest\+json/)
  assert.match(response.headers.get('content-security-policy'), /worker-src 'self'/)
  const manifest = await response.json()
  assert.equal(manifest.start_url, '/chat')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert(manifest.icons.some(icon => icon.purpose === 'maskable' && icon.sizes === '512x512'))
  const icons = [...manifest.icons, {src: '/icons/apple-touch-icon.png', sizes: '180x180'}]
  for (const icon of icons) {
    const image = await fetch(base + icon.src)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    const bytes = Buffer.from(await image.arrayBuffer())
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes)
  }
  const sw = await fetch(base + '/sw.js')
  assert.equal(sw.status, 200)
  assert.match(sw.headers.get('content-type'), /^text\/javascript/)
  assert.match(sw.headers.get('cache-control'), /no-cache/)
  assert.match(sw.headers.get('cache-control'), /no-store/)
  assert.match(sw.headers.get('content-security-policy'), /worker-src 'self'/)
  assert.match(await sw.text(), /SKIP_WAITING/)
  const head = await fetch(base + '/sw.js', {method: 'HEAD'})
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('HTTP SPA routing is restricted to exact workspace roots while API, auth and MCP behavior remains intact', async t => {
  const base = await serverFor(t)
  const index = await (await fetch(base + '/index.html')).text()
  assert.match(index, /rel="manifest"/)
  assert.match(index, /rel="apple-touch-icon"/)
  for (const route of ['/', '/chat', '/manage', '/manage?group=general']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 200, route)
    assert.match(response.headers.get('content-type'), /^text\/html/)
    assert.equal(await response.text(), index)
    assert.equal((await fetch(base + route, {method: 'POST'})).status, 404)
  }
  const head = await fetch(base + '/chat', {method: 'HEAD'})
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  for (const route of ['/chat/id', '/chat/', '/manage/settings', '/unknown', '/auth', '/api', '/assets/missing.js', '/icons/missing.png', '/assets/wechat-emoji/emoji-0000000000000000.png']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 404, route)
    assert.match(response.headers.get('content-type'), /^application\/json/)
  }
  for (const route of ['/api/config', '/api/missing', '/api/messages/events', '/api/media/message/1']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 401, route)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const headers = {Authorization: 'Bearer synthetic-pwa-token'}
  assert.equal((await fetch(base + '/api/config', {headers})).status, 200)
  assert.equal((await fetch(base + '/api/missing', {headers})).status, 404)
  assert.equal((await fetch(base + '/api/config', {headers: {...headers, Origin: 'https://other.example'}})).status, 403)
  assert.equal((await fetch(base + '/api/auth/telegram', {method: 'POST'})).status, 503)
  for (const route of ['/mcp', '/mcp/tools']) {
    const response = await fetch(base + route)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {error: 'messagesUnavailable'})
  }
})