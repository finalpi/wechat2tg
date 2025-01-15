import {Entity, Column, PrimaryGeneratedColumn} from 'typeorm'

@Entity()
export class BindGroup {
    @PrimaryGeneratedColumn()
    id: number

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