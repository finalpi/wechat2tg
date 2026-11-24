import {Check, Column, Entity, PrimaryColumn} from 'typeorm'
import {safeInteger} from './SafeInteger'

export type OfficialForumCreationStatus = 'creating' | 'provisioning' | 'ready'

@Entity('official_account_forum')
@Check('CHK_official_account_forum_singleton', '"id" = 1')
export class OfficialAccountForum {
    @PrimaryColumn({type: 'integer'})
    id = 1

    @Column({type:'bigint',nullable:true,transformer:safeInteger})
    chatId: number | null = null

    // A creating row without chatId is deliberately NOT automatically retried.
    @Column({type: 'text'})
    creationStatus: OfficialForumCreationStatus = 'creating'
}