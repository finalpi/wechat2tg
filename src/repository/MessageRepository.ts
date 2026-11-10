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
        // Older retries can leave a zero-receipt row before the successful one.
        // Prefer a confirmed Telegram receipt rather than treating it as unsent.
        return await this.repository.findOne({
            where: {wxMsgId},
            order: {tgBotMsgId: 'DESC', id: 'DESC'}
        })
    }

    async getByBotMsgId(chatId: number,tgBotMsgId: number, threadId?: number) {
        return await this.repository.findOneBy({
            chatId: chatId,
            tgBotMsgId: tgBotMsgId,
            ...(threadId === undefined ? {} : {threadId})
        })
    }

    async getByFhMsgId(getByFhMsgId: string) {
        return await this.repository.findOneBy({
            fhMsgId: getByFhMsgId
        })
    }

    async listRecentByChatId(chatId: number, limit = 20, threadId?: number) {
        return await this.repository.find({
            where: {
                chatId: chatId,
                ...(threadId === undefined ? {} : {threadId})
            },
            order: {
                id: 'DESC'
            },
            take: limit
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