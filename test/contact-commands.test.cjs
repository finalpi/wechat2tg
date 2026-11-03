/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Telegraf, Markup} = require('telegraf')
const zh = require('../dist/i18n/locales/zh-CN').default

function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), {
    exports, console, Buffer,
    require: name => dependencies[name] || {},
  })
  return exports
}

function fixture({contacts = [], rooms = [], loggedIn = true} = {}) {
  const replies = [], edits = [], queries = [], menus = [], selected = [], bindings = []
  const i18n = {t: key => zh[key] || key}
  const baseDependencies = {'../i18n': {getInstance: () => i18n}}
  const keyboard = load('util/KeyboardPageUtils.js', {...baseDependencies, telegraf: {Markup}})
  const contactsRepository = {
    getAll: async () => contacts,
    getByNickNameOrRemark: async query => {
      queries.push({kind: 'contact', query})
      return contacts.filter(c => c.nickName.includes(query) || c.remark?.includes(query))
    },
  }
  const roomRepository = {
    getAll: async () => rooms,
    getByNickNameOrRemark: async query => {
      queries.push({kind: 'room', query})
      return rooms.filter(c => c.nickName.includes(query) || c.remark?.includes(query))
    },
  }
  const wxClient = {hasLogin: loggedIn, client: {Contact: {find: async ({id}) => {
    selected.push(id)
    return {name: () => '公众号'}
  }}}}
  const commandHelper = load('service/TelegramCommandHelper.js', {
    ...baseDependencies,
    '../util/LogUtil': {LogUtils: {debugLog: () => ({debug: () => undefined})}},
    '../util/PageHelper': {initBot: () => undefined},
  })
  const {TelegramBotClient} = load('client/TelegramBotClient.js', {
    ...baseDependencies,
    telegraf: {Markup},
    '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return wxClient}}},
    '../service/TelegramCommandHelper': commandHelper,
    '../util/KeyboardPageUtils': keyboard,
    '../repository/WxContactRepository': {WxContactRepository: {getInstance: () => contactsRepository}},
    '../repository/WxRoomRepository': {WxRoomRepository: {getInstance: () => roomRepository}},
    '../entity/BindGroup': {BindGroup: class {}},
  })
  const client = Object.create(TelegramBotClient.prototype)
  client.i18n = i18n
  client.bindGroupService = {
    removeByChatIdOrWxId: async () => undefined,
    createOrUpdate: async value => bindings.push(value),
  }
  client.updateGroupByChatId = async () => undefined
  const bot = new Telegraf('123:synthetic-test-token')
  bot.botInfo = {id: 123, is_bot: true, first_name: 'Test', username: 'test_bot'}
  bot.telegram.setMyCommands = async commands => {menus.push(...commands)}
  bot.context.reply = async (text, options) => {replies.push({text, options})}
  bot.context.editMessageReplyMarkup = async markup => {edits.push(markup)}
  bot.context.answerCbQuery = async () => true
  // Telegraf uses instanceof RegExp; preserve patterns when crossing the VM boundary.
  const registerAction = bot.action.bind(bot)
  bot.action = (trigger, ...handlers) => registerAction(
    Object.prototype.toString.call(trigger) === '[object RegExp]' ? new RegExp(trigger.source, trigger.flags) : trigger,
    ...handlers,
  )
  client.onBotCommand(bot)
  client.onBotAction(bot)
  let updateId = 0
  const chat = type => ({id: type === 'private' ? 456 : -10012345, type})
  return {
    replies, edits, queries, menus, selected, bindings,
    command: (text, type = 'private') => bot.handleUpdate({update_id: ++updateId, message: {
      message_id: updateId, date: 1, from: {id: 456, is_bot: false, first_name: 'Owner'}, chat: chat(type), text,
      entities: [{type: 'bot_command', offset: 0, length: text.split(/\s/, 1)[0].length}],
    }}),
    action: (data, type = 'private') => bot.handleUpdate({update_id: ++updateId, callback_query: {
      id: String(updateId), from: {id: 456, is_bot: false, first_name: 'Owner'}, chat_instance: 'synthetic', data,
      message: {message_id: updateId, date: 1, from: bot.botInfo, chat: chat(type), text: 'list'},
    }}),
  }
}

const people = Array.from({length: 12}, (_, i) => ({userName: `wxid_${i}`, nickName: `用户${i}`, remark: ''}))
const official = Array.from({length: 12}, (_, i) => ({userName: `gh_${i}`, nickName: `公众号${i}`, remark: ''}))
const mixed = people.flatMap((person, i) => [person, official[i]])
const dataButtons = markup => markup.inline_keyboard.flat().filter(b => !b.callback_data.includes(':page-'))

test('/user excludes official accounts and renders names without a decorative emoji', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user')
  const buttons = dataButtons(f.replies[0].options.reply_markup)
  assert.equal(buttons.length, 10)
  assert(buttons.every(b => b.callback_data.startsWith('us:wxid_')))
  assert.equal(buttons[0].text, '用户0')
  await f.action('us:page-2')
  assert.deepEqual(Array.from(dataButtons(f.edits[0]), b => b.text), ['用户10', '用户11'])
})

test('/official is registered, lists only official accounts and stays filtered on the next page', async () => {
  const f = fixture({contacts: mixed})
  assert(f.menus.some(c => c.command === 'official' && c.description === '查看公众号'))
  await f.command('/official')
  assert.equal(f.replies.length, 1)
  assert.equal(f.replies[0].text, '创建公众号群组')
  const buttons = dataButtons(f.replies[0].options.reply_markup)
  assert(buttons.every(b => b.callback_data.startsWith('of:gh_')))
  assert.equal(buttons[0].text, '公众号0')
  await f.action('of:page-2')
  assert.deepEqual(Array.from(dataButtons(f.edits[0]), b => b.text), ['公众号10', '公众号11'])
})

for (const command of ['user', 'official', 'room']) {
  for (const mention of ['', '@test_bot']) {
    test(`/${command}${mention} preserves spaces and punctuation in a group search`, async () => {
      const query = '项目 A（研发）-1'
      const f = fixture({contacts: [
        {userName: 'wxid_match', nickName: query, remark: ''},
        {userName: 'gh_match', nickName: query, remark: ''},
      ], rooms: [{chatroomId: 'room@chatroom', nickName: query, remark: ''}]})
      await f.command(`/${command}${mention}  ${query}  `, 'supergroup')
      assert.deepEqual(f.queries, [{kind: command === 'room' ? 'room' : 'contact', query}])
      const buttons = dataButtons(f.replies[0].options.reply_markup)
      assert.equal(buttons.length, 1)
      assert.equal(buttons[0].text, query)
      assert.equal(buttons[0].callback_data, command === 'room' ? 'ro:room@chatroom' : command === 'official' ? 'of:gh_match' : 'us:wxid_match')
    })
  }
}

test('user search does not show official-only matches, and official search does not show user-only matches', async () => {
  const f = fixture({contacts: mixed})
  await f.command('/user 公众号')
  assert.equal(f.replies[0].text, '未查找到联系人')
  await f.command('/official 用户')
  assert.equal(f.replies[1].text, '未查找到公众号')
})

test('room pages have no decorative emoji and keep emojis that are part of the real name', async () => {
  const rooms = Array.from({length: 11}, (_, i) => ({chatroomId: `${i}@chatroom`, nickName: `群${i}`, remark: ''}))
  rooms[0].remark = '🏠 家人'
  const f = fixture({rooms})
  await f.command('/room')
  assert.equal(dataButtons(f.replies[0].options.reply_markup)[0].text, '🏠 家人')
  await f.action('ro:page-2')
  assert.equal(dataButtons(f.edits[0])[0].text, '群10')
})

test('official account selection reuses the existing contact binding flow', async () => {
  const f = fixture()
  await f.action('of:gh_selected', 'supergroup')
  assert.deepEqual(f.selected, ['gh_selected'])
  assert.equal(f.bindings.length, 1)
  assert.equal(f.bindings[0].wxId, 'gh_selected')
  assert.equal(f.bindings[0].type, 0)
  assert.equal(f.replies[0].text, '绑定成功')
})

test('mentioned commands with no query list only their own category', async () => {
  const f = fixture({contacts: mixed, rooms: [{chatroomId: '1@chatroom', nickName: '测试群', remark: ''}]})
  await f.command('/user@test_bot   ')
  await f.command('/official@test_bot')
  await f.command('/room@test_bot')
  assert.equal(f.queries.length, 0)
  assert(dataButtons(f.replies[0].options.reply_markup).every(b => b.callback_data.startsWith('us:wxid_')))
  assert(dataButtons(f.replies[1].options.reply_markup).every(b => b.callback_data.startsWith('of:gh_')))
  assert.equal(dataButtons(f.replies[2].options.reply_markup)[0].text, '测试群')
})

test('legacy official-account buttons still bind and blank names fall back to account ID', async () => {
  const f = fixture({contacts: [{userName: 'gh_empty', nickName: '', remark: ''}]})
  await f.command('/official')
  assert.equal(dataButtons(f.replies[0].options.reply_markup)[0].text, 'gh_empty')
  await f.action('us:gh_legacy', 'supergroup')
  assert.equal(f.bindings[0].wxId, 'gh_legacy')
})

test('command mentions for another bot are ignored, and official listing requires login', async () => {
  const f = fixture({contacts: mixed, loggedIn: false})
  await f.command('/user@another_bot 用户')
  assert.equal(f.replies.length, 0)
  await f.command('/official')
  assert.equal(f.replies[0].text, '请先登录微信')
})