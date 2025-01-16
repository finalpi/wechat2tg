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

    async getByWxMsgId(wxMsgId: number) {
        return await this.repository.getByWxMsgId(wxMsgId)
    }

    async getByBotMsgId(chatId: number, tgBotMsgId: number) {
        return await this.repository.getByBotMsgId(chatId, tgBotMsgId)
    }
}