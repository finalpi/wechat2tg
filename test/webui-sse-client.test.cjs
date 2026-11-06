/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../webui/src/lib/message-events.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
}).outputText
function load(fetch = async () => {throw new Error('unexpected fetch')}) {
  const exports = {}, listeners = new Map()
  const document = {hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)}
  vm.runInNewContext(compiled, {exports, setTimeout, clearTimeout, TextDecoder, AbortController, fetch, document, navigator: {onLine: true}, Math})
  return {...exports, listeners}
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('SSE parser handles UTF8 text, CRLF/chunk boundaries and ignores heartbeat comments', () => {
  const {createSSEParser, decodeMessageEvent} = load()
  const frames = [], parser = createSSEParser(frame => frames.push(frame))
  for (const char of ': heartbeat\r\n\r\nevent: ready\r\ndata: {}\r\n\r\nevent: change\ndata: {"type":"messages",\ndata: "wxId":"测试","ids":[1]}\n\n') parser.push(char)
  assert.equal(frames.length, 2)
  assert.equal(decodeMessageEvent(frames[0]).event, 'ready')
  assert.equal(decodeMessageEvent(frames[1]).data.wxId, '测试')
  assert.equal(decodeMessageEvent({event: 'change', data: 'invalid'}), undefined)
  assert.throws(() => createSSEParser(() => undefined, 16).push('x'.repeat(17)), /too large/)
})

test('refresh queue coalesces bursts, preserves invalidation during fetch and cleans up', async () => {
  const {createRefreshQueue} = load()
  let count = 0, release
  const gate = new Promise(resolve => {release = resolve})
  const errors = []
  const queue = createRefreshQueue(async () => {count++; if (count === 1) await gate}, e => errors.push(e), 2)
  queue.flush()
  for (let i = 0; i < 20; i++) queue.schedule()
  assert.equal(count, 1)
  release(); await wait(20)
  assert.equal(count, 2)
  queue.schedule(); queue.dispose(); await wait(10)
  assert.equal(count, 2)
  assert.deepEqual(errors, [])
})

test('stream client sends bearer header only and auth expiry permanently stops reconnect', async () => {
  let calls = 0, expired = 0
  const lib = load(async (url, options) => {
    calls++
    assert.equal(url, '/api/messages/events')
    assert.equal(options.headers.Authorization, 'Bearer private-token')
    return new Response('event: ready\ndata: {}\n\nevent: auth-expired\ndata: {}\n\n', {headers: {'Content-Type': 'text/event-stream'}})
  })
  const states = []
  const stop = lib.startMessageEvents('private-token', {onEvent: () => undefined, onState: state => states.push(state), onAuthExpired: () => {expired++}})
  await wait(40)
  assert.equal(expired, 1)
  assert.equal(calls, 1)
  assert.equal(states.at(-1), 'disconnected')
  stop()
  assert.equal(lib.listeners.size, 0)
})

test('StrictMode-style immediate cleanup opens no network connection', async () => {
  let calls = 0
  const lib = load(async () => {calls++; return new Response('', {status: 401})})
  const stop = lib.startMessageEvents('token', {onEvent: () => undefined, onState: () => undefined, onAuthExpired: () => undefined})
  stop(); await wait(10)
  assert.equal(calls, 0)
  assert.equal(lib.listeners.size, 0)
})