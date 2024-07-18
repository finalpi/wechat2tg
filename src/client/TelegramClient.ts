import {config} from '../config.js'
import {TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient.js'
import os from 'node:os'
import BaseClient from '../base/BaseClient.js'
import {DeletedMessage} from 'telegram/events/DeletedMessage.js'
import {MessageUtils} from '../utils/MessageUtils.js'
import {StoreSession} from 'telegram/sessions'

export class TelegramClient extends BaseClient {
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
        super()
        this.apiId = parseInt(config.API_ID)
        this.apiHash = config.API_HASH

        this.init()
        this.telegramBotClient = telegramBotClient
    }

    protected init() {
        if (this.apiId && this.apiHash) {

            this._client = new GramClient(this.storeSession, this.apiId, this.apiHash, {
                connectionRetries: 20,
                deviceModel: `${config.APP_NAME} Bot On ${os.hostname()}`,
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

            this._client.start({
                botAuthToken: config.BOT_TOKEN,
            }).then(async () => {
                this._client?.addEventHandler(async event => {
                    // let id = event.peer?.id
                    // this.logInfo(`Deleted message: ${event.inputChat}`)
                    for (const deletedId of event.deletedIds) {
                        MessageUtils.undoMessage(deletedId)
                    }
                }, new DeletedMessage({}))
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

    // TODO: 请在上层接口定义 (暂时是具体实现)
    public async editMessage(inputPeer: { chat_id: number, msg_id: number }, messageText: string) {
        const inputPeerChannelFromMessage = await this?.client?.getInputEntity(inputPeer.chat_id) || inputPeer.chat_id
        return this?.client?.editMessage(
            inputPeerChannelFromMessage,
            {message: inputPeer.msg_id, text: messageText})

    }

}