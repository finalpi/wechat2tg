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
import {SetupServiceImpl} from '../service/Impl/SetupServiceImpl'
import * as os from 'node:os'
import {LogLevel} from 'telegram/extensions/Logger'


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

            this._client = new GramClient(new StoreSession('storage/tg-user-session'), this.apiId, this.apiHash, {
                connectionRetries: 20,
                deviceModel: `${config.APP_NAME} User On ${os.hostname()}`,
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

            // this._client.logger.setLevel(LogLevel.DEBUG)

        }
    }

    public async start(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams) {
        if (this._client?.disconnected) {
            await this._client?.start(authParams).then(async () => {
                this.telegramBotClient.tgUserClientLogin = true
                // TODO: 测试自动创建文件夹
                const setupServiceImpl = new SetupServiceImpl()
                await setupServiceImpl.createFolder()
                const bindItems = await TelegramBotClient.getInstance().bindItemService.getAllBindItems()
                for (const bindItem of bindItems) {
                    await setupServiceImpl.addToFolder(bindItem.chat_id)
                }
                this.telegramBotClient.bot.telegram.sendMessage(this.telegramBotClient.chatId, 'TG登录成功!').then(msg => {
                    setTimeout(() => {
                        this.telegramBotClient.bot.telegram.deleteMessage(this.telegramBotClient.chatId, msg.message_id)
                    }, 10000)
                })
            }).catch((e) => {
                this.telegramBotClient.tgUserClientLogin = false
                console.error('login... user error', e)
            })
        } else {
            this._client?.connect()
        }
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
                }
            }
            console.debug('createGroup id  ', this.telegramBotClient.chatId, this.telegramBotClient.bot.botInfo?.id)
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
            const setupServiceImpl = new SetupServiceImpl()
            await setupServiceImpl.addToFolder(TelegramUserClient.idConvert(id))
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
                    TelegramUserClient.idConvert(id), createGroupInterface.type,
                    createGroupInterface.bindId ? createGroupInterface.bindId : '',
                    createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : '',
                    createGroupInterface.contact?.id ? createGroupInterface.contact?.id : '',
                    createGroupInterface.contact?.payload?.avatar ? createGroupInterface.contact?.payload?.avatar : '')
            } else {
                const topic = await createGroupInterface.room?.topic()
                bindItem = this.telegramBotClient.bindItemService.bindGroup(topic ? topic : '', TelegramUserClient.idConvert(id),
                    createGroupInterface.type,
                    createGroupInterface.bindId ? createGroupInterface.bindId : '',
                    '',
                    createGroupInterface.room?.id ? createGroupInterface.room?.id : '',
                    '')
            }
        }
        return bindItem
    }

    public static idConvert(chatId: BigInteger) {
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