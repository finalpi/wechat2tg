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
    private readonly folderName = 'WeChat'
    // 创建群组队列，保证不重复
    private createGroupQueue: BindGroup[] = []
    constructor(bindGroupService: BindGroupService,client: GramClient) {
        this.bindGroupService = bindGroupService
        this.client = client
    }

    // 更新群组信息
    public async updateGroup(contactOrRoom: BindGroup) {
        try {
            const oldBindGroup = await this.bindGroupService.getByChatId(contactOrRoom.chatId)
            if (!oldBindGroup) {
                return
            }
            const entity = await this.client.getEntity(returnBigInt(contactOrRoom.chatId))
            if (!entity) {
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
                    // 超级群
                    if (entity.className === 'Channel' && entity.megagroup) {
                        await this.client?.invoke(new Api.channels.EditPhoto(
                            {
                                channel: entity,
                                photo: new Api.InputChatUploadedPhoto(
                                    {
                                        file: file,
                                    }
                                )
                            }
                        ))
                    }else {
                        // 普通群
                        await this.client?.invoke(new Api.messages.EditChatPhoto(
                            {
                                chatId: entity.id,
                                photo: new Api.InputChatUploadedPhoto(
                                    {
                                        file: file,
                                    }
                                )
                            }
                        ))
                    }
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
                // 超级群
                if (entity.className === 'Channel' && entity.megagroup) {
                    if (entity.title !== name) {
                        await this.client?.invoke(
                            new Api.channels.EditTitle({
                                channel: entity,
                                title: name,
                            })
                        )
                    }
                } else if (entity.className === 'Chat' ){
                    if (entity.title !== name) {
                        await this.client?.invoke(
                            new Api.messages.EditChatTitle({
                                chatId: entity.id,
                                title: name,
                            })
                        )
                    }
                }
            }
            this.bindGroupService.createOrUpdate(oldBindGroup)
        }catch (e) {
            console.log(e)
        }
    }

    // 创建并绑定群组
    public async createGroup(contactOrRoom: BindGroup): Promise<BindGroup> {
        const item = this.createGroupQueue.find(value => contactOrRoom.chatId === value.chatId)
        if (item) {
            return item
        }
        this.createGroupQueue.push(contactOrRoom)
        const oldGourp = await this.bindGroupService.getByWxId(contactOrRoom.wxId)
        if (oldGourp) {
            contactOrRoom.chatId = oldGourp.chatId
            this.updateGroup(contactOrRoom)
            return oldGourp
        }else {
            // 删除之前绑定过的群组
            await this.bindGroupService.removeByChatIdOrWxId(contactOrRoom.chatId,contactOrRoom.wxId)
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
        bindGroup = await this.bindGroupService.createOrUpdate(bindGroup)

        // 更新信息
        await this.updateGroup(contactOrRoom)
        // 添加到文件夹
        this.addToFolder(bindGroup.chatId)
        this.createGroupQueue = this.createGroupQueue.filter(i=> i.chatId !== contactOrRoom.chatId)
        // 添加绑定
        return bindGroup
    }

    async addToFolder(chatId: number): Promise<void> {
        const result = await this.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const dialogFilter: Api.TypeDialogFilter = result?.filters.find(it => it.title === this.folderName)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // TODO: #42 Cannot read properties of undefined (reading 'id')
        const id = dialogFilter?.id
        const entity = await this.client?.getInputEntity(chatId)
        if (entity && dialogFilter) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const exist = dialogFilter.includePeers.find(it => it.chatId === entity.chatId)
            if (!exist) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                dialogFilter.includePeers.push(entity)
                await this.client?.invoke(new Api.messages.UpdateDialogFilter({
                    id: id,
                    filter: dialogFilter,
                })).catch(e => {
                    // this.tgBotClient.bot.telegram.sendMessage(this.tgBotClient.chatId, this.i18n.t('common.addGroupToFolderFail'))
                })
            }
        }
    }
}