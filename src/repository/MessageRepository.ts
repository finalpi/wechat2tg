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

    // 删除指定时间之前的旧消息
    async deleteOldMessages(beforeTimestamp: number) {
        const result = await this.repository
            .createQueryBuilder()
            .delete()
            .where('createTime < :timestamp', { timestamp: beforeTimestamp })
            .andWhere('createTime IS NOT NULL')
            .execute()
        return result.affected || 0
    }
}