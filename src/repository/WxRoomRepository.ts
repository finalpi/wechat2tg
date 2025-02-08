import { GeWeChatDataSource } from '../data-sourse'
import {Like, Repository, SelectQueryBuilder} from 'typeorm'
import { WxRoom } from '../entity/WxRoom'
import {Page} from '../entity/Page'

export class WxRoomRepository {
    private WxRoomRepository: Repository<WxRoom>
    private static instance: WxRoomRepository

    private constructor() {
        // GeWeChatDataSource.initialize().then(() => {
            this.WxRoomRepository = GeWeChatDataSource.getRepository(WxRoom)
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
                { nickName: Like(`%${query}%`) },
                { remark: Like(`%${query}%`) }
            ]
        })
    }

    async getAll(): Promise<WxRoom[]> {
        return this.WxRoomRepository.find()
    }


}