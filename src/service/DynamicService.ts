import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import {Md5} from 'ts-md5'
import {ContactGender, ContactType} from 'wechaty-puppet/src/schemas/contact'

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

}

export default DynamicService