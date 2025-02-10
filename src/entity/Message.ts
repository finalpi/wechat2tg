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
        default: '',
        nullable: true
    })
    wxSenderId: string

    // 回复消息需要用到发送者 Id
    @Column({
        default: '',
        nullable: true
    })
    content: string

    @Column({
        default: 0,
        nullable: true
    })
    tgBotMsgId: number

    // 消息类型 0:文本消息，1:文件消息
    @Column({
        default: 0,
        nullable: true
    })
    type: number

    // 文件传输助手的msgId
    @Column({
        default: '',
        nullable: true
    })
    fhMsgId: string

    // 原始的 text
    @Column({
        default: '',
        nullable: true
    })
    source_text: string

    // 原始的消息类型
    @Column({
        nullable: true
    })
    source_type: number

    // 发送者
    @Column({
        default: '',
        nullable: true
    })
    sender: string
}