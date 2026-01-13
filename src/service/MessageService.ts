import {MessageRepository} from '../repository/MessageRepository'
import {Message} from '../entity/Message'

export class MessageService {
    private repository = MessageRepository.getInstance()
    private static instance

    static getInstance(): MessageService {
        if (!MessageService.instance) {
            MessageService.instance = new MessageService()
        }
        return MessageService.instance
    }

    constructor() {
        //
    }

    async createOrUpdate(message: Message) {
        return await this.repository.createOrUpdate(message)
    }

    async getByWxMsgId(wxMsgId: string) {
        return await this.repository.getByWxMsgId(wxMsgId)
    }

    async getByBotMsgId(chatId: number, tgBotMsgId: number) {
        return await this.repository.getByBotMsgId(chatId, tgBotMsgId)
    }

    async getByFhMsgId(fhMsgId: string) {
        return await this.repository.getByFhMsgId(fhMsgId)
    }

    // 删除指定天数之前的旧消息
    async deleteOldMessages(days: number): Promise<number> {
        // 注意：微信的 createTime 是秒级时间戳，不是毫秒级
        const nowInSeconds = Math.floor(Date.now() / 1000)
        const retentionTimeInSeconds = days * 24 * 60 * 60 // 天数转换为秒
        const beforeTimestamp = nowInSeconds - retentionTimeInSeconds
        return await this.repository.deleteOldMessages(beforeTimestamp)
    }
}