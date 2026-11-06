/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {createHmac} = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Exercise actual source, without application/config/database dependencies or stale dist.
const filename = path.join(__dirname, '../src/webui/mini-app-auth.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
  fileName: filename,
}).outputText
const sourceExports = {}
vm.runInNewContext(compiled, {
  exports: sourceExports, Buffer, URL,
  require(name) {
    assert.equal(name, 'node:crypto', 'Auth must not load application dependencies')
    return require(name)
  },
}, {filename})
const {createMiniAppAuth, normalizeMiniAppUrl} = sourceExports
const BOT_TOKEN = '123456:test-only-bot-token'
const OWNER = 7654321
const NOW = 1750000000000

// Independent Telegram-style producer. No production signing/parsing helpers are used.
function signed(overrides = {}, botToken = BOT_TOKEN) {
  const fields = {
    query_id: 'query-test-123', user: JSON.stringify({id: OWNER, first_name: 'Owner'}),
    auth_date: String(NOW / 1000), ...overrides,
  }
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key]
  const secret = createHmac('sha256', Buffer.from('WebAppData')).update(botToken).digest()
  const lines = Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => key + '=' + value)
  const hash = createHmac('sha256', secret).update(lines.join('\n')).digest('hex')
  // Reverse wire ordering to ensure the verifier must sort the decoded fields.
  return new URLSearchParams([...Object.entries(fields).reverse(), ['hash', hash]]).toString()
}

function setup(options = {}) {
  let time = NOW
  let owner = OWNER
  const auth = createMiniAppAuth({botToken: BOT_TOKEN, ownerId: async () => owner, now: () => time, ...options})
  return {auth, setTime: value => { time = value }, setOwner: value => { owner = value }}
}

function errorIs(code, status) {
  return error => {
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    assert.equal(error.message, code)
    assert.equal(error.cause, undefined)
    assert.deepEqual(Object.keys(error).sort(), ['code', 'status'])
    assert.ok(!String(error.stack).includes(BOT_TOKEN))
    assert.ok(!JSON.stringify(error).includes('auth_date='))
    return true
  }
}
const unauthorized = () => errorIs('miniAppUnauthorized', 401)
const forbidden = () => errorIs('miniAppForbidden', 403)
const unavailable = () => errorIs('miniAppUnavailable', 503)

function change(input, key, value) {
  const params = new URLSearchParams(input)
  if (value === undefined) params.delete(key)
  else params.set(key, value)
  return params.toString()
}

test('owner exchange returns a random opaque one-hour token, never the signed input', async () => {
  const {auth} = setup()
  const input = signed()
  const first = await auth.exchange(input)
  const second = await auth.exchange(input)
  assert.match(first.token, /^miniapp_[a-f0-9]{64}$/)
  assert.notEqual(first.token, second.token)
  assert.equal(first.expiresAt, NOW + 3600000)
  assert.equal(await auth.authorize(first.token), true)
  assert.equal(await auth.authorize(second.token), true)
  assert.equal(await setup().auth.authorize(first.token), false, 'Sessions are process/instance-local')
  assert.equal(await auth.authorize(input), false, 'initData is never a bearer token')
})

test('HMAC covers exact decoded JSON, Unicode, unknown fields and signature', async () => {
  const {auth} = setup()
  const rawUser = `{ "first_name": "A + B & C = 中文", "id" : ${OWNER} }`
  const input = signed({user: rawUser, signature: 'independent-signature_-/+=', custom_field: 'opaque + value'})
  assert.equal(await auth.authorize((await auth.exchange(input)).token), true)
  await assert.rejects(auth.exchange(change(input, 'user', JSON.stringify(JSON.parse(rawUser)))), unauthorized())
  await assert.rejects(auth.exchange(change(input, 'signature', 'tampered')), unauthorized())
  await assert.rejects(auth.exchange(change(input, 'signature', undefined)), unauthorized())
  // A third-party-style signature exclusion MUST NOT work for bot-token validation.
  await assert.rejects(auth.exchange(signed() + '&signature=not-covered'), unauthorized())
  const upperHash = change(input, 'hash', new URLSearchParams(input).get('hash').toUpperCase())
  assert.ok((await auth.exchange(upperHash)).token)
})

test('tampered data, another bot, and malformed/missing hashes are unauthorized', async () => {
  const {auth} = setup()
  const input = signed()
  for (const invalid of [
    change(input, 'user', JSON.stringify({id: OWNER + 1})),
    change(input, 'auth_date', String(NOW / 1000 + 1)),
    change(input, 'query_id', 'tampered'), signed({}, 'another-bot-token'),
    change(input, 'hash', new URLSearchParams(input).get('hash') + '\n'),
    ...[undefined, '', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), '0'.repeat(64)].map(hash => change(input, 'hash', hash)),
  ]) await assert.rejects(auth.exchange(invalid), unauthorized())
})

test('user/hash/auth_date are mandatory; malformed identities never fall back to receiver/chat', async () => {
  const {auth} = setup()
  for (const key of ['user', 'hash', 'auth_date']) {
    await assert.rejects(auth.exchange(change(signed(), key, undefined)), unauthorized())
  }
  for (const rawUser of [undefined, '', '{', 'null', '[]', '7', 'true', '{}',
    JSON.stringify({id: String(OWNER)}), JSON.stringify({id: 0}), JSON.stringify({id: -1}),
    JSON.stringify({id: 1.5}), JSON.stringify({id: Number.MAX_SAFE_INTEGER + 1}), '{"id":1e309}',
  ]) {
    await assert.rejects(auth.exchange(signed({user: rawUser,
      receiver: JSON.stringify({id: OWNER}), chat: JSON.stringify({id: OWNER})})), unauthorized())
  }
})

test('auth_date requires integer seconds, accepts exact boundaries and rejects stale/future data', async () => {
  const {auth} = setup()
  for (const date of ['', undefined, 'NaN', 'Infinity', '-1', '1.1', '1e9', ' 1750000000', '+1750000000', '1750000000\n',
    '999999999999999999999', String(NOW / 1000 - 301), String(NOW / 1000 + 31)]) {
    await assert.rejects(auth.exchange(signed({auth_date: date})), unauthorized())
  }
  for (const seconds of [-300, 0, 30]) {
    assert.ok((await auth.exchange(signed({auth_date: String(NOW / 1000 + seconds)}))).token)
  }
  const delayed = setup({ownerId: async () => { delayed.setTime(NOW + 300001); return OWNER }})
  await assert.rejects(delayed.auth.exchange(signed()), unauthorized())
})

test('duplicate decoded parameters and malformed encodings are rejected', async () => {
  const {auth} = setup()
  const input = signed({signature: 'sig'})
  const fields = new URLSearchParams(input)
  for (const key of ['user', 'hash', 'auth_date', 'signature', 'query_id']) {
    await assert.rejects(auth.exchange(input + '&' + key + '=' + encodeURIComponent(fields.get(key))), unauthorized())
  }
  for (const suffix of ['&%75ser=%7B%7D', '&%68ash=' + fields.get('hash'), '&bad=%', '&bad=%FF', '&bad=%E0%A4', '&=value', '&bare', '&']) {
    await assert.rejects(auth.exchange(input + suffix), unauthorized())
  }
  for (const input of [null, undefined, 42, {}, '', 'x'.repeat(16385)]) {
    await assert.rejects(auth.exchange(input), unauthorized())
  }
})

test('only trusted current positive owner ID is accepted, including configuration string IDs', async () => {
  const {auth, setOwner} = setup()
  await assert.rejects(auth.exchange(signed({user: JSON.stringify({id: OWNER + 1})})), forbidden())
  setOwner(String(OWNER))
  assert.ok((await auth.exchange(signed())).token)
  for (const owner of [undefined, null, '', ' ', 0, -123, '-123', true, {}, [], 'not-an-id', '1e6', String(OWNER) + '\n',
    Number.MAX_SAFE_INTEGER + 1, String(Number.MAX_SAFE_INTEGER + 1)]) {
    setOwner(owner)
    await assert.rejects(auth.exchange(signed()), unavailable())
  }
})

test('configuration and lookup failures are sanitized; authorize fails closed', async () => {
  const failure = new Error('sensitive config: ' + BOT_TOKEN)
  const failing = setup({ownerId: async () => { throw failure }})
  await assert.rejects(failing.auth.exchange(signed()), unavailable())
  for (const options of [{botToken: ''}, {botToken: ' '}, {ownerId: undefined}, {now: undefined, ttlMs: 0},
    {ttlMs: -1}, {ttlMs: NaN}, {ttlMs: Infinity}, {ttlMs: 0.5}, {now: () => NaN},
    {now: () => { throw failure }}]) {
    await assert.rejects(setup(options).auth.exchange(signed()), unavailable())
  }
  let fail = false
  const {auth} = setup({ownerId: async () => { if (fail) throw failure; return OWNER }})
  const {token} = await auth.exchange(signed())
  fail = true
  assert.equal(await auth.authorize(token), false)
  fail = false
  assert.equal(await auth.authorize(token), false, 'Failed owner lookup revokes the session')
})

test('revocation, malformed tokens, expiry, TTL cap, and current owner changes', async () => {
  const {auth, setTime, setOwner} = setup({ttlMs: 1000})
  const first = await auth.exchange(signed())
  const second = await auth.exchange(signed())
  assert.equal(first.expiresAt, NOW + 1000)
  auth.revoke(first.token)
  auth.revoke(first.token)
  assert.equal(await auth.authorize(first.token), false)
  for (const token of [null, undefined, 4, '', 'miniapp_bad', 'miniapp_' + '0'.repeat(64), 'x'.repeat(20000)]) {
    assert.equal(await auth.authorize(token), false)
    assert.doesNotThrow(() => auth.revoke(token))
  }
  setTime(NOW + 999)
  assert.equal(await auth.authorize(second.token), true)
  setTime(NOW + 1000)
  assert.equal(await auth.authorize(second.token), false)
  const third = await auth.exchange(signed())
  setOwner(OWNER + 1)
  assert.equal(await auth.authorize(third.token), false)
  setOwner(OWNER)
  assert.equal(await auth.authorize(third.token), false)
  const fourth = await auth.exchange(signed())
  setOwner(undefined)
  assert.equal(await auth.authorize(fourth.token), false)
  assert.equal((await setup({ttlMs: 7200000}).auth.exchange(signed())).expiresAt, NOW + 3600000)
})

test('authorize rechecks revocation and expiry after asynchronous owner lookup', async () => {
  let pending
  let wait = false
  const {auth, setTime} = setup({ttlMs: 1000, ownerId: () => wait ? new Promise(resolve => { pending = resolve }) : Promise.resolve(OWNER)})
  const {token} = await auth.exchange(signed())
  wait = true
  const revoked = auth.authorize(token)
  auth.revoke(token)
  pending(OWNER)
  assert.equal(await revoked, false)
  wait = false
  const second = await auth.exchange(signed())
  wait = true
  const expired = auth.authorize(second.token)
  setTime(NOW + 1000)
  pending(OWNER)
  assert.equal(await expired, false)
})

test('replay can reopen within five minutes; sessions are bounded with oldest-first eviction', async () => {
  const {auth, setTime} = setup()
  const input = signed()
  const sessions = []
  for (let i = 0; i < 129; i++) sessions.push(await auth.exchange(input))
  assert.equal(new Set(sessions.map(session => session.token)).size, 129)
  assert.equal(await auth.authorize(sessions[0].token), false)
  for (const session of sessions.slice(1)) assert.equal(await auth.authorize(session.token), true)
  setTime(NOW + 300001)
  await assert.rejects(auth.exchange(input), unauthorized())
  assert.equal(await auth.authorize(sessions[128].token), true, 'initData age does not shorten a live session')
  setTime(NOW + 3600000)
  assert.equal(await auth.authorize(sessions[128].token), false)
})

test('16KiB initData limit is inclusive and measured in UTF-8 bytes', async () => {
  const {auth} = setup()
  const base = signed({padding: ''})
  const exact = signed({padding: 'a'.repeat(16384 - Buffer.byteLength(base))})
  assert.equal(Buffer.byteLength(exact), 16384)
  assert.ok((await auth.exchange(exact)).token)
  await assert.rejects(auth.exchange(exact + 'a'), unauthorized())
  const unicode = signed({padding: '中'.repeat(5500)}).replaceAll('%E4%B8%AD', '中')
  assert.ok(unicode.length < 16384)
  assert.ok(Buffer.byteLength(unicode) > 16384)
  await assert.rejects(auth.exchange(unicode), unauthorized())
})

test('Mini App URL accepts only HTTPS root UI origins, with blank values disabling it', () => {
  for (const value of [undefined, null, '', ' \t\n ']) assert.equal(normalizeMiniAppUrl(value), undefined)
  for (const [input, expected] of [
    ['https://example.com', 'https://example.com/'], [' https://EXAMPLE.com:443/ ', 'https://example.com/'],
    ['https://example.com:8443/', 'https://example.com:8443/'], ['https://[::1]:8443', 'https://[::1]:8443/'],
  ]) assert.equal(normalizeMiniAppUrl(input), expected)
  for (const value of [true, 3, {}, [], 'not a url', '//example.com', 'http://example.com', 'javascript:alert(1)',
    'https://user:pass@example.com', 'https://user@example.com', 'https://@example.com',
    'https://example.com?token=x', 'https://example.com/?', 'https://example.com/#', 'https://example.com#x',
    'https://example.com/ui', 'https://example.com//', 'https://example.com/a/..', 'https://example.com/%2e/',
    'https://example.com\\', 'https://exa\nmple.com', 'https://', 'https:///example.com',
  ]) assert.throws(() => normalizeMiniAppUrl(value), unavailable())
})