import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import {Md5} from 'ts-md5'
import {ContactGender, ContactType} from 'wechaty-puppet/src/schemas/contact'
import {BindItem, ChatMapping} from '../models/BindItem'

class DynamicService {

    public static hash(source: ContactInterface | RoomInterface) {
        if (DynamicService.isContact(source)) {
            return DynamicService.hashContact(source)
        } else if (DynamicService.isRoom(source)) {
            return DynamicService.hashRoom(source)
        }
    }

    private static hashContact(source: ContactInterface): string {
        if (source.payload) {
            const noDynamicIdPayload: {
                gender: ContactGender
                type: ContactType
                name: string
                avatar: string
                address?: string
                alias?: string
                city?: string
                friend?: boolean
                province?: string
                signature?: string
                star?: boolean
                weixin?: string
                handle?: string
                phone: string[]
                corporation?: string
                title?: string
                description?: string
                coworker?: boolean
            } = source.payload
            return Md5.hashStr(JSON.stringify(noDynamicIdPayload))
        }
        return ''
    }

    private static hashRoom(source: RoomInterface): string {
        if (source.payload) {
            const noDynamicIdPayload: {
                topic: string
                avatar?: string
                handle?: string
                external?: boolean
            } = source.payload
            return Md5.hashStr(JSON.stringify(noDynamicIdPayload))

        }
        return ''
    }

    public static isContact(contact: ContactInterface | RoomInterface): contact is ContactInterface {
        return (contact as ContactInterface).id !== undefined
    }

    public static isRoom(contact: ContactInterface | RoomInterface): contact is RoomInterface {
        return (contact as RoomInterface).id !== undefined
    }

    public static isSameContact(contact: ContactInterface, bindItem: ChatMapping): boolean {
        // 我的联系人信息 统计有的字段数量
        // avatar,302
        // name,302
        // id,302
        // gender,300
        // province,247
        // signature,237
        // city,230
        // alias,91
        // weixin,0
        // address,0

        // 同时满足以下条件时，认为是同一个联系人
        // id相同
        // 没有id相同时候，个人账号去除动态id后的信息 hash 相同
        // 没有 hash 相同时候
        // 头像 (id?) 相同
        // 没有头像相同时候，name 相同并且 province gender signature city alias 至少两个相同
        // 以上条件都不满足时，认为不是同一个联系人
        return true
    }

}

export default DynamicService