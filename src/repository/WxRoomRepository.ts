import {getGeWeChatDataSource} from '../data-sourse'
import {Repository} from 'typeorm'
import {directoryContains} from './DirectorySearch'
import { WxRoom } from '../entity/WxRoom'

export class WxRoomRepository {
    private WxRoomRepository: Repository<WxRoom>
    private static instance: WxRoomRepository

    private constructor() {
        // GeWeChatDataSource.initialize().then(() => {
            this.WxRoomRepository = getGeWeChatDataSource().getRepository(WxRoom)
        // })
    }

    static getInstance(): WxRoomRepository {
        if (!WxRoomRepository.instance) {
            WxRoomRepository.instance = new WxRoomRepository()
        }
        return WxRoomRepository.instance
    }

    async getByNickNameOrRemark(query: string) {
        return this.WxRoomRepository.find({
            where: [
                { nickName: directoryContains(query) },
                { remark: directoryContains(query) },
                { chatroomId: directoryContains(query) }
            ]
        })
    }

    async getAll(): Promise<WxRoom[]> {
        return this.WxRoomRepository.find()
    }


}