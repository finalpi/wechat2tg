import {ClientInterface} from './base/ClientInterface'
import {session, Telegraf} from 'telegraf'
import {config} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import * as fs from 'node:fs'
import {ConfigurationService} from '../service/ConfigurationService'
import {WeChatClient} from './WechatClient'

export class TelegramBotClient implements ClientInterface {
    private readonly _bot: Telegraf
    private static instance = undefined
    private configurationService = ConfigurationService.getInstance()
    private wechatClient: WeChatClient
    get bot(): Telegraf{
        return this._bot
    }

    static getInstance(): TelegramBotClient {
        if (!TelegramBotClient.instance) {
            TelegramBotClient.instance = new TelegramBotClient()
        }
        return TelegramBotClient.instance
    }

    private constructor() {
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: httpAgent
                }
            })
        } else {
            this._bot = new Telegraf(config.BOT_TOKEN)
        }
        this.wechatClient = new WeChatClient(this)
    }
    hasLogin(): boolean {
        throw new Error('Method not implemented.')
    }
    start(): void {
        // 判断文件夹是否存在
        if (!fs.existsSync('save-files')) {
            fs.mkdirSync('save-files')
        }

        const bot = this._bot

        bot.use(session())
        this.onBotCommand(bot)
        this.botLaunch(bot)
    }

    private onBotCommand(bot: Telegraf) {
        const commands = [
            {command: 'help', description: '帮助'},
            {command: 'start', description: '开始'},
            {command: 'login', description: '登录'},
        ]

        bot.telegram.setMyCommands(commands)

        bot.command('login', async ctx => {
            // todo 先判断是否登录 TG user client
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // 启动微信客户端
            this.wechatClient.start()
        })
    }


    private async botLaunch(bot: Telegraf, retryCount = 5) {
        if (retryCount >= 0) {
            bot.launch(()=>{
                // 保存 botID
            }).then(() => {
                // 启动后做的事情
            }).catch(error => {
                this.botLaunch(bot, retryCount - 1)
            })
        }
        process.once('SIGINT', () => bot.stop('SIGINT'))
        process.once('SIGTERM', () => bot.stop('SIGTERM'))
    }

}