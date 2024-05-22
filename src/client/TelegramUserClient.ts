import {TelegramClient} from './TelegramClient'
import {TelegramBotClient} from './TelegramBotClient'
import * as authMethods from 'telegram/client/auth'
import {StoreSession} from 'telegram/sessions'
import {Api} from 'telegram'
import {config} from '../config'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import bigInt, {BigInteger} from 'big-integer'
import {MessageInterface} from 'wechaty/dist/esm/src/mods/impls'
import {CreateGroupInterface} from '../models/CreateGroupInterface'


export class TelegramUserClient extends TelegramClient{
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

    protected init(){
        // 子类重写init方法
        if (this.apiId && this.apiHash){
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

    public async start(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams){
        await this._client?.start(authParams).then(() => {
            this.telegramBotClient.tgUserClientLogin = true
            this.telegramBotClient.bot.telegram.sendMessage(this.telegramBotClient.chatId,'登录成功!')
        }).catch((e) => {
            this.telegramBotClient.tgUserClientLogin = false
            console.error('login... user error', e)
        })
        return this._client
    }

    public async createGroup(createGroupInterface: CreateGroupInterface){
        if (this.telegramBotClient.bot.botInfo?.id){
            let name
            if (createGroupInterface.type === 0){
                if (createGroupInterface.contact?.payload){
                    name = `${createGroupInterface.contact?.payload.alias}[${createGroupInterface.contact?.payload.name}]`
                }
            }else {
                if (createGroupInterface.room?.payload){
                    name = createGroupInterface.room.payload.topic
                }
            }
            const result = await this.client?.invoke(
                new Api.messages.CreateChat({
                    users: [this.telegramBotClient.chatId,this.telegramBotClient.bot.botInfo?.id],
                    title: name,
                    ttlPeriod: 0
                })
            )
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const id = result?.updates.chats[0].id
            // 设置管理员
            this.setAdmin(id)
            // TODO 设置头像
            // 添加绑定
            if (createGroupInterface.type === 0){
                this.telegramBotClient.bindItemService.bindGroup(createGroupInterface.contact?.payload?.name ? createGroupInterface.contact?.payload.name : '',this.idConvert(id),createGroupInterface.type,createGroupInterface.bindId ? createGroupInterface.bindId : '',createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : '',createGroupInterface.contact?.id ? createGroupInterface.contact?.id : '')
            }
        }
    }

    private idConvert(chatId:BigInteger){
        // id转换,将telegramapi的chatid转为telegrambot的id
        return 0 - Number(chatId)
    }

    public setAdmin(chatId:BigInteger){
        // 设置管理员
        if (this.telegramBotClient.bot.botInfo?.id){
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