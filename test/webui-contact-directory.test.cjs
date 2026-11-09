/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata')
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const {once} = require('node:events')
const {createHmac} = require('node:crypto')
const {DataSource} = require('typeorm')
const sources = require('../dist/data-sourse')
const {AbstractClient} = require('../dist/base/BaseClient')
const {Message} = require('../dist/entity/Message')
const {BindGroup} = require('../dist/entity/BindGroup')
const {OfficialAccountTopic} = require('../dist/entity/OfficialAccountTopic')
const {WxContact} = require('../dist/entity/WxContact')
const {WxRoom} = require('../dist/entity/WxRoom')
const {WebMessageStore} = require('../dist/webui/message-store')
const {createMessageCenter} = require('../dist/webui/messages')
const {createWebUIServer} = require('../dist/webui/server')
const {contactCategory, contactIndexLetter} = require('../dist/webui/contact-directory')

async function fixture(t) {
  const app = new DataSource({type:'sqlite', database:':memory:', entities:[Message, BindGroup, OfficialAccountTopic], synchronize:true})
  const sdk = new DataSource({type:'sqlite', database:':memory:', entities:[WxContact, WxRoom], synchronize:true})
  await Promise.all([app.initialize(), sdk.initialize()])
  t.after(() => Promise.all([app.destroy(), sdk.destroy()]))
  t.mock.method(sources.AppDataSource, 'getRepository', entity => app.getRepository(entity))
  t.mock.method(sources, 'getGeWeChatDataSource', () => sdk)
  let nativeRequests = 0
  const forbidden = () => {nativeRequests++; throw new Error('Directory GET must not hydrate or invoke native actions')}
  t.mock.method(AbstractClient, 'getSpyClient', name => name === 'wxClient' ? {
    hasLogin:false, client:{Contact:{find:forbidden}, Room:{find:forbidden}, request:forbidden},
  } : undefined)
  const store = new WebMessageStore(':memory:')
  t.after(() => store.close())
  t.after(() => assert.equal(nativeRequests, 0))
  return {app, sdk, store, messages:createMessageCenter(store, {}),
    contact: row => sdk.getRepository(WxContact).save(row),
    binding: (wxId, name = wxId, type = 0) => app.getRepository(BindGroup).save({wxId, name, type, chatId:-1001}),
    topic: (wxId, name = wxId) => app.getRepository(OfficialAccountTopic).save({wxId, name, chatId:-1002, randomId:'1', status:'ready'}),
  }
}

const botToken = '12345:directory-test-only'
function initData() {
  const values = {auth_date:String(Math.floor(Date.now() / 1000)), user:JSON.stringify({id:123, first_name:'test'})}
  const check = Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('\n')
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return new URLSearchParams({...values, hash:createHmac('sha256', key).update(check).digest('hex')}).toString()
}
async function httpFixture(t, messages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-directory-http-'))
  const server = createWebUIServer({file:path.join(root, 'config.json'), token:'directory-token', messages,
    environment:{BOT_TOKEN:botToken, WEBUI_MINI_APP_URL:'https://wechat.example.test/'},
    runtime:{read:async () => ({chatId:123}), save:async () => undefined},
    mcpTokens:{write:'w'.repeat(32), read:'r'.repeat(32)},
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive:true, force:true})})
  const url = `http://127.0.0.1:${server.address().port}`
  return (route, options = {}) => fetch(url + route, {...options, headers:{Authorization:'Bearer directory-token', ...options.headers}})
}

test('WebUI Telegram online state follows polling progress rather than a stale login flag', async t => {
  const f = await fixture(t)
  let polling = {state:'starting',healthy:false,inFlight:false,lastAttemptAt:null,lastSuccessAt:null,lastFailureAt:null,lastError:null,consecutiveFailures:0,lastDurationMs:null,requestTimeoutMs:85000}
  const bot = {hasLogin:true,getPollingHealth:()=>polling}
  t.mock.method(AbstractClient,'getSpyClient',name=>name === 'botClient' ? bot : {hasLogin:false})
  const request = await httpFixture(t,f.messages)
  const status = async()=>(await request('/api/messages/status')).json()
  assert.equal((await status()).telegramOnline,false,'getMe/login alone does not prove update polling works')
  polling = {...polling,state:'healthy',healthy:true,lastSuccessAt:Date.now()}
  assert.equal((await status()).telegramOnline,true)
  polling = {...polling,state:'stalled',healthy:false}
  const stalled = await status()
  assert.equal(stalled.telegramOnline,false)
  assert.equal(stalled.telegramPolling.lastSuccessAt,polling.lastSuccessAt)
  polling = {...polling,state:'retrying',lastError:'ETIMEDOUT',consecutiveFailures:1}
  assert.equal((await status()).telegramPolling.lastError,'ETIMEDOUT')
  polling = {...polling,state:'healthy',healthy:true}
  bot.hasLogin = false
  assert.equal((await status()).telegramOnline,false)
})

test('classification uses valid bit8 flags and only explicit numeric serviceType=1', () => {
  const row = {wxId:'ordinary-id', kind:'contact'}
  for (const verifyFlag of [8, 24, 40, 0xffffffff, '24']) {
    assert.equal(contactCategory({...row, verifyFlag}), 'official')
    assert.equal(contactCategory({...row, verifyFlag, serviceType:1}), 'service')
    for (const serviceType of [null, undefined, 0, 2, '1', true]) assert.equal(contactCategory({...row, verifyFlag, serviceType}), 'official')
  }
  for (const verifyFlag of [0, 1, 16, 32]) assert.equal(contactCategory({...row, verifyFlag, serviceType:1}, true), 'person')
  for (const verifyFlag of [null, undefined, '', 'bad', -1, 1.5, Infinity, NaN, 0x100000000, ' 8', '08']) {
    assert.equal(contactCategory({...row, verifyFlag}), 'unknown')
    assert.equal(contactCategory({...row, verifyFlag}, true), 'official')
  }
  assert.equal(contactCategory({...row, wxId:'gh_not_evidence'}), 'unknown')
  assert.equal(contactCategory({...row, wxId:'enterprise@openim', verifyFlag:24, serviceType:1}), 'enterprise')
  assert.equal(contactCategory({...row, wxId:'group@chatroom', verifyFlag:24, serviceType:1}), 'group')
  assert.equal(contactCategory({...row, kind:'group', wxId:'odd@openim'}), 'group')
  assert.equal(contactIndexLetter('中文'), '#')
  assert.equal(contactIndexLetter('ascii'), 'A')
  assert.equal(contactIndexLetter('中文', ['b', 'zhongwen']), 'B')
})

test('real cached directory merges before search/filter, preserves SDK authority and legacy kinds', async t => {
  const f = await fixture(t)
  await f.contact([
    {userName:'person', nickName:'Person', verifyFlag:0},
    {userName:'service', nickName:'Service', verifyFlag:24, serviceType:1},
    {userName:'official', nickName:'Official', verifyFlag:24},
    {userName:'unknown', nickName:'Unknown', verifyFlag:null},
    {userName:'bad', nickName:'Bad', verifyFlag:'bad'},
    {userName:'gh_person', nickName:'No prefix heuristic', verifyFlag:0},
    {userName:'worker@openim', nickName:'Worker', verifyFlag:24, serviceType:1},
    {userName:'room@chatroom', nickName:'Duplicate room', verifyFlag:24},
    {userName:'hint', nickName:'SDK name', verifyFlag:null},
  ])
  await f.sdk.getRepository(WxRoom).save({chatroomId:'room@chatroom', nickName:'Authoritative room'})
  await f.binding('person', 'fallback search needle')
  await f.app.getRepository(BindGroup).update({wxId:'person'}, {avatarLink:'https://avatar.invalid/'})
  await f.topic('person', 'outdated official topic')
  await f.topic('hint', 'Topic name')
  await f.topic('topic-only')
  await f.binding('binding-only')
  await f.binding('binding-room', 'Binding group', 1)
  const all = await f.messages.contacts('', 'all', 0)
  assert.equal(all.total, 12)
  assert.equal(all.contacts.length, 12)
  assert.equal(all.countsScope, 'cached')
  assert.deepEqual(all.counts, {person:2, group:2, official:3, service:1, enterprise:1, unknown:3})
  const rows = new Map(all.contacts.map(c => [c.wxId, c]))
  assert.equal(rows.get('room@chatroom').name, 'Authoritative room')
  assert.equal(rows.get('person').name, 'Person')
  assert.equal(rows.get('person').category, 'person')
  assert.equal(rows.get('person').hasAvatar, true)
  assert.equal(rows.get('hint').name, 'SDK name')
  assert.equal(rows.get('hint').category, 'official')
  assert(!JSON.stringify(all).includes('verifyFlag'))
  const searched = await f.messages.contacts('needle', 'all', 0)
  assert.equal(searched.total, 1)
  assert.equal(searched.contacts[0].category, 'person', 'non-matching SDK metadata must still override matching binding/topic')
  assert.equal((await f.messages.contacts('needle', 'official', 0)).contacts.length, 0)
  for (const category of Object.keys(all.counts)) {
    const page = await f.messages.contacts('', category, 0)
    assert.equal(page.contacts.length, all.counts[category])
    assert(page.contacts.every(row => row.category === category))
    assert.deepEqual(page.counts, all.counts)
    assert.equal(page.total, 12)
  }
  const legacy = await f.messages.contacts('', 'contact', 0)
  assert.equal(legacy.contacts.length, 10)
  assert(legacy.contacts.every(row => row.kind === 'contact'))
  const groups = await f.messages.contacts('', 'group', 0)
  assert(groups.contacts.every(row => row.kind === 'group'))
})

test('counts are unique cached search totals before category selection or pagination beyond 60', async t => {
  const f = await fixture(t)
  await f.contact(Array.from({length:75}, (_, index) => ({userName:`person-${index}`, nickName:`Needle ${index}`, verifyFlag:0})))
  await f.contact({userName:'service', nickName:'Needle service', verifyFlag:24, serviceType:1})
  await f.contact({userName:'excluded', nickName:'Unrelated', verifyFlag:0})
  await f.binding('person-0', 'Needle duplicate')
  const first = await f.messages.contacts('needle', 'person', 0)
  const second = await f.messages.contacts('needle', 'person', 60)
  assert.equal(first.contacts.length, 60)
  assert.equal(second.contacts.length, 15)
  assert.equal(first.hasMore, true)
  assert.equal(second.hasMore, false)
  for (const page of [first, second, await f.messages.contacts('needle', 'service', 0), await f.messages.contacts('needle', 'unknown', 900)]) {
    assert.equal(page.total, 76)
    assert.deepEqual(page.counts, {person:75, group:0, official:0, service:1, enterprise:0, unknown:0})
    assert.equal(page.countsScope, 'cached')
  }
})

test('cached romanization follows displayed remark and category pages group A-Z then #', async t => {
  const f = await fixture(t)
  await f.contact([
    {userName:'remark', nickName:'Alpha', remark:'备注', pyInitial:'A', remarkPyInitial:'b', verifyFlag:24},
    {userName:'nickname', nickName:'阿', pyInitial:'a', verifyFlag:24},
    {userName:'pinyin', nickName:'词', quanPin:'ci', verifyFlag:24},
    {userName:'no-guess', nickName:'Zebra', remark:'无拼音', pyInitial:'Z', verifyFlag:24},
    {userName:'ascii', nickName:'Delta', verifyFlag:24},
  ])
  const page = await f.messages.contacts('', 'official', 0)
  assert.deepEqual(page.contacts.map(c => c.indexLetter), ['A', 'B', 'C', 'D', '#'])
  assert.deepEqual(page.contacts.map(c => c.wxId), ['nickname', 'remark', 'pinyin', 'ascii', 'no-guess'])
})

test('directory letter order applies before group paging without changing legacy group order', async t => {
  const f = await fixture(t)
  await f.sdk.getRepository(WxRoom).save([
    ...Array.from({length:65}, (_, i) => ({chatroomId:`symbol-${i}@chatroom`, nickName:`# group ${i}`})),
    {chatroomId:'alpha@chatroom', nickName:'Alpha'},
  ])
  assert.equal((await f.messages.contacts('', 'group', 0)).contacts[0].indexLetter, '#')
  const request = await httpFixture(t, f.messages)
  const first = await (await request('/api/contacts?kind=group&order=letter')).json()
  const second = await (await request('/api/contacts?kind=group&order=letter&offset=60')).json()
  assert.equal(first.contacts[0].wxId, 'alpha@chatroom')
  assert.equal(first.contacts.length, 60)
  assert.equal(second.contacts.length, 6)
  assert(second.contacts.every(c => c.indexLetter === '#'))
  assert.equal((await request('/api/contacts?kind=group&order=invalid')).status, 400)
})

test('read-only menu uses validated cached metadata, never topic hints, raw protocol or native actions', async t => {
  const f = await fixture(t)
  const menu = {buttons:[{name:'Docs', kind:'url', url:'https://example.test/docs'}, {name:'More', kind:'group', children:[{name:'Event unavailable', kind:'unsupported', reason:'event'}]}]}
  await f.contact([
    {userName:'official', verifyFlag:24, officialMenu:JSON.stringify(menu)},
    {userName:'empty', verifyFlag:8, officialMenu:'{"buttons":[]}'},
    {userName:'missing', verifyFlag:8},
    {userName:'invalid', verifyFlag:8, officialMenu:'not JSON secret event key'},
    {userName:'raw', verifyFlag:8, officialMenu:'{"Button":[{"Type":"click","Key":"private-native-key"}],"token":"private-token"}'},
    {userName:'unsafe', verifyFlag:8, officialMenu:'{"buttons":[{"kind":"url","name":"Unsafe","url":"javascript:alert(1)","key":"private-native-key"}]}'},
    {userName:'person', verifyFlag:0, officialMenu:JSON.stringify(menu)},
    {userName:'unknown', verifyFlag:null, officialMenu:JSON.stringify(menu)},
    {userName:'room@chatroom', verifyFlag:24, officialMenu:JSON.stringify(menu)},
    {userName:'worker@openim', verifyFlag:24, officialMenu:JSON.stringify(menu)},
  ])
  await f.topic('unknown')
  await f.topic('topic-only')
  assert.deepEqual(await f.messages.officialMenu('official'), {available:true, menu})
  assert.deepEqual(await f.messages.officialMenu('empty'), {available:true, menu:{buttons:[]}})
  for (const id of ['missing', 'invalid', 'raw', 'unknown', 'topic-only']) assert.deepEqual(await f.messages.officialMenu(id), {available:false, menu:null, reason:'notSynced'})
  for (const id of ['person', 'room@chatroom', 'worker@openim']) assert.deepEqual(await f.messages.officialMenu(id), {available:false, menu:null, reason:'notOfficial'})
  const safe = JSON.stringify(await f.messages.officialMenu('unsafe'))
  assert(!safe.includes('javascript:'))
  assert(!safe.includes('private-native-key'))
  await assert.rejects(f.messages.officialMenu('not-visible'), error => error.status === 404 && error.code === 'recipientMissing')
  for (const id of ['', ' ', 'x'.repeat(257)]) await assert.rejects(f.messages.officialMenu(id), error => error.code === 'invalidRequest')
})

test('real HTTP directory/menu routes retain owner auth, validate inputs/methods and never cache APIs', async t => {
  const f = await fixture(t)
  await f.contact({userName:'official', verifyFlag:24, officialMenu:'{"buttons":[]}'})
  const request = await httpFixture(t, f.messages)
  for (const route of ['/api/contacts', '/api/contacts/menu?wxId=official']) {
    assert.equal((await request(route, {headers:{Authorization:''}})).status, 401)
    assert.equal((await request(route + '&token=directory-token', {headers:{Authorization:''}})).status, 401)
    assert.equal((await request(route, {headers:{Origin:'https://attacker.example'}})).status, 403)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) assert.equal((await request(route, {method})).status, 405)
  }
  for (const params of ['', '?wxId=', '?wxId=%20', '?wxId=' + 'x'.repeat(257), '?wxId=official&wxId=person']) assert.equal((await request('/api/contacts/menu' + params)).status, 400)
  assert.equal((await request('/api/contacts/menu?wxId=not-visible')).status, 404)
  for (const query of ['kind=subscription', 'kind=brands', 'offset=-1', 'offset=10001', 'offset=1.5', 'q=' + 'x'.repeat(101)]) assert.equal((await request('/api/contacts?' + query)).status, 400)
  for (const kind of ['all', 'contact', 'group', 'person', 'official', 'service', 'enterprise', 'unknown']) assert.equal((await request('/api/contacts?kind=' + kind)).status, 200)
  for (const route of ['/api/contacts?kind=official', '/api/contacts/menu?wxId=official']) {
    const response = await request(route)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert(!/(?:verifyFlag|officialMenu|private-native-key)/.test(await response.text()))
  }
  assert.equal((await request('/api/contacts/menu/action', {method:'POST'})).status, 404)
  const exchange = await request('/api/auth/telegram', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({initData:initData()})})
  assert.equal(exchange.status, 200)
  const session = await exchange.json()
  const response = await request('/api/contacts/menu?wxId=official', {headers:{Authorization:`Bearer ${session.token}`}})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {available:true, menu:{buttons:[]}})
})

test('group avatars include non-friends, reuse member lookup and reject untrusted media URLs', async t => {
  const f = await fixture(t)
  const {groupApi} = require('wx2tg-puppet/dist/api/GroupApi')
  const avatars = require('../dist/webui/avatars')
  const {parseGroupMembers} = require('../dist/webui/mentions')
  const roomId = 'avatars@chatroom'
  await f.sdk.getRepository(WxRoom).save({chatroomId:roomId,nickName:'Avatar room'})
  await f.contact({userName:'friend',nickName:'Friend',verifyFlag:0,smallHeadImgUrl:'https://wx.qlogo.cn/friend'})
  t.mock.method(AbstractClient,'getSpyClient',name=>name === 'wxClient' ? {hasLogin:true,wxInfo:{wxid:'self'}} : undefined)
  let lookups = 0
  const data = {NewChatroomData:{ChatRoomMember:[
    {UserName:'friend',NickName:'Friend'},
    {UserName:'nonfriend',NickName:'Member',SmallHeadImgUrl:{string:'https://wx.qlogo.cn/member'}},
    {UserName:'unsafe',NickName:'Unsafe',SmallHeadImgUrl:'http://127.0.0.1/private'},
  ]}}
  assert.equal(parseGroupMembers(data)[2].hasAvatar,false)
  t.mock.method(groupApi,'GetChatRoomMemberDetail',async()=>{lookups++;return {data:{Code:0,Data:data}}})
  t.mock.method(avatars,'loadAvatar',async url=>{
    if(!avatars.allowedAvatarURL(url))throw Object.assign(new Error('missing'),{code:'avatarUnavailable',status:404})
    return Buffer.from(url)
  })
  const members = await f.messages.groupMembers(roomId,'',0)
  assert.deepEqual(members.members.map(m=>m.hasAvatar),[true,true,false])
  assert(!JSON.stringify(members).includes('qlogo.cn'),'member API exposes availability, not CDN metadata')
  assert.equal((await f.messages.avatar('nonfriend',roomId)).toString(),'https://wx.qlogo.cn/member')
  assert.equal((await f.messages.avatar('friend',roomId)).toString(),'https://wx.qlogo.cn/friend')
  await assert.rejects(f.messages.avatar('unsafe',roomId),error=>error.code === 'avatarUnavailable')
  await assert.rejects(f.messages.avatar('not-a-member',roomId),error=>error.code === 'avatarUnavailable')
  assert.equal(lookups,1,'member metadata is fetched once for the group')
  const request = await httpFixture(t,f.messages)
  assert.equal((await request(`/api/avatar?wxId=nonfriend&roomId=${roomId}`)).status,200)
  assert.equal((await request('/api/avatar?wxId=nonfriend&roomId=not-a-group')).status,400)
  assert.equal((await request(`/api/avatar?wxId=nonfriend&roomId=${roomId}`,{headers:{Authorization:''}})).status,401)
})

test('old optional adapters return a safe error rather than dispatching menu requests as messages', async t => {
  const request = await httpFixture(t, {contacts:async () => ({contacts:[]})})
  const response = await request('/api/contacts/menu?wxId=official')
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {error:'messagesUnavailable'})
})