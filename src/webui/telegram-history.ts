import {Brackets, DataSource} from 'typeorm'
import {BindGroup} from '../entity/BindGroup'
import {Message} from '../entity/Message'

// Explicit conversation ownership wins over chat IDs: many official accounts
// share one forum chat. Legacy rows may use a legacy binding only without a topic.
export async function conversationMessages(source: DataSource, wxId: string, selfId?: string) {
    const binding = await source.getRepository(BindGroup).findOneBy({wxId})
    return source.getRepository(Message).createQueryBuilder('m').where(new Brackets(where => {
        where.where('m.conversationWxId = :wxId', {wxId})
        if (binding) {
            where.orWhere('(m.conversationWxId IS NULL AND m.threadId IS NULL AND m.chatId = :chatId)', {chatId: binding.chatId})
        } else if (selfId && !wxId.endsWith('@chatroom')) {
            where.orWhere(`(m.conversationWxId IS NULL AND m.threadId IS NULL
                AND ((m.wxSenderId = :selfId AND m.toWxid = :wxId) OR (m.wxSenderId = :wxId AND m.toWxid = :selfId))
                AND m.chatId NOT IN (SELECT chatId FROM bind_group WHERE type = 1 OR wxId LIKE :roomSuffix))`,
            {selfId, wxId, roomSuffix: '%@chatroom'})
        }
    }))
}

export async function originalTelegramMessage(source: DataSource, wxId: string, remoteId: string, selfId?: string) {
    return (await conversationMessages(source, wxId, selfId))
        .andWhere('m.wxMsgId = :remoteId AND m.tgBotMsgId > 0', {remoteId})
        .orderBy('m.id', 'DESC').getOne()
}

export function telegramConversationRecents(source: DataSource) {
    return source.getRepository(Message).createQueryBuilder('m')
        .leftJoin(BindGroup, 'b', 'b.chatId = m.chatId AND m.threadId IS NULL')
        .select('COALESCE(m.conversationWxId, b.wxId)', 'wxId')
        .addSelect('MAX(m.createTime)', 'timestamp')
        .where('COALESCE(m.conversationWxId, b.wxId) IS NOT NULL')
        .groupBy('COALESCE(m.conversationWxId, b.wxId)').getRawMany()
}