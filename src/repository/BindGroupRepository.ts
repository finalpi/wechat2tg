import {AppDataSource} from '../data-sourse'
import {Repository} from 'typeorm/repository/Repository'
import {BindGroup} from '../entity/BindGroup'

export class BindGroupRepository {
    private bindGroupRepository: Repository<BindGroup>
    private static instance
    static getInstance(): BindGroupRepository {
        if (!BindGroupRepository.instance) {
            BindGroupRepository.instance = new BindGroupRepository()
        }
        return BindGroupRepository.instance
    }
    constructor() {
        this.bindGroupRepository = AppDataSource.getRepository(BindGroup)
    }

    async removeByChatIdOrWxId(chatId: number,wxId: string) {
        // 构建查询条件
        const queryBuilder = this.bindGroupRepository.createQueryBuilder().delete()
        queryBuilder.where('chatId = :chatId OR wxId = :wxId', { chatId, wxId })
        return await queryBuilder.execute()
    }

    async createOrUpdate(bindGroup: BindGroup) {
        return await this.bindGroupRepository.save(bindGroup)
    }

    async getByWxId(wxId: string) {
        return await this.bindGroupRepository.findOneBy({
            wxId: wxId
        })
    }
}