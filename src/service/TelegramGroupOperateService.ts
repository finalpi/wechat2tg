import {BindGroupService} from './BindGroupService'
import {BindGroup} from '../entity/BindGroup'
import {ConfigurationService} from './ConfigurationService'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {Api} from 'telegram'
import {CustomFile} from 'telegram/client/uploads'
import axios from 'axios'
import {returnBigInt} from 'telegram/Helpers'
import sharp from 'sharp'

export class TelegramGroupOperateService {
    private bindGroupService: BindGroupService
    private client: GramClient
    private configService: ConfigurationService = ConfigurationService.getInstance()
    constructor(bindGroupService: BindGroupService,client: GramClient) {
        this.bindGroupService = bindGroupService
        this.client = client
    }

    // 更新群组信息
    public async updateGroup(contactOrRoom: BindGroup) {
        // 更新头像
        const response = await axios.get(contactOrRoom.avatarLink, { responseType: 'arraybuffer' })
        const buff = Buffer.from(response.data)
        sharp(buff).toFormat('png').resize(200).toBuffer(async (err,buff)=>{
            const toUpload = new CustomFile('avatar.png', buff.length, '', buff)
            const file = await this.client?.uploadFile({
                file: toUpload,
                workers: 3,
            })
            this.client?.invoke(new Api.messages.EditChatPhoto(
                {
                    chatId: returnBigInt(contactOrRoom.chatId),
                    photo: new Api.InputChatUploadedPhoto(
                        {
                            file: file,
                        }
                    )
                }
            ))
        })
        // 更新群组名
    }

    // 创建并绑定群组
    public async createGroup(contactOrRoom: BindGroup): Promise<BindGroup> {
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
        contactOrRoom.chatId = id.valueOf()
        // 设置管理员
        this.client?.invoke(
            new Api.messages.EditChatAdmin({
                chatId: id,
                userId: config.botId,
                isAdmin: true
            })
        )
        // 更新信息
        this.updateGroup(contactOrRoom)
        // 添加绑定
        const bindGroup = await this.bindGroupService.createOrUpdate(contactOrRoom)
        return bindGroup
    }
}