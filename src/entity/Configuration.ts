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
}