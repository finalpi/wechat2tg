import {log} from 'wechaty'
import {ISetupService} from '../SetupService'
import {TelegramClient} from '../../client/TelegramClient'
import {Api} from 'telegram'
import {TelegramBotClient} from '../../client/TelegramBotClient'
import bigInt from 'big-integer'
import int = Api.int
import AbstractSqlService from '../BaseSqlService'
import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import DynamicService from '../DynamicService'
import {TelegramUserClient} from '../../client/TelegramUserClient'

export class SetupServiceImpl extends AbstractSqlService implements ISetupService {
    private readonly tgClient: TelegramUserClient = TelegramUserClient.getInstance()
    private readonly tgBotClient: TelegramBotClient = TelegramBotClient.getInstance()

    private readonly DEFAULT_FILTER_ID: int = 114

    constructor() {
        super()
        // 初始化表
        this.createAutoBindTable()
        this.tgClient.client?.connect()
    }


    async createFolder(): Promise<void> {
        const result = await this.tgClient.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const filter = result.filters.find(it => it.id && it.id === this.DEFAULT_FILTER_ID)
        if (!filter) {
            log.info('创建 TG 文件夹')
            const dialogFilter = new Api.DialogFilter({
                id: this.DEFAULT_FILTER_ID,
                title: 'WX',
                pinnedPeers: [new Api.InputPeerChat({chatId: bigInt(this.tgBotClient.chatId.toString())})],
                includePeers: [new Api.InputPeerChat({chatId: bigInt(this.tgBotClient.chatId.toString())})],
                excludePeers: [],
                emoticon: '💬',
            })
            this.tgClient.client?.invoke(new Api.messages.UpdateDialogFilter({
                id: this.DEFAULT_FILTER_ID,
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
        // this.tgClient.client.invoke(new Api.)

    }
}