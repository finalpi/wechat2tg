import {BindGroupService} from './BindGroupService'
import {BindGroup} from '../entity/BindGroup'
import {ConfigurationService} from './ConfigurationService'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {Api} from 'telegram'

export class TelegramGroupOperateService {
    private bindGroupService: BindGroupService
    private client: GramClient
    private configService: ConfigurationService = ConfigurationService.getInstance()
    constructor(bindGroupService: BindGroupService,client: GramClient) {
        this.bindGroupService = bindGroupService
        this.client = client
    }

    // 更新群组信息
    public updateGroup(contactOrRoom: BindGroup) {
        //
    }

    // 创建并绑定群组
    public async createGroup(contactOrRoom: BindGroup) {
        // 删除之前绑定过的群组
        await this.bindGroupService.removeByChatIdOrWxId(contactOrRoom.chatId,contactOrRoom.wxId)
        // 创建群组
        const config = await this.configService.getConfig()
        const result = await this.client?.invoke(
            new Api.messages.CreateChat({
                users: [config.chatId, config.botId],
                title: contactOrRoom.name,
                ttlPeriod: 0
            })
        )
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const id = result?.updates.chats[0].id
        contactOrRoom.chatId = id
        // 更新信息
        this.updateGroup(contactOrRoom)
        // 设置管理员
        // 添加绑定
        const bindGroup = await this.bindGroupService.createOrUpdate(contactOrRoom)
    }
}