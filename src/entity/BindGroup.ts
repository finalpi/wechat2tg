import {Entity, Column, PrimaryGeneratedColumn} from 'typeorm'

@Entity()
export class BindGroup {
    @PrimaryGeneratedColumn()
    id: number

    // MTProto 协议的 chatId，bot 协议需要取相反数
    @Column()
    chatId: number

    @Column()
    name: string

    @Column({nullable: true})
    alias: string

    @Column()
    wxId: string

    @Column()
    avatarLink: string

    // 类型：0-contact，1-room
    @Column()
    type: number
}