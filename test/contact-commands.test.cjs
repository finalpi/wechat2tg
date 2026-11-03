/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Telegraf, Markup} = require('telegraf')
const zh = require('../dist/i18n/locales/zh-CN').default
const {WechatAccountClassificationService} = require('../dist/service/WechatAccountClassificationService')
const pagerModule = require('../dist/util/DirectoryPager')
const deliveryModule = require('../dist/util/DirectoryPageDelivery')

function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), {
    exports, console, Buffer,
    require: name => dependencies[name] || {},
  })
  return exports
}

function fixture({contacts = [], rooms = [], loggedIn = true, topic, managedForum = false, pagerOptions} = {}) {
  const replies = [], edits = [], queries = [], menus = [], selected = [], bindings = [], creations = [], events = []
  const failures = {reply: [], edit: [], ack: []}
  const hooks = {}
  const i18n = {t: (key, params = {}) => Object.entries(params).reduce((value, [name, replacement]) => value.replaceAll(`{{${name}}}`, replacement), zh[key] || key)}
  const classification = new WechatAccountClassificationService({getSession: async () => undefined, readFlags: async () => new Map(), backfillFlags: async () => undefined})
  const baseDependencies = {'../i18n': {getInstance: () => i18n}}
  const repository = (kind, rows) => ({
    getAll: async () => {
      events.push('repository')
      if (hooks.repository) await hooks.repository(kind)
      return rows
    },
    getByNickNameOrRemark: async query => {
      events.push('repository')
      queries.push({kind, query})
      if (hooks.repository) await hooks.repository(kind)
      return rows.filter(c => c.nickName.includes(query) || c.remark?.includes(query))
    },
  })
  const wxClient = {hasLogin: loggedIn, wxInfo: {wxid: 'wx_owner'}, client: {
    Contact: {find: async ({id}) => {
      selected.push(id)
      if (hooks.find) return hooks.find(id)
      return {name: () => '公众号', avatar: async () => 'avatar', alias: async () => '别名'}
    }},
    Room: {find: async ({id}) => {
      selected.push(id)
      if (hooks.find) return hooks.find(id)
      return {name: '群聊', avatar: async () => ({url: 'avatar'})}
    }},
  }}
  const commandHelper = load('service/TelegramCommandHelper.js', {
    ...baseDependencies,
    '../util/LogUtil': {LogUtils: {debugLog: () => ({debug: () => undefined})}},
    '../util/PageHelper': {initBot: () => undefined},
  })
  const {TelegramBotClient} = load('client/TelegramBotClient.js', {
    ...baseDependencies,
    telegraf: {Markup},
    '../util/TelegramTopicUtils': require('../dist/util/TelegramTopicUtils'),
    '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return hooks.missingClient ? undefined : wxClient}}},
    '../service/TelegramCommandHelper': commandHelper,
    '../service/WechatAccountClassificationService': {WechatAccountClassificationService: {getInstance: () => classification}},
    '../util/DirectoryPager': pagerModule,
    '../util/DirectoryPageDelivery': deliveryModule,
    '../repository/WxContactRepository': {WxContactRepository: {getInstance: () => repository('contact', contacts)}},
    '../repository/WxRoomRepository': {WxRoomRepository: {getInstance: () => repository('room', rooms)}},
    '../entity/BindGroup': {BindGroup: class {}},
    '../service/TelegramGroupOperateService': {TelegramGroupOperateService: class {
      async createGroup(group) {
        creations.push(group)
        return hooks.create ? hooks.create(group) : {...group, chatId: -10054321}
      }
    }},
  })
  const client = Object.create(TelegramBotClient.prototype)
  client.i18n = i18n
  if (pagerOptions) client.directoryPager = new pagerModule.DirectoryPager(pagerOptions)
  client.bindGroupService = {
    isManagedForum: async () => managedForum,
    resolveWechat: async () => hooks.resolve ? hooks.resolve() : topic,
    removeByChatIdOrWxId: async () => undefined,
    createOrUpdate: async value => bindings.push(value),
  }
  client.updateGroupByChatId = async () => {if (hooks.updateGroup) await hooks.updateGroup()}
  const bot = new Telegraf('123:synthetic-test-token')
  bot.botInfo = {id: 123, is_bot: true, first_name: 'Test', username: 'test_bot'}
  bot.telegram.setMyCommands = async commands => {menus.push(...commands)}
  let messageId = 100
  const result = async (kind, target, text, options) => {
    target.push({text, options})
    events.push(kind)
    const failure = failures[kind].shift()
    if (failure) throw failure
    if (hooks[kind]) await hooks[kind](text)
    return {message_id: ++messageId}
  }
  bot.context.reply = (text, options) => result('reply', replies, text, options)
  bot.context.editMessageText = (text, options) => result('edit', edits, text, options)
  bot.context.answerCbQuery = async () => {
    events.push('ack')
    if (failures.ack.length) throw failures.ack.shift()
    return true
  }
  // Each context has its own Telegram instance: stub at the context boundary, never the network.
  bot.use(async (ctx, next) => {
    ctx.telegram.exportChatInviteLink = async () => {
      if (hooks.invite) return hooks.invite()
      return 'https://t.me/+synthetic'
    }
    return next()
  })
  // Telegraf uses instanceof RegExp; preserve patterns when crossing the VM boundary.
  const registerAction = bot.action.bind(bot)
  bot.action = (trigger, ...handlers) => registerAction(
    Object.prototype.toString.call(trigger) === '[object RegExp]' ? new RegExp(trigger.source, trigger.flags) : trigger,
    ...handlers,
  )
  client.onBotCommand(bot)
  client.onBotAction(bot)
  let updateId = 0
  const options = value => typeof value === 'string' ? {type: value} : value || {}
  const chat = value => ({id: value.chatId ?? (value.type && value.type !== 'private' ? -10012345 : 456), type: value.type || 'private'})
  const from = value => ({id: value.userId ?? 456, is_bot: false, first_name: 'Owner'})
  const thread = value => value.threadId ? {message_thread_id: value.threadId, is_topic_message: true} : {}
  const scope = value => {
    value = options(value)
    return {chatId: chat(value).id, userId: from(value).id, threadId: value.threadId > 1 ? value.threadId : undefined, accountId: wxClient.wxInfo?.wxid || wxClient.wxInfo?.id}
  }
  return {
    replies, edits, queries, menus, selected, bindings, creations, events, failures, hooks, wxClient, client, scope,
    resolve: (callback, context) => client.getDirectoryPager().resolve(scope(context), callback),
    command: (text, context) => {
      const value = options(context)
      return bot.handleUpdate({update_id: ++updateId, message: {
        message_id: updateId, date: 1, from: from(value), chat: chat(value), text, ...thread(value),
        entities: [{type: 'bot_command', offset: 0, length: text.split(/\s/, 1)[0].length}],
      }})
    },
    action: (data, context) => {
      const value = options(context)
      return bot.handleUpdate({update_id: ++updateId, callback_query: {
        id: String(updateId), from: from(value), chat_instance: 'synthetic', data,
        message: {message_id: value.messageId ?? 100, date: 1, from: bot.botInfo, chat: chat(value), text: 'list', ...thread(value)},
      }})
    },
  }
}

const people = Array.from({length: 32}, (_, i) => ({userName: `wxid_${i}`, nickName: `用户${i}`, remark: '', verifyFlag: 0}))
const official = Array.from({length: 32}, (_, i) => ({userName: `gh_${i}`, nickName: `公众号${i}`, remark: '', verifyFlag: 24}))
const mixed = people.flatMap((person, i) => [person, official[i]])
const dataButtons = message => message.options.reply_markup.inline_keyboard.flat().filter(b => /:s:\d+$/.test(b.callback_data))
const button = (message, suffix) => message.options.reply_markup.inline_keyboard.flat().find(b => b.callback_data?.endsWith(suffix)).callback_data
const actions = (f, message, context) => dataButtons(message).map(b => f.resolve(b.callback_data, context).item.action)
const badRequest = description => ({response: {error_code: 400, description: `Bad Request: ${description}`}})
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve}}

for (const [command, prefix, rows] of [['user', 'us', people], ['official', 'of', official]]) {
  test(`/${command} has rich metadata, category-only snapshots and normal selection buttons`, async () => {
    const f = fixture({contacts: mixed})
    await f.command(`/${command}`)
    const page = f.replies[0]
    assert.equal(page.options.parse_mode, 'HTML')
    assert.match(page.text, /<b>/)
    assert(page.text.includes(zh[`pagination.title_${prefix}`]))
    assert(page.text.includes('32'))
    assert.deepEqual(actions(f, page), rows.slice(0, 30).map(c => c.userName))
    assert.equal(dataButtons(page)[0].text, rows[0].nickName)
    assert(dataButtons(page).every(b => !('icon_custom_emoji_id' in b)))
    await f.action(button(page, ':p:2'))
    assert.deepEqual(actions(f, f.edits[0]), rows.slice(30).map(c => c.userName))
    await f.action(`${prefix}:page-2`)
    assert.deepEqual(actions(f, f.edits[1]), rows.slice(30).map(c => c.userName))
    if (command === 'official') assert(f.menus.some(c => c.command === command && c.description === '查看公众号'))
  })
}

for (const command of ['user', 'official', 'room']) {
  for (const mention of ['', '@test_bot']) {
    test(`/${command}${mention} preserves spaces and punctuation in a group search`, async () => {
      const query = '项目 A（研发）-1'
      const f = fixture({contacts: [
        {userName: 'wxid_match', nickName: query, remark: '', verifyFlag: 0},
        {userName: 'gh_match', nickName: query, remark: '', verifyFlag: 8},
      ], rooms: [{chatroomId: 'room@chatroom', nickName: query, remark: ''}]})
      await f.command(`/${command}${mention}  ${query}  `, 'supergroup')
      assert.deepEqual(f.queries, [{kind: command === 'room' ? 'room' : 'contact', query}])
      assert.deepEqual(actions(f, f.replies[0], 'supergroup'), [command === 'room' ? 'room@chatroom' : command === 'official' ? 'gh_match' : 'wxid_match'])
      assert.equal(dataButtons(f.replies[0])[0].text, query)
    })
  }
}

for (const [command, kind] of [['user', 'us'], ['official', 'of'], ['room', 'ro']]) {
  test(`${command} search stays paginated through next/previous/home/back and clear`, async () => {
    const query = '项目 A（研发）-1 & <QA>'
    const contacts = Array.from({length: 63}, (_, i) => ({userName: `id_${i}`, nickName: `${query} ${i}`, verifyFlag: kind === 'of' ? 8 : 0}))
    const rooms = contacts.map(c => ({chatroomId: c.userName, nickName: c.nickName}))
    const f = fixture({contacts, rooms})
    const context = {type: 'supergroup', threadId: 77}
    await f.command(`/${command} ${query}`, context)
    assert.equal(dataButtons(f.replies[0]).length, 30)
    assert.match(f.replies[0].text, /&amp; &lt;QA&gt;/)
    assert(!f.replies[0].text.includes('<QA>'))
    await f.action(button(f.replies[0], ':p:2'), context)
    const second = f.edits.at(-1)
    assert.equal(dataButtons(second).length, 30)
    assert.equal(f.resolve(dataButtons(second)[0].callback_data, context).state.query, query)
    await f.action(button(second, ':p:1'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.page, 1)
    await f.action(button(second, ':h'), context)
    await f.action(dataButtons(second)[0].callback_data, context)
    const success = f.replies.at(-1)
    assert.equal(success.text, zh['binding.success'])
    assert.equal(success.options.message_thread_id, 77)
    assert.equal(f.bindings[0].wxId, 'id_30')
    await f.action(button(success, ':b'), context)
    const restored = f.edits.at(-1)
    assert.equal(f.resolve(dataButtons(restored)[0].callback_data, context).state.page, 2)
    assert(f.queries.every(call => call.query === query))
    await f.action(button(restored, ':a'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.query, '')
  })
}

test('HTML metacharacters in names are escaped in body, not normal buttons', async () => {
  const f = fixture({contacts: [{userName: 'wx_1', nickName: '<A> & "B"', verifyFlag: 0}]})
  await f.command('/user')
  assert.match(f.replies[0].text, /&lt;A&gt; &amp; &quot;B&quot;/)
  assert.equal(dataButtons(f.replies[0])[0].text, '<A> & "B"')
})

test('empty search pages are safe, filtered and can clear their original query', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user 公众号')
  assert(f.replies[0].text.includes(zh['user.no_contacts']))
  assert.equal(dataButtons(f.replies[0]).length, 0)
  await f.action(button(f.replies[0], ':a'))
  assert.deepEqual(actions(f, f.edits[0]), people.slice(0, 30).map(c => c.userName))
  await f.command('/official 用户')
  assert(f.replies[1].text.includes(zh['official.no_accounts']))
  assert.equal(dataButtons(f.replies[1]).length, 0)
  await f.command('/room')
  assert(f.replies[2].text.includes(zh['room.no_groups']))
})

test('VerifyFlag remains authoritative and unknown metadata appears without leaking unknown records', async () => {
  const f = fixture({contacts: [
    {userName: 'gh_personal', nickName: '普通联系人', verifyFlag: 0},
    {userName: 'brand_news', nickName: '不带前缀的公众号', verifyFlag: 24},
    {userName: 'unknown_contact', nickName: '资料待同步', verifyFlag: null},
  ]})
  await f.command('/user')
  assert.deepEqual(actions(f, f.replies[0]), ['gh_personal'])
  await f.command('/official')
  assert.deepEqual(actions(f, f.replies[1]), ['brand_news'])
  assert.match(f.replies[0].text, /1.*VerifyFlag/)
  assert.match(f.replies[1].text, /1.*VerifyFlag/)
})

test('unknown-only contact metadata is not reported as a confirmed empty directory', async () => {
  const f = fixture({contacts: [{userName: 'unknown', nickName: '待确认', verifyFlag: null}]})
  await f.command('/user')
  assert.match(f.replies[0].text, /VerifyFlag/)
  assert(!f.replies[0].text.includes(zh['user.no_contacts']))
  assert.equal(dataButtons(f.replies[0]).length, 0)
})

test('rooms keep emojis in real names and remain separate from contact categories', async () => {
  const rooms = Array.from({length: 31}, (_, i) => ({chatroomId: `${i}@chatroom`, nickName: `群${i}`, remark: ''}))
  rooms[0].remark = '🏠 家人'
  const f = fixture({contacts: mixed, rooms})
  await f.command('/room')
  assert.equal(dataButtons(f.replies[0])[0].text, '🏠 家人')
  await f.action('ro:page-2')
  assert.deepEqual(actions(f, f.edits[0]), ['30@chatroom'])
})

test('mentioned no-query commands and blank names use their category and ID fallback', async () => {
  const f = fixture({contacts: [...mixed, {userName: 'gh_empty', nickName: '', remark: '', verifyFlag: 8}], rooms: [{chatroomId: '1@chatroom', nickName: '测试群'}]})
  await f.command('/user@test_bot   ')
  await f.command('/official@test_bot')
  await f.command('/room@test_bot')
  assert.equal(f.queries.length, 0)
  assert.deepEqual(actions(f, f.replies[0]), people.slice(0, 30).map(c => c.userName))
  assert.deepEqual(actions(f, f.replies[1]), official.slice(0, 30).map(c => c.userName))
  assert.deepEqual(actions(f, f.replies[2]), ['1@chatroom'])
  await f.action('of:page-2')
  assert.equal(dataButtons(f.edits[0]).at(-1).text, 'gh_empty')
})

for (const [prefix, id, type] of [['of', 'gh_selected', 0], ['us', 'gh_legacy', 0], ['ro', 'room@chatroom', 1]]) {
  test(`${prefix}: legacy selection retains binding semantics and a working return route`, async () => {
    const f = fixture({contacts: mixed, rooms: [{chatroomId: id, nickName: '测试群'}]})
    await f.action(`${prefix}:${id}`, 'supergroup')
    assert.deepEqual(f.selected, [id])
    assert.equal(f.bindings[0].wxId, id)
    assert.equal(f.bindings[0].type, type)
    assert.equal(f.replies[0].text, zh['binding.success'])
    assert.equal(button(f.replies[0], ':page-1'), `${prefix}:page-1`)
    await f.action(`${prefix}:page-1`, 'supergroup')
    assert.equal(f.resolve(dataButtons(f.edits[0])[0].callback_data, 'supergroup').state.kind, prefix)
  })
}

for (const prefix of ['of', 'us']) {
  test(`${prefix}: topic link result has Back and never creates a legacy group`, async () => {
    const f = fixture({contacts: mixed, topic: {chatId: -10012345, threadId: 77}})
    await f.action(`${prefix}:brand_selected`)
    assert.equal(f.replies[0].text, 'https://t.me/c/12345/77')
    assert.equal(f.creations.length, 0)
    assert.equal(button(f.replies[0], ':page-1'), `${prefix}:page-1`)
    await f.command('/official')
    await f.action(dataButtons(f.replies[1])[0].callback_data)
    await f.action(button(f.replies[2], ':b'))
    assert.deepEqual(actions(f, f.edits[0]), official.slice(0, 30).map(c => c.userName))
  })
}

for (const data of ['of:gh_selected', 'us:wxid_selected', 'ro:room@chatroom']) {
  test(`${data} cannot rebind the managed forum even when its reply fails`, async () => {
    const f = fixture({managedForum: true})
    f.failures.reply.push(new Error('reply failed'))
    await f.action(data, 'supergroup')
    assert.equal(f.bindings.length, 0)
    assert.equal(f.selected.length, 0)
    assert.match(f.replies[0].text, /\/official/)
    assert.equal(button(f.replies[0], ':page-1'), `${data.slice(0, 2)}:page-1`)
  })
}

test('new selection retains the managed-forum mutation guard', async () => {
  const f = fixture({managedForum: true, contacts: mixed})
  await f.command('/official', 'supergroup')
  await f.action(dataButtons(f.replies[0])[0].callback_data, 'supergroup')
  assert.equal(f.selected.length, 0)
  assert.equal(f.bindings.length, 0)
  assert.match(f.replies[1].text, /\/official/)
  assert(button(f.replies[1], ':b'))
})

test('other bot mentions are ignored and optional missing/logged-out wxClient is safe', async () => {
  const f = fixture({contacts: mixed, loggedIn: false})
  await f.command('/user@another_bot 用户')
  assert.equal(f.replies.length, 0)
  for (const name of ['user', 'official', 'room']) await f.command(`/${name}`)
  assert(f.replies.every(r => r.text === zh['login.please_login_wx']))
  await f.action('us:page-1')
  assert.equal(f.edits.length, 0)
  f.hooks.missingClient = true
  for (const name of ['user', 'official', 'room']) await f.command(`/${name}`)
  assert(f.replies.every(r => r.text === zh['login.please_login_wx']))
})

test('General topic ID 1 and absent thread normalize to the same scope, account id fallback stays bound', async () => {
  const f = fixture({contacts: mixed})
  f.wxClient.wxInfo = {id: 'fallback_account'}
  await f.command('/user', {type: 'supergroup', threadId: 1})
  const select = dataButtons(f.replies[0])[0].callback_data
  const resolved = f.resolve(select, 'supergroup')
  assert.equal(resolved.state.scope.threadId, undefined)
  assert.equal(resolved.state.scope.accountId, 'fallback_account')
  await f.action(button(f.replies[0], ':p:2'), 'supergroup')
  assert.equal(f.edits.length, 1)
  f.wxClient.wxInfo.id = 'new_account'
  await f.action(select, 'supergroup')
  assert.equal(f.selected.length, 0)
  assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
})

test('account changes during a repository read never tag old rows with the new account', async () => {
  const f = fixture({contacts: mixed})
  f.hooks.repository = async () => {f.wxClient.wxInfo.wxid = 'new_account'}
  await f.command('/user')
  assert.equal(f.replies[0].text, zh['pagination.expired'])
  assert.equal(f.replies[0].options.reply_markup, undefined)
})

test('new selection failures return to the original search page and cannot mutate after account change', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user 用户', 'supergroup')
  await f.action(button(f.replies[0], ':p:2'), 'supergroup')
  f.hooks.find = async () => null
  await f.action(dataButtons(f.edits[0])[0].callback_data, 'supergroup')
  assert.equal(f.replies[1].text, zh['pagination.selection_unavailable'])
  await f.action(button(f.replies[1], ':b'), 'supergroup')
  const restored = f.resolve(dataButtons(f.edits[1])[0].callback_data, 'supergroup').state
  assert.equal(restored.query, '用户')
  assert.equal(restored.page, 2)
  f.hooks.find = async () => {
    f.wxClient.wxInfo.wxid = 'new_account'
    return {name: () => 'wrong account'}
  }
  await f.action(dataButtons(f.edits[1])[0].callback_data, 'supergroup')
  assert.equal(f.bindings.length, 0)
  assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
})

test('page numbers clamp after list shrink and legacy finite out-of-range requests', async () => {
  const contacts = [...people]
  const f = fixture({contacts})
  await f.command('/user')
  const next = button(f.replies[0], ':p:2')
  contacts.splice(3)
  await f.action(next)
  assert.deepEqual(actions(f, f.edits[0]), contacts.map(c => c.userName))
  assert.equal(f.resolve(dataButtons(f.edits[0])[0].callback_data).state.page, 1)
  await f.action('us:page-999999')
  await f.action('us:page--9')
  assert(f.edits.every(page => dataButtons(page).length === 3))
  contacts.splice(0)
  await f.action(next)
  assert.equal(dataButtons(f.edits.at(-1)).length, 0)
})

test('malformed legacy and new callbacks fail closed without stale selection', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  const valid = dataButtons(f.replies[0])[0].callback_data
  for (const callback of ['us:page-NaN', 'ro:page-Infinity', 'of:page-1x', 'us:', 'us:a:b', 'dl:nope:s:0', valid.replace(':s:0', ':s:999'), valid.replace(':s:0', ':p:0'), valid + ':extra']) {
    await f.action(callback)
    assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
  }
  assert.equal(f.selected.length, 0)
  assert.equal(f.edits.length, 0)
})

test('expired tokens, scope ownership and account changes cannot select or navigate', async () => {
  let now = 100
  const f = fixture({contacts: mixed, pagerOptions: {ttlMs: 10, now: () => now}})
  const context = {type: 'supergroup', threadId: 77}
  await f.command('/user', context)
  const select = dataButtons(f.replies[0])[0].callback_data
  const next = button(f.replies[0], ':p:2')
  for (const invalid of [{...context, userId: 999}, {...context, chatId: -999}, {...context, threadId: 88}]) {
    await f.action(select, invalid)
    assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
  }
  f.wxClient.wxInfo.wxid = 'another_account'
  await f.action(select, context)
  await f.action(next, context)
  f.wxClient.wxInfo.wxid = 'wx_owner'
  now = 111
  await f.action(select, context)
  await f.action(next, context)
  assert.equal(f.selected.length, 0)
  assert.equal(f.edits.length, 0)
  assert(f.replies.slice(1).every(r => r.text === zh['pagination.expired']))
})

test('immutable old selection indexes never select a reordered row', async () => {
  const contacts = [...people]
  const f = fixture({contacts})
  await f.command('/user', 'supergroup')
  const old = dataButtons(f.replies[0])[0].callback_data
  contacts.reverse()
  await f.action('us:page-1', 'supergroup')
  const fresh = dataButtons(f.edits[0])[0].callback_data
  assert.notEqual(fresh, old)
  assert.equal(f.resolve(fresh, 'supergroup').item.action, 'wxid_31')
  await f.action(old, 'supergroup')
  assert.equal(f.bindings[0].wxId, 'wxid_0')
})

test('rapid navigation is serialized by chat/message, with early acknowledgements', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  const next = button(f.replies[0], ':p:2')
  const entered = deferred(), release = deferred()
  let calls = 0
  f.hooks.repository = async () => {if (++calls === 1) {entered.resolve(); await release.promise}}
  f.events.splice(0)
  const first = f.action(next)
  await entered.promise
  const second = f.action(next.replace(':p:2', ':p:1'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal(f.events.filter(e => e === 'ack').length, 2)
  assert.equal(f.events[0], 'ack')
  release.resolve()
  await Promise.all([first, second])
  assert.deepEqual(f.edits.map(page => f.resolve(dataButtons(page)[0].callback_data).state.page), [2, 1])
})

test('queued callbacks revalidate their account scope before reading or mutating', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  const entered = deferred(), release = deferred()
  f.hooks.edit = async () => {entered.resolve(); await release.promise}
  const first = f.action(button(f.replies[0], ':p:2'))
  await entered.promise
  const second = f.action(dataButtons(f.replies[0])[0].callback_data)
  await new Promise(resolve => setImmediate(resolve))
  f.wxClient.wxInfo.wxid = 'new_owner'
  release.resolve()
  await Promise.all([first, second])
  assert.equal(f.selected.length, 0)
  assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
})

for (const error of [badRequest('message to edit not found'), badRequest('message is not modified'), badRequest('can\'t parse entities')]) {
  test(`callback delivery safely handles ${error.response.description}`, async () => {
    const f = fixture({contacts: mixed})
    await f.command('/user')
    f.failures.edit.push(error)
    f.failures.ack.push(new Error('query expired'))
    await f.action(button(f.replies[0], ':p:2'))
    if (error.response.description.includes('not found')) {
      assert.equal(f.replies.length, 2)
      assert.deepEqual(actions(f, f.replies[1]), ['wxid_30', 'wxid_31'])
    } else if (error.response.description.includes('parse')) {
      assert.equal(f.edits.length, 2)
      assert.equal(f.edits[1].options.parse_mode, undefined)
      assert(!f.edits[1].text.includes('<b>'))
      assert.deepEqual(actions(f, f.edits[1]), ['wxid_30', 'wxid_31'])
    } else {
      assert.equal(f.replies.length, 1)
      assert.equal(f.edits.length, 1)
    }
  })
}

test('deleted-message fallback failure and initial HTML/plain failures never escape', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  f.failures.edit.push(badRequest('message to edit not found'))
  f.failures.reply.push(badRequest('can\'t parse entities'), new Error('plain failed'))
  await f.action(button(f.replies[0], ':p:2'))
  assert.equal(f.edits.length, 1)
  assert.equal(f.replies.length, 3)
  assert.equal(f.replies[2].options.parse_mode, undefined)
  f.failures.reply.push(badRequest('can\'t parse entities'), new Error('plain failed'))
  await f.command('/official')
  assert.equal(f.replies.length, 5)
})

for (const failure of [new Error('ETIMEDOUT'), {response: {error_code: 500}}, {response: {error_code: 429}}, {response: {error_code: 403}}]) {
  test(`ambiguous/forbidden delivery ${failure.message || failure.response.error_code} is never retried as a new message`, async () => {
    const f = fixture({contacts: mixed})
    await f.command('/user')
    f.failures.edit.push(failure)
    await f.action(button(f.replies[0], ':p:2'))
    assert.equal(f.edits.length, 1)
    assert.equal(f.replies.length, 1)
    f.failures.reply.push(failure)
    await f.command('/official')
    assert.equal(f.replies.length, 2)
  })
}

for (const kind of ['us', 'of', 'ro']) {
  test(`${kind} missing selection and creation failure are friendly, single-attempt results with Back`, async () => {
    const f = fixture()
    f.hooks.find = async () => null
    await f.action(`${kind}:missing`)
    assert.equal(f.replies[0].text, zh['pagination.selection_unavailable'])
    assert(button(f.replies[0], ':page-1'))
    delete f.hooks.find
    f.hooks.create = async () => null
    await f.action(`${kind}:null_group`)
    assert.equal(f.replies[1].text, zh['pagination.selection_unavailable'])
    f.hooks.create = async () => {throw new Error('creation timeout')}
    await Promise.all([f.action(`${kind}:creation_failure`), f.action(`${kind}:creation_failure`)])
    assert.equal(f.creations.length, 2)
    assert.equal(f.replies.at(-1).text, zh['pagination.selection_unavailable'])
    assert(button(f.replies.at(-1), ':page-1'))
  })
}

test('a temporarily unavailable selection can be retried after completion without permanently disabling its button', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user', 'supergroup')
  const select = dataButtons(f.replies[0])[0].callback_data
  f.hooks.find = async () => null
  await f.action(select, 'supergroup')
  assert.equal(f.replies.at(-1).text, zh['pagination.selection_unavailable'])
  delete f.hooks.find
  await f.action(select, 'supergroup')
  assert.equal(f.bindings.length, 1)
  assert.equal(f.bindings[0].wxId, 'wxid_0')
  assert.equal(f.replies.at(-1).text, zh['binding.success'])
})

test('creation success keeps URL and token return, duplicate clicks do not create twice', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/official 公众号')
  const select = dataButtons(f.replies[0])[0].callback_data
  await Promise.all([f.action(select), f.action(select)])
  assert.equal(f.creations.length, 1)
  assert.equal(f.replies[1].text, zh['group.create_success'])
  assert.equal(f.replies[1].options.reply_markup.inline_keyboard[0][0].url, 'https://t.me/+synthetic')
  await f.action(button(f.replies[1], ':b'))
  assert.equal(f.resolve(dataButtons(f.edits[0])[0].callback_data).state.query, '公众号')
})

test('repository, destination and optional group-update rejections are contained', async () => {
  const f = fixture({contacts: mixed})
  f.hooks.repository = async () => {throw new Error('sensitive repository details')}
  for (const command of ['user', 'official', 'room']) await f.command(`/${command}`)
  await f.action('us:page-1')
  assert(f.replies.every(r => r.text === zh['pagination.unavailable']))
  delete f.hooks.repository
  f.hooks.resolve = async () => {throw new Error('destination unavailable')}
  await f.action('of:brand_selected')
  assert.equal(f.replies.at(-1).text, zh['official.destination_unavailable'])
  assert(button(f.replies.at(-1), ':page-1'))
  f.hooks.updateGroup = async () => {throw new Error('optional metadata failed')}
  await f.action('us:wx_selected', 'supergroup')
  assert.equal(f.bindings.length, 1)
  assert.equal(f.replies.at(-1).text, zh['binding.success'])
  f.failures.reply.push(new Error('selection reply failed'))
  await f.action('ro:room@chatroom', 'supergroup')
  assert.equal(f.bindings.length, 2)
})