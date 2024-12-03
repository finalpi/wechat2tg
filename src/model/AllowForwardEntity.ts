import {YesOrNo} from '../enums/BaseEnum'

export interface AllowForward {
    id?: number,
    chat_id: number,
    all_allow: YesOrNo,
}

export interface AllowForwardEntities {
    allow_forward_id: number,
    entity_id: number,
}