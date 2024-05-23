import {log} from 'wechaty'
import {ISetupService} from '../SetupService'
import {Api} from 'telegram'
import {TelegramBotClient} from '../../client/TelegramBotClient'
import AbstractSqlService from '../BaseSqlService'
import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import DynamicService from '../DynamicService'
import {TelegramUserClient} from '../../client/TelegramUserClient'
import {TelegramClient} from '../../client/TelegramClient'
import DialogFilter = Api.DialogFilter
import int = Api.int

export class SetupServiceImpl extends AbstractSqlService implements ISetupService {
    private readonly userClient: TelegramUserClient = TelegramUserClient.getInstance()
    private readonly tgClient: TelegramClient = TelegramClient.getInstance()
    private readonly tgBotClient: TelegramBotClient = TelegramBotClient.getInstance()

    private readonly DEFAULT_FILTER_ID = 5100689

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
        const filter = result.filters.find(it => it.className === 'DialogFilter' && it.id === this.DEFAULT_FILTER_ID)
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const values = result.filters.map(it => {return it.className === 'DialogFilter' ? it.id : 0})
        const id = Math.max(...values) + 1 || this.DEFAULT_FILTER_ID
        console.log('filter id', id)
        if (!filter) {
            log.info('创建 TG 文件夹')
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const me: Api.InputPeerUser = await this.tgClient?.client?.getMe()
            const dialogFilter = new Api.DialogFilter({
                id: id,
                title: 'Wx2Tg',
                pinnedPeers: [me],
                includePeers: [],
                excludePeers: [],
            })
            await this.userClient.client?.invoke(new Api.messages.UpdateDialogFilter({
                id: id,
                filter: dialogFilter,
            })).catch(e => {
                log.error('创建 TG 文件夹失败', e)
                this.tgBotClient.sendMessage({
                    chatId: this.tgBotClient.chatId,
                    body: '创建 TG 文件夹失败',
                })
            })
        }
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore TODO: WIP
    setupGroup(contact: ContactInterface | RoomInterface): Promise<void> {
        const contactHash = DynamicService.hash(contact)
        // 创建群组
        // this.userClient.client.invoke(new Api.)

    }
}