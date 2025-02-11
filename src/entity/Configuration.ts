import {Entity, Column, PrimaryColumn} from 'typeorm'

@Entity()
export class Configuration {
    @PrimaryColumn()
    id: number

    @Column({
        default: 0
    })
    chatId: number

    @Column({
        default: 0
    })
    botId: number

    // 媒体是否压缩
    @Column({
        default: true
    })
    compression: boolean

    // 是否使用文件传输助手接收文件
    @Column({
        default: true
    })
    useFileHelper: boolean

    // 是否接收公众号消息
    @Column({
        default: true
    })
    receivePublicAccount: boolean
}