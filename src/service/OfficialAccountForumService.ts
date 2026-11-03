import {randomBytes} from 'node:crypto'
import {OfficialAccountForum} from '../entity/OfficialAccountForum'
import {OfficialAccountTopic} from '../entity/OfficialAccountTopic'
import {GramJsOfficialForumTelegram, TypeOrmOfficialForumStorage} from './OfficialAccountForumAdapters'

export interface OfficialForumDestination {
    wxId: string
    chatId: number
    threadId: number
    name: string
    alias?: string
    type: 0
    isReceive: boolean
    isForwardOthers: boolean
}

export type OfficialForumRoute = {kind: 'legacy'} | {kind: 'blocked'; reason: string}
    | {kind: 'topic'; binding: OfficialForumDestination}
export type OfficialTopicOptions = {isReceive?: boolean; isForwardOthers?: boolean}

// All writes concern only the two official_account_* tables, never BindGroup.
export interface OfficialForumStorage {
    getForum(): Promise<OfficialAccountForum | undefined>
    insertForum(forum: OfficialAccountForum): Promise<boolean>
    saveForum(forum: OfficialAccountForum): Promise<void>
    getTopic(wxId: string): Promise<OfficialAccountTopic | undefined>
    getTopicByThread(chatId: number, threadId: number): Promise<OfficialAccountTopic | undefined>
    insertTopic(topic: OfficialAccountTopic): Promise<void>
    finishTopic(wxId: string, threadId: number): Promise<void>
    setTopicOptions(chatId: number, threadId: number, options: OfficialTopicOptions): Promise<void>
}

export interface OfficialForumTelegram {
    // Check prerequisites before recording an irreversible CreateChannel attempt.
    checkReady(): Promise<void>
    createForum(): Promise<number>
    ensureForumReady(chatId: number): Promise<void>
    createTopic(chatId: number, name: string, randomId: string): Promise<number>
}

const recoveryError = 'Official-account forum creation outcome is unknown. Do not retry CreateChannel or delete its state. '
    + 'Inspect the logged-in Telegram user’s groups, then set OFFICIAL_ACCOUNT_FORUM_CHAT_ID to the existing private forum’s Bot API chat ID and retry.'

export class OfficialAccountForumService {
    private static instance: OfficialAccountForumService
    private forumPromise?: Promise<number>
    private readonly topicPromises = new Map<string, Promise<OfficialForumDestination>>()

    static getInstance(): OfficialAccountForumService {
        if (!this.instance) {
            this.instance = new OfficialAccountForumService(
                new TypeOrmOfficialForumStorage(), new GramJsOfficialForumTelegram(),
                () => process.env.OFFICIAL_ACCOUNT_TOPICS_ENABLED?.trim().toLowerCase() === 'true',
                () => process.env.OFFICIAL_ACCOUNT_FORUM_CHAT_ID,
                async wxId => (await import('./WechatAccountClassificationService')).WechatAccountClassificationService.getInstance().isOfficialAccount(wxId)
            )
        }
        return this.instance
    }

    constructor(
        private readonly storage: OfficialForumStorage,
        private readonly telegram: OfficialForumTelegram,
        private readonly enabled: () => boolean,
        private readonly recoveryChatId: () => string | number | undefined = () => undefined,
        private readonly classifyAccount: (wxId: string) => Promise<boolean | undefined> = async () => undefined
    ) {}

    async forWechat(wxId: string, name: string, initialOptions: OfficialTopicOptions = {}): Promise<OfficialForumDestination | undefined> {
        if (!this.enabled() || !wxId) return undefined
        const official = await this.classifyAccount(wxId)
        if (official === undefined && !await this.storage.getTopic(wxId)) {
            throw Object.assign(new Error('Contact VerifyFlag is unavailable; refresh contact details before creating a topic'), {code: 'contactClassificationUnavailable'})
        }
        if (official === false) return undefined
        const pending = this.topicPromises.get(wxId)
        if (pending) return pending
        const work = this.provisionTopic(wxId, name?.trim() || wxId, initialOptions)
        this.topicPromises.set(wxId, work)
        try {
            return await work
        } finally {
            this.topicPromises.delete(wxId)
        }
    }

    async forTelegram(chatId: number, threadId?: number): Promise<OfficialForumRoute> {
        const forumChatId = await this.getForumChatId()
        // Also block an explicitly configured recovery destination before provisioning.
        if (chatId !== forumChatId && chatId !== this.readRecoveryChatId()) return {kind: 'legacy'}
        if (!this.enabled()) return {kind: 'blocked', reason: 'Official-account topics are disabled'}
        if (!threadId || threadId === 1) return {kind: 'blocked', reason: 'General or missing topic'}
        const forum = await this.storage.getForum()
        if (forum?.creationStatus !== 'ready') return {kind: 'blocked', reason: 'Forum provisioning is incomplete'}
        const topic = await this.storage.getTopicByThread(chatId, threadId)
        if (!topic || topic.status !== 'ready') return {kind: 'blocked', reason: 'Unknown official-account topic'}
        return {kind: 'topic', binding: this.destination(topic)}
    }

    async getForumChatId(): Promise<number | undefined> {
        return (await this.storage.getForum())?.chatId ?? undefined
    }

    async setTopicOptions(chatId: number, threadId: number, options: OfficialTopicOptions): Promise<void> {
        if (chatId !== await this.getForumChatId() || threadId <= 1) throw new Error('Not a managed official-account topic')
        const topic = await this.storage.getTopicByThread(chatId, threadId)
        if (!topic || topic.status !== 'ready') throw new Error('Unknown official-account topic')
        const update: OfficialTopicOptions = {}
        for (const key of ['isReceive', 'isForwardOthers'] as const) {
            if (options[key] !== undefined) {
                if (typeof options[key] !== 'boolean') throw new Error(`${key} must be boolean`)
                update[key] = options[key]
            }
        }
        if (Object.keys(update).length) await this.storage.setTopicOptions(chatId, threadId, update)
    }

    private readRecoveryChatId(): number | undefined {
        const value = this.recoveryChatId()
        if (value === undefined || value === '') return undefined
        const id = Number(value)
        if (!Number.isSafeInteger(id) || !/^-100[1-9]\d*$/.test(String(id))) {
            if (!this.enabled()) return undefined
            throw new Error('OFFICIAL_ACCOUNT_FORUM_CHAT_ID must be a supergroup Bot API chat ID (-100…)')
        }
        return id
    }

    private async ensureForum(): Promise<number> {
        // Check conflicts even when this process has already completed provisioning.
        const recoveryId = this.readRecoveryChatId()
        const current = await this.storage.getForum()
        if (recoveryId && current?.chatId && recoveryId !== current.chatId) {
            throw new Error('OFFICIAL_ACCOUNT_FORUM_CHAT_ID conflicts with the established forum; no state was reset')
        }
        if (!this.forumPromise) {
            this.forumPromise = this.provisionForum(recoveryId).catch(error => {
                this.forumPromise = undefined
                throw error
            })
        }
        return this.forumPromise
    }

    private async provisionForum(recoveryId?: number): Promise<number> {
        let forum = await this.storage.getForum()
        if (!forum) {
            await this.telegram.checkReady()
            const proposed = Object.assign(new OfficialAccountForum(), {
                chatId: recoveryId ?? null,
                creationStatus: recoveryId ? 'provisioning' : 'creating'
            })
            const claimed = await this.storage.insertForum(proposed)
            forum = await this.storage.getForum()
            if (!forum) throw new Error('Failed to persist official-account forum creation intent')
            if (claimed && !recoveryId) {
                // CreateChannel has no randomId. Any failure here must fail CLOSED, including a
                // process crash or a DB failure after Telegram created the group.
                try {
                    const chatId = await this.telegram.createForum()
                    if (!Number.isSafeInteger(chatId) || !/^-100[1-9]\d*$/.test(String(chatId))) throw new Error('Invalid forum chat ID')
                    forum.chatId = chatId
                    forum.creationStatus = 'provisioning'
                    await this.storage.saveForum(forum)
                } catch (error) {
                    throw new Error(`${recoveryError}${forum.chatId ? ` Known candidate chat ID: ${forum.chatId}.` : ''} Cause: ${error instanceof Error ? error.message : String(error)}`)
                }
            }
        }
        if (recoveryId && forum.chatId && recoveryId !== forum.chatId) {
            throw new Error('Recovery chat ID conflicts with the established forum; no state was reset')
        }
        if (!forum.chatId) {
            if (!recoveryId) throw new Error(recoveryError)
            forum.chatId = recoveryId
            forum.creationStatus = 'provisioning'
            await this.storage.saveForum(forum)
        }
        await this.telegram.ensureForumReady(forum.chatId)
        forum.creationStatus = 'ready'
        await this.storage.saveForum(forum)
        return forum.chatId
    }

    private async provisionTopic(wxId: string, name: string, initialOptions: OfficialTopicOptions): Promise<OfficialForumDestination> {
        const chatId = await this.ensureForum()
        let topic = await this.storage.getTopic(wxId)
        if (!topic) {
            await this.storage.insertTopic(Object.assign(new OfficialAccountTopic(), {
                wxId, chatId, name,
                isReceive: initialOptions.isReceive ?? true,
                isForwardOthers: initialOptions.isForwardOthers ?? false,
                randomId: randomBytes(8).readBigInt64BE().toString()
            }))
            topic = await this.storage.getTopic(wxId)
        }
        if (!topic || topic.chatId !== chatId) throw new Error('Official-account topic conflicts with the managed forum')
        if (topic.status !== 'ready' || !topic.threadId) {
            // Reuse the persisted randomId on timeout/restart; never generate a replacement.
            const threadId = await this.telegram.createTopic(chatId, topic.name, topic.randomId)
            if (!Number.isSafeInteger(threadId) || threadId <= 1) throw new Error('Telegram did not return a valid topic service-message ID')
            await this.storage.finishTopic(wxId, threadId)
            topic = await this.storage.getTopic(wxId)
        }
        return this.destination(topic)
    }

    private destination(topic: OfficialAccountTopic): OfficialForumDestination {
        return {
            wxId: topic.wxId, chatId: topic.chatId, threadId: topic.threadId,
            name: topic.name, type: 0, isReceive: topic.isReceive, isForwardOthers: topic.isForwardOthers
        }
    }
}