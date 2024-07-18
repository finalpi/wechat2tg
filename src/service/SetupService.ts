import {Contact, Room} from 'wechaty'


export interface ISetupService {
    // 创建文件夹
    createFolder(): Promise<void>
    // 根据群聊或者人设置群组
    setupGroup(contact: Contact | Room): Promise<void>
}