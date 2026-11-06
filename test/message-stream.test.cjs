/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const {once} = require('node:events')
const {createMessageEvents} = require('../dist/webui/message-events')
const {createMessageStreamHandler} = require('../dist/webui/message-stream')

async function fixture(t, options = {}) {
  const events = createMessageEvents()
  let subscribed = 0, allowed = true
  const handler = createMessageStreamHandler({heartbeatMs: 20, flushMs: 5, ...options})
  const server = http.createServer((req, res) => handler(req, res, listener => {
    subscribed++
    const stop = events.subscribe(listener)
    return () => {subscribed--; stop()}
  }, async () => allowed))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve))})
  const open = async () => {
    const controller = new AbortController()
    t.after(() => controller.abort())
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {signal: controller.signal})
    const reader = response.body.getReader()
    let text = ''
    return {response, controller, until: async predicate => {
      const timer = setTimeout(() => controller.abort(), 2000)
      try {
        while (!predicate(text)) {const part = await reader.read(); if (part.done) break; text += Buffer.from(part.value).toString()}
        assert(predicate(text), `Missing expected stream frame: ${text}`)
        return text
      } finally {clearTimeout(timer)}
    }}
  }
  return {open, events, get subscribed() {return subscribed}, deny: () => {allowed = false}}
}

test('SSE opens once, sends change hints without payloads, heartbeats and revokes authorization', async t => {
  const f = await fixture(t)
  const stream = await f.open()
  assert.equal(stream.response.status, 200)
  assert.match(stream.response.headers.get('content-type'), /^text\/event-stream/)
  assert.equal(stream.response.headers.get('x-accel-buffering'), 'no')
  await stream.until(text => text.includes('event: ready'))
  f.events.publish({type: 'messages', wxId: 'room', ids: [2], body: 'secret-message'})
  f.events.publish({type: 'messages', wxId: 'room', ids: [3]})
  const text = await stream.until(text => text.includes('event: change') && text.includes(': heartbeat'))
  assert(text.includes('"ids":[2,3]'))
  assert(!text.includes('secret-message'))
  f.deny()
  await stream.until(text => text.includes('event: auth-expired'))
  assert.equal(f.subscribed, 0)
})

test('disconnect before authorization completes never allocates a stream subscription', async () => {
  const {Socket} = require('node:net')
  const socket = new Socket()
  const req = new http.IncomingMessage(socket)
  const res = new http.ServerResponse(req)
  res.assignSocket(socket)
  const closed = once(socket, 'close')
  socket.destroy(); await closed
  let subscriptions = 0
  const handler = createMessageStreamHandler({heartbeatMs: 10, maxConnections: 1})
  handler(req, res, () => {subscriptions++; return () => {subscriptions--}}, async () => true)
  assert.equal(subscriptions, 0)
  assert.equal(res.listenerCount('close'), 0)
})

test('SSE caps connections and disconnect releases subscription/slot', async t => {
  const f = await fixture(t, {maxConnections: 1})
  const first = await f.open()
  await first.until(text => text.includes('ready'))
  assert.equal((await f.open()).response.status, 429)
  first.controller.abort()
  const deadline = Date.now() + 1000
  while (f.subscribed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(f.subscribed, 0)
  const next = await f.open()
  assert.equal(next.response.status, 200)
  await next.until(text => text.includes('ready'))
})