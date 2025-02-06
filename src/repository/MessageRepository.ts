import {AppDataSource} from '../data-sourse'
import {Repository} from 'typeorm/repository/Repository'
import {Message} from '../entity/Message'

export class MessageRepository {
    private repository: Repository<Message>
    private static instance
    static getInstance(): MessageRepository {
        if (!MessageRepository.instance) {
            MessageRepository.instance = new MessageRepository()
        }
        return MessageRepository.instance
    }
    constructor() {
        this.repository = AppDataSource.getRepository(Message)
    }

    async createOrUpdate(message: Message) {
        return await this.repository.save(message)
    }

    async getByWxMsgId(wxMsgId: string) {
        return await this.repository.findOneBy({
            wxMsgId: wxMsgId
        })
    }

    async getByBotMsgId(chatId: number,tgBotMsgId: number) {
        return await this.repository.findOneBy({
            chatId: chatId,
            tgBotMsgId: tgBotMsgId
        })
    }

    async getByFhMsgId(getByFhMsgId: string) {
        return await this.repository.findOneBy({
            fhMsgId: getByFhMsgId
        })
    }
}