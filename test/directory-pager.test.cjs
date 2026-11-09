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
  vm.runInNewContext(output, {exports, URL, require(name) {
    if (name === './AvatarURL') return load('AvatarURL.ts')
    assert.equal(name, 'node:crypto', 'No application dependencies allowed beyond the pure avatar URL validator')
    return require(name)
  }}, {filename})
  return exports
}
const {DirectoryPager, backButton} = load('DirectoryPager.ts')
const {answerDirectoryCallback, deliverDirectoryPage, replyDirectoryText, isRichDirectoryMessage} = load('DirectoryPageDelivery.ts')
const scope = {chatId: -100, userId: 7, threadId: 42, accountId: 'wechat-a'}
const translations = {
  'pagination.title_us': 'Contacts', 'pagination.title_of': 'Official accounts',
  'pagination.title_ro': 'Rooms', 'pagination.title_gm': 'Members', 'pagination.page': 'Page {{page}} / {{pages}}',
  'pagination.total': 'Total {{count}}', 'pagination.search': 'Search:',
  'pagination.previous': 'Previous', 'pagination.next': 'Next', 'pagination.home': 'Home',
  'pagination.back': 'Back', 'pagination.clear_search': 'Full list', 'pagination.compatibility': 'Compatibility mode',
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
const richNodes = value => {
  if (!value || typeof value !== 'object') return []
  return [...(value.type ? [value] : []), ...Object.values(value).flatMap(richNodes)]
}
const richButtons = view => richNodes(view.rich_message).filter(node => node.type === 'button').map(node => node.button)
const richButton = (view, label) => richButtons(view).find(value => value.text === label)
const richText = value => typeof value === 'string' ? value
  : Array.isArray(value) ? value.map(richText).join('')
    : value.type === 'button' ? value.button.text : richText(value.text)
const apiError = (description, error_code = 400) => ({response: {error_code, description}})
const parseError = () => apiError('Bad Request: can\'t parse entities: Unsupported start tag')
const missingError = () => apiError('Bad Request: message to edit not found')
const unavailableError = () => apiError('Not Found', 404)
const unsupportedError = () => apiError('Bad Request: rich_message is not supported')
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

function nativeContext(outcomes = [], extra = {}) {
  const ctx = context([], {
    chat: {id: scope.chatId},
    callbackQuery: {message: {message_id: 71, chat: {id: scope.chatId}, message_thread_id: 999, rich_message: {blocks: []}}},
    ...extra,
  })
  ctx.telegram = {async callApi(method, payload) {
    assert.equal(this, ctx.telegram, 'Raw API retains its receiver')
    ctx.calls.push({method, payload})
    if (outcomes.length) {
      const error = outcomes.shift()
      if (error !== undefined) throw error
    }
    return {message_id: 100, rich_message: payload.rich_message}
  }}
  return ctx
}

test('member avatar galleries use only safe visible-page CDN images and scoped selection buttons', () => {
  const pager = new DirectoryPager()
  const members = items(65).map((item,index)=>({...item,avatarUrl:`https://wx.qlogo.cn/avatar/${index}`}))
  const view = render(pager,{kind:'gm',page:2,items:members})
  const photos = richNodes(view.rich_message).filter(node=>node.type === 'photo' && node.photo)
  assert.equal(photos.length,30)
  assert.equal(photos[0].photo.media,members[30].avatarUrl)
  assert.equal(photos[29].photo.media,members[59].avatarUrl)
  for(const photo of photos) {
    const result = pager.resolve(scope,photo.caption.text.button.callback_data)
    assert.equal(result.type,'select')
    assert.equal(result.item.avatarUrl,photo.photo.media)
  }
  assert(!view.html.includes('qlogo.cn'))
  assert(!view.plain.includes('qlogo.cn'))
  for(const avatarUrl of ['http://127.0.0.1/a','https://qlogo.cn.evil.test/a','https://user:secret@qlogo.cn/a','file:///etc/passwd','https://qlogo.cn:8080/a','javascript:alert(1)']) {
    const unsafe = render(pager,{kind:'gm',items:[{remark:'Name',action:'id',avatarUrl}]})
    assert.equal(richNodes(unsafe.rich_message).filter(n=>n.type === 'photo').length,0)
    assert(!unsafe.state.items[0].avatarUrl)
  }
  assert.equal(richNodes(render(pager,{items:members}).rich_message).filter(n=>n.type === 'photo').length,0,'other directories retain text-only layout')
})

test('explicit avatar fetch rejection falls back to a usable text directory without network-error retries', async () => {
  const view = render(new DirectoryPager(),{kind:'gm',items:[{remark:'Member',action:'member',avatarUrl:'https://wx.qlogo.cn/avatar'}]})
  const ctx = nativeContext([apiError('Bad Request: failed to get HTTP URL content')])
  assert.equal(await deliverDirectoryPage(ctx,view),'sent')
  assert.deepEqual(ctx.calls.map(call=>call.method),['sendRichMessage','sendMessage'])
  assert.deepEqual(ctx.calls[1].payload.reply_markup,view.reply_markup)
  const uncertain = nativeContext([new Error('ECONNRESET')])
  assert.equal(await deliverDirectoryPage(uncertain,view),'failed')
  assert.equal(uncertain.calls.length,1)
})

test('native JSON preserves literal malicious names/query; compatibility body has metadata only', () => {
  const pager = new DirectoryPager()
  const query = '<b>&"\'🎉</b>' + '😀'.repeat(210)
  const view = render(pager, {
    query, items: [{remark: 'Alice 😀 & <Bob>', action: 'secret-id'}], notice: '<notice>', prompt: 'Choose & go',
  })
  assert.equal(view.state.query, query, 'Full query is retained for data reload')
  assert.match(view.html, /<b>Contacts<\/b>/)
  assert.match(view.html, /Search: <code>&lt;b&gt;&amp;&quot;&#39;🎉&lt;\/b&gt;/)
  assert.ok(!view.html.includes('Alice'))
  assert.equal(richButtons(view)[0].text, 'Alice 😀 & <Bob>')
  const queryNode = richNodes(view.rich_message).find(node => node.type === 'code')
  assert.equal(queryNode.text, Array.from(query).slice(0, 199).join('') + '…')
  assert.equal(view.rich_message.skip_entity_detection, true)
  assert.deepEqual(plain(view.rich_message.blocks[0]), {type: 'paragraph', text: {type: 'bold', text: 'Contacts'}})
  assert.equal(richNodes(view.rich_message).filter(node => node.type === 'url').length, 0)
  assert.match(view.html, /&lt;notice&gt;/)
  assert.match(view.html, /Choose &amp; go/)
  assert.ok(!view.plain.includes('Alice'))
  assert.equal(JSON.stringify(view.rich_message).split('Alice').length - 1, 1)
  assert.equal(JSON.stringify(view.rich_message).includes('secret-id'), false)
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
    assert.ok(!view.html.includes('Plain name'))
    assert.ok(!view.plain.includes('Plain name'))
    assert.equal(richButtons(view)[0].text, 'Plain name')
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
  for (const value of [...buttons(view), ...richButtons(view), ...view.rich_reply_markup.inline_keyboard.flat(), pager.backButton(view.state.token, translate)]) {
    assert.ok(Buffer.byteLength(value.callback_data) <= 64)
    assert.match(value.callback_data, /^dl:[A-Za-z0-9_-]+:(?:[bhac]|[ps]:\d+)$/)
    assert.ok(!value.callback_data.includes(action))
  }
  assert.equal(Array.from(buttons(view)[0].text).length, 48)
  assert.ok(buttons(view)[0].text.endsWith('…'))
  assert.equal(pager.resolve(scope, selection(view)).item.action, action)
  assert.ok(Array.from(richButtons(view)[0].text).length <= 140)
  assert.ok(!view.plain.includes('31. '))
  assert.ok(view.plain.length <= 4096)
})

test('thirty native names in fifteen paragraphs and legacy metadata fit with huge Unicode labels', () => {
  const pager = new DirectoryPager()
  const rows = items(61).map(item => ({...item, remark: '😀<&>"'.repeat(1000)}))
  const query = '😀<query>&'.repeat(1000)
  const view = render(pager, {items: rows, query, notice: '😀'.repeat(1000), prompt: '😀'.repeat(1000)})
  assert.equal(view.state.items.length, 30)
  assert.equal(view.pageCount, 3)
  assert.equal(view.state.query, query)
  assert.equal(view.state.items[29].action, 'id-30')
  assert.equal(buttons(view).filter(b => /:s:/.test(b.callback_data)).length, 30)
  assert.equal(richButtons(view).filter(b => /:s:/.test(b.callback_data)).length, 30)
  const rowsWithNames = view.rich_message.blocks.filter(block => richNodes(block).some(node => node.type === 'button' && /:s:/.test(node.button.callback_data)))
  assert.equal(rowsWithNames.length, 15)
  assert.ok(rowsWithNames.every(row => richNodes(row).filter(node => node.type === 'button').length === 2))
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

test('unknown-only empty directories do not emit empty native text paragraphs', () => {
  const view = render(new DirectoryPager(), {items: [], notice: 'Classification pending', emptyText: ''})
  assert(view.rich_message.blocks.every(block => block.text !== ''))
  assert.equal(richButtons(view).length, 0)
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

test('native names and all pagination controls resolve the same scoped immutable identities', () => {
  const pager = new DirectoryPager()
  const view = render(pager, {page: 2, query: '<Alice> & /start @name https://x.test'})
  const callbacks = richButtons(view)
  assert.equal(callbacks.length, 34)
  assert.deepEqual(plain(callbacks.map(value => value.callback_data)), plain(buttons(view).map(value => value.callback_data)))
  for (let index = 0; index < 30; index++) {
    const selected = pager.resolve(scope, callbacks[index].callback_data)
    assert.equal(selected.type, 'select')
    assert.equal(selected.item.action, `id-${31 + index}`)
    assert.equal(callbacks[index].style, 'link')
  }
  for (const [label, type, page] of [['Previous', 'page', 1], ['Next', 'page', 3], ['Home', 'home'], ['Full list', 'all']]) {
    const resolved = pager.resolve(scope, richButton(view, label).callback_data)
    assert.equal(resolved.type, type)
    assert.equal(resolved.page, page)
    assert.equal(resolved.state, view.state)
  }
  const escapeHatch = view.rich_reply_markup.inline_keyboard.flat()
  assert.equal(escapeHatch.length, 1)
  assert.equal(escapeHatch[0].text, 'Compatibility mode')
  const compat = pager.resolve(scope, escapeHatch[0].callback_data)
  assert.equal(compat.type, 'compat')
  assert.equal(compat.state, view.state)
  assert.equal(pager.resolve({...scope, userId: 8}, escapeHatch[0].callback_data), undefined)
  assert.equal(richNodes(view.rich_message).find(node => node.type === 'code').text, view.state.query)
  const body = view.rich_message.blocks.map(block => richText(block.text)).join('\n')
  for (const item of view.state.items) assert.equal(body.split(item.remark).length - 1, 1)
  assert.ok(!view.html.includes('Name '))
  assert.ok(!view.plain.includes('Name '))
  assert.ok(view.rich_message.blocks.every(block => block.type === 'paragraph'))
})

test('rich-message detection prioritizes callback message, without guessing from text or client', () => {
  assert.equal(isRichDirectoryMessage(nativeContext()), true)
  assert.equal(isRichDirectoryMessage(context([], {message: {rich_message: {blocks: []}}})), true)
  assert.equal(isRichDirectoryMessage(context([], {message: {text: 'rich_message'}})), false)
  assert.equal(isRichDirectoryMessage(context([], {message: {rich_message: {}}, callbackQuery: {message: {text: 'old'}}})), false)
  assert.equal(isRichDirectoryMessage(context([], {message: {rich_message: {}}, callbackQuery: {}})), false)
  assert.equal(isRichDirectoryMessage(context([], {message: {rich_message: null}})), false)
})

test('new pages send native blocks only; rich edits omit text, parse mode and topic', async () => {
  const view = render(new DirectoryPager())
  const ctx = nativeContext()
  assert.equal(await deliverDirectoryPage(ctx, view), 'sent')
  assert.equal(ctx.calls.length, 1)
  assert.deepEqual(plain(ctx.calls[0]), {method: 'sendRichMessage', payload: plain({
    chat_id: scope.chatId, rich_message: view.rich_message, message_thread_id: 42, reply_markup: view.rich_reply_markup,
  })})
  assert.equal(await deliverDirectoryPage(ctx, view, true), 'edited')
  assert.equal(ctx.calls.length, 2)
  assert.deepEqual(plain(ctx.calls[1]), {method: 'editMessageText', payload: plain({
    chat_id: scope.chatId, message_id: 71, rich_message: view.rich_message, reply_markup: view.rich_reply_markup,
  })})
  const fromCommand = nativeContext([], {callbackQuery: undefined, message: {message_id: 72}})
  assert.equal(await deliverDirectoryPage(fromCommand, view, true), 'edited')
  assert.equal(fromCommand.calls[0].payload.message_id, 72)
})

test('raw page delivery fails closed for mismatched chat or missing edit ID', async () => {
  const view = render(new DirectoryPager())
  for (const extra of [
    {chat: {id: 123}},
    {callbackQuery: {message: {message_id: 4, chat: {id: 123}}}},
    {callbackQuery: {}},
    {callbackQuery: {message: {message_id: 0}}},
  ]) {
    const ctx = nativeContext([], extra)
    assert.equal(await deliverDirectoryPage(ctx, view, true), 'failed')
    assert.equal(ctx.calls.length, 0)
  }
  const legacy = context([], {chat: {id: 123}})
  assert.equal(await deliverDirectoryPage(legacy, view), 'failed')
  assert.equal(legacy.calls.length, 0)
})

test('explicit compatibility mode uses only HTML metadata and original name/navigation keyboard', async () => {
  const view = render(new DirectoryPager(), {page: 2, query: 'q'})
  for (const edit of [false, true]) {
    const ctx = nativeContext()
    assert.equal(await deliverDirectoryPage(ctx, view, edit, true), edit ? 'edited' : 'sent')
    assert.equal(ctx.calls.length, 1)
    const {method, payload} = ctx.calls[0]
    assert.equal(method, edit ? 'editMessageText' : 'sendMessage')
    assert.equal(payload.text, view.html)
    assert.equal(payload.reply_markup, view.reply_markup)
    assert.equal(payload.parse_mode, 'HTML')
    assert.equal(payload.chat_id, scope.chatId)
    assert.equal(payload.message_thread_id, edit ? undefined : 42)
    assert.equal(Object.hasOwn(payload, 'rich_message'), false)
    assert.ok(!payload.text.includes('Name '))
  }
})

for (const edit of [false, true]) {
  test(`explicit rich rejection falls back with original callbacks (${edit ? 'edit' : 'send'})`, async () => {
    for (const error of [
      unavailableError(), unsupportedError(), parseError(),
      apiError('Unknown method sendRichMessage', 404),
      apiError('Bad Request: can\'t parse rich_message JSON object'),
      apiError('Bad Request: invalid rich text block'),
      apiError('Bad Request: message text is empty'),
    ]) {
      const view = render(new DirectoryPager(), {page: 2, query: 'q'})
      const ctx = nativeContext([error])
      assert.equal(await deliverDirectoryPage(ctx, view, edit), edit ? 'edited' : 'sent')
      assert.equal(ctx.calls.length, 2)
      assert.equal(ctx.calls[1].method, edit ? 'editMessageText' : 'sendMessage')
      assert.equal(ctx.calls[1].payload.text, view.html)
      assert.equal(ctx.calls[1].payload.reply_markup, view.reply_markup)
      assert.equal(Object.hasOwn(ctx.calls[1].payload, 'rich_message'), false)
      assert.deepEqual(plain(richButtons(view).map(b => b.callback_data)), plain(buttons(view).map(b => b.callback_data)))
    }
  })
}

test('deleted rich edits send a NEW native page before considering compatibility', async () => {
  const view = render(new DirectoryPager())
  for (const description of ['message to edit not found', 'message can\'t be edited', 'message cannot be edited', 'message can not be edited', 'message was deleted']) {
    const ctx = nativeContext([apiError(`Bad Request: ${description}`)])
    assert.equal(await deliverDirectoryPage(ctx, view, true), 'sent')
    assert.deepEqual(ctx.calls.map(c => c.method), ['editMessageText', 'sendRichMessage'])
    assert.equal(ctx.calls[1].payload.rich_message, view.rich_message)
    assert.equal(ctx.calls[1].payload.message_thread_id, scope.threadId)
    assert.equal(ctx.calls[1].payload.chat_id, scope.chatId)
  }
})

test('native message-not-modified returns unchanged with no fallback', async () => {
  const ctx = nativeContext([apiError('Bad Request: message is not modified')])
  assert.equal(await deliverDirectoryPage(ctx, render(new DirectoryPager()), true), 'unchanged')
  assert.equal(ctx.calls.length, 1)
})

test('native/HTML failures end in plain with at most four attempts and no scope drift', async () => {
  const view = render(new DirectoryPager())
  for (const errors of [
    [missingError(), unsupportedError(), parseError()],
    [unsupportedError(), missingError(), parseError()],
    [unsupportedError(), parseError(), missingError()],
  ]) {
    const ctx = nativeContext(errors)
    assert.equal(await deliverDirectoryPage(ctx, view, true), 'sent')
    assert.equal(ctx.calls.length, 4)
    const last = ctx.calls[3]
    assert.equal(last.method, 'sendMessage')
    assert.equal(last.payload.text, view.plain)
    assert.equal(Object.hasOwn(last.payload, 'parse_mode'), false)
    assert.equal(last.payload.reply_markup, view.reply_markup)
    assert.equal(last.payload.chat_id, scope.chatId)
    assert.equal(last.payload.message_thread_id, 42)
  }
  const failed = nativeContext([missingError(), unsupportedError(), parseError(), parseError()])
  assert.equal(await deliverDirectoryPage(failed, view, true), 'failed')
  assert.equal(failed.calls.length, 4)
  const htmlFailure = nativeContext([unsupportedError(), apiError('unknown error')])
  assert.equal(await deliverDirectoryPage(htmlFailure, view), 'failed')
  assert.equal(htmlFailure.calls.length, 2)
})

test('native and compatibility attempts never retry uncertain or unrelated failures', async () => {
  const errors = [
    new Error('ETIMEDOUT'), new Error('404 Not Found'), {}, null,
    apiError('rich_message not supported', 500), apiError('message to edit not found', 502),
    apiError('Too Many Requests', 429), apiError('Forbidden: rich_message not supported', 403),
    apiError('Bad Request: chat not found'), apiError('chat not found', 404),
    apiError('Bad Request: unknown error'),
    {response: {error_code: '400', description: 'rich_message not supported'}},
  ]
  for (const error of errors) {
    for (const edit of [false, true]) {
      for (const prefix of [[], [unsupportedError()], [missingError()]]) {
        if (!edit && prefix.length && prefix[0].response.description.includes('edit')) continue
        const count = prefix.length + 1
        const ctx = nativeContext([...prefix, error])
        assert.equal(await deliverDirectoryPage(ctx, render(new DirectoryPager()), edit), 'failed')
        assert.equal(ctx.calls.length, count)
      }
    }
  }
})

test('native sends use saved topic only, and omit General/invalid thread IDs', async () => {
  for (const threadId of [undefined, 1, 0, NaN]) {
    const view = render(new DirectoryPager(), {scope: {...scope, threadId}})
    const ctx = nativeContext([unsupportedError()])
    assert.equal(await deliverDirectoryPage(ctx, view), 'sent')
    for (const call of ctx.calls) {
      assert.equal(Object.hasOwn(call.payload, 'message_thread_id'), false)
      assert.equal(call.payload.chat_id, scope.chatId)
    }
  }
})

test('legacy contexts without raw API safely send HTML and keyboard; edits omit topic option', async () => {
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

test('legacy fallback cannot inherit a different thread when the saved scope has no topic', async () => {
  for (const threadId of [undefined, 1]) {
    const view = render(new DirectoryPager(), {scope: {...scope, threadId}})
    const ctx = context([], {message: {message_thread_id: 42}})
    assert.equal(await deliverDirectoryPage(ctx, view), 'failed')
    assert.equal(ctx.calls.length, 0)
    const deleted = context([missingError()], {callbackQuery: {message: {message_thread_id: 42}}})
    assert.equal(await deliverDirectoryPage(deleted, view, true), 'failed')
    assert.deepEqual(deleted.calls.map(c => c.method), ['edit'])
  }
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

test('converting rich messages to compatibility sends new text after explicit no-text rejection', async () => {
  const view = render(new DirectoryPager(), {page: 2, query: 'q'})
  const ctx = nativeContext([apiError('Bad Request: there is no text in the message to edit')])
  assert.equal(await deliverDirectoryPage(ctx, view, true, true), 'sent')
  assert.deepEqual(ctx.calls.map(c => c.method), ['editMessageText', 'sendMessage'])
  assert.equal(ctx.calls[1].payload.text, view.html)
  assert.equal(ctx.calls[1].payload.message_thread_id, scope.threadId)
  assert.equal(ctx.calls[1].payload.reply_markup, view.reply_markup)
})

test('URL-only topic results remain clickable with automatic entity detection disabled', async () => {
  const ctx = nativeContext()
  const markup = {inline_keyboard: [[backButton('token', translate)]]}
  const url = 'https://t.me/c/12345/77'
  assert.equal(await replyDirectoryText(ctx, url, markup), true)
  assert.deepEqual(plain(ctx.calls[0].payload.rich_message.blocks[0]), {
    type: 'paragraph', text: {type: 'url', text: url, url},
  })
  assert.equal(ctx.calls[0].payload.rich_message.skip_entity_detection, true)
})

test('rich result/back and URL links stay inline in native paragraphs, not an external keyboard', async () => {
  const pager = new DirectoryPager()
  const view = render(pager, {page: 2, query: 'q'})
  const back = backButton(view.state.token, translate)
  const markup = {inline_keyboard: [[{text: 'Open <room>', url: 'https://t.me/example'}], [back]]}
  const ctx = nativeContext()
  assert.equal(await replyDirectoryText(ctx, '<result & text>', markup), true)
  assert.equal(ctx.calls.length, 1)
  const {method, payload} = ctx.calls[0]
  assert.equal(method, 'sendRichMessage')
  assert.equal(payload.chat_id, scope.chatId)
  assert.equal(payload.message_thread_id, 999, 'Results follow the source callback topic')
  assert.equal(Object.hasOwn(payload, 'reply_markup'), false)
  assert.equal(Object.hasOwn(payload, 'text'), false)
  assert.equal(Object.hasOwn(payload, 'parse_mode'), false)
  assert.equal(payload.rich_message.skip_entity_detection, true)
  assert.deepEqual(plain(payload.rich_message.blocks), [
    {type: 'paragraph', text: '<result & text>'},
    {type: 'paragraph', text: [{type: 'url', text: 'Open <room>', url: 'https://t.me/example'}]},
    {type: 'paragraph', text: [{type: 'button', button: {...back, style: 'link'}}]},
  ])
  const resolved = pager.resolve(scope, richButtons(payload)[0].callback_data)
  assert.equal(resolved.type, 'back')
  assert.equal(resolved.state.query, 'q')
  assert.equal(resolved.state.page, 2)
  assert.deepEqual(plain(markup.inline_keyboard[1][0]), plain(back), 'Input markup is not mutated')
})

test('unsupported native result falls back to plain with original markup exactly once', async () => {
  const markup = {inline_keyboard: [[{text: 'Open', url: 'https://t.me/example'}, backButton('token', translate)]]}
  for (const error of [unavailableError(), unsupportedError(), parseError()]) {
    const ctx = nativeContext([error])
    assert.equal(await replyDirectoryText(ctx, '<result>', markup), true)
    assert.equal(ctx.calls.length, 2)
    assert.deepEqual(plain(ctx.calls[1]), {method: 'sendMessage', payload: plain({
      chat_id: scope.chatId, text: '<result>', reply_markup: markup, message_thread_id: 999,
    })})
  }
  for (const error of [new Error('ETIMEDOUT'), apiError('rich_message invalid', 500), apiError('Forbidden', 403), apiError('Too Many Requests', 429)]) {
    const ctx = nativeContext([error])
    assert.equal(await replyDirectoryText(ctx, 'result', markup), false)
    assert.equal(ctx.calls.length, 1)
  }
  const failedFallback = nativeContext([unsupportedError(), new Error('network')])
  assert.equal(await replyDirectoryText(failedFallback, 'result', markup), false)
  assert.equal(failedFallback.calls.length, 2)
})

test('result helper preserves non-rich, markup-absent and legacy behavior', async () => {
  const markup = {inline_keyboard: [[backButton('token', translate)]]}
  const noMarkup = nativeContext()
  assert.equal(await replyDirectoryText(noMarkup, 'text'), true)
  assert.equal(noMarkup.calls[0].method, 'reply')
  const plainSource = nativeContext([], {callbackQuery: {message: {message_thread_id: 42, text: 'plain'}}})
  assert.equal(await replyDirectoryText(plainSource, 'text', markup), true)
  assert.equal(plainSource.calls[0].method, 'reply')
  const noRaw = context([], {callbackQuery: {message: {message_thread_id: 42, rich_message: {blocks: []}}}})
  assert.equal(await replyDirectoryText(noRaw, 'text', markup), true)
  assert.equal(noRaw.calls[0].method, 'reply')
  const missingScope = nativeContext([], {chat: undefined, callbackQuery: {message: {rich_message: {blocks: []}}}})
  assert.equal(await replyDirectoryText(missingScope, 'text', markup), false)
  assert.equal(missingScope.calls.length, 0)
})

test('actual Telegraf Context satisfies delivery helpers under strict TypeScript', () => {
  const filename = path.join(__dirname, '__directory-context-typecheck__.ts')
  const source = `
    import type {Context} from 'telegraf';
    import type {DirectoryDeliveryContext} from '../src/util/DirectoryPageDelivery';
    import type {DirectoryView} from '../src/util/DirectoryPager';
    import {answerDirectoryCallback, deliverDirectoryPage, replyDirectoryText, isRichDirectoryMessage} from '../src/util/DirectoryPageDelivery';
    declare const ctx: Context;
    declare const view: DirectoryView;
    const bridge: DirectoryDeliveryContext = ctx;
    deliverDirectoryPage(ctx, view, true, false);
    replyDirectoryText(ctx, 'result', view.reply_markup);
    answerDirectoryCallback(ctx);
    isRichDirectoryMessage(ctx);
  `
  const options = {
    strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
    moduleResolution: ts.ModuleResolutionKind.Node10,
  }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => file === filename
    ? ts.createSourceFile(file, source, languageVersion, true)
    : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([filename], options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => __dirname, getNewLine: () => '\n',
  }))
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