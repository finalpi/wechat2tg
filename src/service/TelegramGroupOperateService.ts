import {BindGroupService} from './BindGroupService'
import {BindGroup} from '../entity/BindGroup'
import {ConfigurationService} from './ConfigurationService'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {Api} from 'telegram'
import {CustomFile} from 'telegram/client/uploads'
import axios from 'axios'
import {returnBigInt} from 'telegram/Helpers'
import {prepareGroupAvatar, sameGroupAvatar} from '../util/GroupAvatar'
import {FormatUtils} from '../util/FormatUtils'
import {config} from '../config'
import {FileUtils} from '../util/FileUtils'
import {TelegramChatFolderService} from './TelegramChatFolderService'

interface GroupMetadataState {
    queue: Promise<void>
    pending: Map<string, Promise<void>>
    blockedUntil: number
}

function noticeIds(value?: string): number[] {
    try {
        const ids = JSON.parse(value || '[]')
        return Array.isArray(ids) ? [...new Set<number>(ids.filter(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647))] : []
    } catch {return []}
}

export class TelegramGroupOperateService {
    // Startup, manual updates and new service instances share one metadata lane per account client.
    private static readonly metadataStates = new WeakMap<GramClient, GroupMetadataState>()
    private bindGroupService: BindGroupService
    private client: GramClient
    private configService: ConfigurationService = ConfigurationService.getInstance()
    // 创建群组队列，保证不重复
    private createGroupQueue: BindGroup[] = []

    constructor(bindGroupService: BindGroupService, client: GramClient) {
        this.bindGroupService = bindGroupService
        this.client = client
    }

    // Metadata is optional: serialize requests, but never sleep/retry through a FloodWait.
    public async updateGroup(contactOrRoom: BindGroup): Promise<void> {
        if (!this.client) return
        let state = TelegramGroupOperateService.metadataStates.get(this.client)
        if (!state) {
            state = {queue: Promise.resolve(), pending: new Map(), blockedUntil: 0}
            TelegramGroupOperateService.metadataStates.set(this.client, state)
        }
        if (Date.now() < state.blockedUntil) return
        const input = {...contactOrRoom}
        const key = JSON.stringify([input.chatId, input.wxId, input.name, input.alias, input.avatarLink, input.type])
        const pending = state.pending.get(key)
        if (pending) return pending
        const operation = state.queue.then(() => this.updateGroupMetadata(input, state))
        state.queue = operation.catch(() => undefined)
        state.pending.set(key, operation)
        try {
            await operation
        } finally {
            if (state.pending.get(key) === operation) state.pending.delete(key)
        }
    }

    private async updateGroupMetadata(input: BindGroup, state: GroupMetadataState): Promise<void> {
        // A previous queued job may have established a cooldown after this one was enqueued.
        if (Date.now() < state.blockedUntil) return
        let updated: BindGroup | undefined
        let changed = false
        try {
            const stored = await this.bindGroupService.getByChatId(input.chatId)
            if (!stored) return
            updated = {...stored}
            const entity = await this.client.getEntity(returnBigInt(input.chatId))
            if (!entity || !(entity.className === 'Chat' || entity.className === 'Channel' && entity.megagroup)) return
            const preferences = await this.configService.getConfig()
            const deleteAvatarNotices = stored.type === 1 || stored.wxId?.endsWith('@chatroom') === true
                || preferences.deleteAvatarNotices === true
            if (input.avatarLink && (input.avatarLink !== stored.avatarLink || !stored.avatarHash)) {
                try {
                    const buff = await FileUtils.getInstance().downloadUrl2Buffer(input.avatarLink)
                    if (!buff?.length) throw new Error('Empty group avatar')
                    const avatar = await prepareGroupAvatar(buff)
                    if (avatar.hash !== stored.avatarHash) {
                        // The old source URL can expire or change its bytes. The
                        // existing Telegram photo is the authoritative baseline.
                        const current = await this.client.downloadProfilePhoto(entity, {isBig: true})
                        if (!Buffer.isBuffer(current)) throw new Error('Unable to read current group avatar')
                        if (!current.length || !await sameGroupAvatar(avatar.buffer, current)) {
                            const result = await this.updateGroupAvatar(entity, avatar.buffer)
                            if (deleteAvatarNotices) {
                                const notices = this.metadataNoticeIds(result, entity, 'avatar')
                                if (notices.length) updated.avatarNoticeIds = JSON.stringify([...new Set([...noticeIds(updated.avatarNoticeIds), ...notices])])
                            }
                        }
                    }
                    updated.avatarLink = input.avatarLink
                    updated.avatarHash = avatar.hash
                    changed = true
                } catch (error) {
                    // An avatar FloodWait must also stop the following title edit.
                    if (this.isFloodWaitError(error)) throw error
                    console.warn('[TelegramGroupOperateService] 更新群头像失败，保留原头像:', error?.message)
                }
            }
            if (deleteAvatarNotices) changed = await this.cleanupNotices(entity, updated, 'avatarNoticeIds') || changed
            const alias = input.type === 0 && input.alias === input.name ? '' : input.alias
            const name = input.type === 0
                ? FormatUtils.transformTitleStr(config.CREATE_CONTACT_NAME, alias, input.name, '') || '未命名'
                : FormatUtils.transformTitleStr(config.CREATE_ROOM_NAME, alias, '', input.name) || '未命名群聊'
            // GramJS may return a stale cached entity after a successful edit.
            if (updated.name !== name && entity.title !== name) {
                const result = await this.client.invoke(entity.className === 'Channel'
                    ? new Api.channels.EditTitle({channel: entity, title: name})
                    : new Api.messages.EditChatTitle({chatId: entity.id, title: name}))
                if (preferences.deleteTitleNotices === true) {
                    const notices = this.metadataNoticeIds(result, entity, 'title')
                    if (notices.length) updated.titleNoticeIds = JSON.stringify([...new Set([...noticeIds(updated.titleNoticeIds), ...notices])])
                }
            }
            if (updated.name !== name || updated.alias !== alias) {
                updated.name = name
                updated.alias = alias
                changed = true
            }
            if (preferences.deleteTitleNotices === true) changed = await this.cleanupNotices(entity, updated, 'titleNoticeIds') || changed
        } catch (error) {
            if (this.isFloodWaitError(error)) {
                const seconds = Number(error.seconds)
                const wait = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
                state.blockedUntil = Date.now() + wait * 1000
                console.warn(`[TelegramGroupOperateService] 群名/头像更新触发 Telegram 限流，暂停元数据同步 ${wait} 秒；不影响消息转发`)
            } else {
                console.error('[TelegramGroupOperateService] 更新群组信息失败:', error?.message)
            }
        }
        // Persist only confirmed changes, including an avatar succeeded before a title FloodWait.
        if (changed && updated) {
            try {
                await this.bindGroupService.createOrUpdate(updated)
            } catch (error) {
                console.error('[TelegramGroupOperateService] 保存群组信息失败:', error?.message)
            }
        }
    }

    private async updateGroupAvatar(entity: any, buff: Buffer) {
        const toUpload = new CustomFile('avatar.png', buff.length, '', buff)
        const file = await this.client?.uploadFile({
            file: toUpload,
            workers: 3,
        })
        return entity.className === 'Channel' && entity.megagroup
            ? await this.client.invoke(new Api.channels.EditPhoto({
                channel: entity,
                photo: new Api.InputChatUploadedPhoto({
                    file: file,
                })
            }))
            : await this.client.invoke(new Api.messages.EditChatPhoto({
                chatId: entity.id,
                photo: new Api.InputChatUploadedPhoto({
                    file: file,
                })
            }))
    }

    private metadataNoticeIds(result: any, entity: any, kind: 'avatar' | 'title'): number[] {
        const notices: number[] = []
        const updates = Array.isArray((result as any)?.updates) ? (result as any).updates
            : result instanceof Api.UpdateShort ? [result.update] : []
        for (const update of updates) {
            const message = update.message
            if (!(message instanceof Api.MessageService)) continue
            const matchingAction = kind === 'avatar' ? message.action instanceof Api.MessageActionChatEditPhoto
                : message.action instanceof Api.MessageActionChatEditTitle
            if (!matchingAction) continue
            const peer = message.peerId
            const samePeer = entity.className === 'Channel'
                ? peer instanceof Api.PeerChannel && String(peer.channelId) === String(entity.id)
                : peer instanceof Api.PeerChat && String(peer.chatId) === String(entity.id)
            if (samePeer && Number.isSafeInteger(message.id) && message.id > 0 && message.id <= 2147483647) notices.push(message.id)
        }
        return [...new Set(notices)]
    }

    private async cleanupNotices(entity: any, updated: BindGroup, key: 'avatarNoticeIds' | 'titleNoticeIds'): Promise<boolean> {
        const notices = noticeIds(updated[key])
        if (!notices.length) return false
        try {
            await this.client.deleteMessages(entity, notices, {revoke: true})
            updated[key] = null
            console.log(`[TelegramGroupOperateService] 已清理 ${notices.length} 条群组元数据通知`)
            return true
        } catch (error) {
            // Keep the confirmed edit and receipt IDs for the next metadata sync.
            if (this.isFloodWaitError(error)) throw error
            console.warn('[TelegramGroupOperateService] 群组元数据通知清理待重试:', error?.code || error?.name)
            return false
        }
    }

    private isFloodWaitError(e: any): boolean {
        return e?.code === 420 || e?.errorMessage === 'FLOOD' || e?.message?.includes('FloodWait')
    }

    // 创建并绑定群组
    public async createGroup(contactOrRoom: BindGroup): Promise<BindGroup> {
        // 使用 wxId 来去重，而不是 chatId（因为新建群组时 chatId 可能是 undefined）
        const item = this.createGroupQueue.find(value => contactOrRoom.wxId && contactOrRoom.wxId === value.wxId)
        if (item && item.chatId) {
            return item
        }
        this.createGroupQueue.push(contactOrRoom)
        const oldGourp = await this.bindGroupService.getByWxId(contactOrRoom.wxId)
        if (oldGourp) {
            contactOrRoom.chatId = oldGourp.chatId
            this.updateGroup(contactOrRoom)
            return oldGourp
        } else {
            // 删除之前绑定过的群组
            await this.bindGroupService.removeByChatIdOrWxId(contactOrRoom.chatId, contactOrRoom.wxId)
        }

        // 检查 client 是否可用
        if (!this.client) {
            console.error('[TelegramGroupOperateService] 创建群组失败: Telegram User Client 未连接')
            this.createGroupQueue = this.createGroupQueue.filter(i => i.wxId !== contactOrRoom.wxId)
            return null
        }

        // 创建群组
        const config = await this.configService.getConfig()
        if (!contactOrRoom.name) {
            contactOrRoom.name = '未命名'
        }

        try {
            const result = await this.client.invoke(
                new Api.messages.CreateChat({
                    users: [config.chatId, config.botId],
                    title: contactOrRoom.name,
                    ttlPeriod: 0
                })
            )

            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const id = result?.updates?.chats?.[0]?.id
            if (!id) {
                console.error('[TelegramGroupOperateService] 创建群组失败: 无法获取群组ID')
                this.createGroupQueue = this.createGroupQueue.filter(i => i.wxId !== contactOrRoom.wxId)
                return null
            }

            contactOrRoom.chatId = 0 - id.valueOf()

            // 设置管理员
            this.client.invoke(
                new Api.messages.EditChatAdmin({
                    chatId: id,
                    userId: config.botId,
                    isAdmin: true
                })
            )

            let bindGroup = new BindGroup()
            bindGroup.chatId = contactOrRoom.chatId
            bindGroup.name = contactOrRoom.name
            bindGroup.type = contactOrRoom.type
            bindGroup.alias = contactOrRoom.alias
            bindGroup.wxId = contactOrRoom.wxId
            bindGroup = await this.bindGroupService.createOrUpdate(bindGroup)

            // 更新信息
            await this.updateGroup(contactOrRoom)
            // Folder organization is optional: never delay or fail a persisted binding.
            void this.addToFolder(bindGroup.chatId)
            this.createGroupQueue = this.createGroupQueue.filter(i => i.wxId !== contactOrRoom.wxId)
            // 添加绑定
            return bindGroup
        } catch (e) {
            console.error('[TelegramGroupOperateService] 创建群组失败:', e)
            this.createGroupQueue = this.createGroupQueue.filter(i => i.wxId !== contactOrRoom.wxId)
            return null
        }
    }

    async quitChat(chatId: any): Promise<void> {
        const id: any = 0 - chatId
        await this.client?.invoke(
            new Api.messages.DeleteChat({
                chatId: id
            })
        )
        await this.bindGroupService.removeByChatIdOrWxId(chatId, undefined)
    }

    async addToFolder(chatId: number): Promise<void> {
        if (!this.client) return
        try {
            const result = await TelegramChatFolderService.forClient(this.client).addChat(chatId)
            if (result.status === 'skipped' && result.reason !== 'excluded') {
                console.info(`[TelegramGroupOperateService] 文件夹整理已跳过（${result.reason}），群组和绑定仍可正常使用`)
            }
        } catch {
            // Even an unexpected organizer failure must not become an unhandled rejection.
            console.warn('[TelegramGroupOperateService] 文件夹整理未完成，群组和绑定仍可正常使用')
        }
    }
}
