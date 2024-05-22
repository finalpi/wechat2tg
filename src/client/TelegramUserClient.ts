import {TelegramClient} from './TelegramClient'
import {TelegramBotClient} from './TelegramBotClient'
import * as authMethods from 'telegram/client/auth'
import {StoreSession} from 'telegram/sessions'
import {Api} from 'telegram'
import {config} from '../config'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import long = Api.long
import bigInt from 'big-integer'


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

    public createGroup(){
        if (this.telegramBotClient.bot.botInfo?.id){
            this.client?.invoke(
                new Api.messages.CreateChat({
                    users: [this.telegramBotClient.chatId,this.telegramBotClient.bot.botInfo?.id],
                    title: 'tes1',
                    ttlPeriod: 0
                })
            )
        }
    }

    public setAdmin(chatId:number){
        // 设置管理员
        if (this.telegramBotClient.bot.botInfo?.id){
            this.client?.invoke(
                new Api.messages.EditChatAdmin({
                    chatId: bigInt(chatId),
                    userId: this.telegramBotClient.bot.botInfo?.id,
                    isAdmin: true
                })
            )
        }
    }
}