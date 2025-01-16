import {Entity, Column, PrimaryGeneratedColumn} from 'typeorm'

@Entity()
export class Message {
    @PrimaryGeneratedColumn()
    id: number

    @Column({
        default: 0
    })
    chatId: number

    @Column({
        default: 0
    })
    wxMsgId: string

    // 回复消息需要用到发送者 Id
    @Column({
        default: ''
    })
    wxSenderId: string

    // 回复消息需要用到发送者 Id
    @Column({
        default: ''
    })
    content: string

    @Column({
        default: 0
    })
    tgBotMsgId: number

    // 消息类型 0:文本消息，1:文件消息
    @Column({
        default: 0
    })
    type: number
}