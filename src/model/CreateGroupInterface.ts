import {ContactInterface, RoomInterface} from 'wechaty/impls'

export interface CreateGroupInterface {
    // type:0-个人,1-群组
    type: number | 0 | 1
    // 实例对象
    contact?: ContactInterface
    room?: RoomInterface
    bindId?: string
}