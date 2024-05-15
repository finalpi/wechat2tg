import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {Api, TelegramClient as GramClient} from 'telegram'
import * as console from 'console'
import {Context} from 'telegraf'
import {TelegramBotClient} from './TelegramBotClient'

export class TelegramClient{
    get client() {
        return this._client
    }

    set client(value) {
        this._client = value
    }
    private apiId:number | undefined
    private apiHash:string | undefined
    private _client
    private storeSession = new StoreSession('storage')
    private telegramBotClient: TelegramBotClient

    constructor(telegramBotClient: TelegramBotClient) {
        this.apiId = parseInt(config.API_ID)
        this.apiHash = config.API_HASH
        this._client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
            connectionRetries: 5,
        })
        this.telegramBotClient = telegramBotClient
        this._client.start({
            botAuthToken: config.BOT_TOKEN,
        })
    }

    public async downloadFile(messageId: number){
        const chat = await this._client.getInputEntity(this.telegramBotClient.chatId)
        const messages = await this._client.getMessages(chat,{ids:messageId})
        const video = messages[0].video
        if (video){
            const videoLocation = new Api.InputDocumentFileLocation({
                id: video.id,
                accessHash: video.accessHash,
                fileReference: video.fileReference,
                thumbSize: ''
            })
            const buffer = await this._client.downloadFile(videoLocation)
            if (buffer){
                return new Promise(resolve => resolve(buffer))
            }
        }
    }

}