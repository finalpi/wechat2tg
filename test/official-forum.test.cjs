/* eslint-disable @typescript-eslint/no-var-requires -- Node's .cjs test runner uses CommonJS. */
const test = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const {DataSource} = require('typeorm')
const {OfficialAccountForumService} = require('../dist/service/OfficialAccountForumService')
const {TypeOrmOfficialForumStorage, GramJsOfficialForumTelegram} = require('../dist/service/OfficialAccountForumAdapters')
const {OfficialAccountForum} = require('../dist/entity/OfficialAccountForum')
const {OfficialAccountTopic} = require('../dist/entity/OfficialAccountTopic')
const {BindGroup} = require('../dist/entity/BindGroup')
const {Api, utils} = require('telegram')
const {returnBigInt} = require('telegram/Helpers')
const CHAT = -1001234567890
const copy = value => value === undefined ? undefined : structuredClone(value)

class MemoryStorage {
    forum
    topics = new Map()
    writes = 0
    async getForum() { return copy(this.forum) }
    async insertForum(row) {
        if (this.forum) return false
        this.forum = copy(row); this.writes++; return true
    }
    async saveForum(row) { this.forum = copy(row); this.writes++ }
    async getTopic(wxId) { return copy(this.topics.get(wxId)) }
    async getTopicByThread(chatId, threadId) {
        return copy([...this.topics.values()].find(row => row.chatId === chatId && row.threadId === threadId))
    }
    async insertTopic(row) {
        if (!this.topics.has(row.wxId)) { this.topics.set(row.wxId, copy(row)); this.writes++ }
    }
    async finishTopic(wxId, threadId) {
        Object.assign(this.topics.get(wxId), {threadId, status: 'ready'}); this.writes++
    }
    async setTopicOptions(chatId, threadId, options) {
        const row = [...this.topics.values()].find(row => row.chatId === chatId && row.threadId === threadId)
        Object.assign(row, options); this.writes++
    }
}

class FakeTelegram {
    creates = 0
    checks = 0
    ensures = 0
    topicCalls = []
    remoteTopics = new Map()
    createError = false
    setupError = false
    topicTimeout = false
    async checkReady() { this.checks++ }
    async createForum() {
        this.creates++
        if (this.createError) throw new Error('connection lost after request')
        return CHAT
    }
    async ensureForumReady() {
        this.ensures++
        if (this.setupError) throw new Error('missing bot rights')
    }
    async createTopic(chatId, name, randomId) {
        this.topicCalls.push({chatId, name, randomId})
        if (!this.remoteTopics.has(randomId)) this.remoteTopics.set(randomId, this.remoteTopics.size + 10)
        if (this.topicTimeout) { this.topicTimeout = false; throw new Error('topic response lost') }
        return this.remoteTopics.get(randomId)
    }
}

const flags = new Map([['gh_a', 8], ['gh_b', 24], ['brand_news', 24], ['wx_a', 0], ['gh_personal', 0]])
const classify = async id => flags.has(id) ? (flags.get(id) & 8) !== 0 : undefined
const service = (store, telegram, enabled = () => true, recovery) => new OfficialAccountForumService(store, telegram, enabled, recovery, classify)

test('OFF/known personal contacts have zero provisioning side effects; unrelated chats stay legacy', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    const off = service(store, telegram, () => false)
    assert.equal(await off.forWechat('gh_a', 'A'), undefined)
    assert.equal(await service(store, telegram).forWechat('wx_a', 'A'), undefined)
    assert.deepEqual(await off.forTelegram(-123), {kind: 'legacy'})
    assert.equal(await off.getForumChatId(), undefined)
    assert.equal(store.writes, 0)
    assert.equal(telegram.checks + telegram.creates + telegram.ensures + telegram.topicCalls.length, 0)
})

test('one forum and per-account single-flight, independent topics and exact recipients', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram(), app = service(store, telegram)
    const results = await Promise.all(Array.from({length: 30}, (_, i) => app.forWechat(i % 2 ? 'gh_a' : 'gh_b', i % 2 ? 'A' : 'B')))
    assert.equal(telegram.creates, 1)
    assert.equal(telegram.ensures, 1)
    assert.equal(telegram.topicCalls.length, 2)
    assert.equal(new Set(results.map(row => row.threadId)).size, 2)
    for (const binding of results) {
        assert.equal(binding.chatId, CHAT)
        assert.equal(binding.type, 0)
        assert.equal(binding.isReceive, true)
        assert.equal(binding.isForwardOthers, false)
        assert.deepEqual(await app.forTelegram(CHAT, binding.threadId), {kind: 'topic', binding})
    }
    const restarted = service(store, telegram)
    assert.deepEqual(await restarted.forWechat('gh_a', 'Renamed'), results[1])
    assert.equal(telegram.creates, 1)
    assert.equal(telegram.topicCalls.length, 2)
})

test('initial topic flags inherit legacy preferences only once, and OFF ignores invalid recovery placeholders', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram(), app = service(store, telegram)
    const topic = await app.forWechat('gh_a', 'A', {isReceive: false, isForwardOthers: true})
    assert.equal(topic.isReceive, false)
    assert.equal(topic.isForwardOthers, true)
    await app.setTopicOptions(CHAT, topic.threadId, {isReceive: true, isForwardOthers: false})
    const again = await app.forWechat('gh_a', 'A', {isReceive: false, isForwardOthers: true})
    assert.equal(again.isReceive, true)
    assert.equal(again.isForwardOthers, false)
    const off = service(new MemoryStorage(), new FakeTelegram(), () => false, () => 'invalid-placeholder')
    assert.deepEqual(await off.forTelegram(-123), {kind: 'legacy'})
})

test('eligibility uses authoritative classification, not gh_ names, and unknown new contacts fail closed', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram(), app = service(store, telegram)
    assert.equal(await app.forWechat('gh_personal', 'ordinary contact'), undefined)
    const official = await app.forWechat('brand_news', 'Publisher without gh prefix')
    assert.equal(official.wxId, 'brand_news')
    await assert.rejects(app.forWechat('unknown_contact', 'unknown'), {code: 'contactClassificationUnavailable'})
    assert.equal(telegram.topicCalls.length, 1)
    const cacheUnavailable = new OfficialAccountForumService(store, telegram, () => true, undefined, async () => undefined)
    assert.equal((await cacheUnavailable.forWechat('brand_news', 'same publisher')).threadId, official.threadId)
    assert.equal(telegram.topicCalls.length, 1)
})

test('known forum persists before permissions; restart resumes without another group', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    telegram.setupError = true
    await assert.rejects(service(store, telegram).forWechat('gh_a', 'A'), /missing bot rights/)
    assert.equal(store.forum.chatId, CHAT)
    assert.equal(store.forum.creationStatus, 'provisioning')
    assert.equal(telegram.topicCalls.length, 0)
    assert.equal((await service(store, telegram).forTelegram(CHAT, 10)).kind, 'blocked')
    telegram.setupError = false
    assert.equal((await service(store, telegram).forWechat('gh_a', 'A')).chatId, CHAT)
    assert.equal(telegram.creates, 1)
})

test('ambiguous CreateChannel failure fails closed until explicit nonconflicting recovery', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    telegram.createError = true
    const app = service(store, telegram)
    await assert.rejects(app.forWechat('gh_a', 'A'), /OFFICIAL_ACCOUNT_FORUM_CHAT_ID/)
    assert.equal(store.forum.chatId, null)
    telegram.createError = false
    await assert.rejects(app.forWechat('gh_a', 'A'), /outcome is unknown/)
    await assert.rejects(service(store, telegram).forWechat('gh_a', 'A'), /outcome is unknown/)
    assert.equal(telegram.creates, 1)
    const recovered = service(store, telegram, () => true, () => CHAT)
    assert.equal((await recovered.forWechat('gh_a', 'A')).chatId, CHAT)
    assert.equal(telegram.creates, 1)
    await assert.rejects(service(store, telegram, () => true, () => CHAT - 1).forWechat('gh_b', 'B'), /conflicts/)
    assert.equal(store.forum.chatId, CHAT)
})

test('a crash after creation intent cannot create another group on restart', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    store.forum = {id: 1, chatId: null, creationStatus: 'creating'}
    await assert.rejects(service(store, telegram).forWechat('gh_a', 'A'), /outcome is unknown/)
    assert.equal(telegram.creates, 0)
})

test('topic retries across restart reuse the persisted randomId after lost response', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    telegram.topicTimeout = true
    await assert.rejects(service(store, telegram).forWechat('gh_a', 'A'), /response lost/)
    const saved = await store.getTopic('gh_a')
    assert.equal(saved.threadId, null)
    assert.match(saved.randomId, /^-?\d+$/)
    const destination = await service(store, telegram).forWechat('gh_a', 'A')
    assert.equal(destination.threadId, 10)
    assert.equal(telegram.topicCalls.length, 2)
    assert.equal(telegram.topicCalls[0].randomId, telegram.topicCalls[1].randomId)
    assert.equal(telegram.remoteTopics.size, 1)
})

test('General/missing/unknown/OFF blocked; flags survive reuse, restart and partial updates', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    let enabled = true
    const app = service(store, telegram, () => enabled)
    const a = await app.forWechat('gh_a', 'A'), b = await app.forWechat('gh_b', 'B')
    for (const id of [undefined, 0, 1, 999]) assert.equal((await app.forTelegram(CHAT, id)).kind, 'blocked')
    await app.setTopicOptions(CHAT, a.threadId, {isReceive: false, isForwardOthers: true})
    await app.setTopicOptions(CHAT, a.threadId, {isReceive: true})
    const reused = await service(store, telegram).forWechat('gh_a', 'A')
    assert.equal(reused.isReceive, true)
    assert.equal(reused.isForwardOthers, true)
    assert.equal((await app.forTelegram(CHAT, b.threadId)).binding.isForwardOthers, false)
    await assert.rejects(app.setTopicOptions(CHAT, 1, {isReceive: true}), /Not a managed/)
    await assert.rejects(app.setTopicOptions(CHAT, 999, {isReceive: true}), /Unknown/)
    enabled = false
    assert.equal(await app.forWechat('gh_a', 'A'), undefined)
    assert.equal((await app.forTelegram(CHAT, a.threadId)).kind, 'blocked')
    assert.deepEqual(await app.forTelegram(-99, a.threadId), {kind: 'legacy'})
})

test('explicit recovery may adopt an existing forum without CreateChannel', async () => {
    const store = new MemoryStorage(), telegram = new FakeTelegram()
    const app = service(store, telegram, () => true, () => String(CHAT))
    assert.equal((await app.forTelegram(CHAT, 20)).kind, 'blocked')
    assert.equal((await app.forWechat('gh_a', 'A')).chatId, CHAT)
    assert.equal(telegram.creates, 0)
})

test('real TypeORM adapter: additive tables, constraints, state races and untouched BindGroup', async () => {
    const db = new DataSource({type: 'sqlite', database: ':memory:', entities: [OfficialAccountForum, OfficialAccountTopic, BindGroup], synchronize: true})
    await db.initialize()
    try {
        const legacyRepo = db.getRepository(BindGroup)
        const legacy = await legacyRepo.save({wxId: 'gh_a', chatId: -12, name: 'Old group', type: 0, isReceive: false, isForwardOthers: true})
        const store = new TypeOrmOfficialForumStorage(async () => db), telegram = new FakeTelegram()
        const app = service(store, telegram)
        const a = await app.forWechat('gh_a', 'A'), b = await app.forWechat('gh_b', 'B')
        await app.setTopicOptions(CHAT, a.threadId, {isReceive: false, isForwardOthers: true})
        assert.deepEqual({...await legacyRepo.findOneBy({id: legacy.id})}, {...legacy, alias: null, avatarLink: null})
        assert.deepEqual(await app.forTelegram(legacy.chatId), {kind: 'legacy'})
        assert.equal(await store.insertForum({id: 1, chatId: null, creationStatus: 'creating'}), false)
        await assert.rejects(db.getRepository(OfficialAccountForum).insert({id: 2, creationStatus: 'creating'}), /CHECK constraint/)
        await assert.rejects(store.saveForum({id: 1, chatId: CHAT - 1, creationStatus: 'ready'}), /state conflict/)
        await assert.rejects(store.finishTopic('gh_b', a.threadId), /state conflict/)
        await assert.rejects(db.getRepository(OfficialAccountTopic).update({wxId: 'gh_b'}, {threadId: a.threadId}), /UNIQUE constraint/)
        await store.insertTopic({wxId: 'gh_a', chatId: CHAT, name: 'Replacement', randomId: '999', status: 'creating', threadId: null, isReceive: true, isForwardOthers: false})
        const restarted = service(new TypeOrmOfficialForumStorage(async () => db), telegram)
        const persisted = await restarted.forWechat('gh_a', 'A')
        assert.equal(persisted.isReceive, false)
        assert.equal(persisted.isForwardOthers, true)
        assert.equal(persisted.threadId, a.threadId)
        assert.equal((await restarted.forTelegram(CHAT, b.threadId)).binding.wxId, 'gh_b')
        assert.equal(telegram.creates, 1)
    } finally { await db.destroy() }
})

test('database uniqueness prevents two service instances from creating two forums', async () => {
    const db = new DataSource({type: 'sqlite', database: ':memory:', entities: [OfficialAccountForum, OfficialAccountTopic], synchronize: true})
    await db.initialize()
    try {
        const telegram = new FakeTelegram()
        const instances = [0, 1].map(() => service(new TypeOrmOfficialForumStorage(async () => db), telegram))
        const results = await Promise.allSettled(instances.map(app => app.forWechat('gh_a', 'A')))
        assert.ok(results.some(result => result.status === 'fulfilled'))
        assert.equal(telegram.creates, 1)
        const destination = await instances[1].forWechat('gh_a', 'A')
        assert.equal(destination.chatId, CHAT)
        assert.equal(telegram.remoteTopics.size, 1)
    } finally { await db.destroy() }
})

test('GramJS adapter uses forum flags, marked peer IDs, awaited admin RPC and service-message topic IDs', async () => {
    const channel = new Api.Channel({id: returnBigInt(1234567890), title: 'Forum', megagroup: true, forum: true})
    const requests = []
    let promoted = false
    const members = new Set(['@test_bot'])
    const user = {
        checkAuthorization: async () => true,
        getEntity: async () => channel,
        invoke: async request => {
            requests.push(request)
            if (request instanceof Api.channels.CreateChannel) return new Api.Updates({chats: [channel], updates: [], users: [], date: 0, seq: 0})
            if (request instanceof Api.channels.GetParticipant) {
                if (!members.has(String(request.participant))) throw {errorMessage: 'USER_NOT_PARTICIPANT'}
                return {}
            }
            if (request instanceof Api.channels.InviteToChannel) { members.add(String(request.users[0])); return {} }
            if (request instanceof Api.channels.EditAdmin) {
                // Telegram rejects administrator titles longer than 16 characters.
                // A permissive RPC mock previously hid the production provisioning failure.
                if ([...request.rank].length > 16) {
                    throw Object.assign(new Error('ADMIN_RANK_INVALID'), {code: 400, errorMessage: 'ADMIN_RANK_INVALID'})
                }
                await Promise.resolve(); promoted = true; return {}
            }
            if (request instanceof Api.channels.CreateForumTopic) {
                return new Api.Updates({chats: [], users: [], date: 0, seq: 0, updates: [
                    new Api.UpdateNewChannelMessage({pts: 999, ptsCount: 1, message: new Api.MessageService({
                        id: 71, peerId: new Api.PeerChannel({channelId: returnBigInt(1234567890)}), date: 0,
                        action: new Api.MessageActionTopicCreate({title: 'A', iconColor: 0})
                    })})
                ]})
            }
            throw new Error(`Unexpected request ${request.className}`)
        }
    }
    const bot = {
        getMe: async () => ({id: 100, username: 'test_bot'}),
        getChat: async () => { assert.equal(promoted, true); return {type: 'supergroup', is_forum: true} },
        getChatMember: async () => ({status: 'administrator', can_manage_topics: true, can_invite_users: true, can_delete_messages: true})
    }
    const adapter = new GramJsOfficialForumTelegram()
    // Override the lazy client lookup only; all actual GramJS request construction is exercised.
    adapter.clients = async () => ({user, bot, config: {chatId: 200, botId: 100}})
    await adapter.checkReady()
    assert.equal(await adapter.createForum(), Number(utils.getPeerId(channel)))
    await adapter.ensureForumReady(CHAT)
    assert.equal(await adapter.createTopic(CHAT, 'A', '-12345678901234'), 71)
    const create = requests.find(request => request instanceof Api.channels.CreateChannel)
    assert.equal(create.megagroup, true)
    assert.equal(create.forum, true)
    const admin = requests.find(request => request instanceof Api.channels.EditAdmin)
    assert.ok([...admin.rank].length <= 16)
    assert.equal(admin.adminRights.manageTopics, true)
    assert.equal(admin.adminRights.inviteUsers, true)
    assert.equal(admin.adminRights.deleteMessages, true)
    assert.equal(requests.filter(request => request instanceof Api.channels.InviteToChannel).length, 1)
    const topic = requests.find(request => request instanceof Api.channels.CreateForumTopic)
    assert.equal(topic.randomId.toString(), '-12345678901234')
})