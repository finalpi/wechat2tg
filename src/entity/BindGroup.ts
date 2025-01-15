import {Entity, Column, PrimaryGeneratedColumn} from 'typeorm'

@Entity()
export class BindGroup {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    chatId: number

    @Column()
    name: string

    @Column()
    alias: string

    @Column()
    wxId: string

    @Column()
    avatarLink: string
}