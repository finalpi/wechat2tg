import {Column, Entity, Index, PrimaryColumn} from 'typeorm'

@Entity('official_account_topic')
@Index('IDX_official_account_topic_destination', ['chatId', 'threadId'], {unique: true})
export class OfficialAccountTopic {
    @PrimaryColumn({type: 'text'})
    wxId: string

    @Column({type: 'integer'})
    chatId: number

    @Column({type: 'integer', nullable: true})
    threadId: number | null = null

    @Column({type: 'text'})
    name: string

    @Column({type: 'text'})
    status: 'creating' | 'ready' = 'creating'

    // Decimal signed int64, persisted BEFORE invoking CreateForumTopic.
    @Column({type: 'text'})
    randomId: string

    @Column({type: 'boolean', default: true})
    isReceive = true

    @Column({type: 'boolean', default: false})
    isForwardOthers = false
}