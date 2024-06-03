import {log} from 'wechaty'
import {ISetupService} from '../SetupService'
import {Api} from 'telegram'
import {TelegramBotClient} from '../../client/TelegramBotClient'
import AbstractSqlService from '../BaseSqlService'
import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import DynamicService from '../DynamicService'
import {TelegramUserClient} from '../../client/TelegramUserClient'
import {TelegramClient} from '../../client/TelegramClient'

export class SetupServiceImpl extends AbstractSqlService implements ISetupService {
    private readonly userClient: TelegramUserClient = TelegramUserClient.getInstance()
    private readonly tgClient: TelegramClient = TelegramClient.getInstance()
    private readonly tgBotClient: TelegramBotClient = TelegramBotClient.getInstance()
    private readonly folderName = 'WeChat'

    private readonly DEFAULT_FILTER_ID = 115

    constructor() {
        super()
        // 初始化表
        this.createAutoBindTable()
        this.userClient.client?.connect()
    }


    async createFolder(): Promise<void> {
        const result = await this.userClient.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const values = result.filters.map(it => {return it.className === 'DialogFilter' ? it.id : 0})
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const value = result?.filters.find(it => it.title === this.folderName)
        let id
        if (value){
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            id = value.id
        }else {
            id = Math.max(...values) + 1 || this.DEFAULT_FILTER_ID
        }
        if (!id) {
            id = 100
        }
        console.log('filter id', id)
        if (!value) {
            log.info('创建 TG 文件夹')
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const me = await this.tgBotClient.bot.telegram.getMe()
            const botEntity = await this.userClient.client?.getInputEntity(me.id)
            if (botEntity){
                const dialogFilter = new Api.DialogFilter({
                    id: id,
                    title: this.folderName,
                    pinnedPeers: [botEntity],
                    includePeers: [],
                    excludePeers: [],
                })
                await this.userClient.client?.invoke(new Api.messages.UpdateDialogFilter({
                    id: id,
                    filter: dialogFilter,
                })).catch(e => {
                    if (e.errorMessage.includes('DIALOG_FILTERS_TOO_MUCH')){
                        // 已经到达文件夹创建的上限,不再创建新的文件夹
                        return
                    }
                    log.error('创建 TG 文件夹失败', e)
                    this.tgBotClient.sendMessage({
                        chatId: this.tgBotClient.chatId,
                        body: '创建 TG 文件夹失败',
                    })
                })
            }
        }
    }

    async addToFolder(chatId: number): Promise<void> {
        const result = await this.userClient.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const dialogFilter: Api.TypeDialogFilter = result?.filters.find(it => it.title === this.folderName)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const id = dialogFilter.id
        const entity = await this.userClient.client?.getInputEntity(chatId)
        if (entity && dialogFilter){
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const exist = dialogFilter.includePeers.find(it=>it.chatId === entity.chatId)
            if (!exist){
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                dialogFilter.includePeers.push(entity)
                await this.userClient.client?.invoke(new Api.messages.UpdateDialogFilter({
                    id: id,
                    filter: dialogFilter,
                })).catch(e => {
                    this.tgBotClient.sendMessage({
                        chatId: this.tgBotClient.chatId,
                        body: '添加群组进文件夹失败',
                    })
                })
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TODO: WIP
    setupGroup(contact: ContactInterface | RoomInterface): Promise<void> {
        const contactHash = DynamicService.hash(contact)
        // 创建群组
        // this.userClient.client.invoke(new Api.)

    }

    private idConvert(chatId: number){
        return 0 - chatId
    }
}