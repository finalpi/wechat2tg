import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient'
import * as authMethods from 'telegram/client/auth'

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
    protected init(){
        if (this.apiId && this.apiHash){
            if (config.HOST) {
                this._client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
                    connectionRetries: 5,
                    proxy: {
                        ip: config.HOST,
                        port: parseInt(config.PORT),
                        socksType: 5,
                    },
                })
            } else {
                this._client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
                    connectionRetries: 5,
                })
            }
            this._client.start({
                botAuthToken: config.BOT_TOKEN,
            })
        }
    }

    public async downloadFile(messageId: number, chatId: string | number) {
        const chat = await this._client?.getInputEntity(chatId)
        const messages = await this._client?.getMessages(chat, {ids: messageId})
        if (messages){
            return messages[0].downloadMedia()
        }
    }

}