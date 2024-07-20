import AbstractSqlService from './BaseSqlService.js'
import {MessageItem, MessageItemUpdate} from '../models/MessageItem.js'

export class MessageService extends AbstractSqlService {
    private static instance?: MessageService = undefined

    private constructor() {
        super()
        // 初始化表
        this.createMessageTable()
    }

    public static getInstance(): MessageService {
        if (!MessageService.instance) {
            MessageService.instance = new MessageService()
        }
        return MessageService.instance
    }

    /**
     * 添加message
     * @param item
     */
    public addMessage(item: MessageItemUpdate) {
        this.db.serialize(() => {
            const stmt = this.db.prepare('INSERT INTO tb_message VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            stmt.run(item.wechat_message_id, item.chat_id, item.telegram_message_id, item.type, item.msg_text, item.send_by, item.create_time, item.telegram_user_message_id, item.sender_id, (err: Error | null) => {
                if (err) {
                    this._log.error('addMessage', err)
                }
            })
            stmt.finalize()
        })
    }

    public updateMessageByChatMsg(query: {chat_id: string, msg_text: string}, update: MessageItemUpdate) {
        const logger = this._log
        this.db.serialize(() => {
            // 构建 SET 子句
            const setClauses: string[] = []
            const params: any[] = []
            for (const [key, value] of Object.entries(update)) {
                if (value !== null && value !== undefined) {
                    setClauses.push(`${key} = ?`)
                    params.push(value)
                }
            }

            // 如果没有需要更新的字段，直接返回
            if (setClauses.length === 0) {
                return
            }

            const sql = `UPDATE tb_message
                     SET ${setClauses.join(', ')}
                     WHERE chat_id = ? AND msg_text = ? AND telegram_user_message_id = (
                         SELECT MAX(telegram_user_message_id)
                         FROM tb_message
                         WHERE chat_id = ? AND msg_text = ?
                     )`

            // 添加 WHERE 子句的参数
            params.push(query.chat_id, query.msg_text, query.chat_id, query.msg_text)

            this.db.run(sql, params, function (err) {
                if (err) {
                    logger.error('updateMessageByUserInfo', err)
                }
            })
        })
    }

    public updateMessageByWechatMsgIdOrChatItem(updateBy: {
        chat_id?: number,
        telegram_message_id?: number,
        wechat_msg_id?: string,
    }, itemUpdate: MessageItemUpdate) {
        const logger = this._log
        this.db.serialize(() => {
            const where = updateBy.wechat_msg_id ? 'wechat_message_id = ?' : 'chat_id = ? AND telegram_message_id = ?'
            const sql = `UPDATE tb_message
                         SET wechat_message_id   = COALESCE(?, wechat_message_id),
                             chat_id             = COALESCE(?, chat_id),
                             telegram_message_id = COALESCE(?, telegram_message_id),
                             type                = COALESCE(?, type),
                             msg_text            = COALESCE(?, msg_text),
                             send_by             = COALESCE(?, send_by),
                             create_time         = COALESCE(?, create_time)
                         WHERE ${where}`

            const params = [
                itemUpdate.wechat_message_id,
                itemUpdate.chat_id,
                itemUpdate.telegram_message_id,
                itemUpdate.type,
                itemUpdate.msg_text,
                itemUpdate.send_by,
                itemUpdate.create_time,
                ...('wechat_msg_id' in updateBy ? [updateBy.wechat_msg_id] : [updateBy.chat_id, updateBy.telegram_message_id])
            ]

            this.db.run(sql, params, function (err) {
                if (err) {
                    logger.error('updateMessageByWechatMsgIdOrChatItem', err)
                    return
                }
            })
        })
    }

    public updateMessageUserIdByChatIdTextAndRandomRanger(chatId: number | undefined, text: string, tg_user_msg_id: number) {
        const logger = this._log
        this.logInfo('updateMessageUserIdByChatIdTextAndRandomRanger chatId:', chatId, 'text:', text, 'tg_user_msg_id:', tg_user_msg_id)
        if (!chatId) {
            this.logWarn('updateMessageUserIdByChatIdTextAndRandomRanger chatId is null plz check')
            return
        }
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this
        this.db.get('SELECT * FROM tb_message WHERE chat_id = ? AND telegram_user_message_id is not null limit 1',
            [chatId],
            (err, row: MessageItem) => {
                if (err) {
                    logger.error('updateMessageUserIdByChatIdTextAndRandomRanger err: ', err.message)
                    return
                }
                // 这里假定下范围
                if (row && row.telegram_user_message_id) {
                    const subRanger = row.telegram_user_message_id - row.telegram_message_id + 120

                    this.db.run('UPDATE tb_message set telegram_user_message_id = ? WHERE chat_id = ? AND msg_text = ? AND telegram_message_id >= ? AND telegram_message_id <= ?',
                        [tg_user_msg_id, chatId, text, row.telegram_message_id - subRanger, row.telegram_message_id + subRanger], function (err) {
                            if (err) {
                                logger.error('updateMessageUserIdByChatIdTextAndRandomRanger err: ', err)
                                return
                            }
                            if (!this.changes) {
                                that.db.run('UPDATE tb_message set telegram_user_message_id = ? WHERE telegram_message_id = (SELECT MAX (telegram_message_id) FROM tb_message WHERE chat_id = ? AND msg_text = ?)',
                                    [tg_user_msg_id, chatId, text], (err) => {
                                        if (err) {
                                            logger.error('updateMessageUserIdByChatIdTextAndRandomRanger err:', err)
                                        }
                                    })
                            }
                        })
                } else {
                    this.db.run('UPDATE tb_message set telegram_user_message_id = ? WHERE telegram_message_id = (SELECT MAX (telegram_message_id) FROM tb_message WHERE chat_id = ? AND msg_text = ?)',
                        [tg_user_msg_id, chatId, text], (err) => {
                            if (err) {
                                logger.error('updateMessageUserIdByChatIdTextAndRandomRanger err:', err)
                            }
                        })
                }
            })
    }

    /**
     * 根据telegram的messageId查询消息
     * @param tg_msg_id bot message id
     * @param chat_id chat id
     */
    public findMessageByTelegramMessageId(tg_msg_id: number, chat_id: number): Promise<MessageItem> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_message WHERE telegram_message_id= ? and chat_id = ? limit 1', [tg_msg_id, chat_id], (err, row: MessageItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }

    /**
     * 根据wechat的messageId查询消息
     * @param id
     */
    public findMessageByWechatMessageId(id: string): Promise<MessageItem> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_message WHERE wechat_message_id= ? limit 1', [id], (err, row: MessageItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }
}