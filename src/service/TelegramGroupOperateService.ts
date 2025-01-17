import {BindGroupService} from './BindGroupService'
import {BindGroup} from '../entity/BindGroup'
import {ConfigurationService} from './ConfigurationService'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {Api} from 'telegram'
import {CustomFile} from 'telegram/client/uploads'
import axios from 'axios'
import {returnBigInt} from 'telegram/Helpers'
import sharp from 'sharp'
import {FormatUtils} from '../util/FormatUtils'
import {config} from '../config'
import {FileUtils} from '../util/FileUtils'

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
        const oldBindGroup = await this.bindGroupService.getByChatId(contactOrRoom.chatId)
        if (!oldBindGroup) {
            return
        }
        oldBindGroup.alias = contactOrRoom.alias
        // 更新头像
        if (contactOrRoom.avatarLink !== oldBindGroup.avatarLink) {
            oldBindGroup.avatarLink = contactOrRoom.avatarLink
            const buff = await FileUtils.getInstance().downloadUrl2Buffer(contactOrRoom.avatarLink)
            sharp(buff).toFormat('png').resize(200).toBuffer(async (err,buff)=>{
                const toUpload = new CustomFile('avatar.png', buff.length, '', buff)
                const file = await this.client?.uploadFile({
                    file: toUpload,
                    workers: 3,
                })
                this.client?.invoke(new Api.messages.EditChatPhoto(
                    {
                        chatId: returnBigInt(0 - contactOrRoom.chatId),
                        photo: new Api.InputChatUploadedPhoto(
                            {
                                file: file,
                            }
                        )
                    }
                ))
            })
        }
        // 更新群组名
        let name
        if (contactOrRoom.type === 0) {
            name = FormatUtils.transformTitleStr(config.CREATE_CONTACT_NAME, contactOrRoom.alias, contactOrRoom.name, '')
        } else {
            name = FormatUtils.transformTitleStr(config.CREATE_ROOM_NAME, '', '', contactOrRoom.name)
        }
        if (name !== oldBindGroup.name) {
            oldBindGroup.name = name
            this.client?.invoke(
                new Api.messages.EditChatTitle({
                    chatId: returnBigInt(0 - contactOrRoom.chatId),
                    title: name,
                })
            )
        }
        this.bindGroupService.createOrUpdate(oldBindGroup)
    }

    // 创建并绑定群组
    public async createGroup(contactOrRoom: BindGroup): Promise<BindGroup> {
        // 删除之前绑定过的群组
        await this.bindGroupService.removeByChatIdOrWxId(contactOrRoom.chatId,contactOrRoom.wxId)
        const oldGourp = await this.bindGroupService.getByWxId(contactOrRoom.wxId)
        if (oldGourp) {
            contactOrRoom.chatId = oldGourp.chatId
            this.updateGroup(contactOrRoom)
            return oldGourp
        }
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
        contactOrRoom.chatId = 0 - id.valueOf()
        // 设置管理员
        this.client?.invoke(
            new Api.messages.EditChatAdmin({
                chatId: id,
                userId: config.botId,
                isAdmin: true
            })
        )
        let bindGroup = new BindGroup()
        bindGroup.chatId = contactOrRoom.chatId
        bindGroup.name = contactOrRoom.name
        bindGroup.type = contactOrRoom.type
        bindGroup.alias = contactOrRoom.alias
        bindGroup.wxId = contactOrRoom.wxId
        bindGroup = await this.bindGroupService.createOrUpdate(contactOrRoom)

        // 更新信息
        this.updateGroup(contactOrRoom)
        // 添加绑定
        return bindGroup
    }
}