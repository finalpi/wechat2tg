import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {Api, TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient'

export class TelegramClient {
    get client() {
        return this._client
    }

    set client(value) {
        this._client = value
    }

    private readonly apiId: number | undefined
    private readonly apiHash: string | undefined
    private _client: GramClient
    private storeSession = new StoreSession('storage')
    private telegramBotClient: TelegramBotClient

    constructor(telegramBotClient: TelegramBotClient) {
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

    public async downloadFile(messageId: number,chatId: string|number) {
        const chat = await this._client.getInputEntity(chatId)
        const messages = await this._client.getMessages(chat, {ids: messageId})
        const video = messages[0].video
        if (video) {
            const videoLocation = new Api.InputDocumentFileLocation({
                id: video.id,
                accessHash: video.accessHash,
                fileReference: video.fileReference,
                thumbSize: ''
            })
            return this._client.downloadFile(videoLocation)
        }
    }

}