import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient'
import * as authMethods from 'telegram/client/auth'
import os from 'node:os'

export class TelegramClient {
    get client() {
        return this._client
    }

    private static instance: TelegramClient

    protected readonly apiId: number | undefined
    protected readonly apiHash: string | undefined
    protected _client?: GramClient
    protected storeSession = new StoreSession('storage/tg-session')
    protected telegramBotClient: TelegramBotClient

    static getInstance(): TelegramClient {
        if (!TelegramClient.instance) {
            TelegramClient.instance = new TelegramClient(TelegramBotClient.getInstance())
        }
        return TelegramClient.instance
    }

    protected constructor(telegramBotClient: TelegramBotClient) {
        this.apiId = parseInt(config.API_ID)
        this.apiHash = config.API_HASH

        this.init()
        this.telegramBotClient = telegramBotClient
    }

    protected init() {
        if (this.apiId && this.apiHash) {

            this._client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
                connectionRetries: 5,
                deviceModel: `${config.APP_NAME} On ${os.hostname()}`,
                appVersion: 'rainbowcat',
                proxy: config.HOST ? {
                    ip: config.HOST,
                    port: parseInt(config.PORT),
                    socksType: 5,
                    password: config.PASSWORD,
                    username: config.USERNAME,
                } : undefined,
                autoReconnect: true,
            })

            this._client.start({
                botAuthToken: config.BOT_TOKEN,
            })
        }
    }

    public async downloadFile(messageId: number, chatId: string | number) {
        const chat = await this._client?.getInputEntity(chatId)
        const messages = await this._client?.getMessages(chat, {ids: messageId})
        if (messages) {
            return messages[0].downloadMedia()
        }
    }

}