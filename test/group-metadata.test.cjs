/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Api} = require('telegram')
const {returnBigInt} = require('telegram/Helpers')

const floodWait = () => Object.assign(new Error('A wait of 690 seconds is required'), {
  code: 420, errorMessage: 'FLOOD', seconds: 690,
})

function fixture({avatar = false} = {}) {
  let now = 1000
  const logs = {log: [], warn: [], error: []}, requests = [], downloads = [], uploads = [], saves = [], rows = new Map(), hooks = {}
  const client = {
    getEntity: async id => hooks.entity ? hooks.entity(id) : ({className: 'Channel', megagroup: true, id, title: 'Old title'}),
    uploadFile: async () => {uploads.push(1); return {id: returnBigInt(1)}},
    invoke: async request => {
      requests.push(request)
      return hooks.invoke ? hooks.invoke(request) : undefined
    },
  }
  const bindings = {
    getByChatId: async id => rows.has(id) ? {...rows.get(id)} : undefined,
    createOrUpdate: async row => {
      if (hooks.save) await hooks.save(row)
      saves.push({...row}); rows.set(row.chatId, {...row}); return row
    },
  }
  const modules = {
    './ConfigurationService': {ConfigurationService: {getInstance: () => ({})}},
    '../config': {config: {CREATE_CONTACT_NAME: 'contact', CREATE_ROOM_NAME: 'room'}},
    '../util/FormatUtils': {FormatUtils: {transformTitleStr: (_template, alias, name, room) => room || alias || name}},
    '../util/FileUtils': {FileUtils: {getInstance: () => ({downloadUrl2Buffer: async url => {downloads.push(url); return Buffer.from('avatar')}})}},
    sharp: () => ({toFormat() {return this}, resize() {return this}, toBuffer: async () => Buffer.from('png')}),
    telegram: {Api}, 'telegram/Helpers': {returnBigInt},
    'telegram/client/uploads': {CustomFile: class {}},
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/service/TelegramGroupOperateService.js'), 'utf8'), {
    exports, Buffer, Date: class extends Date {static now() {return now}},
    console: Object.fromEntries(Object.keys(logs).map(level => [level, (...args) => logs[level].push(args)])),
    require: name => modules[name] || {},
  })
  const service = (current = client) => new exports.TelegramGroupOperateService(bindings, current)
  const input = id => {
    rows.set(id, {chatId: id, wxId: `room_${id}@chatroom`, type: 1, name: 'Old title', avatarLink: avatar ? 'old-avatar' : undefined})
    return {chatId: id, wxId: `room_${id}@chatroom`, type: 1, name: 'New title', avatarLink: avatar ? 'new-avatar' : undefined}
  }
  return {client, service, input, rows, requests, downloads, uploads, saves, logs, hooks, advance: ms => {now += ms}}
}

test('a title FloodWait suppresses subsequent group metadata RPCs across service instances', async () => {
  const f = fixture()
  f.hooks.invoke = async () => {throw floodWait()}
  for (const id of [-10001, -10002, -10003]) await f.service().updateGroup(f.input(id))
  assert.equal(f.requests.length, 1, 'Do not repeat EditTitle while Telegram requires a 690-second wait')
  assert(f.requests[0] instanceof Api.channels.EditTitle)
  assert.equal(f.logs.log.length, 0, 'Expected throttling should not dump FloodWait stacks')
  assert.equal(f.logs.warn.length, 1, 'Log the cooldown once, not once per skipped group')
})

test('an avatar FloodWait also stops title edits and later avatar uploads during the cooldown', async () => {
  const f = fixture({avatar: true})
  f.hooks.invoke = async request => {
    if (request instanceof Api.channels.EditPhoto) throw floodWait()
  }
  for (const id of [-10001, -10002, -10003]) await f.service().updateGroup(f.input(id))
  assert.equal(f.requests.length, 1, 'Avatar throttling must also stop EditTitle')
  assert(f.requests[0] instanceof Api.channels.EditPhoto)
  assert.equal(f.downloads.length, 1)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.saves.length, 0, 'Failed avatar/title updates must remain pending locally')
  assert.equal(f.rows.get(-10001).avatarLink, 'old-avatar')
  assert.equal(f.logs.warn.length, 1)
})

test('metadata retries are allowed after the exact cooldown, never before it', async () => {
  const f = fixture()
  const input = f.input(-10001)
  f.hooks.invoke = async () => {throw floodWait()}
  await f.service().updateGroup(input)
  f.advance(689999)
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 1)
  f.advance(1)
  delete f.hooks.invoke
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 2)
  assert.equal(f.rows.get(input.chatId).name, 'New title')
})

test('FloodWait without usable seconds uses a bounded conservative cooldown', async () => {
  const f = fixture()
  const input = f.input(-10001)
  f.hooks.invoke = async () => {throw {code: 420, errorMessage: 'FLOOD'}}
  await f.service().updateGroup(input)
  f.advance(59999)
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 1)
  f.advance(1)
  delete f.hooks.invoke
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 2)
})

test('concurrent metadata jobs serialize so only one RPC can hit a new FloodWait', async () => {
  const f = fixture()
  const inputs = [-10001, -10002, -10003].map(f.input)
  await Promise.all(inputs.map(input => f.service().updateGroup(input)))
  assert.equal(f.requests.length, 3, 'Normal updates still complete')
  f.requests.splice(0)
  const retry = inputs.map(input => ({...input, name: 'Next title'}))
  f.hooks.invoke = async () => {throw floodWait()}
  await Promise.all(retry.map(input => f.service().updateGroup(input)))
  assert.equal(f.requests.length, 1, 'Queued jobs must re-check cooldown before their RPC')
})

test('overlapping identical metadata requests are coalesced across service instances', async () => {
  const f = fixture()
  const input = f.input(-10001)
  await Promise.all(Array.from({length: 8}, () => f.service().updateGroup(input)))
  assert.equal(f.requests.length, 1)
  assert.equal(f.saves.length, 1)
})

test('a client cooldown does not block another Telegram client', async () => {
  const f = fixture()
  f.hooks.invoke = async () => {throw floodWait()}
  await f.service().updateGroup(f.input(-10001))
  const calls = []
  const other = {...f.client, invoke: async request => {calls.push(request)}}
  await f.service(other).updateGroup(f.input(-10002))
  assert.equal(calls.length, 1)
  assert.equal(f.rows.get(-10002).name, 'New title')
})

test('failed avatars stay pending while a successful title is saved', async () => {
  const f = fixture({avatar: true})
  f.hooks.invoke = async request => {
    if (request instanceof Api.channels.EditPhoto) throw new Error('upload failed')
  }
  const input = f.input(-10001)
  await f.service().updateGroup(input)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'old-avatar')
  assert.equal(f.rows.get(input.chatId).name, 'New title')
})

test('a confirmed avatar is saved even when the following title edit is throttled', async () => {
  const f = fixture({avatar: true})
  f.hooks.invoke = async request => {
    if (request instanceof Api.channels.EditTitle) throw floodWait()
  }
  const input = f.input(-10001)
  await f.service().updateGroup(input)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'new-avatar')
  assert.equal(f.rows.get(input.chatId).name, 'Old title')
  assert.equal(f.logs.warn.length, 1)
})

test('an already confirmed title is not edited again when GramJS still returns its cached old entity', async () => {
  const f = fixture()
  const input = f.input(-10001)
  await f.service().updateGroup(input)
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 1)
  assert.equal(f.saves.length, 1)
})

test('a matching Telegram title does not generate writes, including stale binding caches', async () => {
  const f = fixture()
  f.hooks.entity = async id => ({className: 'Channel', megagroup: true, id, title: 'New title'})
  const input = f.input(-10001)
  await f.service().updateGroup(input)
  await f.service().updateGroup(input)
  assert.equal(f.requests.length, 0)
  assert.equal(f.saves.length, 1, 'Repair the local cache once, without a redundant Telegram edit')
})

test('unrelated RPC and persistence errors are handled without poisoning the queue or creating a cooldown', async () => {
  const f = fixture()
  f.hooks.invoke = async () => {throw new Error('CHAT_ADMIN_REQUIRED')}
  await f.service().updateGroup(f.input(-10001))
  delete f.hooks.invoke
  f.hooks.save = async () => {throw new Error('database unavailable')}
  await assert.doesNotReject(f.service().updateGroup(f.input(-10002)))
  delete f.hooks.save
  await f.service().updateGroup(f.input(-10003))
  assert.equal(f.requests.length, 3)
  assert.equal(f.rows.get(-10003).name, 'New title')
})

test('contact aliases equal to the nickname are normalized without mutating the caller', async () => {
  const f = fixture()
  const input = {...f.input(-10001), type: 0, name: 'Alice', alias: 'Alice'}
  await f.service().updateGroup(input)
  assert.equal(f.rows.get(input.chatId).alias, '')
  assert.equal(f.rows.get(input.chatId).name, 'Alice')
  assert.equal(input.alias, 'Alice')
})

for (const entity of ['Chat', 'Channel']) {
  test(`avatar and title success use the right ${entity} RPC and preserve binding preferences`, async () => {
    const f = fixture({avatar: true})
    f.hooks.entity = async id => ({className: entity, megagroup: true, id, title: 'Old title'})
    const input = f.input(-10001)
    Object.assign(f.rows.get(input.chatId), {isReceive: false, isForwardOthers: true})
    await f.service().updateGroup(input)
    const [photo, title] = entity === 'Chat'
      ? [Api.messages.EditChatPhoto, Api.messages.EditChatTitle]
      : [Api.channels.EditPhoto, Api.channels.EditTitle]
    assert(f.requests[0] instanceof photo)
    assert(f.requests[1] instanceof title)
    const stored = f.rows.get(input.chatId)
    assert.equal(stored.avatarLink, 'new-avatar')
    assert.equal(stored.name, 'New title')
    assert.equal(stored.isReceive, false)
    assert.equal(stored.isForwardOthers, true)
    assert.equal(input.name, 'New title', 'Do not mutate caller input')
  })
}