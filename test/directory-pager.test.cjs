/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {HTMLParser} = require('telegram/extensions/html')

// Load actual source without application/config/database side effects or stale dist.
function load(file) {
  const filename = path.join(__dirname, '../src/util', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021},
    fileName: filename,
  }).outputText
  const exports = {}
  vm.runInNewContext(output, {exports, require(name) {
    assert.equal(name, 'node:crypto', 'No application dependencies allowed')
    return require(name)
  }}, {filename})
  return exports
}
const {DirectoryPager, backButton} = load('DirectoryPager.ts')
const {answerDirectoryCallback, deliverDirectoryPage, replyDirectoryText} = load('DirectoryPageDelivery.ts')
const scope = {chatId: -100, userId: 7, threadId: 42, accountId: 'wechat-a'}
const translations = {
  'pagination.title_us': 'Contacts', 'pagination.title_of': 'Official accounts',
  'pagination.title_ro': 'Rooms', 'pagination.page': 'Page {{page}} / {{pages}}',
  'pagination.total': 'Total {{count}}', 'pagination.search': 'Search:',
  'pagination.previous': 'Previous', 'pagination.next': 'Next', 'pagination.home': 'Home',
  'pagination.back': 'Back', 'pagination.clear_search': 'Full list',
}
const translate = (key, values = {}) => {
  assert.ok(Object.hasOwn(translations, key), `Unknown locale key ${key}`)
  return translations[key].replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))
}
const items = count => Array.from({length: count}, (_, i) => ({remark: `Name ${i + 1}`, action: `id-${i + 1}`}))
const render = (pager, overrides = {}) => pager.render({
  scope, kind: 'us', query: '', page: 1, items: items(75), prompt: 'Select a contact', emptyText: 'No matches', ...overrides,
}, translate)
const buttons = view => view.reply_markup.inline_keyboard.flat()
const button = (view, text) => buttons(view).find(value => value.text === text)
const selection = (view, index = 0) => buttons(view).find(value => value.callback_data.endsWith(`:s:${index}`)).callback_data
const plain = value => JSON.parse(JSON.stringify(value))
const apiError = (description, error_code = 400) => ({response: {error_code, description}})
const parseError = () => apiError('Bad Request: can\'t parse entities: Unsupported start tag')
const missingError = () => apiError('Bad Request: message to edit not found')
function context(outcomes = [], extra = {}) {
  const calls = []
  const invoke = method => async (text, options) => {
    calls.push({method, text, options})
    const result = outcomes.shift()
    if (result) throw result
    return {message_id: 99}
  }
  return {calls, reply: invoke('reply'), editMessageText: invoke('edit'), answerCbQuery: invoke('ack'), ...extra}
}

test('real rich-text body escapes search, labels and metadata; buttons remain ordinary text', () => {
  const pager = new DirectoryPager()
  const query = '<b>&"\'🎉</b>' + '😀'.repeat(210)
  const view = render(pager, {
    query, items: [{remark: 'Alice 😀 & <Bob>', action: 'secret-id'}], notice: '<notice>', prompt: 'Choose & go',
  })
  assert.equal(view.state.query, query, 'Full query is retained for data reload')
  assert.match(view.html, /<b>Contacts<\/b>/)
  assert.match(view.html, /Search: <code>&lt;b&gt;&amp;&quot;&#39;🎉&lt;\/b&gt;/)
  assert.match(view.html, /Alice 😀 &amp; &lt;Bob&gt;/)
  assert.match(view.html, /&lt;notice&gt;/)
  assert.match(view.html, /Choose &amp; go/)
  assert.match(view.plain, /Alice 😀 & <Bob>/)
  const displayQuery = view.plain.split('\n').find(line => line.startsWith('Search: ')).slice(8)
  assert.equal(Array.from(displayQuery).length, 200)
  assert.ok(displayQuery.endsWith('…'))
  assert.equal(buttons(view)[0].text, 'Alice 😀 & <Bob>')
  for (const value of buttons(view)) assert.deepEqual(Object.keys(value).sort(), ['callback_data', 'text'])
  assert.ok(!view.html.includes('tg-emoji'))
  assert.ok(!view.html.includes('secret-id'))
})

test('plain names and all directory kinds use translated titles', () => {
  const pager = new DirectoryPager()
  for (const kind of ['us', 'of', 'ro']) {
    const view = render(pager, {kind, items: [{remark: 'Plain name', action: 'x'}]})
    assert.equal(view.plain.split('\n')[0], translations[`pagination.title_${kind}`])
    assert.match(view.html, /<b>1\.<\/b> Plain name/)
  }
})

test('blank display names fall back to their exact ID without added decoration', () => {
  const pager = new DirectoryPager()
  const view = render(pager, {items: [{remark: '', action: 'wxid_without_name'}]})
  assert.equal(buttons(view)[0].text, 'wxid_without_name')
  assert.equal(pager.resolve(scope, selection(view)).item.action, 'wxid_without_name')
})

test('long names truncate safely, full IDs never enter bounded ASCII callbacks', () => {
  const pager = new DirectoryPager()
  const action = '群@'.repeat(10000)
  const view = render(pager, {query: 'q', page: 2, items: items(75).map(item => ({...item, remark: '😀'.repeat(1000), action}))})
  for (const value of [...buttons(view), pager.backButton(view.state.token, translate)]) {
    assert.ok(Buffer.byteLength(value.callback_data) <= 64)
    assert.match(value.callback_data, /^dl:[A-Za-z0-9_-]+:(?:[bha]|[ps]:\d+)$/)
    assert.ok(!value.callback_data.includes(action))
  }
  assert.equal(Array.from(buttons(view)[0].text).length, 48)
  assert.ok(buttons(view)[0].text.endsWith('…'))
  assert.equal(pager.resolve(scope, selection(view)).item.action, action)
  assert.ok(Array.from(view.plain.split('\n').find(line => line.startsWith('31. ')).slice(4)).length <= 140)
  assert.ok(view.plain.length <= 4096)
})

test('thirty rich rows fit the Telegram limit even with huge Unicode names and metadata', () => {
  const pager = new DirectoryPager()
  const rows = items(61).map(item => ({...item, remark: '😀<&>"'.repeat(1000)}))
  const query = '😀<query>&'.repeat(1000)
  const view = render(pager, {items: rows, query, notice: '😀'.repeat(1000), prompt: '😀'.repeat(1000)})
  assert.equal(view.state.items.length, 30)
  assert.equal(view.pageCount, 3)
  assert.equal(view.state.query, query)
  assert.equal(view.state.items[29].action, 'id-30')
  assert.equal(buttons(view).filter(b => /:s:/.test(b.callback_data)).length, 30)
  assert.ok(view.plain.length <= 4096)
  const [text] = HTMLParser.parse(view.html)
  assert.equal(text, view.plain)
  assert.ok(text.length <= 4096)
  assert.ok(!view.html.includes('<query>'))
})

test('search >30 hits navigates previous/next/home/full-list and back preserves query/page', () => {
  const pager = new DirectoryPager()
  const first = render(pager, {query: 'Alice'})
  assert.equal(first.total, 75)
  assert.equal(first.pageCount, 3)
  assert.equal(first.state.items.length, 30)
  assert.equal(first.reply_markup.inline_keyboard[0].length, 2)
  assert.ok(first.reply_markup.inline_keyboard.every(row => row.length <= 2))
  assert.equal(button(first, 'Previous'), undefined)
  assert.equal(button(first, 'Home'), undefined)
  const next = pager.resolve(scope, button(first, 'Next').callback_data)
  assert.equal(next.type, 'page')
  assert.equal(next.page, 2)
  const second = render(pager, {query: next.state.query, page: next.page})
  assert.match(second.plain, /Page 2 \/ 3/)
  assert.match(second.plain, /Total 75/)
  assert.equal(second.state.items[0].action, 'id-31')
  assert.equal(pager.resolve(scope, button(second, 'Previous').callback_data).page, 1)
  for (const [label, type] of [['Home', 'home'], ['Full list', 'all']]) {
    const resolved = pager.resolve(scope, button(second, label).callback_data)
    assert.equal(resolved.type, type)
    assert.equal(resolved.state.query, 'Alice')
  }
  const back = pager.resolve(scope, backButton(second.state.token, translate).callback_data)
  assert.equal(back.type, 'back')
  assert.equal(back.state, second.state)
  const restored = render(pager, {query: back.state.query, page: back.state.page})
  assert.equal(restored.state.query, 'Alice')
  assert.equal(restored.state.page, 2)
  assert.notEqual(restored.state.token, second.state.token)
  const last = render(pager, {page: 3})
  assert.equal(last.state.items.length, 15)
  assert.equal(button(last, 'Next'), undefined)
  assert.equal(button(last, 'Full list'), undefined)
})

test('strict finite one-based clamping, shrink and empty results are safe', () => {
  const pager = new DirectoryPager()
  for (const page of [NaN, Infinity, -Infinity, -2, 0, '2', undefined]) {
    assert.equal(render(pager, {page}).state.page, 1)
  }
  assert.equal(render(pager, {page: 2.9}).state.page, 2)
  assert.equal(render(pager, {page: 999}).state.page, 3)
  assert.equal(render(pager, {page: 3, items: items(31)}).state.page, 2)
  const empty = render(pager, {page: 9, items: [], query: 'missing'})
  assert.equal(empty.state.page, 1)
  assert.equal(empty.pageCount, 1)
  assert.equal(empty.total, 0)
  assert.equal(empty.state.items.length, 0)
  assert.match(empty.html, /No matches/)
  assert.deepEqual(plain(buttons(empty).map(value => value.text)), ['Full list'])
})

test('immutable snapshots keep original IDs after mutation, reordering and other renders', () => {
  const pager = new DirectoryPager({token: () => 'fixed'})
  const originalScope = {...scope}
  const source = items(75)
  const first = render(pager, {scope: originalScope, query: 'q', items: source})
  const callback = selection(first)
  source[0].action = 'mutated'
  originalScope.accountId = 'mutated'
  const second = render(pager, {items: source.reverse(), page: 2})
  assert.notEqual(first.state.token, second.state.token)
  assert.equal(pager.resolve(scope, callback).item.action, 'id-1')
  assert.equal(pager.resolve(scope, callback).state.query, 'q')
  assert.ok(Object.isFrozen(first.state))
  assert.ok(Object.isFrozen(first.state.scope))
  assert.ok(Object.isFrozen(first.state.items))
  assert.ok(Object.isFrozen(first.state.items[0]))
  assert.equal(Reflect.set(first.state.items[0], 'action', 'new-id'), false)
  assert.equal(first.state.items.length, 30)
})

test('scope isolation includes chat, user, thread and account, including absent values', () => {
  const pager = new DirectoryPager()
  const view = render(pager)
  const callback = selection(view)
  assert.equal(pager.resolve({...scope}, callback).type, 'select')
  for (const key of ['chatId', 'userId', 'threadId', 'accountId']) {
    assert.equal(pager.resolve({...scope, [key]: key === 'accountId' ? 'other' : 999}, callback), undefined)
    const absent = {...scope}
    delete absent[key]
    assert.equal(pager.resolve(absent, callback), undefined)
  }
})

test('TTL is fixed rather than sliding and bounded cache evicts oldest view', () => {
  let now = 100
  const pager = new DirectoryPager({ttlMs: 20, maxStates: 2, now: () => now, token: () => 'fixed'})
  const first = render(pager)
  const second = render(pager)
  now = 119
  assert.ok(pager.resolve(scope, selection(first)))
  const third = render(pager)
  assert.equal(pager.resolve(scope, selection(first)), undefined)
  assert.ok(pager.resolve(scope, selection(second)))
  now = 120
  assert.equal(pager.resolve(scope, selection(second)), undefined)
  assert.ok(pager.resolve(scope, selection(third)))
  now = 139
  assert.equal(pager.resolve(scope, selection(third)), undefined)
  assert.notEqual(render(pager).state.token, first.state.token)
})

test('defaults expire after thirty minutes and retain only 512 states', () => {
  let now = 0
  const pager = new DirectoryPager({now: () => now})
  const first = render(pager)
  for (let i = 0; i < 511; i++) render(pager)
  assert.ok(pager.resolve(scope, selection(first)))
  const newest = render(pager)
  assert.equal(pager.resolve(scope, selection(first)), undefined)
  now = 30 * 60 * 1000
  assert.equal(pager.resolve(scope, selection(newest)), undefined)
})

test('invalid callbacks, indices, tokens and malformed page numbers fail closed', () => {
  const pager = new DirectoryPager()
  const view = render(pager)
  const prefix = `dl:${view.state.token}:`
  for (const suffix of ['p:0', 'p:-1', 'p:1.5', 'p:01', 'p:NaN', 'p:Infinity', 'p:1e2', 'p:9007199254740992', 's:30', 's:-1', 's:01', 'b:1', 'x', 's:0:more', 's:0\n']) {
    assert.equal(pager.resolve(scope, prefix + suffix), undefined, suffix)
  }
  for (const callback of ['', null, undefined, 'old:contact', 'dl:unknown:s:0', 'dl:💥:b', 'x'.repeat(100)]) {
    assert.equal(pager.resolve(scope, callback), undefined)
  }
  assert.throws(() => backButton('bad:token', translate))
  assert.throws(() => new DirectoryPager({maxStates: Infinity}))
  assert.throws(() => new DirectoryPager({ttlMs: 0}))
})

test('fresh page sends HTML with its keyboard and saved topic; edit omits topic option', async () => {
  const view = render(new DirectoryPager())
  const ctx = context()
  assert.equal(await deliverDirectoryPage(ctx, view), 'sent')
  assert.equal(await deliverDirectoryPage(ctx, view, true), 'edited')
  assert.equal(ctx.calls[0].text, view.html)
  assert.equal(ctx.calls[0].options.parse_mode, 'HTML')
  assert.equal(ctx.calls[0].options.reply_markup, view.reply_markup)
  assert.equal(ctx.calls[0].options.message_thread_id, 42)
  assert.equal(Object.hasOwn(ctx.calls[1].options, 'message_thread_id'), false)
})

test('explicit message-not-modified is success with no new reply', async () => {
  const ctx = context([apiError('Bad Request: message is not modified')])
  assert.equal(await deliverDirectoryPage(ctx, render(new DirectoryPager()), true), 'unchanged')
  assert.deepEqual(ctx.calls.map(call => call.method), ['edit'])
})

test('expired callback acknowledgements are consumed', async () => {
  const ctx = context([apiError('Bad Request: query is too old and response timeout expired or query ID is invalid')])
  assert.equal(await answerDirectoryCallback(ctx, 'Expired'), undefined)
  assert.equal(ctx.calls[0].text, 'Expired')
})

for (const editing of [false, true]) {
  test(`HTML entity failure retries plain with identical keyboard (${editing ? 'edit' : 'send'})`, async () => {
    const view = render(new DirectoryPager(), {query: '<name>'})
    const ctx = context([parseError()])
    assert.equal(await deliverDirectoryPage(ctx, view, editing), editing ? 'edited' : 'sent')
    assert.equal(ctx.calls.length, 2)
    assert.equal(ctx.calls[1].text, view.plain)
    assert.equal(Object.hasOwn(ctx.calls[1].options, 'parse_mode'), false)
    assert.equal(ctx.calls[1].options.reply_markup, view.reply_markup)
    assert.equal(ctx.calls[0].method, ctx.calls[1].method)
    if (!editing) assert.equal(ctx.calls[1].options.message_thread_id, 42)
  })
}

test('missing edit sends new HTML page then plain at most once, retaining saved topic', async () => {
  const view = render(new DirectoryPager())
  const ctx = context([missingError(), parseError()], {callbackQuery: {message: {message_thread_id: 999}}})
  assert.equal(await deliverDirectoryPage(ctx, view, true), 'sent')
  assert.deepEqual(ctx.calls.map(call => call.method), ['edit', 'reply', 'reply'])
  assert.equal(ctx.calls[1].text, view.html)
  assert.equal(ctx.calls[2].text, view.plain)
  for (const call of ctx.calls.slice(1)) {
    assert.equal(call.options.message_thread_id, 42)
    assert.equal(call.options.reply_markup, view.reply_markup)
  }
})

test('cannot-edit errors send a new page; HTML rejected before missing edit remains plain', async () => {
  const view = render(new DirectoryPager())
  for (const description of ['message can\'t be edited', 'message cannot be edited', 'message can not be edited', 'message was deleted']) {
    const ctx = context([apiError(`Bad Request: ${description}`)])
    assert.equal(await deliverDirectoryPage(ctx, view, true), 'sent')
    assert.deepEqual(ctx.calls.map(call => call.method), ['edit', 'reply'])
  }
  const ctx = context([parseError(), missingError()])
  assert.equal(await deliverDirectoryPage(ctx, view, true), 'sent')
  assert.equal(ctx.calls.length, 3)
  assert.equal(ctx.calls[2].text, view.plain)
})

test('fallback-send failures are consumed, including the third and final attempt', async () => {
  const view = render(new DirectoryPager())
  for (const outcomes of [
    [missingError(), new Error('ETIMEDOUT')],
    [missingError(), parseError(), new Error('network')],
    [parseError(), parseError()],
    [missingError(), parseError(), parseError()],
  ]) {
    const count = outcomes.length
    const ctx = context(outcomes)
    assert.equal(await deliverDirectoryPage(ctx, view, true), 'failed')
    assert.equal(ctx.calls.length, count)
    assert.ok(ctx.calls.length <= 3)
  }
})

test('ambiguous network/unknown errors, 5xx, 429 and 403 never duplicate a message', async () => {
  const failures = [
    new Error('ETIMEDOUT'), new Error('400: message to edit not found'),
    new Error('400: can\'t parse entities'), {}, null,
    apiError('message to edit not found', 500), apiError('can\'t parse entities', 502),
    apiError('Too Many Requests', 429), apiError('Forbidden', 403), apiError('unknown error'),
    {response: {error_code: '400', description: 'message to edit not found'}},
  ]
  for (const error of failures) {
    for (const editing of [false, true]) {
      const calls = []
      const fail = async () => {calls.push(1); throw error}
      const ctx = {reply: fail, editMessageText: fail}
      assert.equal(await deliverDirectoryPage(ctx, render(new DirectoryPager()), editing), 'failed')
      assert.equal(calls.length, 1)
    }
  }
})

test('plain result/error replies retain callback or message topic, omit General 1, and consume errors', async () => {
  const markup = {inline_keyboard: [[backButton('token', translate)]]}
  for (const extra of [{callbackQuery: {message: {message_thread_id: 42}}}, {message: {message_thread_id: 42}}]) {
    const ctx = context([], extra)
    assert.equal(await replyDirectoryText(ctx, '<plain & text>', markup), true)
    assert.equal(ctx.calls[0].text, '<plain & text>')
    assert.deepEqual(plain(ctx.calls[0].options), plain({message_thread_id: 42, reply_markup: markup}))
  }
  for (const threadId of [undefined, 1, 0, NaN]) {
    const ctx = context([], {message: {message_thread_id: threadId}})
    assert.equal(await replyDirectoryText(ctx, 'plain'), true)
    assert.deepEqual(plain(ctx.calls[0].options), {})
    const view = render(new DirectoryPager(), {scope: {...scope, threadId}})
    assert.equal(await deliverDirectoryPage(ctx, view), 'sent')
    assert.equal(Object.hasOwn(ctx.calls[1].options, 'message_thread_id'), false)
  }
  const ctx = context([new Error('network')])
  assert.equal(await replyDirectoryText(ctx, 'error', markup), false)
  assert.equal(ctx.calls.length, 1)
})