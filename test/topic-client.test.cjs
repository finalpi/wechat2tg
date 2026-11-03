/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Markup} = require('telegraf')
const topics = require('../dist/util/TelegramTopicUtils')
const textUtils = require('../dist/util/TelegramTextUtils')
const chatId = -10012345
const noop = () => undefined

function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), {
    exports, console, Buffer, process: {env: {WEBUI_ENABLED: 'false'}},
    setTimeout: () => 1, clearTimeout: noop,
    require: name => dependencies[name] || {},
  })
  return exports
}

function fixture() {
  const sent = [], saved = [], forwarded = [], lookups = [], commands = new Map(), actions = [], handlers = []
  let enabled = true
  const binding = {chatId, threadId: 77, wxId: 'gh_news', type: 0, isReceive: true, isForwardOthers: true}
  const bind = {
    isManagedForum: async id => id === chatId,
    resolveTelegram: async (id, thread) => id === chatId
      ? enabled && thread === 77 ? {...binding} : undefined
      : {chatId: id, wxId: 'wxid_legacy', isForwardOthers: true},
    resolveWechat: async () => ({...binding}),
    createOrUpdate: async value => saved.push({...value}),
    removeByChatIdOrWxId: async () => {throw Error('must not unbind forum')},
  }
  const messages = {
    getByBotMsgId: async (...args) => {lookups.push(args); return messages.stored},
    getByWxMsgId: async () => messages.stored,
    createOrUpdate: async value => saved.push({...value}),
    listRecentByChatId: async (...args) => {lookups.push(args); return []},
  }
  const telegram = new Proxy({}, {get: (_, method) => async (...args) => {
    sent.push({method, args})
    return {message_id: 900}
  }})
  const wxClient = {hasReady: true, hasLogin: true, wxInfo: {wxid: 'me'},
    sendMessage: async message => {forwarded.push(message); return true},
    revokeMessage: async message => forwarded.push(message),
    client: {Message: {getXmlToJson: () => ({msg: {location: {x: '1', y: '2'}}})}},
  }
  class Filename {constructor(name) {this.fileName = name}}
  const mt = {hasLogin: true, client: {
    getInputEntity: async id => id,
    sendFile: async (...args) => {sent.push({method: 'mtFile', args}); return {id: 901}},
    getMessages: async () => [],
  }}
  const spy = name => name === 'wxClient' ? wxClient : name === 'botClient' ? {client: {telegram}} : name === 'botMTPClient' ? mt : {hasLogin: false}
  const deps = {
    telegraf: {Markup}, 'telegraf/filters': {message: name => name},
    '../base/BaseClient': {AbstractClient: class {static getSpyClient(name) {return spy(name)}}},
    '../util/TelegramTopicUtils': topics, '../util/TelegramTextUtils': textUtils,
    '../config': {config: {AI_API_KEY: 'synthetic', AI_API_URL: 'https://invalid.example', AI_CONTEXT_LIMIT: 2}},
    '../entity/Message': {Message: class {}},
    '../util/FormatUtils': {FormatUtils: {transformIdentityBodyStr: (_mode, _sender, content) => content}},
    '../service/TelegramCommandHelper': {setCommand: noop, setSimpleCommandHandler: noop},
    '../service/AiReplyService': {AiReplyService: {getInstance: () => ({generateReplySuggestion: async () => 'suggestion', formatSuggestionsForTelegram: x => x})}},
    '../util/FileUtils': {FileUtils: {downloadBufferWithProxy: async () => Buffer.from('data')}},
    'node:fs': {existsSync: () => true, readFileSync: () => Buffer.from('gif')},
    'node:path': path,
    'telegram': {Api: {DocumentAttributeFilename: Filename}},
    'telegram/client/uploads': {CustomFile: class {}},
  }
  const {TelegramBotClient} = load('client/TelegramBotClient.js', deps)
  const client = Object.create(TelegramBotClient.prototype)
  Object.assign(client, {
    bindGroupService: bind, messageService: messages,
    configurationService: {getConfig: async () => ({})},
    i18n: {t: key => key, getLanguage: () => 'zh-CN'},
    logger: {info: noop, warn: noop, error: noop, debug: noop},
    messageSender: {
      sendText: async (...args) => {sent.push({method: 'text', args}); return {message_id: 800}},
      sendFile: async (...args) => {sent.push({method: 'file', args}); return {message_id: 801}},
    },
  })
  client.sendTelegramRequest = async (_id, fn) => fn()
  client.onMessage({on: (kind, fn) => handlers.push({kind, fn})})
  client.onBotCommand({command: (name, fn) => commands.set(name, fn), start: noop, help: noop})
  client.onBotAction({action: (pattern, fn) => actions.push({pattern, fn})})
  const ctx = (thread = 77, extra = {}, id = chatId) => {
    const message = {message_id: 20, message_thread_id: thread, text: 'hello', ...extra}
    return {chat: {id, type: 'supergroup'}, message, update: {message}, text: message.text,
      telegram: Object.assign(Object.create(telegram), {getFileLink: async () => new URL('https://invalid.example/file')}),
      reply: async (text, options) => {sent.push({method: 'reply', args: [id, text, options]}); return {message_id: 900}},
      answerCbQuery: noop, editMessageReplyMarkup: noop,
    }
  }
  const action = async (data, context) => {
    context.callbackQuery = {message: context.message}
    delete context.message
    const match = actions.find(a => a.pattern.test(data))
    context.match = {input: data}
    await match.fn(context)
  }
  return {client, bind, messages, sent, saved, forwarded, lookups, commands, ctx, action, mt, Filename,
    text: context => handlers.find(h => h.kind === 'text').fn(context),
    disable: () => {enabled = false},
  }
}

function userFixture() {
  const forwarded = [], handlers = [], lookups = []
  let forward = true
  class PeerUser {constructor(id) {this.userId = {eq: other => id === other}}}
  class NewMessage {}
  class DeletedMessage {}
  const wx = {wxInfo: {wxid: 'me'}, sendMessage: async msg => forwarded.push(msg), revokeMessage: async msg => forwarded.push(msg)}
  const {UserMTProtoClient} = load('client/UserMTProtoClient.js', {
    '../base/BaseClient': {AbstractClient: class {static getSpyClient() {return wx}}},
    '../util/TelegramTopicUtils': topics, '../util/TelegramTextUtils': textUtils,
    '../service/ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig: async () => ({botId: 2})})}},
    '../service/BindGroupService': {BindGroupService: {getInstance: () => ({resolveTelegram: async (id, thread) => {
      lookups.push([id, thread])
      return id === chatId && thread === 77 ? {wxId: 'gh_news', isForwardOthers: forward} : undefined
    }})}},
    '../service/MessageService': {MessageService: {getInstance: () => ({getByBotMsgId: async (id, msgId) => {
      lookups.push([id, msgId])
      return {chatId: id, threadId: 77, wxSenderId: 'me'}
    }})}},
    'telegram': {Api: {PeerUser}}, 'telegram/Helpers': {returnBigInt: value => value},
    'telegram/events': {NewMessage}, 'telegram/events/DeletedMessage': {DeletedMessage},
  })
  const client = Object.create(UserMTProtoClient.prototype)
  client.client = {getMe: async () => ({id: 1}), checkAuthorization: async () => false, start: async () => undefined,
    addEventHandler: (fn, event) => handlers.push({fn, event}),
  }
  client.createFolder = noop
  return {client, forwarded, lookups, handlers, PeerUser, NewMessage, DeletedMessage, disableForward: () => {forward = false}}
}

const flush = () => new Promise(resolve => setImmediate(resolve))
const outbound = (type = 0) => ({id: 'wx-1', chatId, threadId: 77, conversationWxId: 'gh_news', wxId: 'gh_news', senderId: 'gh_news', sender: 'News', content: 'hello', type,
  file: {fileName: 'test.bin', file: Buffer.from('data'), sendType: 'document'}})

for (const quoteThread of [undefined, 77, 88]) {
  test(`text ingress uses current topic, not quoted topic ${quoteThread}`, async () => {
    const f = fixture()
    f.messages.stored = {chatId, threadId: quoteThread}
    const c = f.ctx(77, quoteThread ? {reply_to_message: {message_id: 10, message_thread_id: quoteThread}} : {})
    await f.text(c)
    assert.equal(f.forwarded[0].threadId, 77)
    assert.equal(f.forwarded[0].conversationWxId, 'gh_news')
    assert.equal(f.forwarded[0].param?.replyMessageId, quoteThread === 77 ? 10 : undefined)
    if (quoteThread) assert.deepEqual(f.lookups[0], [chatId, 10, 77])
  })
}

for (const thread of [undefined, 1, 88]) {
  test(`General/unknown ${thread} blocks text and media before download`, async () => {
    const f = fixture()
    // Explicit undefined bypasses the fixture's default topic.
    const c = f.ctx(77, {message_thread_id: thread, document: {file_id: 'file', file_name: 'test.bin'}})
    await f.text(c)
    await f.client.handleFileMessage(c, 'document')
    assert.equal(f.forwarded.length, 0)
  })
}

test('topic media roots, replies and their captions carry routing metadata', async () => {
  const f = fixture()
  f.messages.stored = {chatId, threadId: 77}
  for (const reply of [undefined, {message_id: 10, message_thread_id: 77}]) {
    const c = f.ctx(77, {text: undefined, caption: 'caption', reply_to_message: reply, document: {file_id: 'file', file_name: 'test.bin'}})
    await f.client.handleFileMessage(c, 'document')
    await flush()
  }
  assert.equal(f.forwarded.length, 4)
  for (const msg of f.forwarded) {
    assert.equal(msg.threadId, 77)
    assert.equal(msg.conversationWxId, 'gh_news')
  }
  assert.equal(f.forwarded.filter(m => m.param?.replyMessageId === 10).length, 2)
  await f.client.sendGif('file.webp', 'file.gif', f.ctx())
  assert.equal(f.forwarded.at(-1).threadId, 77)
})

test('disabled topics block ingress while ordinary legacy text remains unchanged', async () => {
  const f = fixture()
  f.disable()
  await f.text(f.ctx())
  assert.equal(f.forwarded.length, 0)
  await f.text(f.ctx(undefined, {message_thread_id: undefined, text: '\\/command'}, -55))
  assert.equal(f.forwarded[0].content, '/command')
  assert.equal(f.forwarded[0].threadId, undefined)
  assert.equal(f.forwarded[0].conversationWxId, 'wxid_legacy')
})

test('text/file persistence, Bot API card/location, retry uploads and notices retain topic', async () => {
  const f = fixture()
  await f.client.sendTextMsgSynchronously(outbound())
  await f.client.sendBufferedMessage(outbound(1))
  for (const saved of f.saved) {
    assert.equal(saved.threadId, 77)
    assert.equal(saved.conversationWxId, 'gh_news')
  }
  assert.equal(f.sent.find(s => s.method === 'text').args[2].message_thread_id, 77)
  assert.equal(f.sent.find(s => s.method === 'file').args[2].message_thread_id, 77)
  await f.client.sendBusinessCardMessage(outbound(4), {})
  await f.client.sendLocationMessage(outbound(5), {})
  for (const fileType of ['photo', 'video', 'voice', 'animation', 'document']) {
    await f.client.sendWechatRetryFile(chatId, Buffer.from('data'), {fileName: 'retry', fileType, threadId: 77, replyToMessageId: 22})
  }
  await f.client.sendTelegramFileNotice(chatId, 'upload', 77)
  await f.client.createTelegramUploadProgressEditor(chatId, 'upload', 5, undefined, 77)
  for (const send of f.sent.filter(s => String(s.method).startsWith('send'))) {
    assert.equal(send.args.at(-1).message_thread_id, 77)
  }
})

test('large MTProto uploads specify topic root and topMsgId, with original reply when present', async () => {
  const f = fixture()
  await f.client.sendLargeDocumentViaTelegramApi(outbound(1))
  await f.client.sendLargeDocumentViaTelegramApi({...outbound(1), param: {reply_id: 23}})
  const uploads = f.sent.filter(s => s.method === 'mtFile')
  assert.equal(uploads[0].args[1].replyTo, 77)
  assert.equal(uploads[1].args[1].replyTo, 23)
  assert(uploads.every(s => s.args[1].topMsgId === 77))
})

test('upload recovery rejects an identical filename in another topic', async () => {
  const f = fixture()
  const doc = {attributes: [new f.Filename('same.bin')], size: 4}
  f.mt.client.getMessages = async () => [
    {id: 10, document: doc, replyTo: {forumTopic: true, replyToMsgId: 88}},
    {id: 11, document: doc, replyTo: {forumTopic: true, replyToTopId: 77, replyToMsgId: 55}},
  ]
  assert.equal(await f.client.findRecentUploadedTelegramDocumentMessageId(f.mt, chatId, 'same.bin', 4, 0, 77), 11)
})

test('AI context is scoped by current topic before repository limit and General is blocked', async () => {
  const f = fixture()
  const c = f.ctx(77, {text: '/ai suggest'})
  c.telegram = {editMessageText: async () => undefined}
  await f.client.handleAiCommand(c)
  assert.deepEqual(f.lookups, [[chatId, 6, 77]])
  await f.client.handleAiCommand(f.ctx(1, {text: '/ai suggest'}))
  assert.equal(f.lookups.length, 1)
})

test('message/forward callbacks update only resolved topic and forum mutations are blocked', async () => {
  const f = fixture()
  for (const command of ['message', 'forward']) {
    await f.commands.get(command)(f.ctx())
    await f.action(command, f.ctx())
  }
  assert.equal(f.saved.length, 2)
  assert(f.saved.every(v => v.threadId === 77 && v.wxId === 'gh_news'))
  await f.action('forward', f.ctx(1))
  assert.equal(f.saved.length, 2)
  for (const command of ['quit', 'unbind', 'update']) await f.commands.get(command)(f.ctx())
  assert.equal(f.sent.filter(s => s.method === 'reply' && s.args[1].includes('/official')).length, 3)
})

test('revoke and attachment/retry callbacks reject records from another topic or chat', async () => {
  const f = fixture()
  f.messages.stored = {chatId, threadId: 88, source_text: 'xml', source_type: 'file', wxSenderId: 'me'}
  f.client.downloadChatHistoryAttachment = async () => {throw Error('must not download')}
  f.client.buildWechatRetryMessage = () => {throw Error('must not download')}
  await f.commands.get('revoke')(f.ctx(77, {reply_to_message: {message_id: 10}}))
  for (const data of ['chr:10:root', 'chrw:wx:root', 'chrf:10:root:a', 'chrfw:wx:root:a', 'wmr:wx']) await f.action(data, f.ctx())
  assert.equal(f.forwarded.length, 0)
  assert.equal(f.sent.filter(s => s.method === 'sendDocument').length, 0)
  f.messages.stored.chatId = -55
  f.messages.stored.threadId = 77
  await f.action('wmr:wx', f.ctx())
})

test('UserMTProto forwarding resolves current topic and honors its forward flag for text/media', async () => {
  const f = userFixture()
  await f.client.listenMessage()
  await flush()
  const listener = f.handlers.find(h => h.event instanceof f.NewMessage).fn
  const message = thread => ({id: 20, chatId: {toJSNumber: () => chatId}, fromId: new f.PeerUser(3),
    message: 'hello', replyTo: {forumTopic: true, replyToTopId: thread, replyToMsgId: 10},
    media: {className: 'MessageMediaDocument'}, document: {mimeType: 'application/pdf'}, downloadMedia: async () => Buffer.from('pdf')})
  await listener({message: message(77)})
  await flush()
  assert.equal(f.forwarded.length, 2)
  assert(f.forwarded.every(msg => msg.threadId === 77 && msg.conversationWxId === 'gh_news'))
  await listener({message: message(88)})
  await listener({message: {...message(77), replyTo: undefined}})
  f.disableForward()
  await listener({message: message(77)})
  assert.equal(f.forwarded.length, 2)
})

test('UserMTProto deletion skips unscoped IDs and scopes known events by event.chatId', async () => {
  const f = userFixture()
  f.client.listenMessage = noop
  await f.client.login({})
  const listener = f.handlers.find(h => h.event instanceof f.DeletedMessage).fn
  await listener({deletedIds: [20]})
  assert.equal(f.lookups.length, 0)
  await listener({chatId: {toString: () => String(chatId)}, deletedIds: [20, 21]})
  assert.deepEqual(f.lookups, [[chatId, 20], [chatId, 21]])
  assert.equal(f.forwarded.length, 2)
})

test('retry preserves stored destination after feature disable and forbidden send never retargets', async () => {
  const f = fixture()
  f.messages.stored = {...outbound(1), wxMsgId: 'wx-1', source_text: 'xml', source_type: 'file'}
  f.disable()
  f.client.buildWechatRetryMessage = () => ({type: () => 'file', toFileBox: async () => ({name: 'retry', toBuffer: async () => Buffer.from('data')})})
  f.client.wxTypeToTgFileType = () => 'document'
  f.client.editWechatMediaRetryMessage = async () => undefined
  await f.action('wmr:wx-1', f.ctx())
  assert.equal(f.sent.find(s => s.method === 'sendDocument').args[2].message_thread_id, 77)
  const msg = outbound()
  await f.client.dealException({response: {error_code: 403}}, msg)
  assert.equal(msg.chatId, chatId)
  assert.equal(msg.threadId, 77)
  await f.client.sendTextMsgSynchronously(msg)
  assert.equal(f.sent.find(s => s.method === 'text').args[2].message_thread_id, 77)
})