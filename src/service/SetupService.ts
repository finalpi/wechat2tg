import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import {Api} from 'telegram'

export interface ISetupService {
    // 创建文件夹
    createFolder(): Promise<void>
    // 根据群聊或者人设置群组
    setupGroup(contact: ContactInterface | RoomInterface): Promise<void>
}