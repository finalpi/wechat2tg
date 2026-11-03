import {DataSource, Repository} from 'typeorm'
import {Api, utils} from 'telegram'
import {TelegramClient} from 'telegram/client/TelegramClient'
import {returnBigInt} from 'telegram/Helpers'
import {OfficialAccountForum} from '../entity/OfficialAccountForum'
import {OfficialAccountTopic} from '../entity/OfficialAccountTopic'
import type {OfficialForumStorage, OfficialForumTelegram, OfficialTopicOptions} from './OfficialAccountForumService'

export class TypeOrmOfficialForumStorage implements OfficialForumStorage {
    constructor(private readonly source: () => Promise<DataSource> = async () => (await import('../data-sourse')).AppDataSource) {}

    private async forums(): Promise<Repository<OfficialAccountForum>> {
        return (await this.source()).getRepository(OfficialAccountForum)
    }

    private async topics(): Promise<Repository<OfficialAccountTopic>> {
        return (await this.source()).getRepository(OfficialAccountTopic)
    }

    async getForum(): Promise<OfficialAccountForum | undefined> {
        return (await (await this.forums()).findOneBy({id: 1})) ?? undefined
    }

    async insertForum(forum: OfficialAccountForum): Promise<boolean> {
        try {
            await (await this.forums()).insert(forum)
            return true
        } catch (error) {
            if (error?.code === 'SQLITE_CONSTRAINT' && await this.getForum()) return false
            throw error
        }
    }

    async saveForum(forum: OfficialAccountForum): Promise<void> {
        // Do not replace a known ID, even if another process supplies stale state.
        const result = await (await this.forums()).createQueryBuilder().update()
            .set({chatId: forum.chatId, creationStatus: forum.creationStatus})
            .where('id = :id AND (chatId IS NULL OR chatId = :chatId)', {id: 1, chatId: forum.chatId}).execute()
        if (result.affected !== 1) throw new Error('Official-account forum state conflict; no state was reset')
    }

    async getTopic(wxId: string): Promise<OfficialAccountTopic | undefined> {
        return (await (await this.topics()).findOneBy({wxId})) ?? undefined
    }

    async getTopicByThread(chatId: number, threadId: number): Promise<OfficialAccountTopic | undefined> {
        return (await (await this.topics()).findOneBy({chatId, threadId})) ?? undefined
    }

    async insertTopic(topic: OfficialAccountTopic): Promise<void> {
        try {
            await (await this.topics()).insert(topic)
        } catch (error) {
            if (error?.code !== 'SQLITE_CONSTRAINT' || !await this.getTopic(topic.wxId)) throw error
        }
    }

    async finishTopic(wxId: string, threadId: number): Promise<void> {
        const result = await (await this.topics()).createQueryBuilder().update()
            .set({threadId, status: 'ready'})
            .where('wxId = :wxId AND (threadId IS NULL OR threadId = :threadId)', {wxId, threadId}).execute()
        if (result.affected !== 1) throw new Error('Official-account topic state conflict')
    }

    async setTopicOptions(chatId: number, threadId: number, options: OfficialTopicOptions): Promise<void> {
        const result = await (await this.topics()).update({chatId, threadId}, options)
        if (result.affected !== 1) throw new Error('Unknown official-account topic')
    }
}

/** No application clients/config/database are loaded until a method is invoked. */
export class GramJsOfficialForumTelegram implements OfficialForumTelegram {
    private async clients() {
        const {AbstractClient} = await import('../base/BaseClient')
        const {ConfigurationService} = await import('./ConfigurationService')
        const user = AbstractClient.getSpyClient('userMTPClient')?.client as TelegramClient
        const bot = AbstractClient.getSpyClient('botClient')?.client?.telegram
        const config = await ConfigurationService.getInstance().getConfig()
        if (!user || !bot || !Number.isSafeInteger(config?.botId) || config.botId <= 0
            || !Number.isSafeInteger(config?.chatId) || config.chatId <= 0) {
            throw new Error('Official-account forums require a logged-in Telegram user, configured bot and positive owner config.chatId')
        }
        return {user, bot, config}
    }

    async checkReady(): Promise<void> {
        const {user, bot, config} = await this.clients()
        if (!await user.checkAuthorization()) throw new Error('Telegram user is not logged in')
        const me = await bot.getMe()
        if (me.id !== config.botId) throw new Error('Configured botId does not match the logged-in bot')
    }

    async createForum(): Promise<number> {
        const {user} = await this.clients()
        // No username is assigned: a new channel is private by default.
        const result = await user.invoke(new Api.channels.CreateChannel({
            title: 'WeChat Official Accounts', about: 'WeChat official-account topics',
            megagroup: true, forum: true
        }))
        const channel = ('chats' in result ? result.chats : [])
            .find(chat => chat instanceof Api.Channel && chat.megagroup)
        if (!channel) throw new Error('CreateChannel returned no identifiable supergroup')
        return Number(utils.getPeerId(channel))
    }

    private async channel(user: TelegramClient, chatId: number): Promise<Api.Channel> {
        // getEntity may need the access hash after a crash/restart. Populate the user
        // session's entity cache from dialogs, without guessing a channel access hash.
        let entity
        try {
            entity = await user.getEntity(returnBigInt(chatId))
        } catch {
            for await (const dialog of user.iterDialogs({})) {
                if (dialog.id?.toString() === String(chatId)) {
                    entity = dialog.entity
                    break
                }
            }
        }
        if (!(entity instanceof Api.Channel) || !entity.megagroup || !entity.forum
            || entity.username || entity.usernames?.some(username => username.active)) {
            throw new Error(`Chat ${chatId} must be an accessible private Telegram supergroup with forum enabled`)
        }
        return entity
    }

    private async ensureMember(user: TelegramClient, channel: Api.Channel, id: number, username?: string): Promise<void> {
        const participant = username ? `@${username}` : returnBigInt(id)
        try {
            await user.invoke(new Api.channels.GetParticipant({channel, participant}))
            return
        } catch (error) {
            if (error?.errorMessage !== 'USER_NOT_PARTICIPANT') throw error
        }
        await user.invoke(new Api.channels.InviteToChannel({channel, users: [participant]}))
        // An invite can require approval or be restricted. Completion is not membership.
        await user.invoke(new Api.channels.GetParticipant({channel, participant}))
    }

    async ensureForumReady(chatId: number): Promise<void> {
        await this.checkReady()
        const {user, bot, config} = await this.clients()
        const channel = await this.channel(user, chatId)
        const botInfo = await bot.getMe()
        await this.ensureMember(user, channel, config.botId, botInfo.username)
        await this.ensureMember(user, channel, config.chatId)
        await user.invoke(new Api.channels.EditAdmin({
            channel, userId: botInfo.username ? `@${botInfo.username}` : returnBigInt(config.botId),
            adminRights: new Api.ChatAdminRights({manageTopics: true, inviteUsers: true, deleteMessages: true}),
            // Telegram administrator titles must not exceed 16 characters.
            rank: 'WeChat accounts'
        }))
        // Check the Bot API view after awaiting the actual MTProto RPC, never an event listener.
        const chat = await bot.getChat(chatId)
        const member = await bot.getChatMember(chatId, config.botId)
        if (chat.type !== 'supergroup' || !chat.is_forum || chat.username
            || member.status !== 'administrator' || !member.can_manage_topics
            || !member.can_invite_users || !member.can_delete_messages) {
            throw new Error(`Forum ${chatId} is not ready: verify forum mode and bot manage_topics/invite_users/delete_messages rights, then retry`)
        }
    }

    async createTopic(chatId: number, name: string, randomId: string): Promise<number> {
        const {user} = await this.clients()
        const channel = await this.channel(user, chatId)
        const result = await user.invoke(new Api.channels.CreateForumTopic({
            channel, title: name.slice(0, 128), randomId: returnBigInt(randomId)
        }))
        const updates = 'updates' in result ? result.updates : []
        // A service-message ID is the topic/thread ID, NOT pts, channel.id or an update ID.
        const mapping = updates.find(update => update instanceof Api.UpdateMessageID
            && update.randomId?.toString() === randomId) as Api.UpdateMessageID | undefined
        const service = updates.find(update => (update instanceof Api.UpdateNewChannelMessage || update instanceof Api.UpdateNewMessage)
            && update.message instanceof Api.MessageService
            && update.message.action instanceof Api.MessageActionTopicCreate
            && utils.getPeerId(update.message.peerId) === String(chatId)
            && (!mapping || update.message.id === mapping.id)) as Api.UpdateNewChannelMessage | undefined
        if (service) return service.message.id
        // Telegram may return only the randomId mapping on an idempotent replay.
        if (mapping) return mapping.id
        throw new Error('CreateForumTopic returned no topic service-message ID; retry with the persisted randomId (do not reset topic state)')
    }
}