/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const {generateServiceWorker} = require('../scripts/pwa-build.cjs')

const origin = 'https://pwa.example'
function fixture(t, version = 'A') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-pwa-'))
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}))
  fs.cpSync(path.join(__dirname, '../webui/public'), directory, {recursive: true})
  fs.mkdirSync(path.join(directory, 'assets'), {recursive: true})
  fs.writeFileSync(path.join(directory, 'index.html'), `<html>public shell ${version}</html>`)
  fs.writeFileSync(path.join(directory, `assets/index-${version.repeat(8)}.js`), `/* ${version} */`)
  return {directory, ...generateServiceWorker(directory)}
}

function harness() {
  const stores = new Map(), requests = []
  let fetcher = async request => new Response(`public ${new URL(request.url).pathname}`)
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href
  const caches = {
    keys: async () => [...stores.keys()],
    has: async name => stores.has(name),
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return {
        match: async request => entries.get(key(request))?.clone(),
        put: async (request, response) => {entries.set(key(request), response.clone())},
        addAll: async list => {
          const responses = await Promise.all(list.map(async request => {
            requests.push(request)
            const response = await fetcher(request)
            if (!response.ok || response.redirected) throw new Error('install fetch failed')
            return response
          }))
          list.forEach((request, i) => entries.set(key(request), responses[i].clone()))
        },
      }
    },
  }
  function load(script) {
    const events = new Map()
    const state = {skipped: 0, claimed: 0}
    const self = {
      location: {origin},
      addEventListener: (type, handler) => events.set(type, handler),
      skipWaiting: async () => {state.skipped++},
      clients: {claim: async () => {state.claimed++}},
    }
    vm.runInNewContext(script, {self, caches, URL, Request, Response, fetch: request => fetcher(request)})
    return {
      state,
      dispatch: async (type, data = {}) => {
        const pending = []
        events.get(type)({...data, waitUntil: promise => pending.push(promise)})
        await Promise.all(pending)
      },
      request: (pathname, options = {}) => {
        let result
        events.get('fetch')({request: {url: new URL(pathname, origin).href, method: 'GET', mode: 'cors',
          ...options, headers: new Headers(options.headers)}, respondWith: promise => {result = promise}})
        return result
      },
    }
  }
  return {stores, caches, requests, load, network: fn => {fetcher = fn}}
}

test('generated worker has a deterministic content version and explicit public precache list', t => {
  const build = fixture(t)
  fs.mkdirSync(path.join(build.directory, 'assets/wechat-emoji'))
  for (const file of ['assets/plain.js', 'assets/index-AAAAAAAA.js.map', 'private.json', 'assets/wechat-emoji/emoji-0123456789abcdef.png']) {
    fs.writeFileSync(path.join(build.directory, file), 'not public shell')
  }
  const again = generateServiceWorker(build.directory)
  assert.equal(again.script, build.script)
  assert.deepEqual(again.urls, ['/assets/index-AAAAAAAA.js', '/favicon.svg', '/icons/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/index.html', '/manifest.webmanifest'])
  for (const file of ['index.html', 'assets/index-AAAAAAAA.js', 'icons/icon-192.png']) {
    const before = generateServiceWorker(build.directory)
    fs.appendFileSync(path.join(build.directory, file), 'changed')
    assert.notEqual(generateServiceWorker(build.directory).cacheName, before.cacheName)
  }
})

test('worker only precaches public credential-free resources and does not take over tabs', async t => {
  const build = fixture(t), h = harness(), sw = h.load(build.script)
  await sw.dispatch('install')
  await sw.dispatch('activate')
  assert.deepEqual(h.requests.map(request => new URL(request.url).pathname), build.urls)
  for (const request of h.requests) {
    assert.equal(request.credentials, 'omit')
    assert.equal(request.cache, 'reload')
    assert.equal(request.redirect, 'error')
    assert.equal(request.headers.has('Authorization'), false)
  }
  assert.equal(sw.state.skipped, 0)
  assert.equal(sw.state.claimed, 0)
  await sw.dispatch('message', {data: {type: 'UNKNOWN'}})
  await sw.dispatch('message', {data: 'SKIP_WAITING'})
  assert.equal(sw.state.skipped, 0)
  await sw.dispatch('message', {data: {type: 'SKIP_WAITING'}})
  assert.equal(sw.state.skipped, 1)
})

test('API, events, auth, media, MCP, emoji, unknown navigation and sensitive requests are never intercepted', async t => {
  const h = harness(), sw = h.load(fixture(t).script)
  await sw.dispatch('install')
  h.network(() => {throw new Error('must not use network')})
  for (const pathname of ['/api/config', '/api/messages/events', '/api/auth/telegram', '/api/auth/logout', '/api/media/message/1', '/api/avatar', '/media/file.png', '/mcp', '/mcp/tools', '/assets/wechat-emoji/emoji-0123456789abcdef.png', '/emoji/emoji-0123456789abcdef.png', '/auth', '/sw.js', '/assets/missing.js']) {
    assert.equal(sw.request(pathname), undefined, pathname)
  }
  for (const pathname of ['/missing', '/chat/id', '/chat/', '/manage/settings', '/api/config', '/assets/missing.js']) {
    assert.equal(sw.request(pathname, {mode: 'navigate'}), undefined, pathname)
  }
  for (const pathname of ['/chat', '/index.html', '/assets/index-AAAAAAAA.js', '/manifest.webmanifest']) {
    assert.equal(sw.request(pathname + '?token=secret'), undefined)
    assert.equal(sw.request(pathname + '?'), undefined)
    assert.equal(sw.request(pathname, {headers: {Authorization: 'Bearer secret'}}), undefined)
    assert.equal(sw.request(pathname, {headers: {Range: 'bytes=0-10'}}), undefined)
    assert.equal(sw.request(pathname, {method: 'POST'}), undefined)
    assert.equal(sw.request(pathname, {method: 'HEAD'}), undefined)
    assert.equal(sw.request('https://other.example' + pathname), undefined)
  }
})

test('offline fallback uses only the public index for exact routes, never saves online navigation or errors', async t => {
  const build = fixture(t), h = harness(), sw = h.load(build.script)
  await sw.dispatch('install')
  const keys = [...h.stores.get(build.cacheName).keys()]
  h.network(async () => new Response('online private navigation'))
  assert.equal(await (await sw.request('/chat', {mode: 'navigate'})).text(), 'online private navigation')
  h.network(async () => new Response('unauthorized', {status: 401}))
  assert.equal((await sw.request('/chat', {mode: 'navigate'})).status, 401)
  h.network(async () => {throw new Error('offline')})
  for (const pathname of ['/', '/chat', '/manage']) {
    assert.equal(await (await sw.request(pathname, {mode: 'navigate'})).text(), 'public /index.html')
  }
  assert.equal(await (await sw.request('/assets/index-AAAAAAAA.js')).text(), 'public /assets/index-AAAAAAAA.js')
  assert.deepEqual([...h.stores.get(build.cacheName).keys()], keys)
  assert.equal(await (await (await h.caches.open(build.cacheName)).match('/index.html')).text(), 'public /index.html')
})

test('updates retain exactly one previous generation and isolate unrelated caches and current shell', async t => {
  const h = harness(), a = fixture(t, 'A'), b = fixture(t, 'B'), c = fixture(t, 'C')
  await h.caches.open('another-app-cache')
  const first = h.load(a.script)
  await first.dispatch('install')
  await first.dispatch('activate')
  const second = h.load(b.script)
  h.network(async request => new Response(`B ${new URL(request.url).pathname}`))
  await second.dispatch('install')
  assert(h.stores.has(a.cacheName), 'waiting worker does not remove active assets')
  assert.equal(second.state.skipped, 0)
  await second.dispatch('message', {data: {type: 'SKIP_WAITING'}})
  await second.dispatch('activate')
  h.network(async () => {throw new Error('offline')})
  assert.equal(await (await second.request('/assets/index-AAAAAAAA.js')).text(), 'public /assets/index-AAAAAAAA.js')
  assert.equal(await (await second.request('/chat', {mode: 'navigate'})).text(), 'B /index.html')
  const third = h.load(c.script)
  h.network(async request => new Response(`C ${new URL(request.url).pathname}`))
  await third.dispatch('install')
  await third.dispatch('activate')
  assert.deepEqual(await h.caches.keys(), ['another-app-cache', 'wechat2tg-pwa-state', b.cacheName, c.cacheName])
  h.network(async () => {throw new Error('offline')})
  assert.equal(await (await third.request('/assets/index-BBBBBBBB.js')).text(), 'B /assets/index-BBBBBBBB.js')
  await assert.rejects(third.request('/assets/index-AAAAAAAA.js'), /offline/)
  // Runtime unknown hashed URLs may pass through, but must never enter a cache.
  h.network(async () => new Response('not found', {status: 404}))
  assert.equal((await third.request('/assets/missing-XXXXXXXX.js')).status, 404)
  for (const entries of h.stores.values()) assert.equal(entries.has(origin + '/assets/missing-XXXXXXXX.js'), false)
})

test('superseded waiting updates never displace the actual previous active generation', async t => {
  const h = harness(), a = fixture(t, 'A'), b = fixture(t, 'B'), c = fixture(t, 'C')
  const first = h.load(a.script)
  await first.dispatch('install')
  await first.dispatch('activate')
  await h.load(b.script).dispatch('install') // Never accepted by the user.
  const third = h.load(c.script)
  await third.dispatch('install')
  await third.dispatch('activate')
  assert(h.stores.has(a.cacheName))
  assert.equal(h.stores.has(b.cacheName), false)
  h.network(async () => {throw new Error('offline')})
  assert.equal(await (await third.request('/assets/index-AAAAAAAA.js')).text(), 'public /assets/index-AAAAAAAA.js')
  // Reopening a terminated worker also finds the persisted previous generation.
  const restarted = h.load(c.script)
  assert.equal(await (await restarted.request('/assets/index-AAAAAAAA.js')).text(), 'public /assets/index-AAAAAAAA.js')
  assert.equal(restarted.request('/.pwa-active-generation'), undefined)
})

test('failed installation removes its incomplete generation without touching the active cache', async t => {
  const h = harness(), a = fixture(t, 'A'), b = fixture(t, 'B')
  await h.load(a.script).dispatch('install')
  h.network(async () => new Response('failed', {status: 503}))
  await assert.rejects(h.load(b.script).dispatch('install'), /install fetch failed/)
  assert.deepEqual(await h.caches.keys(), [a.cacheName])
})