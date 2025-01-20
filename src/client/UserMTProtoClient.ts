import os from 'node:os'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {StoreSession} from 'telegram/sessions'
import * as authMethods from 'telegram/client/auth'
import {config} from '../config'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'
import {Api} from 'telegram'
import {ConfigurationService} from '../service/ConfigurationService'

export class UserMTProtoClient extends AbstractClient {
    private readonly DEFAULT_FILTER_ID = 115
    private readonly folderName = 'WeChat'

    async login(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams): Promise<boolean> {
        if (!UserMTProtoClient.getSpyClient('userMTPClient')) {
            const clientFactory = new ClientFactory()
            UserMTProtoClient.addSpyClient({
                interfaceId: 'userMTPClient',
                client: clientFactory.create('userMTPClient')
            })
        }
        if (!await this.client?.checkAuthorization()) {
            this.client?.start(authParams).then(res => {
                // 登录成功逻辑
                this.hasLogin = true
                this.createFolder()
            }).catch((e) => {
                //
            })
        }
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    onMessage(): Promise<BaseMessage> {
        throw new Error('Method not implemented.')
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance = undefined

    static getInstance(): UserMTProtoClient {
        if (!UserMTProtoClient.instance) {
            UserMTProtoClient.instance = new UserMTProtoClient()
        }
        return UserMTProtoClient.instance
    }

    private constructor() {
        super()
        //
        this.client = new GramClient(new StoreSession('storage/tg-user-session'), parseInt(config.API_ID), config.API_HASH, {
            connectionRetries: 1000000,
            deviceModel: `wx2tg-pad User On ${os.hostname()}`,
            appVersion: 'rainbowcat',
            proxy: config.HOST ? {
                ip: config.HOST,
                port: parseInt(config.PORT),
                socksType: 5,
                password: config.PASSWORD,
                username: config.USERNAME,
            } : undefined,
            autoReconnect: true,
            maxConcurrentDownloads: 3,
        })
        this.hasReady = true
    }

    async createFolder(): Promise<void> {
        const result = await this.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const values = result.filters.map(it => {
            return it.className === 'DialogFilter' ? it.id : 0
        })
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const value = result?.filters.find(it => it.title === this.folderName)
        let id
        if (value) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            id = value.id
        } else {
            id = Math.max(...values) + 1 || this.DEFAULT_FILTER_ID
        }
        if (id === 1) {
            id = 100
        }
        const config = await ConfigurationService.getInstance().getConfig()
        // console.log('filter id', id)
        if (!value) {
            // log.info('创建 TG 文件夹')
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.client?.getInputEntity(config.botId).then(botEntity => {
                if (botEntity) {
                    const dialogFilter = new Api.DialogFilter({
                        id: id,
                        title: this.folderName,
                        pinnedPeers: [botEntity],
                        includePeers: [botEntity],
                        excludePeers: [],
                    })
                    this.client?.invoke(new Api.messages.UpdateDialogFilter({
                        id: id,
                        filter: dialogFilter,
                    })).catch(e => {
                        if (e.errorMessage.includes('DIALOG_FILTERS_TOO_MUCH')) {
                            // 已经到达文件夹创建的上限,不再创建新的文件夹
                            return
                        }
                    })
                }
            })
        }
    }
}