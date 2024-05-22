import {TelegramClient} from './TelegramClient'
import {TelegramBotClient} from './TelegramBotClient'
import * as authMethods from 'telegram/client/auth'
import {StoreSession} from 'telegram/sessions'
import {Api} from 'telegram'
import {config} from '../config'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {BigInteger} from 'big-integer'
import {CreateGroupInterface} from '../models/CreateGroupInterface'
import {CustomFile} from 'telegram/client/uploads'


export class TelegramUserClient extends TelegramClient {
    private static telegramUserInstance: TelegramUserClient

    private constructor(telegramBotClient: TelegramBotClient) {
        super(telegramBotClient)
    }

    static getInstance(): TelegramUserClient {
        if (!TelegramUserClient.telegramUserInstance) {
            TelegramUserClient.telegramUserInstance = new TelegramUserClient(TelegramBotClient.getInstance())
        }
        return TelegramUserClient.telegramUserInstance
    }

    protected init() {
        // 子类重写init方法
        if (this.apiId && this.apiHash) {
            if (config.HOST) {
                this._client = new GramClient(new StoreSession('storage/tg-user-session'), this.apiId, this.apiHash, {
                    connectionRetries: 5,
                    proxy: {
                        ip: config.HOST,
                        port: parseInt(config.PORT),
                        socksType: 5,
                    },
                })
            } else {
                this._client = new GramClient(new StoreSession('storage/tg-user-session'), this.apiId, this.apiHash, {
                    connectionRetries: 5,
                })
            }
        }
    }

    public async start(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams) {
        await this._client?.start(authParams).then(() => {
            this.telegramBotClient.tgUserClientLogin = true
            this.telegramBotClient.bot.telegram.sendMessage(this.telegramBotClient.chatId, '登录成功!')
        }).catch((e) => {
            this.telegramBotClient.tgUserClientLogin = false
            console.error('login... user error', e)
        })
        return this._client
    }

    public async createGroup(createGroupInterface: CreateGroupInterface) {
        let bindItem
        if (this.telegramBotClient.bot.botInfo?.id) {
            let name
            let avatar
            if (createGroupInterface.type === 0) {
                if (createGroupInterface.contact?.payload) {
                    name = `${createGroupInterface.contact?.payload.alias}[${createGroupInterface.contact?.payload.name}]`
                    avatar = createGroupInterface.contact?.avatar()
                }
            } else {
                if (createGroupInterface.room?.payload) {
                    name = createGroupInterface.room.payload.topic
                    avatar = createGroupInterface.room?.avatar()
                }
            }
            const result = await this.client?.invoke(
                new Api.messages.CreateChat({
                    users: [this.telegramBotClient.chatId, this.telegramBotClient.bot.botInfo?.id],
                    title: name,
                    ttlPeriod: 0
                })
            )
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const id = result?.updates.chats[0].id
            // 设置管理员
            this.setAdmin(id)
            avatar?.then((fBox) => {
                fBox.toBuffer().then(async (buff) => {
                    const toUpload = new CustomFile(fBox.name, buff.length, '', buff)
                    const file = await this.client?.uploadFile({
                        file: toUpload,
                        workers: 3,
                    })
                    this.client?.invoke(new Api.messages.EditChatPhoto(
                        {
                            chatId: id,
                            photo: new Api.InputChatUploadedPhoto(
                                {
                                    file: file,
                                }
                            )
                        }
                    ))
                })
            })

            // 添加绑定
            if (createGroupInterface.type === 0) {
                bindItem = this.telegramBotClient.bindItemService.bindGroup(
                    createGroupInterface.contact?.payload?.name ? createGroupInterface.contact?.payload.name : '',
                    this.idConvert(id), createGroupInterface.type,
                    createGroupInterface.bindId ? createGroupInterface.bindId : '',
                    createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : '',
                    createGroupInterface.contact?.id ? createGroupInterface.contact?.id : '')
            } else {
                const topic = await createGroupInterface.room?.topic()
                this.telegramBotClient.bindItemService.bindGroup(topic ? topic : '', this.idConvert(id), createGroupInterface.type, createGroupInterface.bindId ? createGroupInterface.bindId : '', '', createGroupInterface.room?.id ? createGroupInterface.room?.id : '')
                if (createGroupInterface.type === 0) {
                    bindItem = this.telegramBotClient.bindItemService.bindGroup(
                        createGroupInterface.contact?.payload?.name ?
                            createGroupInterface.contact?.payload.name : '',
                        this.idConvert(id),
                        createGroupInterface.type,
                        createGroupInterface.bindId ? createGroupInterface.bindId : '',
                        createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : '',
                        createGroupInterface.contact?.id ? createGroupInterface.contact?.id : '')
                }
            }
        }
        return bindItem
    }

    private idConvert(chatId: BigInteger) {
        // id转换,将telegram api的chat id转为telegram bot的id
        return 0 - Number(chatId)
    }

    public setAdmin(chatId: BigInteger) {
        // 设置管理员
        if (this.telegramBotClient.bot.botInfo?.id) {
            this.client?.invoke(
                new Api.messages.EditChatAdmin({
                    chatId: chatId,
                    userId: this.telegramBotClient.bot.botInfo?.id,
                    isAdmin: true
                })
            )
        }
    }
}