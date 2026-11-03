/* eslint-disable @typescript-eslint/no-var-requires -- Node's CommonJS test runner. */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {Api, utils} = require('telegram')
const {returnBigInt} = require('telegram/Helpers')

// Compile only the service: importing it must never load application/config/database modules.
const filename = path.join(__dirname, '../src/service/TelegramChatFolderService.ts')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
}}).outputText
let now = 1000
const exportsObject = {}
vm.runInNewContext(output, {exports: exportsObject, Date: {now: () => now}, require: name => {
  assert.equal(name, 'telegram')
  return require(name)
}}, {filename})
const Service = exportsObject.TelegramChatFolderService
const chat = id => new Api.InputPeerChat({chatId: returnBigInt(id)})
const user = id => new Api.InputPeerUser({userId: returnBigInt(id), accessHash: returnBigInt(123)})
const channel = id => new Api.InputPeerChannel({channelId: returnBigInt(id), accessHash: returnBigInt(456)})
const chats = count => Array.from({length: count}, (_, i) => chat(i + 1))
const ids = peers => new Set(Array.from(peers, peer => utils.getPeerId(peer)))
const count = folder => ids([...folder.includePeers, ...folder.pinnedPeers]).size
const folder = (id = 2, title = 'WeChat', includePeers = [], extra = {}) => new Api.DialogFilter({
  id, title, includePeers, pinnedPeers: [], excludePeers: [], ...extra,
})
const shared = (id, title, includePeers = []) => new Api.DialogFilterChatlist({
  id, title, includePeers, pinnedPeers: [], hasMyInvites: true,
})
const rpcError = code => Object.assign(new Error(`RPC: ${code}`), {errorMessage: code})
const skipped = (result, reason) => assert.deepEqual({...result}, {status: 'skipped', reason})
const placed = (result, title, status = 'added') => {
  assert.equal(result.status, status)
  assert.equal(result.folderName, title)
  assert.ok(result.folderId >= 2 && result.folderId <= 255)
}

function fixture(options = {}) {
  const f = {
    state: options.state ?? {filters: [...(options.filters ?? [new Api.DialogFilterDefault()])]},
    calls: [], updates: [], writes: [], failures: {},
    serverChats: options.serverChats ?? Infinity, serverFolders: options.serverFolders ?? Infinity,
    config: {
      dialog_filters_chats_limit_default: 100, dialog_filters_chats_limit_premium: 200,
      dialog_filters_limit_default: 10, dialog_filters_limit_premium: 30,
      ...options.config,
    },
  }
  const check = stage => {
    f.calls.push(stage)
    const failure = f.failures[stage]?.shift()
    if (failure) throw failure
  }
  const client = {
    async getMe() {
      check('me')
      return new Api.User({id: returnBigInt(9999), premium: options.premium ?? false})
    },
    async getInputEntity(id) {
      check('peer')
      const [bare, type] = utils.resolveId(returnBigInt(id))
      if (type === Api.PeerChannel) return channel(bare)
      return type === Api.PeerChat ? chat(bare) : user(bare)
    },
    async invoke(request) {
      // A scheduling point exposes lost-update races if callers aren't serialized.
      await Promise.resolve()
      if (request instanceof Api.messages.GetDialogFilters) {
        check('filters')
        return new Api.messages.DialogFilters({filters: [...f.state.filters]})
      }
      if (request instanceof Api.help.GetAppConfig) {
        check('config')
        assert.equal(request.hash, 0)
        if (f.configResult) return f.configResult
        return new Api.help.AppConfig({hash: 123, config: new Api.JsonObject({
          value: Object.entries(f.config).map(([key, value]) => new Api.JsonObjectValue({
            key, value: new Api.JsonNumber({value}),
          })),
        })})
      }
      assert.ok(request instanceof Api.messages.UpdateDialogFilter, request.className)
      f.updates.push(request)
      check('update')
      assert.ok(request.filter instanceof Api.DialogFilter)
      assert.equal(request.id, request.filter.id)
      request.getBytes() // Validate real GramJS serialization, not just a mock object's shape.
      if (f.returnFalse) return false
      const index = f.state.filters.findIndex(item => item.id === request.id)
      if (index < 0 && f.state.filters.filter(item => !(item instanceof Api.DialogFilterDefault)).length >= f.serverFolders) {
        throw rpcError('DIALOG_FILTERS_TOO_MUCH')
      }
      if (count(request.filter) > f.serverChats) throw rpcError('DIALOG_FILTER_INCLUDE_TOO_MUCH')
      f.writes.push(request)
      if (index < 0) f.state.filters.push(request.filter)
      else f.state.filters[index] = request.filter
      return true
    },
  }
  f.client = client
  f.service = Service.forClient(client)
  f.named = title => f.state.filters.find(item => item.title === title)
  return f
}

test('normal 99 -> 100 -> WeChat 2 -> WeChat 3, without duplicating the pinned bot', async () => {
  const bot = user(9000)
  const original = folder(2, 'WeChat', [...chats(98), bot], {pinnedPeers: [user(9000)]})
  const f = fixture({filters: [new Api.DialogFilterDefault(), original]})
  placed(await f.service.addChat(-99), 'WeChat')
  assert.equal(count(f.named('WeChat')), 100)
  assert.equal(original.includePeers.length, 99, 'read snapshot was not mutated')
  placed(await f.service.addChat(-100), 'WeChat 2')
  assert.equal(f.named('WeChat 2').pinnedPeers.length, 0)
  for (let id = 101; id < 200; id++) placed(await f.service.addChat(-id), 'WeChat 2')
  placed(await f.service.addChat(-200), 'WeChat 3')
  assert.equal(f.calls.filter(call => call === 'config').length, 1)
  assert.equal(f.calls.filter(call => call === 'filters').length, 102)
})

test('pinned-only peers consume capacity; overlap and duplicate BigInteger IDs count once', async () => {
  const f = fixture({filters: [folder(2, 'WeChat', [chat(1), chat(1)], {pinnedPeers: [chat(1), user(1)]})],
    config: {dialog_filters_chats_limit_default: 3}})
  placed(await f.service.addChat(Number(utils.getPeerId(channel(1)))), 'WeChat')
  assert.equal(count(f.named('WeChat')), 3)
  placed(await f.service.addChat(-2), 'WeChat 2')
  placed(await f.service.addChat(1), 'WeChat', 'already-present')
})

test('Premium uses 200 and server-configured caps rather than hard-coded tier limits', async () => {
  const premium = fixture({premium: true, filters: [folder(2, 'WeChat', chats(199))]})
  placed(await premium.service.addChat(-200), 'WeChat')
  placed(await premium.service.addChat(-201), 'WeChat 2')
  const configured = fixture({premium: true, filters: [folder(2, 'WeChat', chats(204))],
    config: {dialog_filters_chats_limit_premium: 205}})
  placed(await configured.service.addChat(-205), 'WeChat')
  placed(await configured.service.addChat(-206), 'WeChat 2')
  const defaultTier = fixture({config: {dialog_filters_chats_limit_default: 1}})
  placed(await defaultTier.service.addChat(-1), 'WeChat')
  placed(await defaultTier.service.addChat(-2), 'WeChat 2')
})

test('capacity cache is per client and expires after five minutes', async () => {
  const f = fixture({config: {dialog_filters_chats_limit_default: 1}})
  placed(await f.service.addChat(-1), 'WeChat')
  f.config.dialog_filters_chats_limit_default = 3
  placed(await f.service.addChat(-2), 'WeChat 2')
  assert.equal(f.calls.filter(call => call === 'config').length, 1)
  now += 5 * 60 * 1000 + 1
  placed(await f.service.addChat(-3), 'WeChat')
  assert.equal(f.calls.filter(call => call === 'config').length, 2)
})

test('server include limit overrides cached cap and tries existing overflow before creating', async () => {
  for (const code of ['DIALOG_FILTER_INCLUDE_TOO_MUCH', 'FILTER_INCLUDE_TOO_MUCH']) {
    const original = folder(2, 'WeChat', [chat(1)])
    const f = fixture({filters: [original, folder(8, 'WeChat 2')]})
    f.failures.update = [rpcError(code)]
    placed(await f.service.addChat(-2), 'WeChat 2')
    assert.deepEqual(f.updates.map(request => request.id), [2, 8])
    assert.equal(original.includePeers.length, 1)
    assert.equal(f.state.filters.length, 2)
  }
  const f = fixture({filters: [folder(2, 'WeChat', [chat(1)])], serverChats: 1})
  placed(await f.service.addChat(-2), 'WeChat 2')
  placed(await f.service.addChat(-3), 'WeChat 3')
  assert.equal(count(f.named('WeChat')), 1)
})

test('known total cap counts personal and shared folders, not Default; existing space still works', async () => {
  const personal = folder(8, 'Personal', [user(5)])
  const invite = shared(9, 'Friends')
  const f = fixture({filters: [new Api.DialogFilterDefault(), folder(), personal, invite],
    config: {dialog_filters_chats_limit_default: 1, dialog_filters_limit_default: 3}})
  placed(await f.service.addChat(-1), 'WeChat')
  skipped(await f.service.addChat(-2), 'folder-limit')
  assert.equal(f.updates.length, 1)
  assert.equal(f.named('Personal'), personal)
  assert.equal(f.named('Friends'), invite)
  const empty = fixture({config: {dialog_filters_limit_default: 1}})
  placed(await empty.service.addChat(-1), 'WeChat')
})

test('unknown total cap permits Premium beyond ten folders; server total rejection is nonfatal', async () => {
  for (const stage of ['config', 'me']) {
    const f = fixture({premium: true, filters: Array.from({length: 12}, (_, i) => folder(i + 2, `Personal ${i}`))})
    f.failures[stage] = [new Error('offline')]
    placed(await f.service.addChat(-1), 'WeChat')
    assert.equal(f.state.filters.length, 13)
    assert.equal(f.updates.length, 1)
  }
  for (const code of ['DIALOG_FILTERS_TOO_MUCH', 'FILTERS_TOO_MUCH']) {
    const f = fixture()
    f.failures.config = [new Error('offline')]
    f.failures.update = [rpcError(code)]
    skipped(await f.service.addChat(-1), 'folder-limit')
    assert.equal(f.updates.length, 1)
    placed(await f.service.addChat(-2), 'WeChat')
  }
  const capped = fixture({serverFolders: 0})
  skipped(await capped.service.ensurePrimaryFolder(9000), 'folder-limit')
})

test('failed/missing/malformed config safely falls back to 100 chats and unknown total', async () => {
  const responses = [
    new Api.help.AppConfigNotModified(),
    new Api.help.AppConfig({hash: 1, config: new Api.JsonNull()}),
    new Api.help.AppConfig({hash: 1, config: new Api.JsonObject({value: [
      new Api.JsonObjectValue({key: 'dialog_filters_chats_limit_default', value: new Api.JsonString({value: '200'})}),
    ]})}),
  ]
  for (const response of responses) {
    const f = fixture({filters: [folder(2, 'WeChat', chats(99))]})
    f.configResult = response
    placed(await f.service.addChat(-100), 'WeChat')
    placed(await f.service.addChat(-101), 'WeChat 2')
  }
  const f = fixture({filters: [folder(2, 'WeChat', chats(100))]})
  f.failures.config = [new Error('offline')]
  placed(await f.service.addChat(-101), 'WeChat 2')
})

test('canonical names only; numeric order, shared titles and safe ID/name holes are respected', async () => {
  const protectedFolders = [folder(2, 'Work'), shared(4, 'WeChat'), shared(5, 'WeChat 3'),
    folder(6, 'WeChat 01'), folder(7, 'WeChat 1'), folder(8, 'WeChat 2 '), folder(9, 'WeChat 0'),
    folder(10, 'WeChat 2\n')]
  const f = fixture({filters: protectedFolders})
  const snapshots = protectedFolders.map(item => Buffer.from(item.getBytes()))
  const result = await f.service.addChat(-1)
  placed(result, 'WeChat 2')
  assert.equal(result.folderId, 3)
  protectedFolders.forEach((item, i) => assert.deepEqual(item.getBytes(), snapshots[i]))
  const ordered = fixture({filters: [folder(2, 'WeChat', chats(1)), folder(10, 'WeChat 10'), folder(3, 'WeChat 2')],
    config: {dialog_filters_chats_limit_default: 1}})
  placed(await ordered.service.addChat(-2), 'WeChat 2')
  placed(await ordered.service.addChat(-3), 'WeChat 10')
  placed(await ordered.service.addChat(-4), 'WeChat 3')
})

test('ID exhaustion returns folder-limit; ID 255 is usable but 1 is never allocated', async () => {
  const filters = Array.from({length: 253}, (_, i) => folder(i + 2, `Private ${i}`))
  const f = fixture({filters, config: {dialog_filters_limit_default: 300}})
  const result = await f.service.addChat(-1)
  placed(result, 'WeChat')
  assert.equal(result.folderId, 255)
  const full = fixture({filters: Array.from({length: 254}, (_, i) => folder(i + 2, `Private ${i}`)),
    config: {dialog_filters_limit_default: 300}})
  skipped(await full.service.addChat(-1), 'folder-limit')
  assert.equal(full.updates.length, 0)
})

test('channel, user and chat IDs are typed; repeated adds and restarted clients reuse persisted folders', async () => {
  const f = fixture({filters: [folder()]})
  for (const peer of [channel(7), user(7), chat(7), channel(8)]) {
    placed(await f.service.addChat(Number(utils.getPeerId(peer))), 'WeChat')
    placed(await f.service.addChat(Number(utils.getPeerId(peer))), 'WeChat', 'already-present')
  }
  assert.equal(f.named('WeChat').includePeers.length, 4)
  const restarted = fixture({state: f.state})
  placed(await restarted.service.addChat(Number(utils.getPeerId(channel(8)))), 'WeChat', 'already-present')
  assert.equal(restarted.updates.length, 0)
  const overflow = fixture({filters: [folder(2, 'WeChat', chats(100)), folder(3, 'WeChat 2', [chat(101)])]})
  placed(await overflow.service.addChat(-101), 'WeChat 2', 'already-present')
  placed(await overflow.service.addChat(-102), 'WeChat 2')
  assert.equal(overflow.state.filters.length, 2)
})

test('preserves every setting, pinned/excluded/manual peers and input snapshot when updating', async () => {
  const settings = {contacts: true, nonContacts: false, groups: true, broadcasts: true, bots: true,
    excludeMuted: true, excludeRead: true, excludeArchived: true, emoticon: 'W', color: 3,
    pinnedPeers: [user(99)], excludePeers: [channel(44)]}
  const original = folder(12, 'WeChat', [chat(3), user(99)], settings)
  const bytes = Buffer.from(original.getBytes())
  const f = fixture({filters: [original]})
  placed(await f.service.addChat(-4), 'WeChat')
  const updated = f.named('WeChat')
  assert.notEqual(updated, original)
  assert.notEqual(updated.pinnedPeers, original.pinnedPeers)
  assert.notEqual(updated.excludePeers, original.excludePeers)
  assert.notEqual(updated.includePeers, original.includePeers)
  for (const [key, value] of Object.entries(settings)) {
    if (Array.isArray(value)) assert.deepEqual([...ids(updated[key])], [...ids(value)])
    else assert.equal(updated[key], value)
  }
  assert.deepEqual([...ids(updated.includePeers)], ['-3', '99', '-4'])
  assert.deepEqual(original.getBytes(), bytes)
})

test('explicit exclusion is an opt-out, never bypassed by overflow creation', async () => {
  const original = folder(2, 'WeChat', chats(100), {excludePeers: [channel(7)]})
  const f = fixture({filters: [original, folder(3, 'WeChat 2')]})
  skipped(await f.service.addChat(Number(utils.getPeerId(channel(7)))), 'excluded')
  assert.equal(f.updates.length, 0)
  assert.equal(f.state.filters.length, 2)
  assert.deepEqual([...ids(original.excludePeers)], ['-1007'])
})

test('startup leaves existing ordinary primary untouched without resolving or pinning bot', async () => {
  const original = folder(8, 'WeChat', [chat(1)], {excludePeers: [user(9)], excludeRead: true})
  const f = fixture({filters: [original]})
  f.failures.peer = [new Error('must not resolve')]
  placed(await f.service.ensurePrimaryFolder(9), 'WeChat', 'already-present')
  assert.deepEqual(f.calls, ['filters'])
  assert.equal(f.named('WeChat'), original)
})

test('startup creates pinned+included bot, reserves shared primary title and is restart-idempotent', async () => {
  for (const filters of [[], [shared(2, 'WeChat')]]) {
    const f = fixture({filters})
    const title = filters.length ? 'WeChat 2' : 'WeChat'
    placed(await f.service.ensurePrimaryFolder(9000), title)
    assert.deepEqual([...ids(f.named(title).includePeers)], ['9000'])
    assert.deepEqual([...ids(f.named(title).pinnedPeers)], ['9000'])
    const restarted = fixture({state: f.state})
    placed(await restarted.service.ensurePrimaryFolder(9000), title, 'already-present')
    assert.equal(restarted.updates.length, 0)
  }
})

test('startup respects an unpinned bot in the existing numbered primary beside a shared WeChat folder', async () => {
  const original = folder(3, 'WeChat 2', [user(9000)])
  const f = fixture({filters: [shared(2, 'WeChat'), original]})
  placed(await f.service.ensurePrimaryFolder(9000), 'WeChat 2', 'already-present')
  assert.equal(f.updates.length, 0)
  assert.equal(f.state.filters.length, 2)
  assert.equal(f.named('WeChat 2'), original)
  assert.equal(original.pinnedPeers.length, 0)
})

test('concurrent wrapper callers and startup share one queue, avoiding lost peers and duplicate folders', async () => {
  const f = fixture({config: {dialog_filters_chats_limit_default: 3}})
  const wrapper = () => ({service: Service.forClient(f.client)})
  const a = wrapper(), b = wrapper()
  assert.equal(a.service, b.service)
  const results = await Promise.all([
    a.service.ensurePrimaryFolder(9000), b.service.ensurePrimaryFolder(9000),
    ...Array.from({length: 11}, (_, i) => (i % 2 ? a : b).service.addChat(-(i + 1))),
    a.service.addChat(-11),
  ])
  assert.ok(results.every(result => result.status !== 'skipped'))
  assert.equal(results[1].status, 'already-present')
  assert.equal(results.at(-1).status, 'already-present')
  const custom = f.state.filters.filter(item => item instanceof Api.DialogFilter)
  assert.equal(custom.length, 4)
  assert.equal(new Set(custom.map(item => item.id)).size, 4)
  assert.equal(new Set(custom.map(item => item.title)).size, 4)
  assert.equal(ids(custom.flatMap(item => [...item.includePeers, ...item.pinnedPeers])).size, 12)
  assert.ok(custom.every(item => count(item) === 3))
  assert.equal(f.calls.filter(call => call === 'filters').length, results.length)
})

test('folder/peer/update failures resolve unavailable, never leak rejection and queue recovers', async () => {
  const leaked = []
  const listener = reason => leaked.push(reason)
  process.on('unhandledRejection', listener)
  try {
    for (const operation of ['addChat', 'ensurePrimaryFolder']) {
      for (const stage of ['filters', 'peer', 'update']) {
        const f = fixture()
        f.failures[stage] = [new Error('unavailable')]
        const results = await Promise.all([f.service[operation](stage === 'peer' ? 9 : -1), f.service[operation](9)])
        skipped(results[0], 'unavailable')
        placed(results[1], 'WeChat')
      }
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(leaked, [])
  } finally {
    process.removeListener('unhandledRejection', listener)
  }
})

test('ambiguous/flood/false updates stop immediately without trying overflow or new folders', async () => {
  for (const error of [rpcError('FLOOD_WAIT_30'), new Error('timeout'), rpcError('DIALOG_FILTER_INVALID')]) {
    const original = folder(2, 'WeChat')
    const f = fixture({filters: [original, folder(3, 'WeChat 2')]})
    f.failures.update = [error]
    skipped(await f.service.addChat(-1), 'unavailable')
    assert.equal(f.updates.length, 1)
    assert.equal(original.includePeers.length, 0)
    assert.equal(f.state.filters.length, 2)
    placed(await f.service.addChat(-2), 'WeChat')
  }
  const f = fixture()
  f.returnFalse = true
  skipped(await f.service.addChat(-1), 'unavailable')
  assert.equal(f.updates.length, 1)
  const impossible = fixture({serverChats: 0})
  skipped(await impossible.service.addChat(-1), 'unavailable')
  assert.equal(impossible.updates.length, 1, 'do not repeatedly create single-peer folders')
})