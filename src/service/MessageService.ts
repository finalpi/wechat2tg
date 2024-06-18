import AbstractSqlService from './BaseSqlService'
import {MessageItem} from '../models/MessageItem'
import {BindItem} from '../models/BindItem'

export class MessageService extends AbstractSqlService {
    private static instance?: MessageService = undefined
    private constructor() {
        super()
        // 初始化表
        this.createMessageTable()
    }
    public static getInstance(): MessageService{
        if (!MessageService.instance){
            MessageService.instance = new MessageService()
        }
        return MessageService.instance
    }

    /**
     * 添加message
     * @param item
     */
    public addMessage(item: MessageItem){
        this.db.serialize(() => {
            const stmt = this.db.prepare('INSERT INTO tb_message VALUES (?, ?, ?, ?, ?, ?, ?)')
            stmt.run(item.wechat_message_id, item.chat_id, item.telegram_message_id, item.type, item.msg_text, item.send_by,item.create_time)
            stmt.finalize()
        })
    }

    /**
     * 根据telegram的messageId查询消息
     * @param id
     */
    public findMessageByTelegramMessageId(id: number): Promise<MessageItem>{
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_message WHERE telegram_message_id= ?', [id], (err, row: MessageItem) => {
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
    public findMessageByWechatMessageId(id: string): Promise<MessageItem>{
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_message WHERE wechat_message_id= ?', [id], (err, row: MessageItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }
}