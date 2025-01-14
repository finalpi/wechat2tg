import {Entity, Column, PrimaryGeneratedColumn} from 'typeorm'

@Entity()
export class Configuration {
    @PrimaryGeneratedColumn()
    id: number

    @Column({
        default: 0
    })
    chatId: number
}