import {config} from '../config'
import {StoreSession} from 'telegram/sessions'
import {TelegramClient as GramClient} from 'telegram'
import {TelegramBotClient} from './TelegramBotClient'
import os from 'node:os'
import BaseClient from '../base/BaseClient'
import {DeletedMessage} from "telegram/events/DeletedMessage";
import {MessageUtils} from "../utils/MessageUtils";

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
                maxConcurrentDownloads: 5,
            })

            this._client.start({
                botAuthToken: config.BOT_TOKEN,
            }).then(async () => {
                // 测试测试 DELETED ME
                this._client?.getMe().then(me => {
                    // 新消息处理
                    // this._client?.addEventHandler(async event => {
                    //     const msg = event.message
                    //     this.logInfo(`New message from ${msg.id} in chat ${msg.chatId}: ${msg.text}`)
                    //     // CacheHelper.getInstances().addUndoMessageCache({
                    //     //     telegram_bot_message_id: msg.id,
                    //     //     chat_id: msg.chatId,
                    //     //     msgDate: msg.date
                    //     // })
                    // }, new NewMessage({fromUsers: [me]}))

                    // 监听删除消息事件
                }).catch(err => {
                    this.logError(err)
                })

                this._client?.addEventHandler(async event => {
                    // let id = event.peer?.id
                    // this.logInfo(`Deleted message: ${event.inputChat}`)
                    for (const deletedId of event.deletedIds) {
                        MessageUtils.undoMessage(deletedId)
                        this.logInfo(`Deleted message id: ${deletedId}`)
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

}