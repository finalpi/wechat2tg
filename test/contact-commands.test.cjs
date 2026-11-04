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

// Inspect the real payload produced by DirectoryPager/DirectoryPageDelivery; do not
// synthesize a second renderer or translate rich callbacks into an external keyboard.
function richNodes(value, type) {
  if (!value || typeof value !== 'object') return []
  return [
    ...(value.type === type ? [value] : []),
    ...Object.values(value).flatMap(child => richNodes(child, type)),
  ]
}
function richText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(richText).join('')
  if (!value || typeof value !== 'object') return ''
  return value.type === 'button' ? value.button.text : richText(value.text)
}
const externalButtons = message => message.options?.reply_markup?.inline_keyboard.flat() || []
const richButtons = message => richNodes(message.rich_message?.blocks, 'button').map(node => node.button)
const messageButtons = message => [...richButtons(message), ...externalButtons(message)]
const resultText = message => message.rich_message ? richText(message.rich_message.blocks[0]) : message.text

function fixture({contacts = [], rooms = [], members = [], loggedIn = true, topic, managedForum = false, pagerOptions} = {}) {
  const replies = [], edits = [], queries = [], menus = [], selected = [], bindings = [], creations = [], events = [], apiCalls = []
  const sources = new Map()
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
    getByUserName: async id => {
      if (hooks.detail) return hooks.detail(id)
      return rows.find(row => row.userName === id) || null
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
    '../webui/mentions': {createGroupMentionService: () => ({members: async roomId => {
      events.push('members:' + roomId)
      return hooks.members ? hooks.members(roomId) : members
    }})},
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
    resolveTelegram: async (chatId, threadId) => hooks.telegramBinding ? hooks.telegramBinding(chatId, threadId) : topic,
    removeByChatIdOrWxId: async () => undefined,
    createOrUpdate: async value => bindings.push(value),
  }
  client.updateGroupByChatId = async () => {if (hooks.updateGroup) await hooks.updateGroup()}
  const bot = new Telegraf('123:synthetic-test-token')
  bot.botInfo = {id: 123, is_bot: true, first_name: 'Test', username: 'test_bot'}
  bot.telegram.setMyCommands = async commands => {menus.push(...commands)}
  let messageId = 100
  const result = async (kind, target, text, options = {}, payload, sourceId) => {
    const rich_message = payload?.rich_message
    const record = {
      text: rich_message ? rich_message.blocks.map(richText).join('\n') : text,
      options, rich_message, payload,
      message_id: kind === 'edit' ? sourceId : ++messageId,
    }
    target.push(record)
    events.push(kind)
    const failure = failures[kind].shift()
    if (failure) throw failure
    if (hooks[kind]) await hooks[kind](record.text)
    for (const button of messageButtons(record)) {
      if (button.callback_data) sources.set(button.callback_data, record)
    }
    return {message_id: record.message_id, ...(rich_message ? {rich_message} : {text})}
  }
  bot.context.reply = function (text, options) {return result('reply', replies, text, options)}
  bot.context.editMessageText = function (text, options) {
    return result('edit', edits, text, options, undefined, this.callbackQuery?.message?.message_id)
  }
  bot.context.answerCbQuery = async () => {
    events.push('ack')
    if (failures.ack.length) throw failures.ack.shift()
    return true
  }
  // Telegraf constructs a fresh Telegram instance per Context. Guard both the bot
  // and each context: an unrecognized method must fail locally, never hit Telegram.
  bot.telegram.callApi = async method => {throw new Error(`Unexpected bot API call: ${method}`)}
  bot.use(async (ctx, next) => {
    ctx.telegram.callApi = async (method, payload) => {
      apiCalls.push({method, payload})
      assert(['sendRichMessage', 'sendMessage', 'editMessageText'].includes(method), `Unexpected context API call: ${method}`)
      if (method === 'sendRichMessage' || payload.rich_message) {
        assert(payload.rich_message?.blocks?.length)
        assert(!('text' in payload), 'Native payload must omit text')
        assert(!('parse_mode' in payload), 'Native payload must omit parse_mode')
      } else {
        assert.equal(typeof payload.text, 'string')
      }
      const options = {...payload}
      delete options.rich_message
      delete options.text
      return method === 'editMessageText'
        ? result('edit', edits, payload.text, options, payload, payload.message_id)
        : result('reply', replies, payload.text, options, payload)
    }
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
    replies, edits, queries, menus, selected, bindings, creations, events, apiCalls, failures, hooks, wxClient, client, scope,
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
      const token = /^dl:[^:]+:/.exec(data)?.[0]
      const source = value.source || sources.get(data)
        || (token && [...sources].find(([callback]) => callback.startsWith(token))?.[1])
      // Explicit native:false models old clients/mock text contexts. Otherwise use
      // the actual delivered view/result, including a text fallback after rejection.
      const native = value.native ?? !!source?.rich_message
      if (native) assert(source?.rich_message, 'Native callback needs a delivered rich source')
      return bot.handleUpdate({update_id: ++updateId, callback_query: {
        id: String(updateId), from: from(value), chat_instance: 'synthetic', data,
        message: {
          message_id: value.messageId ?? source?.message_id ?? 100,
          date: 1, from: bot.botInfo, chat: chat(value),
          ...(native ? {rich_message: source.rich_message} : {text: source?.text || 'list'}),
          ...thread(value),
        },
      }})
    },
  }
}

const people = Array.from({length: 32}, (_, i) => ({userName: `wxid_${i}`, nickName: `用户${i}`, remark: '', verifyFlag: 0}))
const official = Array.from({length: 32}, (_, i) => ({userName: `gh_${i}`, nickName: `公众号${i}`, remark: '', verifyFlag: 24}))
const mixed = people.flatMap((person, i) => [person, official[i]])
const dataButtons = message => messageButtons(message).filter(b => /:s:\d+$/.test(b.callback_data))
const button = (message, suffix) => {
  const found = messageButtons(message).find(b => b.callback_data?.endsWith(suffix))
  assert(found, `Missing clickable ${suffix} in delivered message`)
  return found.callback_data
}
const actions = (f, message, context) => dataButtons(message).map(b => f.resolve(b.callback_data, context).item.action)
const badRequest = description => ({response: {error_code: 400, description: `Bad Request: ${description}`}})
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise, resolve}}

for (const [command, prefix, rows] of [['user', 'us', people], ['official', 'of', official]]) {
  test(`/${command} has native rich metadata, category-only snapshots and directly clickable names`, async () => {
    const f = fixture({contacts: mixed})
    await f.command(`/${command}`)
    const page = f.replies[0]
    assert.equal(f.apiCalls[0].method, 'sendRichMessage')
    assert.equal(page.payload.chat_id, 456)
    assert.equal(page.options.parse_mode, undefined)
    assert(richNodes(page.rich_message.blocks, 'bold').length)
    assert.equal(externalButtons(page).length, 1)
    assert(externalButtons(page)[0].callback_data.endsWith(':c'))
    assert(richButtons(page).every(b => b.style === 'link' && typeof b.text === 'string'))
    assert(!externalButtons(page).some(b => /:s:|:p:|:h$|:a$/.test(b.callback_data)))
    assert(page.text.includes(zh[`pagination.title_${prefix}`]))
    assert(page.text.includes('32'))
    assert.deepEqual(actions(f, page), rows.slice(0, 30).map(c => c.userName))
    assert.equal(dataButtons(page)[0].text, rows[0].nickName)
    assert(dataButtons(page).every(b => !('icon_custom_emoji_id' in b)))
    await f.action(button(page, ':p:2'))
    assert.deepEqual(actions(f, f.edits[0]), rows.slice(30).map(c => c.userName))
    assert(f.edits[0].rich_message)
    assert.equal(f.apiCalls.at(-1).method, 'editMessageText')
    assert.equal(f.edits[0].payload.message_id, page.message_id)
    assert(!('text' in f.edits[0].payload))
    assert(!('parse_mode' in f.edits[0].payload))
    await f.action(`${prefix}:page-2`)
    assert.deepEqual(actions(f, f.edits[1]), rows.slice(30).map(c => c.userName))
    assert.equal(f.edits[1].rich_message, undefined)
    assert.equal(f.edits[1].options.parse_mode, 'HTML')
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
    assert(f.replies[0].rich_message)
    assert(f.replies[0].text.includes(query))
    assert.equal(f.replies[0].payload.message_thread_id, 77)
    assert.equal(f.replies[0].payload.chat_id, -10012345)
    assert(richNodes(f.replies[0].rich_message.blocks, 'code').some(node => node.text === query))
    await f.action(button(f.replies[0], ':p:2'), context)
    const second = f.edits.at(-1)
    assert.equal(dataButtons(second).length, 30)
    assert.equal(f.resolve(dataButtons(second)[0].callback_data, context).state.query, query)
    await f.action(button(second, ':p:1'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.page, 1)
    await f.action(button(second, ':h'), context)
    await f.action(dataButtons(second)[0].callback_data, context)
    const success = f.replies.at(-1)
    assert.equal(resultText(success), zh['binding.success'])
    assert(success.rich_message)
    assert.equal(success.options.reply_markup, undefined)
    assert(richButtons(success).some(b => b.callback_data.endsWith(':b') && b.style === 'link'))
    assert.equal(success.options.message_thread_id, 77)
    assert.equal(f.bindings[0].wxId, 'id_30')
    await f.action(button(success, ':b'), context)
    const restored = f.edits.at(-1)
    assert(restored.rich_message)
    assert.equal(f.resolve(dataButtons(restored)[0].callback_data, context).state.page, 2)
    assert(f.queries.every(call => call.query === query))
    await f.action(button(restored, ':a'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.query, '')
  })
}

test('native names are plain rich-button text, never HTML or duplicated external names', async () => {
  const f = fixture({contacts: [{userName: 'wx_1', nickName: '<A> & "B"', verifyFlag: 0}]})
  await f.command('/user')
  const page = f.replies[0]
  assert(page.rich_message)
  assert.equal(dataButtons(page)[0].text, '<A> & "B"')
  assert.equal(dataButtons(page)[0].style, 'link')
  assert.equal(page.text.split('<A> & "B"').length - 1, 1)
  assert.equal(externalButtons(page).length, 1)
  assert(!page.text.includes('&lt;A&gt;'))
})

for (const [command, kind] of [['user', 'us'], ['official', 'of'], ['room', 'ro']]) {
  test(`${command} compatibility action preserves page/query, selection Back and later navigation mode`, async () => {
    const query = '项目 & <QA>'
    const contacts = Array.from({length: 63}, (_, i) => ({userName: `id_${i}`, nickName: `${query} ${i}`, verifyFlag: kind === 'of' ? 8 : 0}))
    const f = fixture({contacts, rooms: contacts.map(c => ({chatroomId: c.userName, nickName: c.nickName}))})
    const context = {type: 'supergroup', threadId: 77}
    await f.command(`/${command} ${query}`, context)
    await f.action(button(f.replies[0], ':p:2'), context)
    const nativeSecond = f.edits.at(-1)
    assert(nativeSecond.rich_message)
    const compat = button(nativeSecond, ':c')
    assert.equal(f.resolve(compat, context).type, 'compat')
    await f.action(compat, context)
    const compatible = f.edits.at(-1)
    assert.equal(compatible.rich_message, undefined)
    assert.equal(compatible.options.parse_mode, 'HTML')
    assert.match(compatible.text, /项目 &amp; &lt;QA&gt;/)
    assert(!compatible.text.includes('项目 &amp; &lt;QA&gt; 30'), 'Compatibility body must not duplicate keyboard names')
    assert.equal(dataButtons(compatible).length, 30)
    assert.equal(richButtons(compatible).length, 0)
    const select = dataButtons(compatible)[0].callback_data
    assert.equal(f.resolve(select, context).state.page, 2)
    assert.equal(f.resolve(select, context).state.query, query)
    const nativeCalls = f.apiCalls.filter(call => call.payload.rich_message).length
    await f.action(select, context)
    const success = f.replies.at(-1)
    assert.equal(success.text, zh['binding.success'])
    assert.equal(success.rich_message, undefined)
    assert.equal(f.bindings[0].wxId, 'id_30')
    await f.action(button(success, ':b'), context)
    const restored = f.edits.at(-1)
    assert.equal(restored.rich_message, undefined)
    assert.equal(f.resolve(dataButtons(restored)[0].callback_data, context).state.page, 2)
    assert.equal(f.resolve(dataButtons(restored)[0].callback_data, context).state.query, query)
    await f.action(button(restored, ':p:1'), context)
    await f.action(button(f.edits.at(-1), ':p:2'), context)
    await f.action(button(f.edits.at(-1), ':h'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.page, 1)
    await f.action(button(f.edits.at(-1), ':a'), context)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.query, '')
    assert.equal(f.apiCalls.filter(call => call.payload.rich_message).length, nativeCalls)
    await f.command(`/${command} ${query}`, context)
    assert(f.replies.at(-1).rich_message, 'Fresh commands retry native, not a global compatibility flag')
  })
}

for (const failure of [
  {response: {error_code: 404, description: 'Not Found'}},
  badRequest('rich_message is not supported'),
]) {
  test(`explicit native rejection ${failure.response.description} falls back once and stays compatible`, async () => {
    const f = fixture({contacts: mixed})
    const context = {type: 'supergroup', threadId: 77}
    f.failures.reply.push(failure)
    await f.command('/user 用户', context)
    assert.equal(f.replies.length, 2)
    assert.deepEqual(f.apiCalls.map(call => call.method), ['sendRichMessage', 'sendMessage'])
    const compatible = f.replies[1]
    assert.equal(compatible.rich_message, undefined)
    assert.equal(compatible.options.message_thread_id, 77)
    assert(!compatible.text.includes('用户0'))
    assert.deepEqual(actions(f, compatible, context), people.slice(0, 30).map(c => c.userName))
    await f.action(button(compatible, ':p:2'), context)
    const second = f.edits.at(-1)
    assert.equal(second.rich_message, undefined)
    assert.equal(second.payload.chat_id, -10012345)
    assert.equal(second.payload.message_id, compatible.message_id)
    assert.equal(f.resolve(dataButtons(second)[0].callback_data, context).state.query, '用户')
    await f.action(dataButtons(second)[0].callback_data, context)
    assert.equal(f.replies.at(-1).rich_message, undefined)
    await f.action(button(f.replies.at(-1), ':b'), context)
    assert.equal(f.edits.at(-1).rich_message, undefined)
    assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state.page, 2)
    assert.equal(f.apiCalls.filter(call => call.payload.rich_message).length, 1)
    await f.command('/user 用户', context)
    assert(f.replies.at(-1).rich_message)
  })
}

test('unsupported native edit switches that message to compatibility without an extra send', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user 用户')
  f.failures.edit.push(badRequest('rich_message is not supported'))
  await f.action(button(f.replies[0], ':p:2'))
  assert.equal(f.replies.length, 1)
  assert.equal(f.edits.length, 2)
  assert(f.edits[0].rich_message)
  assert.equal(f.edits[1].rich_message, undefined)
  assert.equal(f.edits[1].payload.message_id, f.replies[0].message_id)
  await f.action(button(f.edits[1], ':p:1'))
  assert.equal(f.edits[2].rich_message, undefined)
  assert.equal(f.resolve(dataButtons(f.edits[2])[0].callback_data).state.query, '用户')
})

test('unsupported native selection result falls back with Back without repeating binding', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user 用户', 'supergroup')
  await f.action(button(f.replies[0], ':p:2'), 'supergroup')
  f.failures.reply.push(badRequest('rich_message is not supported'))
  await f.action(dataButtons(f.edits[0])[0].callback_data, 'supergroup')
  assert.equal(f.bindings.length, 1)
  assert.equal(f.replies.length, 3)
  assert(f.replies[1].rich_message)
  assert.equal(f.replies[2].rich_message, undefined)
  assert.equal(f.replies[2].text, zh['binding.success'])
  await f.action(button(f.replies[2], ':b'), 'supergroup')
  assert.equal(f.edits.at(-1).rich_message, undefined)
  const restored = f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, 'supergroup').state
  assert.equal(restored.query, '用户')
  assert.equal(restored.page, 2)
})

test('explicit text-source override models old/mock callbacks without disabling native commands', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  assert(f.replies[0].rich_message)
  await f.action(button(f.replies[0], ':p:2'), {native: false})
  assert.equal(f.edits[0].rich_message, undefined)
  assert.equal(f.edits[0].options.parse_mode, 'HTML')
  await f.command('/user')
  assert(f.replies.at(-1).rich_message)
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
    assert(f.replies[2].rich_message)
    assert(richNodes(f.replies[2].rich_message.blocks, 'url').some(node => node.url === 'https://t.me/c/12345/77'))
    assert.equal(f.replies[2].options.reply_markup, undefined)
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
  assert.equal(resultText(f.replies[1]), zh['pagination.selection_unavailable'])
  assert(f.replies[1].rich_message)
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
  assert.equal(resultText(f.replies.at(-1)), zh['pagination.expired'])
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
    await f.action(button(f.replies[0], ':p:2'), error.response.description.includes('parse') ? {native: false} : undefined)
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

test('deleted-message and native/HTML/plain fallback failures are bounded and never escape', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  f.failures.edit.push(badRequest('message to edit not found'))
  const unsupported = badRequest('rich_message is not supported')
  f.failures.reply.push(unsupported, badRequest('can\'t parse entities'), new Error('plain failed'))
  await f.action(button(f.replies[0], ':p:2'))
  assert.equal(f.edits.length, 1)
  assert.equal(f.replies.length, 4)
  assert(f.replies[1].rich_message)
  assert.equal(f.replies[2].options.parse_mode, 'HTML')
  assert.equal(f.replies[3].options.parse_mode, undefined)
  assert.equal(f.replies[3].rich_message, undefined)
  f.failures.reply.push(unsupported, badRequest('can\'t parse entities'), new Error('plain failed'))
  await f.command('/official')
  assert.equal(f.replies.length, 7)
  assert(f.replies[4].rich_message)
  assert.equal(f.replies[6].options.parse_mode, undefined)
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
    // A result-send failure must not repeat creation or send a fallback result.
    f.failures.reply.push(failure)
    await f.action(dataButtons(f.replies[0])[0].callback_data)
    assert.equal(f.creations.length, 1)
    assert.equal(f.selected.length, 1)
    assert.equal(f.replies.length, 3)
    assert(f.replies[2].rich_message)
    assert.equal(f.replies[2].options.reply_markup, undefined)
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
  assert.equal(resultText(f.replies.at(-1)), zh['pagination.selection_unavailable'])
  delete f.hooks.find
  await f.action(select, 'supergroup')
  assert.equal(f.bindings.length, 1)
  assert.equal(f.bindings[0].wxId, 'wxid_0')
  assert.equal(resultText(f.replies.at(-1)), zh['binding.success'])
})

test('creation success keeps URL and token return, duplicate clicks do not create twice', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/official 公众号')
  const select = dataButtons(f.replies[0])[0].callback_data
  await Promise.all([f.action(select), f.action(select)])
  assert.equal(f.creations.length, 1)
  assert.equal(resultText(f.replies[1]), zh['group.create_success'])
  assert(f.replies[1].rich_message)
  assert(richNodes(f.replies[1].rich_message.blocks, 'url').some(node => node.url === 'https://t.me/+synthetic'))
  assert.equal(f.replies[1].options.reply_markup, undefined)
  assert(richButtons(f.replies[1]).every(b => b.style === 'link'))
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

for (const context of ['private', {type: 'supergroup', threadId: 77}]) {
  test(`/contacts shows cached profile details and returns to the original search/page (${JSON.stringify(context)})`, async () => {
    const contacts = people.map(person => ({...person, remark: '备注 ' + person.nickName, alias: 'real_alias',
      sex: 2, country: '中国', province: '广东', city: '深圳', signature: '<hello> & world', description: '描述'}))
    const f = fixture({contacts, managedForum: true})
    await f.command('/contacts@test_bot 用户', context)
    assert(f.menus.some(c => c.command === 'contacts' && c.description === zh['command.contacts']))
    assert(f.menus.some(c => c.command === 'members' && c.description === zh['command.members']))
    await f.action(button(f.replies[0], ':p:2'), context)
    await f.action(dataButtons(f.edits.at(-1))[0].callback_data, context)
    const detail = f.replies.at(-1)
    assert.match(resultText(detail), /微信 ID：wxid_30/)
    assert.match(resultText(detail), /昵称：用户30/)
    assert.match(resultText(detail), /备注：备注 用户30/)
    assert.match(resultText(detail), /微信号：real_alias/)
    assert.match(resultText(detail), /性别：女/)
    assert.match(resultText(detail), /地区：中国 \/ 广东 \/ 深圳/)
    assert(resultText(detail).includes('<hello> & world'))
    assert(detail.rich_message.skip_entity_detection)
    await f.action(button(detail, ':b'), context)
    const state = f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state
    assert.equal(state.kind, 'ct')
    assert.equal(state.query, '用户')
    assert.equal(state.page, 2)
    assert.equal(f.selected.length + f.bindings.length + f.creations.length, 0)
  })
}

test('read-only contact compatibility buttons retain their details and return action', async () => {
  const f = fixture({contacts: people})
  f.failures.reply.push(badRequest('rich_message is not supported'))
  await f.command('/contacts')
  const page = f.replies.at(-1)
  assert.equal(page.rich_message, undefined)
  await f.action(dataButtons(page)[0].callback_data)
  const detail = f.replies.at(-1)
  assert.equal(detail.rich_message, undefined)
  assert.match(detail.text, /wxid_0/)
  assert.equal(detail.options.parse_mode, undefined)
  await f.action(button(detail, ':b'))
  assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data).state.kind, 'ct')
  assert.equal(f.bindings.length + f.creations.length, 0)
})

const groupMembers = Array.from({length: 63}, (_, i) => ({wxId: `member_${i}`, name: `群名${i}`,
  nickname: `昵称${i}`, displayName: `群名${i}`, hasAvatar: false}))

test('/members preserves group search/page, room identity, member pagination and non-friend detail', async () => {
  const rooms = Array.from({length: 32}, (_, i) => ({chatroomId: `group_${i}@chatroom`, nickName: `项目 A ${i}`}))
  const f = fixture({rooms, members: groupMembers, managedForum: true})
  const context = {type: 'supergroup', threadId: 77}
  await f.command('/members@test_bot 项目 A', context)
  await f.action(button(f.replies[0], ':p:2'), context)
  const groupsPage = f.edits.at(-1)
  await f.action(dataButtons(groupsPage)[0].callback_data, context)
  let members = f.edits.at(-1)
  assert.equal(f.resolve(dataButtons(members)[0].callback_data, context).state.roomId, 'group_30@chatroom')
  assert(members.text.includes('项目 A 30'))
  assert.equal(dataButtons(members).length, 30)
  await f.action(button(members, ':p:2'), context)
  members = f.edits.at(-1)
  await f.action(dataButtons(members)[0].callback_data, context)
  const detail = f.replies.at(-1)
  assert.match(resultText(detail), /微信 ID：member_30/)
  assert.match(resultText(detail), /群内名称：群名30/)
  await f.action(button(detail, ':b'), context)
  const restoredMembers = f.edits.at(-1)
  const state = f.resolve(dataButtons(restoredMembers)[0].callback_data, context).state
  assert.equal(state.kind, 'gm')
  assert.equal(state.page, 2)
  assert.equal(state.roomId, 'group_30@chatroom')
  const parent = messageButtons(restoredMembers).find(b => b.text === zh['directory.back_groups'])
  assert(parent)
  await f.action(parent.callback_data, context)
  const restoredGroups = f.resolve(dataButtons(f.edits.at(-1))[0].callback_data, context).state
  assert.equal(restoredGroups.kind, 'gr')
  assert.equal(restoredGroups.query, '项目 A')
  assert.equal(restoredGroups.page, 2)
  assert(f.events.filter(e => e.startsWith('members:')).every(e => e === 'members:group_30@chatroom'))
  assert.equal(f.selected.length + f.bindings.length + f.creations.length, 0)
  assert(f.apiCalls.every(call => call.payload.message_thread_id === undefined || call.payload.message_thread_id === 77))
})

test('/members in a bound topic resolves the exact topic and displays that WeChat group directly', async () => {
  const f = fixture({members: groupMembers, contacts: [{userName: 'member_0', nickName: '好友昵称', alias: '真实微信号'}]})
  const context = {type: 'supergroup', threadId: 88}
  f.hooks.telegramBinding = async (chatId, threadId) => {
    assert.equal(chatId, -10012345)
    assert.equal(threadId, 88)
    return {type: 1, wxId: 'bound@chatroom'}
  }
  await f.command('/members', context)
  const page = f.replies.at(-1)
  assert.equal(f.resolve(dataButtons(page)[0].callback_data, context).state.kind, 'gm')
  assert(f.events.includes('members:bound@chatroom'))
  await f.action(dataButtons(page)[0].callback_data, context)
  assert.match(resultText(f.replies.at(-1)), /好友昵称/)
  assert.match(resultText(f.replies.at(-1)), /真实微信号/)
  assert.equal(f.bindings.length + f.creations.length, 0)
})

test('member compatibility mode retains the room and group return across navigation', async () => {
  const f = fixture({members: groupMembers, rooms: [{chatroomId: 'room@chatroom', nickName: '测试群'}]})
  await f.command('/members')
  await f.action(button(f.replies[0], ':c'))
  await f.action(dataButtons(f.edits.at(-1))[0].callback_data)
  await f.action(button(f.edits.at(-1), ':p:2'))
  const members = f.edits.at(-1)
  assert.equal(members.rich_message, undefined)
  assert.equal(f.resolve(dataButtons(members)[0].callback_data).state.roomId, 'room@chatroom')
  await f.action(dataButtons(members)[0].callback_data)
  assert.match(f.replies.at(-1).text, /member_30/)
  await f.action(button(f.replies.at(-1), ':b'))
  const parent = externalButtons(f.edits.at(-1)).find(b => b.text === zh['directory.back_groups'])
  await f.action(parent.callback_data)
  assert.equal(f.resolve(dataButtons(f.edits.at(-1))[0].callback_data).state.kind, 'gr')
})

test('member loading errors are contained and a later explicit click can retry', async () => {
  const f = fixture({rooms: [{chatroomId: 'room@chatroom', nickName: '群'}]})
  await f.command('/members')
  const select = dataButtons(f.replies[0])[0].callback_data
  f.hooks.members = async () => {throw new Error('private upstream response')}
  await f.action(select)
  assert.equal(f.replies.at(-1).text, zh['pagination.unavailable'])
  delete f.hooks.members
  await f.action(select)
  assert(f.edits.at(-1).text.includes(zh['directory.no_members']))
  assert(messageButtons(f.edits.at(-1)).some(b => b.text === zh['directory.back_groups']))
  assert.equal(f.bindings.length + f.creations.length, 0)
})

for (const command of ['contacts', 'members']) {
  test(`/${command} rejects wrong scope, expired callbacks and offline browsing`, async () => {
    let now = 100
    const f = fixture({contacts: people, rooms: [{chatroomId: 'room@chatroom', nickName: '群'}],
      pagerOptions: {ttlMs: 10, now: () => now}})
    const context = {type: 'supergroup', threadId: 77}
    await f.command(`/${command}`, context)
    const select = dataButtons(f.replies[0])[0].callback_data
    for (const invalid of [{...context, userId: 999}, {...context, chatId: -999}, {...context, threadId: 88}]) {
      await f.action(select, invalid)
      assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
    }
    now = 111
    await f.action(select, context)
    assert.equal(f.replies.at(-1).text, zh['pagination.expired'])
    f.wxClient.hasLogin = false
    await f.command(`/${command}`, context)
    assert.equal(f.replies.at(-1).text, zh['login.please_login_wx'])
    assert.equal(f.edits.length + f.selected.length + f.bindings.length + f.creations.length, 0)
  })
}

test('read-only views do not expose records if the account changes while loading', async () => {
  const f = fixture({contacts: people, rooms: [{chatroomId: 'room@chatroom', nickName: '群'}]})
  await f.command('/contacts')
  f.hooks.detail = async () => {f.wxClient.wxInfo.wxid = 'another'; return people[0]}
  await f.action(dataButtons(f.replies[0])[0].callback_data)
  assert.equal(resultText(f.replies.at(-1)), zh['pagination.expired'])
  f.wxClient.wxInfo.wxid = 'wx_owner'
  await f.command('/members')
  f.hooks.members = async () => {f.wxClient.wxInfo.wxid = 'another'; return groupMembers}
  await f.action(dataButtons(f.replies.at(-1))[0].callback_data)
  assert.equal(resultText(f.replies.at(-1)), zh['pagination.expired'])
  assert.equal(f.edits.length, 0)
})

test('deleted contacts and unavailable optional profile fields are handled without guessing', async () => {
  const contacts = [...people]
  const f = fixture({contacts})
  await f.command('/contacts')
  const select = dataButtons(f.replies[0])[0].callback_data
  contacts.shift()
  await f.action(select)
  assert.equal(resultText(f.replies.at(-1)), zh['pagination.selection_unavailable'])
  assert(button(f.replies.at(-1), ':b'))
  await f.command('/contacts')
  await f.action(dataButtons(f.replies.at(-1))[0].callback_data)
  const detail = resultText(f.replies.at(-1))
  assert.match(detail, /wxid_1/)
  assert(!/undefined|null|性别：|地区：/.test(detail))
  assert.equal(f.selected.length + f.bindings.length + f.creations.length, 0)
})

test('very long Unicode profile fields stay below Telegram limits without broken surrogate pairs', async () => {
  const long = '😀'.repeat(1000)
  const f = fixture({contacts: [{userName: 'wx_1', nickName: long, remark: long, alias: long,
    country: long, province: long, city: long, signature: long, description: long, verifyFlag: 0}]})
  await f.command('/contacts')
  await f.action(dataButtons(f.replies[0])[0].callback_data)
  const detail = resultText(f.replies.at(-1))
  assert(detail.length < 4096)
  assert(detail.includes('…'))
  assert.equal(detail, Buffer.from(detail).toString('utf8'))
})