/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {Api} = require('telegram')
const {returnBigInt} = require('telegram/Helpers')
const {createHash} = require('node:crypto')

const floodWait = () => Object.assign(new Error('A wait of 690 seconds is required'), {
  code: 420, errorMessage: 'FLOOD', seconds: 690,
})

function fixture({avatar = false, group = true, deleteAvatarNotices = false, deleteTitleNotices = false} = {}) {
  let now = 1000
  const logs = {log: [], warn: [], error: []}, requests = [], downloads = [], photoReads = [], uploads = [], deletions = [], saves = [], rows = new Map(), hooks = {}
  const preferences = {deleteAvatarNotices, deleteTitleNotices}
  const client = {
    getEntity: async id => hooks.entity ? hooks.entity(id) : ({className: 'Channel', megagroup: true, id, title: 'Old title'}),
    uploadFile: async () => {uploads.push(1); return {id: returnBigInt(1)}},
    downloadProfilePhoto: async entity => {photoReads.push(entity.id);return hooks.photo ? hooks.photo(entity) : Buffer.from('old-avatar')},
    deleteMessages: async (entity,ids,options) => {deletions.push({entity,ids,options});if(hooks.delete)await hooks.delete(entity,ids,options)},
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
    './ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig:async()=>({...preferences})})}},
    '../config': {config: {CREATE_CONTACT_NAME: 'contact', CREATE_ROOM_NAME: 'room'}},
    '../util/FormatUtils': {FormatUtils: {transformTitleStr: (_template, alias, name, room) => room || alias || name}},
    '../util/FileUtils': {FileUtils: {getInstance: () => ({downloadUrl2Buffer: async url => {downloads.push(url); return hooks.download ? hooks.download(url) : Buffer.from(url)}})}},
    '../util/GroupAvatar': {
      prepareGroupAvatar: async buffer => ({buffer, hash: createHash('sha256').update(buffer).digest('hex')}),
      sameGroupAvatar: async (left,right) => hooks.compare ? hooks.compare(left,right) : left.equals(right),
    },
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
    const wxId = group ? `room_${id}@chatroom` : `contact_${id}`, type = group ? 1 : 0
    rows.set(id, {chatId: id, wxId, type, name: 'Old title', avatarLink: avatar ? 'old-avatar' : undefined})
    return {chatId: id, wxId, type, name: 'New title', avatarLink: avatar ? 'new-avatar' : undefined}
  }
  return {client, service, input, rows, requests, downloads, photoReads, uploads, deletions, saves, logs, hooks, preferences, advance: ms => {now += ms}}
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
  assert.equal(f.photoReads.length, 1, 'Compare the actual Telegram photo before replacing it')
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

test('changed URLs with identical content update the local URL without changing the Telegram photo', async () => {
  const f = fixture({avatar: true}), input = f.input(-10001)
  f.hooks.download = async () => Buffer.from('same pixels')
  f.hooks.photo = async () => Buffer.from('same pixels')
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length, 0)
  assert.equal(f.requests.filter(request => request instanceof Api.channels.EditPhoto).length, 0)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'new-avatar')
  const hash = f.rows.get(input.chatId).avatarHash
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(f.rows.get(input.chatId).name, 'New title', 'Avatar deduplication still allows title changes')
  f.downloads.splice(0)
  await f.service().updateGroup({...input, avatarLink: 'rotated-token-url'})
  assert.deepEqual(f.downloads, ['rotated-token-url'], 'Persisted hashes survive new service instances')
  assert.equal(f.rows.get(input.chatId).avatarHash, hash)
  assert.equal(f.uploads.length, 0)
  await f.service().updateGroup({...input, avatarLink: 'rotated-token-url'})
  assert.equal(f.downloads.length, 1, 'The confirmed URL is not downloaded again')
  assert.equal(f.photoReads.length, 1, 'Exact stored fingerprints avoid repeated Telegram photo reads')
})

test('legacy matching URLs gain a content baseline without uploading', async () => {
  const f = fixture({avatar: true}), input = f.input(-10001)
  input.avatarLink = 'old-avatar'
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length, 0)
  assert.deepEqual(f.downloads, ['old-avatar'])
  assert.match(f.rows.get(input.chatId).avatarHash, /^[a-f0-9]{64}$/)
})

test('real avatar changes upload once and concurrent alternate URLs with the same pixels are deduplicated', async () => {
  const f = fixture({avatar: true}), input = f.input(-10001)
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length, 1)
  const previousHash = f.rows.get(input.chatId).avatarHash
  f.hooks.download = async () => Buffer.from('actual replacement pixels')
  await Promise.all(['url-a', 'url-b', 'url-c'].map(avatarLink => f.service().updateGroup({...input, avatarLink})))
  assert.equal(f.uploads.length, 2)
  assert.notEqual(f.rows.get(input.chatId).avatarHash, previousHash)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'url-c')
})

test('an expired legacy URL is ignored when the actual Telegram photo already matches', async () => {
  const f = fixture({avatar: true}), input = f.input(-10001)
  f.hooks.download = async url => {if (url === 'old-avatar') throw Error('expired');return Buffer.from('new pixels')}
  f.hooks.photo = async () => Buffer.from('new pixels')
  await f.service().updateGroup(input)
  assert.deepEqual(f.downloads,['new-avatar'])
  assert.equal(f.uploads.length,0)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'new-avatar')
  assert.match(f.rows.get(input.chatId).avatarHash, /^[a-f0-9]{64}$/)
})

test('a failed Telegram comparison leaves the source pending and retries without a blind photo edit',async()=>{
  const f=fixture({avatar:true}),input=f.input(-10001)
  f.hooks.photo=async()=>{throw Error('network unavailable')}
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,0)
  assert.equal(f.rows.get(input.chatId).avatarHash,undefined)
  assert.equal(f.rows.get(input.chatId).avatarLink,'old-avatar')
  delete f.hooks.photo
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,1)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'new-avatar')
  assert.match(f.rows.get(input.chatId).avatarHash, /^[a-f0-9]{64}$/)
})

test('compression-only differences skip photo edits while an empty Telegram avatar is initialized',async()=>{
  const f=fixture({avatar:true}),input=f.input(-10001)
  f.hooks.compare=async()=>true
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,0)
  f.hooks.photo=async()=>Buffer.alloc(0)
  await f.service().updateGroup({...input,avatarLink:'different-image'})
  assert.equal(f.uploads.length,1)
})

test('a Telegram photo-read FloodWait stops title edits and later metadata reads',async()=>{
  const f=fixture({avatar:true})
  f.hooks.photo=async()=>{throw floodWait()}
  for(const id of [-10001,-10002])await f.service().updateGroup(f.input(id))
  assert.equal(f.photoReads.length,1)
  assert.equal(f.uploads.length,0)
  assert.equal(f.requests.length,0)
  assert.equal(f.saves.length,0)
  assert.equal(f.logs.warn.length,1)
})

test('a database save failure after a photo update is retried against the current Telegram image',async()=>{
  const f=fixture({avatar:true}),input=f.input(-10001)
  f.hooks.save=async()=>{throw Error('database unavailable')}
  f.hooks.invoke=async request=>{
    if(request instanceof Api.channels.EditPhoto)f.hooks.photo=async()=>Buffer.from('new-avatar')
  }
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,1)
  assert.equal(f.rows.get(input.chatId).avatarHash,undefined)
  delete f.hooks.save
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,1,'the already updated photo is not uploaded again')
  assert.match(f.rows.get(input.chatId).avatarHash,/^[a-f0-9]{64}$/)
})

test('failed downloads preserve the saved hash and can be retried', async () => {
  const f = fixture({avatar: true}), input = f.input(-10001)
  await f.service().updateGroup(input)
  const hash = f.rows.get(input.chatId).avatarHash
  f.hooks.download = async () => {throw Error('network unavailable')}
  await f.service().updateGroup({...input, avatarLink: 'newer-url'})
  assert.equal(f.rows.get(input.chatId).avatarHash, hash)
  assert.equal(f.rows.get(input.chatId).avatarLink, 'new-avatar')
  assert.equal(f.uploads.length, 1)
})

test('avatar pixel hashes ignore encoding and metadata while detecting visible changes', async () => {
  const sharp = require('sharp'), {prepareGroupAvatar} = require('../dist/util/GroupAvatar')
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
  const image = sharp(pixels, {raw: {width: 2, height: 2, channels: 3}})
  const first = await image.clone().png({compressionLevel: 0}).toBuffer()
  const second = await image.clone().withMetadata().png({compressionLevel: 9}).toBuffer()
  assert.notDeepEqual(first, second)
  assert.equal((await prepareGroupAvatar(first)).hash, (await prepareGroupAvatar(second)).hash)
  const changed = await sharp({create: {width: 2, height: 2, channels: 3, background: '#ff00ff'}}).png().toBuffer()
  assert.notEqual((await prepareGroupAvatar(first)).hash, (await prepareGroupAvatar(changed)).hash)
  await assert.rejects(prepareGroupAvatar(Buffer.from('invalid image')))
})

test('current Telegram avatars match through JPEG compression and size changes while real visual edits are detected',async()=>{
  const sharp=require('sharp'),{sameGroupAvatar}=require('../dist/util/GroupAvatar')
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect width="480" height="480" fill="#00a4ec"/><circle cx="240" cy="200" r="135" fill="white"/><path d="M240 80 130 260h220Z" fill="#328daf"/><text x="145" y="415" font-size="56" fill="white">AVATAR</text></svg>'
  const original=await sharp(Buffer.from(svg)).png().toBuffer()
  for(const size of [132,200,640])for(const quality of [70,85,95]){
    const compressed=await sharp(original).resize(size,size).jpeg({quality}).toBuffer()
    assert.equal(await sameGroupAvatar(original,compressed),true,`same logo, size=${size}, quality=${quality}`)
  }
  const blue=await sharp({create:{width:200,height:200,channels:3,background:'#00a4ec'}}).png().toBuffer()
  const otherColor=await sharp({create:{width:200,height:200,channels:3,background:'#d74d4d'}}).png().toBuffer()
  assert.equal(await sameGroupAvatar(blue,otherColor),false,'uniform color changes are real changes')
  const localEdit=await sharp(original).composite([{input:await sharp({create:{width:36,height:36,channels:3,background:'#000000'}}).png().toBuffer(),left:220,top:220}]).png().toBuffer()
  assert.equal(await sameGroupAvatar(original,localEdit),false,'a local logo edit must not disappear in a global average')
  const translucent=await sharp({create:{width:100,height:100,channels:4,background:{r:255,g:0,b:0,alpha:0}}}).png().toBuffer()
  const white=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).jpeg().toBuffer()
  assert.equal(await sameGroupAvatar(translucent,white),true,'transparent backgrounds compare using the same white flattening')
  await assert.rejects(sameGroupAvatar(original,Buffer.from('invalid image')))
})

test('minor grayscale re-encoding differences around the mean-error boundary keep the existing avatar',async()=>{
  const sharp=require('sharp'),{sameGroupAvatar}=require('../dist/util/GroupAvatar')
  const image=level=>sharp({create:{width:64,height:64,channels:3,background:{r:level,g:level,b:level}}}).png().toBuffer()
  const original=await image(128)
  assert.equal(await sameGroupAvatar(original,await image(132)),true,'a four-level tone difference stays inside the recompression budget')
  assert.equal(await sameGroupAvatar(original,await image(137)),false,'larger whole-image changes still update the avatar')
  const patch=await image(180)
  const localEdit=await sharp(original).composite([{input:await sharp(patch).resize(8,8).toBuffer(),left:24,top:24}]).png().toBuffer()
  assert.equal(await sameGroupAvatar(original,localEdit),false,'a local change is rejected even with a small global average')
})

test('high-contrast line art survives the actual upload and Telegram resampling chain',async()=>{
  const sharp=require('sharp'),{prepareGroupAvatar,sameGroupAvatar}=require('../dist/util/GroupAvatar')
  for(const step of [7,14,15,18,19,20,21,22]){
    const lines=[]
    for(let position=15;position<630;position+=step){
      lines.push(`<path d="M${position} 15V630M15 ${position}H630" stroke="#111" stroke-width="2"/>`)
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="646" height="646"><rect width="646" height="646" fill="#fff"/>${lines.join('')}</svg>`
    const source=await sharp(Buffer.from(svg)).jpeg({quality:90}).toBuffer()
    const uploaded=await prepareGroupAvatar(source)
    const telegram=await sharp(uploaded.buffer).resize(640,640).jpeg({quality:85}).toBuffer()
    assert.equal(await sameGroupAvatar(uploaded.buffer,telegram),true,`same line art with spacing ${step}`)
  }
})

function photoReceipt(kind, id=101) {
  const peer = kind==='Channel' ? new Api.PeerChannel({channelId:returnBigInt(12345)}) : new Api.PeerChat({chatId:returnBigInt(12345)})
  const foreign = kind==='Channel' ? new Api.PeerChannel({channelId:returnBigInt(67890)}) : new Api.PeerChat({chatId:returnBigInt(67890)})
  const notice = (messageId,target,action=new Api.MessageActionChatEditPhoto({photo:new Api.PhotoEmpty({id:returnBigInt(1)})}))=>new Api.MessageService({id:messageId,peerId:target,date:1,action})
  const message = notice(id,peer)
  return {updates:[
    {message},{message},
    {message:notice(102,foreign)},
    {message:notice(103,peer,new Api.MessageActionChatEditTitle({title:'Other service notice'}))},
    {message:new Api.Message({id:104,peerId:peer,date:1,message:'Normal chat message'})},
    {message:notice(-1,peer)},
    {message:notice(2147483648,peer)},
  ]}
}

for(const kind of ['Chat','Channel']) {
  test(`a successful ${kind} avatar update removes only its confirmed photo service notice`,async()=>{
    const f=fixture({avatar:true,deleteAvatarNotices:true}),input=f.input(-10001)
    f.hooks.entity=async()=>({className:kind,megagroup:true,id:returnBigInt(12345),title:'Old title'})
    f.hooks.invoke=async request=>{
      if(request instanceof Api.channels.EditPhoto || request instanceof Api.messages.EditChatPhoto)return photoReceipt(kind)
    }
    await f.service().updateGroup(input)
    assert.equal(f.uploads.length,1)
    assert.equal(f.deletions.length,1)
    assert.deepEqual([...f.deletions[0].ids],[101])
    assert.equal(f.deletions[0].options.revoke,true)
    assert.equal(String(f.deletions[0].entity.id),'12345')
    assert.equal(f.rows.get(input.chatId).avatarNoticeIds,null)
    assert.match(f.rows.get(input.chatId).avatarHash,/^[a-f0-9]{64}$/)
  })
}

test('a failed avatar notice deletion is persisted and retried without another photo upload',async()=>{
  const f=fixture({avatar:true,deleteAvatarNotices:true}),input=f.input(-10001)
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async request=>{if(request instanceof Api.channels.EditPhoto)return photoReceipt('Channel')}
  f.hooks.delete=async()=>{throw Error('temporary network error')}
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,1)
  assert.equal(f.rows.get(input.chatId).avatarNoticeIds,'[101]')
  assert.match(f.rows.get(input.chatId).avatarHash,/^[a-f0-9]{64}$/)
  delete f.hooks.delete
  await f.service().updateGroup(input)
  assert.equal(f.deletions.length,2)
  assert.equal(f.uploads.length,1)
  assert.equal(f.rows.get(input.chatId).avatarNoticeIds,null)
})

test('notice deletion FloodWait preserves confirmed avatar metadata and retries after the shared cooldown',async()=>{
  const f=fixture({avatar:true,deleteAvatarNotices:true}),input=f.input(-10001)
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async request=>{if(request instanceof Api.channels.EditPhoto)return photoReceipt('Channel')}
  f.hooks.delete=async()=>{throw floodWait()}
  await f.service().updateGroup(input)
  assert.equal(f.requests.length,1,'the title edit waits for the metadata cooldown')
  assert.equal(f.rows.get(input.chatId).avatarNoticeIds,'[101]')
  assert.equal(f.rows.get(input.chatId).avatarLink,'new-avatar')
  await f.service().updateGroup(input)
  assert.equal(f.deletions.length,1)
  f.advance(690000);delete f.hooks.delete
  await f.service().updateGroup(input)
  assert.equal(f.uploads.length,1)
  assert.equal(f.deletions.length,2)
  assert.equal(f.rows.get(input.chatId).avatarNoticeIds,null)
  assert.equal(f.rows.get(input.chatId).name,'New title')
})

test('short update receipts also identify the avatar service message for deletion',async()=>{
  const f=fixture({avatar:true,deleteAvatarNotices:true}),input=f.input(-10001)
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async request=>{
    if(request instanceof Api.channels.EditPhoto)return new Api.UpdateShort({
      update:new Api.UpdateNewChannelMessage({message:photoReceipt('Channel').updates[0].message,pts:1,ptsCount:1}),date:1,
    })
  }
  await f.service().updateGroup(input)
  assert.deepEqual([...f.deletions[0].ids],[101])
  assert.equal(f.rows.get(input.chatId).avatarNoticeIds,null)
})

for(const kind of ['Chat','Channel'])for(const deleteAvatarNotices of [false,true])for(const deleteTitleNotices of [false,true]){
  test(`${kind} notice settings are independent: avatar=${deleteAvatarNotices}, title=${deleteTitleNotices}`,async()=>{
    const f=fixture({avatar:true,group:false,deleteAvatarNotices,deleteTitleNotices}),input=f.input(-10001)
    f.hooks.entity=async()=>({className:kind,megagroup:true,id:returnBigInt(12345),title:'Old title'})
    f.hooks.invoke=async()=>photoReceipt(kind)
    await f.service().updateGroup(input)
    const deleted=f.deletions.flatMap(call=>[...call.ids])
    assert.deepEqual(deleted,[...(deleteAvatarNotices?[101]:[]),...(deleteTitleNotices?[103]:[])])
    assert.equal(f.rows.get(input.chatId).name,'New title')
    assert.equal(f.uploads.length,1)
  })
}

test('runtime title setting changes stop pending cleanup and resume it without a repeated title edit',async()=>{
  const f=fixture({deleteTitleNotices:true}),input=f.input(-10001)
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async()=>photoReceipt('Channel')
  f.hooks.delete=async()=>{throw Error('temporary network error')}
  await f.service().updateGroup(input)
  assert.equal(f.rows.get(input.chatId).titleNoticeIds,'[103]')
  assert.equal(f.rows.get(input.chatId).name,'New title')
  f.preferences.deleteTitleNotices=false
  delete f.hooks.delete
  await f.service().updateGroup(input)
  assert.equal(f.deletions.length,1,'disabled cleanup leaves pending notices alone')
  assert.equal(f.requests.length,1,'the title already changed successfully')
  f.preferences.deleteTitleNotices=true
  await f.service().updateGroup(input)
  assert.equal(f.deletions.length,2)
  assert.equal(f.requests.length,1)
  assert.equal(f.rows.get(input.chatId).titleNoticeIds,null)
})

for(const kind of ['Chat','Channel']) {
  test(`WeChat group avatar notices are cleaned automatically in ${kind} with both preferences disabled`,async()=>{
    const f=fixture({avatar:true}),input=f.input(-10001)
    f.hooks.entity=async()=>({className:kind,megagroup:true,id:returnBigInt(12345),title:'Old title'})
    f.hooks.invoke=async()=>photoReceipt(kind)
    await f.service().updateGroup(input)
    assert.deepEqual(f.deletions.flatMap(call=>[...call.ids]),[101])
    assert.equal(f.rows.get(input.chatId).name,'New title')
  })
}

test('a legacy group binding is recognized by its WeChat room ID even when its stored type is contact',async()=>{
  const f=fixture({avatar:true}),input=f.input(-10001)
  f.rows.get(input.chatId).type=0
  input.type=0
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async()=>photoReceipt('Channel')
  await f.service().updateGroup(input)
  assert.deepEqual(f.deletions.flatMap(call=>[...call.ids]),[101])
})

test('a title notice deletion FloodWait preserves the confirmed name and its pending receipt',async()=>{
  const f=fixture({deleteTitleNotices:true}),input=f.input(-10001)
  f.hooks.entity=async()=>({className:'Channel',megagroup:true,id:returnBigInt(12345),title:'Old title'})
  f.hooks.invoke=async()=>photoReceipt('Channel')
  f.hooks.delete=async()=>{throw floodWait()}
  await f.service().updateGroup(input)
  assert.equal(f.rows.get(input.chatId).name,'New title')
  assert.equal(f.rows.get(input.chatId).titleNoticeIds,'[103]')
  f.advance(690000);delete f.hooks.delete
  await f.service().updateGroup(input)
  assert.equal(f.requests.length,1)
  assert.equal(f.rows.get(input.chatId).titleNoticeIds,null)
})
