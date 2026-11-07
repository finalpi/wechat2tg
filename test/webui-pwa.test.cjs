/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../webui/src/lib/use-pwa.ts'), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS},
}).outputText
const flush = async () => {await Promise.resolve(); await Promise.resolve(); await Promise.resolve()}
class Target extends EventTarget {
  listeners = 0
  addEventListener(...args) {this.listeners++; super.addEventListener(...args)}
  removeEventListener(...args) {this.listeners--; super.removeEventListener(...args)}
  fire(name) {this.dispatchEvent(new Event(name, {cancelable: true}))}
}
function setup({enabled = true, secure = true, supported = true, controlled = true, waiting = true, standalone = false, ios = false, registerError = false} = {}) {
  const window = new Target(), sw = new Target(), registration = new Target(), media = new Target(), worker = new Target()
  const timers = new Map(), states = [], posts = [], calls = []
  let reloads = 0, safe = true, id = 0
  worker.state = 'installed'
  worker.postMessage = value => posts.push(value)
  registration.waiting = waiting ? worker : null
  registration.installing = null
  sw.controller = controlled ? {} : null
  sw.register = async (...args) => {calls.push(args); if (registerError) throw Error('offline'); return registration}
  media.matches = standalone
  window.isSecureContext = secure
  window.matchMedia = () => media
  window.location = {reload: () => reloads++}
  const navigator = {standalone: ios, ...(supported ? {serviceWorker: sw} : {})}
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, require: () => ({}), window, navigator,
    setTimeout: (fn, delay) => {timers.set(++id, {fn, delay}); return id},
    clearTimeout: id => timers.delete(id),
  })
  const start = () => exports.createPwaLifecycle({enabled, canReload: () => safe}, state => states.push(state))
  const lifecycle = start()
  return {window, sw, registration, media, worker, timers, states, posts, calls, lifecycle, start,
    get state() {return states.at(-1)}, get reloads() {return reloads}, setSafe: value => {safe = value},
    activate() {registration.waiting = null; sw.controller = worker; sw.fire('controllerchange')},
    expire(delay) {for (const [id, timer] of timers) if (timer.delay === delay) {timers.delete(id); timer.fn()}},
  }
}

test('disabled, insecure and unsupported contexts never register or capture prompts', async () => {
  for (const options of [{enabled: false}, {secure: false}, {supported: false}]) {
    const h = setup(options)
    await flush()
    assert.equal(h.state.supported, false)
    assert.equal(h.calls.length, 0)
    assert.equal(h.window.listeners, 0)
    assert.equal(await h.lifecycle.install(), false)
    assert.equal(await h.lifecycle.applyUpdate(), false)
  }
})

test('registration uses root scope; offline failure is surfaced without rejection', async () => {
  const h = setup()
  await flush()
  assert.equal(h.calls[0][0], '/sw.js')
  assert.equal(h.calls[0][1].scope, '/')
  assert.equal(h.state.updateReady, true)
  assert.equal(h.posts.length, 0)
  h.lifecycle.dispose()
  const offline = setup({registerError: true})
  await flush()
  assert.match(offline.state.error, /联网/)
  offline.lifecycle.dispose()
})

test('installation prompts are ephemeral, accepted/dismissed/error are handled', async () => {
  const h = setup()
  assert.equal(await h.lifecycle.install(), false)
  for (const outcome of ['accepted', 'dismissed', 'error']) {
    const event = new Event('beforeinstallprompt', {cancelable: true})
    event.prompt = async () => {if (outcome === 'error') throw Error('prompt failed')}
    event.userChoice = Promise.resolve({outcome})
    h.window.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(h.state.canInstall, true)
    assert.equal(await h.lifecycle.install(), outcome === 'accepted')
    assert.equal(h.state.canInstall, false)
    assert.equal(await h.lifecycle.install(), false)
    assert.equal(h.timers.size, 0)
  }
  h.window.fire('appinstalled')
  assert.equal(h.state.installed, true)
  h.lifecycle.dispose()
})

test('display-mode changes and iOS standalone report installation', () => {
  for (const options of [{standalone: true}, {ios: true}]) {
    const h = setup(options)
    assert.equal(h.state.installed, true)
    h.lifecycle.dispose()
  }
  const h = setup()
  h.media.matches = true
  h.media.fire('change')
  assert.equal(h.state.installed, true)
  h.lifecycle.dispose()
})

test('updatefound tracks installing worker; first install and unsolicited changes never reload', async () => {
  const h = setup({waiting: false})
  await flush()
  h.registration.installing = h.worker
  h.registration.fire('updatefound')
  h.registration.waiting = h.worker
  h.worker.fire('statechange')
  assert.equal(h.state.updateReady, true)
  h.activate()
  assert.equal(h.reloads, 0)
  h.lifecycle.dispose()
  const first = setup({controlled: false})
  await flush()
  assert.equal(first.state.updateReady, false)
  assert.equal(await first.lifecycle.applyUpdate(), false)
  first.activate()
  assert.equal(first.reloads, 0)
  first.lifecycle.dispose()
})

test('only approved requesting tab reloads; unsafe edits block posting and reload', async () => {
  const h = setup(), other = setup()
  await flush()
  h.setSafe(false)
  assert.equal(await h.lifecycle.applyUpdate(), false)
  assert.match(h.state.error, /未保存.*提交/)
  assert.equal(h.posts.length, 0)
  h.setSafe(true)
  assert.equal(await h.lifecycle.applyUpdate(), true)
  assert.equal(h.posts[0].type, 'SKIP_WAITING')
  assert.equal(await h.lifecycle.applyUpdate(), false)
  h.activate(); other.activate()
  assert.equal(h.reloads, 1)
  assert.equal(other.reloads, 0)
  assert.equal(h.timers.size, 0)
  h.lifecycle.dispose(); other.lifecycle.dispose()
  const editing = setup()
  await flush()
  await editing.lifecycle.applyUpdate()
  editing.setSafe(false)
  editing.activate()
  assert.equal(editing.reloads, 0)
  assert.match(editing.state.error, /未保存/)
  editing.setSafe(true)
  editing.sw.fire('controllerchange')
  assert.equal(editing.reloads, 0)
  assert.equal(editing.state.updateReady, true, 'activation must not hide the pending user-approved refresh')
  assert.equal(await editing.lifecycle.applyUpdate(), true)
  assert.equal(editing.reloads, 1, 'after saving edits, the same tab can explicitly retry refresh')
  assert.equal(editing.posts.length, 1, 'the already-active worker must not receive another skipWaiting')
  assert.equal(editing.state.updateReady, false)
  editing.lifecycle.dispose()
})

test('timeout, post errors and redundant workers clear pending approval', async () => {
  for (const failure of ['timeout', 'post', 'redundant']) {
    const h = setup()
    await flush()
    if (failure === 'post') h.worker.postMessage = () => {throw Error('gone')}
    await h.lifecycle.applyUpdate()
    if (failure === 'timeout') h.expire(15000)
    if (failure === 'redundant') {h.worker.state = 'redundant'; h.worker.fire('statechange')}
    assert.notEqual(h.state.error, '')
    assert.equal(h.timers.size, 0)
    h.activate()
    assert.equal(h.reloads, 0)
    h.lifecycle.dispose()
  }
})

test('logout/disposal removes all listeners and cancels update and install approvals', async () => {
  const h = setup()
  await flush()
  await h.lifecycle.applyUpdate()
  const event = new Event('beforeinstallprompt')
  event.prompt = () => new Promise(() => { /* Simulate a browser prompt left open. */ })
  h.window.dispatchEvent(event)
  const install = h.lifecycle.install()
  h.lifecycle.dispose()
  assert.equal(await install, false)
  h.activate()
  assert.equal(h.reloads, 0)
  assert.equal(h.timers.size, 0)
  for (const target of [h.window, h.media, h.sw, h.registration, h.worker]) assert.equal(target.listeners, 0)
  assert.equal(await h.lifecycle.applyUpdate(), false)
})

test('StrictMode setup/cleanup replay registers only live instance; late completion stays detached', async () => {
  const h = setup()
  h.lifecycle.dispose()
  const live = h.start()
  await flush()
  assert.equal(h.calls.length, 1)
  live.dispose()
  const late = setup()
  let resolve
  late.sw.register = () => new Promise(done => {resolve = done})
  await flush()
  late.lifecycle.dispose()
  resolve(late.registration)
  await flush()
  assert.equal(late.registration.listeners, 0)
  assert.equal(late.sw.listeners, 0)
})

test('install timeout releases pending prompt without installing or reusing it', async () => {
  const h = setup()
  const event = new Event('beforeinstallprompt')
  event.prompt = () => new Promise(() => { /* Simulate a browser prompt left open. */ })
  h.window.dispatchEvent(event)
  const result = h.lifecycle.install()
  h.expire(60000)
  assert.equal(await result, false)
  assert.equal(await h.lifecycle.install(), false)
  h.lifecycle.dispose()
})