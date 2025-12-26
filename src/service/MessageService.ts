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
        const now = Date.now()
        const retentionTime = days * 24 * 60 * 60 * 1000 // 将天数转换为毫秒
        const beforeTimestamp = now - retentionTime
        return await this.repository.deleteOldMessages(beforeTimestamp)
    }
}