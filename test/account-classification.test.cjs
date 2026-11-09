/* eslint-disable @typescript-eslint/no-var-requires -- Node's CommonJS test runner. */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {DataSource} = require('typeorm')

// Compile only owned sources so these tests can run while the merge/SDK artifact is in progress.
function loadSource(file, dependencies = {}) {
  const filename = path.join(__dirname, '..', 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, experimentalDecorators: true,
    emitDecoratorMetadata: true, esModuleInterop: true,
  }}).outputText
  const exports = {}
  vm.runInNewContext(output, {exports, console, Buffer, setTimeout, clearTimeout,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      // Importing the classification service itself must not resolve application clients.
      if (name.startsWith('.')) throw new Error(`Unexpected eager application import: ${name}`)
      return require(name)
    },
  }, {filename})
  return exports
}
const {WechatAccountClassificationService: Service} = loadSource('service/WechatAccountClassificationService.ts')
const row = (wxid, flag = 24, extra = {}) => ({account_wxid: 'owner', kind: 'contact', wxid,
  deleted: false, profile: {verify_flag: flag}, ...extra})
const names = rows => Array.from(rows, item => item.userName)

function fixture({flags = new Map(), directory, find, options = {}} = {}) {
  let now = 1000
  const queries = [], lookups = []
  const service = new Service({
    now: () => now,
    getSession: async () => ({accountWxid: 'owner',
      queryDirectory: async (query, timeout) => {
        queries.push({...query, timeout})
        return directory ? directory(query) : Promise.reject(new Error('SQLite backend / endpoint unavailable'))
      },
      findContact: async id => {lookups.push(id); return find ? find(id) : undefined},
    }),
    readFlags: async ids => new Map(ids.filter(id => flags.has(id)).map(id => [id, flags.get(id)])),
    backfillFlags: async updates => {
      for (const [id, flag] of updates) if (flags.has(id) && flags.get(id) === null) flags.set(id, flag)
    },
  }, options)
  return {service, flags, queries, lookups, advance: n => {now += n}}
}

test('authoritative flags: non-gh official, gh personal, absent/malformed remain unknown, rooms excluded', async () => {
  const f = fixture()
  const rows = [{userName: 'news', verifyFlag: 24}, {userName: 'brand', verifyFlag: 8},
    {userName: 'brand136', verifyFlag: 136}, {userName: 'gh_person', verifyFlag: 0},
    ...[undefined, null, '', false, -1, 1.5, 'no', {}, NaN, Infinity].map((flag, i) => ({userName: `bad${i}`, verifyFlag: flag})),
    {userName: 'x@chatroom', verifyFlag: 8}]
  const result = await f.service.classifyContacts(rows)
  assert.deepEqual(names(result.official), ['news', 'brand', 'brand136'])
  assert.deepEqual(names(result.contacts), ['gh_person'])
  assert.equal(result.unknown.length, 10)
  assert.equal(await f.service.isOfficialAccount('gh_person', 0), false)
  assert.equal(await f.service.isOfficialAccount('news', 24), true)
  assert.equal(await f.service.isOfficialAccount('missing'), undefined)
  assert.equal(await f.service.isOfficialAccount('x@chatroom', 24), undefined)
})

test('@openim contacts never become official/unknown or require VerifyFlag enrichment', async () => {
  const f = fixture({flags:new Map([['cached@openim',24]])})
  const rows = [undefined,null,0,24,'bad'].map((verifyFlag,index)=>({userName:`worker_${index}@openim`,verifyFlag}))
  rows.push({userName:'cached@openim'})
  const result = await f.service.classifyContacts(rows)
  assert.deepEqual(names(result.contacts),rows.map(row=>row.userName))
  assert.equal(result.official.length,0)
  assert.equal(result.unknown.length,0)
  for(const entry of rows)assert.equal(await f.service.isOfficialAccount(entry.userName,entry.verifyFlag),false)
  assert.equal(f.queries.length,0)
  assert.equal(f.lookups.length,0)
})

test('missing hints cannot erase cached zero; known hints/cache require no client or HTTP', async () => {
  const f = fixture({flags: new Map([['gh_person', 0], ['news', 24]])})
  const result = await f.service.classifyContacts([{userName: 'gh_person'}, {userName: 'news', verifyFlag: null}])
  assert.deepEqual(names(result.contacts), ['gh_person'])
  assert.deepEqual(names(result.official), ['news'])
  assert.equal(f.queries.length, 0)
  assert.equal(f.lookups.length, 0)
})

test('Directory paginates list/total, validates account/kind/deleted, rejects absent flags and rooms', async () => {
  const first = [row('news'), row('foreign', 24, {account_wxid: 'other'}), row('deleted', 24, {deleted: true}),
    row('room', 24, {kind: 'room'}), row('absent', undefined, {profile: {}}), row('unclear', 24, {deleted: undefined})]
  const second = [row('gh_person', 0), row('x@chatroom')]
  const f = fixture({flags: new Map([['news', null], ['gh_person', null]]),
    directory: query => ({Data: {list: query.Offset === 0 ? first : second, total: 8}})})
  const result = await f.service.classifyContacts(['news', 'foreign', 'deleted', 'room', 'absent', 'unclear', 'gh_person'].map(userName => ({userName})))
  assert.deepEqual(names(result.official), ['news'])
  assert.deepEqual(names(result.contacts), ['gh_person'])
  assert.equal(result.unknown.length, 5)
  assert.deepEqual(f.queries.map(q => q.Offset), [0, 6])
  assert.ok(f.queries.every(q => q.Wxid === 'owner' && q.Kind === 'contact' && q.Limit === 500 && q.timeout <= 1000))
  assert.equal(f.flags.size, 2)
})

test('Directory failures use SDK; single-flight and cooldown prevent duplicate traffic', async () => {
  const f = fixture({find: async () => {await new Promise(resolve => setTimeout(resolve, 5)); return {verifyFlag: 24}}})
  const values = await Promise.all(Array.from({length: 6}, () => f.service.isOfficialAccount('news')))
  assert.deepEqual(values, [true, true, true, true, true, true])
  assert.deepEqual(f.lookups, ['news'])
  assert.equal(f.queries.length, 1)
  await f.service.isOfficialAccount('another')
  assert.equal(f.queries.length, 1)
})

test('bounded concurrency, budget and fair rotation progress past unknown failures; duplicates removed', async () => {
  let active = 0, peak = 0
  const f = fixture({options: {lookupBudget: 4, concurrency: 2}, find: async () => {
    active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    throw new Error('unavailable')
  }})
  const rows = Array.from({length: 10}, (_, i) => ({userName: `user${i}`}))
  const first = await f.service.classifyContacts([...rows, rows[0]])
  assert.equal(first.unknown.length, 10)
  assert.equal(f.lookups.length, 4)
  await f.service.classifyContacts(rows)
  await f.service.classifyContacts(rows)
  assert.equal(f.lookups.length, 10)
  assert.equal(new Set(f.lookups).size, 10)
  assert.equal(peak, 2)
  assert.equal(f.queries.length, 1)
})

test('hung SDK calls do not freeze foreground or duplicate after deadline', async () => {
  const f = fixture({options: {foregroundTimeoutMs: 25, concurrency: 2, lookupBudget: 10},
    find: () => new Promise(() => { /* Simulate an SDK request that never settles. */ })})
  const rows = Array.from({length: 30}, (_, i) => ({userName: `user${i}`}))
  const started = Date.now()
  assert.equal((await f.service.classifyContacts(rows)).unknown.length, 30)
  assert.ok(Date.now() - started < 500)
  await f.service.classifyContacts(rows)
  assert.equal(f.lookups.length, 2)
})

test('production adapter atomically preserves concurrent explicit zero, never creates stubs (SQLite)', async () => {
  const db = new DataSource({type: 'sqlite', database: ':memory:'})
  await db.initialize()
  try {
    await db.query('CREATE TABLE contact (userName TEXT PRIMARY KEY, verifyFlag INTEGER NULL)')
    await db.query('INSERT INTO contact VALUES (?, NULL)', ['race'])
    await db.query('INSERT INTO contact VALUES (?, NULL)', ['news'])
    const client = {baseUrl: 'http://invalid.test', info: async () => ({id: 'owner'}), Contact: {find: async () => undefined}}
    const {WechatAccountClassificationService: Production} = loadSource('service/WechatAccountClassificationService.ts', {
      '../data-sourse': {getGeWeChatDataSource: () => db},
      '../base/BaseClient': {AbstractClient: {getSpyClient: () => ({hasLogin: true, client})}},
      axios: {request: async request => {
        assert.equal(request.url, '/Directory/Query')
        await db.query('UPDATE contact SET verifyFlag = 0 WHERE userName = ?', ['race'])
        return {data: {Data: {list: [row('race'), row('news'), row('stub')], total: 3}}}
      }},
    })
    const result = await new Production().classifyContacts(['race', 'news', 'stub'].map(userName => ({userName})))
    assert.deepEqual(names(result.contacts), ['race'])
    assert.deepEqual(names(result.official), ['news', 'stub'])
    assert.deepEqual(await db.query('SELECT * FROM contact ORDER BY userName'), [
      {userName: 'news', verifyFlag: 24}, {userName: 'race', verifyFlag: 0},
    ])
  } finally {await db.destroy()}
})

test('mirror never synchronizes SDK columns; nullable flag has no zero default; app forum entities retained', async () => {
  const {WxContact} = loadSource('entity/WxContact.ts')
  class Dummy {}
  const dependencies = {'../unused': {}}
  for (const name of ['Configuration', 'BindGroup', 'Message', 'OfficialAccountForum', 'OfficialAccountTopic', 'WxRoom']) {
    dependencies[`./entity/${name}`] = {[name]: Dummy}
  }
  dependencies['./entity/WxContact'] = {WxContact}
  dependencies['./client/WechatClient'] = {}
  const source = loadSource('data-sourse.ts', dependencies)
  assert.equal(source.AppDataSource.options.synchronize, true)
  assert.equal(source.AppDataSource.options.entities.length, 5)
  const mirror = source.getGeWeChatDataSource()
  assert.equal(mirror.options.synchronize, false)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-classification-'))
  const database = path.join(directory, 'puppet.db')
  const sdk = new DataSource({type: 'sqlite', database})
  await sdk.initialize()
  await sdk.query('CREATE TABLE contact (userName TEXT PRIMARY KEY, verifyFlag INTEGER NULL, sdkFuture TEXT)')
  await sdk.query('INSERT INTO contact VALUES (?, ?, ?)', ['news', 24, 'preserved'])
  await sdk.destroy()
  const db = new DataSource({...mirror.options, database, logging: false})
  await db.initialize()
  try {
    // Reopening a pre-existing SDK database must not alter its schema.
    const metadata = db.getMetadata(WxContact).findColumnWithPropertyName('verifyFlag')
    assert.equal(metadata.isNullable, true)
    assert.equal(metadata.default, undefined)
    assert.ok((await db.query('PRAGMA table_info(contact)')).some(column => column.name === 'sdkFuture'))
    assert.deepEqual(await db.query('SELECT * FROM contact'), [{userName: 'news', verifyFlag: 24, sdkFuture: 'preserved'}])
  } finally {
    await db.destroy()
    fs.rmSync(directory, {recursive: true, force: true})
  }
})

test('partial Directory scans continue from the offset and unsupported endpoints retry only after backoff', async () => {
  const f = fixture({options: {directoryPages: 1, lookupBudget: 0},
    directory: query => ({Data: {list: [row(`news${query.Offset}`)], total: 3}})})
  const rows = [0, 1, 2].map(i => ({userName: `news${i}`}))
  assert.equal((await f.service.classifyContacts(rows)).unknown.length, 2)
  f.advance(1001)
  assert.equal((await f.service.classifyContacts(rows)).unknown.length, 1)
  f.advance(1001)
  assert.equal((await f.service.classifyContacts(rows)).unknown.length, 0)
  assert.deepEqual(f.queries.map(query => query.Offset), [0, 1, 2])
  const failure = fixture()
  await failure.service.isOfficialAccount('unknown')
  await failure.service.isOfficialAccount('unknown')
  assert.equal(failure.queries.length, 1)
  assert.equal(failure.lookups.length, 1)
  failure.advance(30_001)
  await failure.service.isOfficialAccount('unknown')
  assert.equal(failure.queries.length, 2)
  assert.equal(failure.lookups.length, 2)
})

test('logged-in SDK fallback still works when self-info or Directory is unavailable', async () => {
  let lookups = 0
  const client = {info: async () => {throw new Error('self profile unavailable')},
    Contact: {find: async () => {lookups++; return {verifyFlag: 24}}}}
  const {WechatAccountClassificationService: Production} = loadSource('service/WechatAccountClassificationService.ts', {
    '../data-sourse': {getGeWeChatDataSource: () => {throw new Error('uninitialized mirror')}},
    '../base/BaseClient': {AbstractClient: {getSpyClient: () => ({hasLogin: true, client})}},
  })
  assert.equal(await new Production().isOfficialAccount('news'), true)
  assert.equal(lookups, 1)
})