import {config} from '../config'
import {TelegramClient as GramClient} from 'telegram'
import os from 'node:os'
import {AbstractClient} from '../base/BaseClient'
import {StoreSession} from 'telegram/sessions'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'

export class BotMTProtoClient extends AbstractClient {
    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    onMessage(msg: any): void {
        throw new Error('Method not implemented.')
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance: BotMTProtoClient

    protected readonly apiId: number | undefined
    protected readonly apiHash: string | undefined
    protected storeSession = new StoreSession('storage/tg-session')

    static getInstance(): BotMTProtoClient {
        if (!BotMTProtoClient.instance) {
            BotMTProtoClient.instance = new BotMTProtoClient()
        }
        return BotMTProtoClient.instance
    }

    protected constructor() {
        super()
        this.apiId = parseInt(config.API_ID)
        this.apiHash = config.API_HASH
        this.client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
            connectionRetries: 1000000,
            deviceModel: `wx2tg Bot On ${os.hostname()}`,
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
    }

    async login(param?: any) {
        if (!BotMTProtoClient.getSpyClient('botMTPClient')) {
            const clientFactory = new ClientFactory()
            BotMTProtoClient.addSpyClient({
                interfaceId: 'botMTPClient',
                client: clientFactory.create('botMTPClient')
            })
        }
        this.client.start({
            botAuthToken: config.BOT_TOKEN,
        }).then(async () => {//
        })
        return true
    }
}