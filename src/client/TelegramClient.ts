import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient'

export class TelegramClient {
    get client() {
        return this._client
    }

    set client(value) {
        this._client = value
    }

    private static instance: TelegramClient

    private readonly apiId: number | undefined
    private readonly apiHash: string | undefined
    private _client: GramClient
    private storeSession = new StoreSession('storage/tg-session')
    private telegramBotClient: TelegramBotClient

    static getInstance(): TelegramClient {
        if (!TelegramClient.instance) {
            TelegramClient.instance = new TelegramClient(TelegramBotClient.getInstance())
        }
        return TelegramClient.instance
    }

    private constructor(telegramBotClient: TelegramBotClient) {
        this.apiId = parseInt(config.API_ID)
        this.apiHash = config.API_HASH
        ///
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


        this.telegramBotClient = telegramBotClient
        this._client.start({
            botAuthToken: config.BOT_TOKEN,
        })
    }

    public async downloadFile(messageId: number, chatId: string | number) {
        const chat = await this._client.getInputEntity(chatId)
        const messages = await this._client.getMessages(chat, {ids: messageId})
        return messages[0].downloadMedia()
    }

}