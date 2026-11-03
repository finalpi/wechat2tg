import {BindGroupRepository} from '../repository/BindGroupRepository'
import {BindGroup} from '../entity/BindGroup'
import {OfficialAccountForumService} from './OfficialAccountForumService'

export class BindGroupService {
    private bindGroupRepository = BindGroupRepository.getInstance()
    private static instance

    static getInstance(): BindGroupService {
        if (!BindGroupService.instance) {
            BindGroupService.instance = new BindGroupService()
        }
        return BindGroupService.instance
    }

    constructor() {
        //
    }

    async removeByChatIdOrWxId(chatId: number, wxId: string) {
        if (chatId && await this.isManagedForum(chatId)) {
            throw new Error('The official-account forum cannot be rebound or unbound as a single chat')
        }
        return await this.bindGroupRepository.removeByChatIdOrWxId(chatId, wxId)
    }

    async fixGroup() {
        return await this.bindGroupRepository.fixGroup()
    }

    async createOrUpdate(bindGroup: BindGroup) {
        if (bindGroup.threadId) {
            await OfficialAccountForumService.getInstance().setTopicOptions(bindGroup.chatId, bindGroup.threadId, {
                isReceive: bindGroup.isReceive, isForwardOthers: bindGroup.isForwardOthers
            })
            return bindGroup
        }
        if (await this.isManagedForum(bindGroup.chatId)) {
            throw new Error('Official-account topics must not replace legacy chat bindings')
        }
        return await this.bindGroupRepository.createOrUpdate(bindGroup)
    }

    async getByWxId(wxId: string) {
        return await this.bindGroupRepository.getByWxId(wxId)
    }

    async getAll() {
        return await this.bindGroupRepository.getAll()
    }

    async getByChatId(chatId: number) {
        return await this.bindGroupRepository.getByChatId(chatId)
    }

    async resolveWechat(wxId: string, name: string): Promise<BindGroup | undefined> {
        const legacy = await this.getByWxId(wxId)
        // These are group/synthetic destinations, not contacts requiring VerifyFlag.
        if (wxId.endsWith('@chatroom') || wxId === 'app') return legacy
        try {
            const topic = await OfficialAccountForumService.getInstance().forWechat(wxId, name, legacy ? {
                isReceive: legacy.isReceive, isForwardOthers: legacy.isForwardOthers
            } : undefined)
            return topic ? Object.assign(new BindGroup(), topic) : legacy
        } catch (error) {
            // Unknown is not personal. Preserve an explicitly existing destination while
            // metadata is unavailable, but never create a new group or guess a topic.
            if (error?.code === 'contactClassificationUnavailable' && legacy) return legacy
            throw error
        }
    }

    async resolveTelegram(chatId: number, threadId?: number): Promise<BindGroup | undefined> {
        const route = await OfficialAccountForumService.getInstance().forTelegram(chatId, threadId)
        if (route.kind === 'blocked') return undefined
        if (route.kind === 'topic') return Object.assign(new BindGroup(), route.binding)
        return await this.getByChatId(chatId)
    }

    async isManagedForum(chatId: number): Promise<boolean> {
        if (!chatId) return false
        return (await OfficialAccountForumService.getInstance().forTelegram(chatId)).kind !== 'legacy'
    }
}