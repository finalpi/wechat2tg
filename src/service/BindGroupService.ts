import {BindGroupRepository} from '../repository/BindGroupRepository'
import {BindGroup} from '../entity/BindGroup'

export class BindGroupService {
    private bindGroupRepository = BindGroupRepository.getInstance()
    private static instance
    static getInstance(): BindGroupService {
        if (!BindGroupService.instance) {
            BindGroupService.instance = new BindGroupService()
        }
        return BindGroupService.instance
    }
    constructor() {
        //
    }

    async removeByChatIdOrWxId(chatId: number,wxId: string) {
        return await this.bindGroupRepository.removeByChatIdOrWxId(chatId,wxId)
    }

    async createOrUpdate(bindGroup: BindGroup) {
        return await this.bindGroupRepository.createOrUpdate(bindGroup)
    }
}