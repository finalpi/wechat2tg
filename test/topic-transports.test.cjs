/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Transpile the real source so these isolated tests do not depend on a full build
// or a stale dist directory. Only explicitly supplied dependencies may be loaded.
const compiled = new Map()
function load(file, dependencies = {}) {
  if (!compiled.has(file)) {
    compiled.set(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2021,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        experimentalDecorators: true,
      },
      fileName: file,
    }).outputText)
  }
  const exports = {}
  vm.runInNewContext(compiled.get(file), {
    exports, Buffer, console, setTimeout, clearTimeout,
    require(name) {
      assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  }, {filename: file})
  return exports
}
const emojiData = load('util/WechatCustomEmojiData.ts')
const emojiHtml = load('util/WechatCustomEmoji.ts', {
  './WechatCustomEmojiData': emojiData,
  htmlparser2: require('htmlparser2'),
  entities: require('entities'),
})
const {HTMLParser} = require('telegram/extensions/html')
const {Api} = require('telegram')
const [emojiAlias, customEmoji] = Object.entries(emojiData.WECHAT_CUSTOM_EMOJI)[0]
const plain = value => JSON.parse(JSON.stringify(value))
const media = fileType => ({buff: Buffer.from('test'), filename: 'test.bin', caption: 'caption', fileType})
const replyParameters = params=>typeof params.reply_parameters === 'string' ? JSON.parse(params.reply_parameters) : params.reply_parameters

function transport(kind, failure, enabled = false, displayOptions = {}) {
  const presentation = require('./helpers/telegram-presentation')(displayOptions)
  const actions = [], calls = []
  const invoke = method => async (...args) => {
    calls.push({method, args})
    const error = typeof failure === 'function' ? failure(calls.length) : failure
    if (error) throw error
    return displayOptions.receipt || {id: 123, message_id: 123}
  }
  const base = load('message/MessageSender.ts', {
    '../client/TelegramBotClient': {TelegramBotClient: {getSpyClient: () => ({client: {telegram: {
      sendChatAction: async (...args) => {actions.push(args)},
    }}})}},
  })
  let sender
  if (kind === 'bot') {
    const {TelegramBotApiMessageSender} = load('message/TelegramBotApiMessageSender.ts', {
      './MessageSender': base,
      '../config': {config: {WECHAT_CUSTOM_EMOJI_ENABLED: enabled}},
      '../util/WechatCustomEmoji': emojiHtml,
      '../util/TelegramPresentation': presentation,
      '../util/TelegramKeyboard': load('util/TelegramKeyboard.ts'),
      'abort-controller': AbortController,
    })
    sender = new TelegramBotApiMessageSender({telegram: Object.fromEntries(
      ['sendMessage', 'callApi', 'editMessageMedia', 'editMessageCaption', 'deleteMessage'].map(name => [name, invoke(name)]),
    )})
  } else {
    const {TelegramApiMessageSender} = load('message/TelegramApiMessageSender.ts', {
      './MessageSender': base,
      '../config': {config: {WECHAT_CUSTOM_EMOJI_ENABLED: enabled}},
      '../util/WechatCustomEmoji': emojiHtml,
      '../util/TelegramPresentation': presentation,
      '../util/TelegramKeyboard': load('util/TelegramKeyboard.ts'),
      'telegram/client/uploads': {CustomFile: class {
        constructor(name, size, filePath, buffer) {Object.assign(this, {name, size, filePath, buffer})}
      }},
      'node:fs': {writeFileSync: () => {throw new Error('Unexpected file write')}},
      telegram: {Api: {KeyboardButtonCallback: class {constructor(options) {Object.assign(this, options)}}}},
    })
    sender = new TelegramApiMessageSender({
      getInputEntity: async chatId => chatId,
      ...Object.fromEntries(['sendMessage', 'sendFile', 'editMessage', 'deleteMessages'].map(name => [name, invoke(name)])),
    })
  }
  return {sender, actions, calls}
}

test('Bot API text preserves topic, reply, parse mode, keyboard, and topic action', async () => {
  const f = transport('bot')
  assert.deepEqual(plain(await f.sender.sendText(-100, 'hello', {
    message_thread_id: 42, reply_id: 91, parse_mode: 'HTML',
    inline_keyboard: [{text: 'open', callback_data: 'open'}],
  })), {message_id: 123})
  assert.deepEqual(plain(f.calls[0]), {method: 'sendMessage', args: [-100, 'hello', {
    message_thread_id: 42,
    reply_parameters: {message_id: 91},
    parse_mode: 'HTML',
    reply_markup: {inline_keyboard: [[{text: 'open', callback_data: 'open'}]]},
  }]})
  assert.deepEqual(plain(f.actions), [[-100, 'typing', {message_thread_id: 42}]])
  await f.sender.sendText(-100, 'topic root', {message_thread_id: 42})
  assert.equal(f.calls[1].args[2].message_thread_id, 42)
  assert.equal(Object.hasOwn(f.calls[1].args[2], 'reply_parameters'), false)
})

for (const fileType of ['animation', 'document', 'audio', 'photo', 'video', 'voice']) {
  test(`Bot API ${fileType} preserves topic and explicit reply`, async () => {
    const f = transport('bot')
    await f.sender.sendFile(-100, media(fileType), {message_thread_id: 42, reply_id: 91, parse_mode: 'HTML'})
    const [method, payload] = f.calls[0].args
    assert.equal(method, `send${fileType[0].toUpperCase()}${fileType.slice(1)}`)
    assert.equal(payload.chat_id, -100)
    assert.equal(payload.message_thread_id, 42)
    assert.deepEqual(plain(replyParameters(payload)), {message_id: 91})
    assert.equal(payload.parse_mode, 'HTML')
    assert.equal(payload.caption, 'caption')
    assert.equal(payload[fileType].source.toString(), 'test')
    assert.deepEqual(plain(f.actions), [[-100, 'upload_document', {message_thread_id: 42}]])
    await f.sender.sendFile(-100, media(fileType))
    assert.equal(Object.hasOwn(f.calls[1].args[1], 'message_thread_id'), false)
    assert.equal(Object.hasOwn(f.calls[1].args[1], 'reply_parameters'), false)
    assert.deepEqual(plain(f.actions[1]), [-100, 'upload_document'])
  })
}

for (const method of ['sendText', 'sendFile']) {
  for (const reply_id of [undefined, 91]) {
    test(`GramJS ${method} sets topMsgId and ${reply_id ? 'explicit reply' : 'topic root replyTo'}`, async () => {
      const f = transport('gram')
      const value = method === 'sendText' ? 'hello' : media('document')
      await f.sender[method](-100, value, {message_thread_id: 42, reply_id, parse_mode: 'HTML'})
      const [chatId, params] = f.calls[0].args
      assert.equal(chatId, -100)
      assert.equal(params.topMsgId, 42)
      assert.equal(params.replyTo, reply_id ?? 42)
      assert.equal(params.parseMode, 'html')
      assert.equal(f.actions[0][2].message_thread_id, 42)
      if (method === 'sendFile') {
        assert.equal(params.caption, 'caption')
        assert.equal(params.forceDocument, true)
        assert.equal(params.file.buffer.toString(), 'test')
      } else {
        assert.equal(params.message, 'hello')
      }
    })
  }
}

for (const kind of ['bot', 'gram']) {
  test(`${kind} ordinary sends retain legacy reply behavior without topic fields`, async () => {
    const f = transport(kind)
    for (const method of ['sendText', 'sendFile']) {
      for (const option of [undefined, {reply_id: 91, parse_mode: 'HTML'}]) {
        await f.sender[method](-100, method === 'sendText' ? 'hello' : media('document'), option)
        const call = f.calls.at(-1)
        const params = kind === 'bot' && method === 'sendText' ? call.args[2] : call.args[1]
        assert.equal(Object.hasOwn(params, 'message_thread_id'), false)
        assert.equal(Object.hasOwn(params, 'topMsgId'), false)
        assert.equal(kind === 'bot' ? replyParameters(params)?.message_id : params.replyTo, option?.reply_id)
        assert.equal(f.actions.at(-1).length, 2)
      }
    }
  })

  test(`${kind} edits/deletes target original IDs and topic failures never fall back to General`, async () => {
    const f = transport(kind)
    await f.sender.editFile(-100, 91, {fileType: 'photo', caption: 'edited'}, {message_thread_id: 42, parse_mode: 'HTML'})
    await f.sender.deleteMessage(-100, 91)
    assert.equal(f.calls.length, 2)
    if (kind === 'bot') {
      assert.deepEqual(f.calls[0].args.slice(0, 2), [-100, 91])
      assert.deepEqual(f.calls[1].args, [-100, 91])
    } else {
      assert.equal(f.calls[0].args[1].message, 91)
      assert.deepEqual(plain(f.calls[1].args), [-100, [91], {}])
    }
    const failed = transport(kind, new Error('topic unavailable'))
    await assert.rejects(failed.sender.sendText(-100, 'hello', {message_thread_id: 42}), /topic unavailable/)
    await assert.rejects(failed.sender.sendFile(-100, media('document'), {message_thread_id: 42}), /topic unavailable/)
    assert.equal(failed.calls.length, 2)
  })
}

for (const kind of ['bot', 'gram']) {
  test(`${kind} renders real custom emoji at HTML text, media and edit boundaries without mutating inputs`, async () => {
    const f = transport(kind, undefined, true)
    const original = `<b>${emojiAlias} 🙂</b><code>${emojiAlias}</code><tg-emoji emoji-id="${customEmoji.id}">${customEmoji.emoji}</tg-emoji>`
    const option = {parse_mode: 'HTML', message_thread_id: 42, reply_id: 91}
    const file = {...media('document'), caption: original}
    const beforeFile = {...file}, beforeOption = {...option}
    await f.sender.sendText(-100, original, option)
    await f.sender.sendFile(-100, file, option)
    await f.sender.editFile(-100, 91, {fileType: 'audio', caption: original}, option)
    await f.sender.editAudio(-100, 91, original)
    const htmls = kind === 'bot'
      ? [f.calls[0].args[1], f.calls[1].args[1].caption, f.calls[2].args[3].caption, f.calls[3].args[3]]
      : [f.calls[0].args[1].message, f.calls[1].args[1].caption, f.calls[2].args[1].text, f.calls[3].args[1].text]
    for (const html of htmls) {
      assert.equal(html, emojiHtml.renderWechatCustomEmojiHtml(original, true))
      assert.equal((html.match(/<tg-emoji /g) || []).length, 2)
      assert(html.includes(`<code>${emojiAlias}</code>`))
      assert(html.includes('🙂'))
      // Exercise the installed GramJS parser, not merely copied HTML strings.
      const [text, entities] = HTMLParser.parse(html)
      const custom = entities.filter(e => e instanceof Api.MessageEntityCustomEmoji)
      assert.equal(custom.length, 2)
      for (const entity of custom) {
        assert.equal(entity.documentId.toString(), customEmoji.id)
        assert.equal(text.slice(entity.offset, entity.offset + entity.length), customEmoji.emoji)
        assert(entity.getBytes().length > 0)
      }
    }
    assert.deepEqual(file, beforeFile)
    assert.deepEqual(option, beforeOption)
    const params = kind === 'bot' ? f.calls[0].args[2] : f.calls[0].args[1]
    assert.equal(kind === 'bot' ? params.message_thread_id : params.topMsgId, 42)
    assert.equal(kind === 'bot' ? params.reply_parameters.message_id : params.replyTo, 91)
  })

  test(`${kind} leaves disabled and non-HTML text/captions unchanged`, async () => {
    for (const [enabled, parse_mode] of [[false, 'HTML'], [true, undefined], [true, 'MarkdownV2']]) {
      const f = transport(kind, undefined, enabled)
      const original = `${emojiAlias} 🙂`
      await f.sender.sendText(-100, original, {parse_mode})
      await f.sender.sendFile(-100, {...media('photo'), caption: original}, {parse_mode})
      await f.sender.editFile(-100, 91, {fileType: 'photo', caption: original}, {parse_mode})
      assert.equal(kind === 'bot' ? f.calls[0].args[1] : f.calls[0].args[1].message, original)
      assert.equal(f.calls[1].args[1].caption, original)
      assert.equal(kind === 'bot' ? f.calls[2].args[3].caption : f.calls[2].args[1].text, original)
      if (!enabled) {
        await f.sender.editAudio(-100, 91, original)
        assert.equal(kind === 'bot' ? f.calls[3].args[3] : f.calls[3].args[1].text, original)
      }
    }
  })

  test(`${kind} emoji permission errors and timeouts are not automatically resent`, async () => {
    for (const failure of [Object.assign(new Error('CUSTOM_EMOJI_INVALID'), {response: {error_code: 400}}), new Error('Request timeout')]) {
      const f = transport(kind, failure, true)
      await assert.rejects(f.sender.sendText(-100, emojiAlias, {parse_mode: 'HTML', message_thread_id: 42}), error => error === failure)
      assert.equal(f.calls.length, 1)
    }
  })
}

for(const kind of ['bot','gram']){
  test(`${kind} compatibility links and explicit rejection fallback preserve topic, reply and receipts`,async()=>{
    const denied = kind === 'bot' ? {response:{error_code:400,description:'Bad Request: CUSTOM_EMOJI_NOT_ALLOWED'}} : {code:400,errorMessage:'CUSTOM_EMOJI_NOT_ALLOWED'}
    const f = transport(kind,n=>n === 1 ? denied : undefined,true,{fallback:'links'})
    const result = await f.sender.sendText(-100,emojiAlias,{parse_mode:'HTML',message_thread_id:42,reply_id:91})
    assert.equal(result.message_id,123);assert.equal(f.calls.length,2)
    const first = kind === 'bot' ? f.calls[0].args[1] : f.calls[0].args[1].message
    const second = kind === 'bot' ? f.calls[1].args[1] : f.calls[1].args[1].message
    assert.match(first,/<tg-emoji/);assert.match(second,/<a href=/)
    const options = kind === 'bot' ? f.calls[1].args[2] : f.calls[1].args[1]
    assert.equal(kind === 'bot' ? options.message_thread_id : options.topMsgId,42)
    assert.equal(kind === 'bot' ? options.reply_parameters.message_id : options.replyTo,91)
    await f.sender.sendFile(-100,{...media('photo'),caption:emojiAlias},{parse_mode:'HTML',message_thread_id:42})
    assert.equal(f.calls.length,3);assert.match(f.calls[2].args[1].caption,/<a href=/,'subsequent captions use the cached compatibility decision')
    const compatible = transport(kind,undefined,true,{mode:'compatible',fallback:'links'})
    await compatible.sender.sendText(-100,emojiAlias,{parse_mode:'HTML'})
    assert.match(kind === 'bot' ? compatible.calls[0].args[1] : compatible.calls[0].args[1].message,/<a href=/)
  })
}

for(const kind of ['bot','gram']){
  const button = {text:'拆红包',callback_data:'rp:0123456789abcdef0123456789abcdef'}
  const keyboard = params=>kind === 'bot' ? params.reply_markup?.inline_keyboard
    : params.buttons?.map(row=>row.map(item=>({text:item.text,callback_data:item.data.toString()})))
  test(`${kind} callback buttons reach text, every media kind and edits with topic/reply intact`,async()=>{
    const f = transport(kind)
    for(const inline_keyboard of [[button],[[button]],[null,{},button,{text:'bad',callback_data:'x'.repeat(65)}]]){
      const option = {inline_keyboard,message_thread_id:42,reply_id:91,parse_mode:'HTML'}
      await f.sender.sendText(-100,'body',option)
      assert.deepEqual(plain(keyboard(f.calls.at(-1).args[kind === 'bot' ? 2 : 1])),[[button]])
      for(const fileType of ['photo','document','video','animation','audio','voice']){
        await f.sender.sendFile(-100,media(fileType),option)
        const params = f.calls.at(-1).args[1]
        assert.deepEqual(plain(keyboard(params)),[[button]])
        assert.equal(kind === 'bot' ? params.message_thread_id : params.topMsgId,42)
        assert.equal(kind === 'bot' ? replyParameters(params).message_id : params.replyTo,91)
      }
      await f.sender.editFile(-100,123,{fileType:'photo',caption:'updated'},option)
      assert.deepEqual(plain(keyboard(f.calls.at(-1).args[kind === 'bot' ? 4 : 1])),[[button]])
    }
    await f.sender.sendFile(-100,media('photo'),{inline_keyboard:[{},null,{text:'invalid',callback_data:5}]})
    assert.equal(keyboard(f.calls.at(-1).args[1]),undefined)
  })
  test(`${kind} accepted media caption fallback edits the receipt and retains red-packet buttons`,async()=>{
    const f = transport(kind,undefined,true,{receipt:{id:123,message_id:123,caption:customEmoji.emoji,caption_entities:[]}})
    const result = await f.sender.sendFile(-100,{...media('photo'),caption:emojiAlias},{parse_mode:'HTML',inline_keyboard:[button],message_thread_id:42,reply_id:91})
    assert.equal(result.message_id,123)
    assert.equal(f.calls.length,2,'one send followed by one edit, never another send')
    assert.equal(f.calls[1].method,kind === 'bot' ? 'editMessageCaption' : 'editMessage')
    assert.equal(kind === 'bot' ? f.calls[1].args[1] : f.calls[1].args[1].message,123)
    assert.deepEqual(plain(keyboard(f.calls[0].args[1])),[[button]])
    assert.deepEqual(plain(keyboard(f.calls[1].args[kind === 'bot' ? 4 : 1])),[[button]])
  })
  test(`${kind} photo errors remain single attempts even with a red-packet keyboard`,async()=>{
    for(const error of [new Error('Request timeout'),{response:{error_code:500,description:'server error'}}]){
      const f = transport(kind,error)
      await assert.rejects(f.sender.sendFile(-100,media('photo'),{parse_mode:'HTML',inline_keyboard:[button]}),value=>value === error)
      assert.equal(f.calls.length,1)
    }
  })
}

test('callback normalization accepts legacy queries but excludes non-string and oversized UTF-8 data',()=>{
  const {telegramCallbackButtons} = load('util/TelegramKeyboard.ts')
  const valid = {text:'拆红包',callback_data:'rp:packet'}
  assert.deepEqual(plain(telegramCallbackButtons([[{text:'拆红包',query:'rp:packet'}],null,{},
    {text:' ',callback_data:'x'},{text:'bad',callback_data:{}},{text:'big',callback_data:'红包'.repeat(11)}])),[valid])
  assert.deepEqual(plain(telegramCallbackButtons({text:'bad'})),[])
})

function persistence(extra = []) {
  const rows = [...extra,
    {id: 6, chatId: -200, threadId: 42, tgBotMsgId: 106, wxMsgId: 'other-chat'},
    {id: 5, chatId: -100, threadId: 43, tgBotMsgId: 105},
    {id: 4, chatId: -100, threadId: 43, tgBotMsgId: 104},
    {id: 3, chatId: -100, threadId: 42, tgBotMsgId: 103, wxMsgId: 'quoted'},
    {id: 2, chatId: -100, threadId: 42, tgBotMsgId: 102},
    {id: 1, chatId: -100, threadId: null, tgBotMsgId: 101},
  ]
  const queries = []
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value)
  const store = {
    find: async options => {
      queries.push(plain(options))
      return rows.filter(row => matches(row, options.where))
        .sort((a, b) => options.order.id === 'DESC' ? b.id - a.id : a.id - b.id)
        .slice(0, options.take)
    },
    findOneBy: async where => {queries.push(plain(where)); return rows.find(row => matches(row, where)) ?? null},
    findOne: async options => {queries.push(plain(options));return rows.filter(row=>matches(row,options.where)).sort((a,b)=>b.tgBotMsgId - a.tgBotMsgId || b.id - a.id)[0] ?? null},
  }
  const repositoryModule = load('repository/MessageRepository.ts', {
    '../data-sourse': {AppDataSource: {getRepository: () => store}},
    '../entity/Message': {Message: class {}},
  })
  const {MessageService} = load('service/MessageService.ts', {'../repository/MessageRepository': repositoryModule})
  return {service: new MessageService(), queries}
}

test('history applies topic predicate in the repository before take, preserving legacy defaults', async () => {
  const {service, queries} = persistence()
  const result = await service.listRecentByChatId(-100, 2, 42)
  assert.deepEqual(result.map(row => row.id), [3, 2])
  assert.deepEqual(queries[0], {where: {chatId: -100, threadId: 42}, order: {id: 'DESC'}, take: 2})
  assert.deepEqual((await service.listRecentByChatId(-100, 2)).map(row => row.id), [5, 4])
  assert.deepEqual(queries[1].where, {chatId: -100})
  await service.listRecentByChatId(-100)
  assert.equal(queries[2].take, 20)
  await service.listRecentByChatId(-100, undefined, 0)
  assert.deepEqual(queries[3], {where: {chatId: -100, threadId: 0}, order: {id: 'DESC'}, take: 20})
})

test('quoted message lookup enforces supplied thread and chat, while legacy and WeChat lookup stay global', async () => {
  const {service, queries} = persistence()
  assert.equal((await service.getByBotMsgId(-100, 103, 42)).wxMsgId, 'quoted')
  assert.deepEqual(queries[0], {chatId: -100, tgBotMsgId: 103, threadId: 42})
  assert.equal(await service.getByBotMsgId(-100, 103, 43), null)
  assert.equal(await service.getByBotMsgId(-200, 103, 42), null)
  assert.equal(await service.getByBotMsgId(-100, 103, 0), null)
  assert.equal((await service.getByBotMsgId(-100, 103)).id, 3)
  assert.deepEqual(queries.at(-1), {chatId: -100, tgBotMsgId: 103})
  assert.equal((await service.getByBotMsgId(-100, 101)).threadId, null)
  assert.equal((await service.getByWxMsgId('other-chat')).chatId, -200)
  assert.deepEqual(queries.at(-1), {where:{wxMsgId:'other-chat'},order:{tgBotMsgId:'DESC',id:'DESC'}})
})

test('WeChat receipt lookup prefers a confirmed delivery over earlier or later failed attempts', async()=>{
  const {service} = persistence([{id:7,wxMsgId:'quoted',tgBotMsgId:0},{id:0,wxMsgId:'quoted',tgBotMsgId:0}])
  assert.equal((await service.getByWxMsgId('quoted')).tgBotMsgId,103)
})