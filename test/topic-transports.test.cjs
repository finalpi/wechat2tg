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
const plain = value => JSON.parse(JSON.stringify(value))
const media = fileType => ({buff: Buffer.from('test'), filename: 'test.bin', caption: 'caption', fileType})

function transport(kind, failure) {
  const actions = [], calls = []
  const invoke = method => async (...args) => {
    calls.push({method, args})
    if (failure) throw failure
    return {id: 123, message_id: 123}
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
      'abort-controller': AbortController,
    })
    sender = new TelegramBotApiMessageSender({telegram: Object.fromEntries(
      ['sendMessage', 'callApi', 'editMessageMedia', 'editMessageCaption', 'deleteMessage'].map(name => [name, invoke(name)]),
    )})
  } else {
    const {TelegramApiMessageSender} = load('message/TelegramApiMessageSender.ts', {
      './MessageSender': base,
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
    assert.deepEqual(plain(payload.reply_parameters), {message_id: 91})
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
        assert.equal(kind === 'bot' ? params.reply_parameters?.message_id : params.replyTo, option?.reply_id)
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

function persistence() {
  const rows = [
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
  assert.deepEqual(queries.at(-1), {wxMsgId: 'other-chat'})
})