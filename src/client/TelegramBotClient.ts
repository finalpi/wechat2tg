import {Context, session, Telegraf} from 'telegraf'
import {config, useProxy} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import * as fs from 'node:fs'
import {ConfigurationService} from '../service/ConfigurationService'
import {UserAuthParams} from 'telegram/client/auth'
import {message} from 'telegraf/filters'
import {BindGroupService} from '../service/BindGroupService'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'
import {Configuration} from '../entity/Configuration'
import {SimpleMessageSendQueueHelper} from '../util/SimpleMessageSendQueueHelper'
import {MessageSender, Option} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import {FormatUtils} from '../util/FormatUtils'
import {Message} from '../entity/Message'
import {MessageService} from '../service/MessageService'
import {FileUtils} from '../util/FileUtils'
import sharp from 'sharp'
import {ConverterHelper} from '../util/FfmpegUtils'
import * as path from 'node:path'
import TgCommandHelper from '../service/TelegramCommandHelper'

export class TelegramBotClient extends AbstractClient {
    async login(): Promise<boolean> {
        if (!TelegramBotClient.getSpyClient('botClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'botClient',
                client: clientFactory.create('botClient')
            })
        }
        this.startTime = new Date()
        const config = await this.configurationService.getConfig()
        const bot: Telegraf = this.client
        bot.use(session())
        // 此方法需要放在所有监听方法之前,先拦截命令做处理鉴权
        bot.use(async (ctx, next) => {
            const chatId = config.chatId
            if (ctx.message) {
                const messageDate = new Date(ctx.message?.date * 1000)
                if (messageDate.getTime() < this.startTime.getTime()) {
                    return
                }
            }
            if (!chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.callbackQuery && ctx.callbackQuery.from.id === chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && !ctx.callbackQuery && !ctx.message) {
                return
            }

            // const bind = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
            if (ctx.chat && (chatId === ctx.chat.id)) {
                return next() // 如果用户授权，则继续处理下一个中间件或命令
            }

            if (!ctx.chat?.type.includes('group') && ctx.message && !ctx.message.from.is_bot) {
                return ctx.reply('Sorry, you are not authorized to interact with this bot.') // 如果用户未授权，发送提示消息
            }
        })
        this.onBotCommand(bot)
        this.onMessage(bot)
        this.onBotAction(bot)
        await this.botLaunch(bot)
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async sendMessage(message: BaseMessage): Promise<boolean> {
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.wxMsgId = message.id
        messageEntity.type = message.type
        messageEntity.wxSenderId = message.senderId
        messageEntity.content = message.content
        messageEntity.fhMsgId = message.fhMsgId
        await this.messageService.createOrUpdate(messageEntity)
        // 文本消息放进队列发送
        if (message.type === 0) {
            // 文本消息走队列
            this.sendQueueHelper.addMessageWithMsgId(parseInt(message.id), message)
        }else if (message.type === 1) {
            // 图片消息逻辑
            this.messageSender.sendFile(message.chatId,{
                buff: message.file.file,
                filename: message.file.fileName,
                fileType: message.file.sendType,
                caption: message.sender
            }, {
                parse_mode: 'HTML'
            }).then(msgRes=>{
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                if (e.response.error_code === 403) {
                    this.bindGroupService.removeByChatIdOrWxId(message.chatId,message.senderId)
                    message.chatId = this.config.botId
                    this.sendMessage(message)
                }
            })
        }else {
            this.messageSender.sendFile(message.chatId, {
                buff: Buffer.from('0'),
                filename: 'temp_file',
                caption: '文件接收中',
                fileType: 'document'
            }).then(async msgRes=>{
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            })
        }
        return true
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance = undefined
    private sendQueueHelper: SimpleMessageSendQueueHelper
    private configurationService = ConfigurationService.getInstance()
    private bindGroupService: BindGroupService
    private messageService: MessageService
    private chatId: number
    // 等待命令输入
    private waitInputCommand: string | undefined = undefined
    private phoneNumber: string | undefined = undefined
    private password: string | undefined = undefined
    private phoneCode = ''
    private messageSender: MessageSender
    // bot 启动时间
    private startTime: Date
    config: Configuration | undefined

    static getInstance(): TelegramBotClient {
        if (!TelegramBotClient.instance) {
            TelegramBotClient.instance = new TelegramBotClient()
        }
        return TelegramBotClient.instance
    }

    private constructor() {
        super()
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info)
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: httpAgent
                }
            })
        } else {
            this.client = new Telegraf(config.BOT_TOKEN)
        }
        this.hasReady = true
        // 加载配置
        this.configurationService.getConfig().then(config => {
            this.chatId = config.chatId
            this.config = config
        })
        this.bindGroupService = BindGroupService.getInstance()
        this.messageService = MessageService.getInstance()
        // 判断文件夹是否存在
        if (!fs.existsSync('save-files')) {
            fs.mkdirSync('save-files')
        }
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendTextMsg.bind(this),617)
        this.messageSender = SenderFactory.createSender(this.client)
    }

    private async sendTextMsg(message: BaseMessage) {
        // 发送文本消息的方法
        const bindGroup = await this.bindGroupService.getByWxId(message.wxId)
        const sendTextFormat = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, message.content)
        const option: Option = {
            parse_mode: 'HTML'
        }
        if (message.param?.reply_id) {
            option.reply_id = message.param.reply_id
        }
        const newMsg = await this.messageSender.sendText(bindGroup.chatId, sendTextFormat, option).catch(e => {
            if (e.response.error_code === 403) {
                this.bindGroupService.removeByChatIdOrWxId(message.chatId,message.senderId)
                message.chatId = this.config.botId
                this.sendTextMsg(message)
            }
        })
        // 更新chatId
        const messageEntity = await this.messageService.getByWxMsgId(message.id)
        if (newMsg && messageEntity) {
            messageEntity.tgBotMsgId = parseInt(newMsg.message_id + '')
            this.messageService.createOrUpdate(messageEntity)
        }
        return
    }

    private onBotAction(bot: Telegraf) {
        // 数字键盘点击
        bot.action(/num-(\d+)/, ctx => {
            const match = ctx.match[1]
            if (match !== '100') {
                this.phoneCode = this.phoneCode + match
            } else {
                this.phoneCode = this.phoneCode.substring(0, this.phoneCode.length - 1)
            }
            let inputCode = this.phoneCode
            if (this.phoneCode.length < 5) {
                for (let i = 0; i < 5 - this.phoneCode.length; i++) {
                    inputCode = inputCode + '_ '
                }
            }
            ctx.editMessageText(`请输入你收到的验证码: ${inputCode}`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: '1', callback_data: 'num-1'},
                            {text: '2', callback_data: 'num-2'},
                            {text: '3', callback_data: 'num-3'},
                        ],
                        [
                            {text: '4', callback_data: 'num-4'},
                            {text: '5', callback_data: 'num-5'},
                            {text: '6', callback_data: 'num-6'},
                        ],
                        [
                            {text: '7', callback_data: 'num-7'},
                            {text: '8', callback_data: 'num-8'},
                            {text: '9', callback_data: 'num-9'},
                        ],
                        [
                            {text: '0', callback_data: 'num-0'},
                            {text: 'Del', callback_data: 'num-100'},
                        ]
                    ]
                }
            })
            ctx.answerCbQuery()
        })
    }

    onMessage(bot: Telegraf) {
        bot.on(message('text'), async ctx => {
            const text = ctx.message.text
            const messageId = ctx.message.message_id
            const chatId = ctx.chat.id
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            // 处理等待用户输入的指令
            if (await this.dealWithCommand(ctx, text)) {
                return
            }
            const message: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: text,
                type: 0
            }
            if (replyMessageId) {
                message.param = {
                    replyMessageId: replyMessageId
                }
            }
            // 发送消息到微信
            TelegramBotClient.getSpyClient('wxClient').sendMessage(message)
        })
        bot.on(message('voice'), ctx =>
            this.handleFileMessage.call(this, ctx, 'voice'))

        bot.on(message('audio'), ctx =>
            this.handleFileMessage.call(this, ctx, 'audio'))

        bot.on(message('video'), ctx =>
            this.handleFileMessage.call(this, ctx, 'video'))

        bot.on(message('document'), ctx =>
            this.handleFileMessage.call(this, ctx, 'document'))

        bot.on(message('photo'), ctx =>
            this.handleFileMessage.call(this, ctx, 'photo'))

        bot.on(message('sticker'), ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            const fileId = ctx.message.sticker.file_id
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                const uniqueId = ctx.message.sticker.file_unique_id
                const href = fileLink.href
                const fileName = `${uniqueId}-${href.substring(href.lastIndexOf('/') + 1, href.length)}`
                const saveFile = `save-files/${fileName}`
                const gifFile = `save-files/${fileName.slice(0, fileName.lastIndexOf('.'))}.gif`

                const lottie_config = {
                    width: 128,
                    height: 128
                }
                // 微信不能发超过1Mb的gif文件
                if (saveFile.endsWith('.tgs')) {
                    lottie_config.width = 512
                    lottie_config.height = 512
                }

                // gif 文件存在
                if (fs.existsSync(gifFile)) {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                } else if (!fs.existsSync(saveFile)) {
                    FileUtils.downloadWithProxy(fileLink.toString(), saveFile).then(() => {
                        this.sendGif(saveFile, gifFile, ctx, lottie_config)
                    }).catch(() => ctx.reply('发送失败'))
                } else {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                }
            }).catch(e => {
                ctx.reply('发送失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        })

    }

    private async sendGif(saveFile: string, gifFile: string, ctx: any,
                          lottie_config?: {
                              width: number,
                              height: number
                          }) {
        try {
            if (!fs.existsSync(gifFile)) {
                if (saveFile.endsWith('.tgs')) {
                    await new ConverterHelper().tgsToGif(saveFile, gifFile, lottie_config)
                } else if (saveFile.endsWith('.webm')) {
                    await new ConverterHelper().webmToGif(saveFile, gifFile)
                } else if (saveFile.endsWith('.webp')) {
                    await new ConverterHelper().webpToGif(saveFile, gifFile)
                }
            }
            if (!fs.existsSync(gifFile)) {
                await ctx.reply('表情转换失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
                return
            }
            const messageId = ctx.message.message_id
            const chatId = ctx.chat.id
            const baseMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: '',
                type: 1
            }
            const buffer = fs.readFileSync(gifFile)

            // 提取文件名
            const fileName = path.basename(gifFile)
            baseMessage.content = fileName
            baseMessage.file = {
                fileName: fileName,
                file: Buffer.from(buffer),
            }
            TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
        } catch (e) {
            this.logError('发送失败')
            await ctx.reply('发送失败', {
                reply_parameters: {
                    message_id: ctx.message.message_id
                }
            })
        }

    }

    private async handleFileMessage(ctx: any, fileType: string | 'audio' | 'video' | 'document' | 'photo' | 'voice') {
        if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
            ctx.reply('请先登录微信')
            return
        }
        const messageId = ctx.message.message_id
        const chatId = ctx.chat.id
        const baseMessage: BaseMessage = {
            id: messageId + '',
            senderId: '',
            wxId: '',
            sender: '{me}',
            chatId: chatId,
            content: '',
            type: 1
        }
        if (ctx.message[fileType]) {
            let fileId = ctx.message[fileType].file_id
            let fileSize = ctx.message[fileType].file_size
            let fileName = ctx.message[fileType].file_name || ''
            if (!fileId) {
                fileId = ctx.message[fileType][ctx.message[fileType].length - 1].file_id
                fileSize = ctx.message[fileType][ctx.message[fileType].length - 1].file_size
            }
            if (fileSize && fileSize > 20971520) {
                // 配置了大文件发送则发送大文件
                FileUtils.getInstance().downloadLargeFile(ctx.message.message_id, ctx.chat.id).then(buff => {
                    if (buff) {
                        baseMessage.content = fileName
                        baseMessage.file = {
                            fileName: fileName,
                            file: Buffer.from(buff),
                        }
                        TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                    } else {
                        ctx.reply('发送失败', {
                            reply_parameters: {
                                message_id: ctx.message.message_id
                            }
                        })
                    }
                }).catch(err => {
                    this.logError('use telegram api download file error: ' + err)
                    ctx.reply('发送失败', {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    })
                })
                return
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                FileUtils.downloadBufferWithProxy(fileLink.toString()).then(buffer => {
                    // 如果图片大小小于100k,则添加元数据使其大小达到100k,否则会被微信压缩质量
                    if (fileSize && fileSize < 100 * 1024 && (fileType === 'photo' || (fileName.endsWith('jpg') || fileName.endsWith('jpeg') || fileName.endsWith('png')))) {
                        if (!fileName) {
                            fileName = new Date().getTime() + '.png'
                        }
                        baseMessage.content = fileName
                            // 构造包含无用信息的 EXIF 元数据
                            const exifData = {
                                IFD0: {
                                    // 添加一个长字符串作为无用信息
                                    ImageDescription: '0'.repeat(110_000 - Buffer.byteLength(buffer))
                                }
                            }

                            // 保存带有新元数据的图片
                            sharp(buffer)
                                .toFormat('png')
                                .withMetadata({exif: exifData})
                                .toBuffer()
                                .then(buff => {
                                    baseMessage.file = {
                                        fileName: fileName,
                                        file: buff,
                                    }
                                    TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                                }).catch((err) => {
                                ctx.reply('发送失败')
                            })
                        return
                    }
                    if (fileType === 'voice') {
                        const nowShangHaiZh = new Date().toLocaleString('zh', {
                            timeZone: 'Asia/ShangHai'
                        }).toString().replaceAll('/', '-')
                        fileName = `语音-${nowShangHaiZh.toLocaleLowerCase()}.mp3`
                    }
                    baseMessage.content = fileName
                    baseMessage.file = {
                        fileName: fileName,
                        file: buffer,
                    }
                    TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                }).catch(() => ctx.reply('发送失败'))
            }).catch(reason => {
                ctx.reply('发送失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        }
    }

    private onBotCommand(bot: Telegraf) {
        TgCommandHelper.setCommand(bot)
        TgCommandHelper.setSimpleCommandHandler(bot)


        bot.command('login', async ctx => {
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // todo 先判断是否登录 TG user client
            this.loginUserClient()
            // 登录微信客户端
            this.loginWechatClient()
        })

        bot.command('flogin', async ctx => {
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // 登录文件传输助手客户端
            this.loginFileHelperClient()
        })
    }

    private loginWechatClient() {
        if (!TelegramBotClient.getSpyClient('wxClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'wxClient',
                client: clientFactory.create('wxClient')
            })
        }
        TelegramBotClient.getSpyClient('wxClient').login()
    }

    private loginFileHelperClient() {
        if (!TelegramBotClient.getSpyClient('fhClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'fhClient',
                client: clientFactory.create('fhClient')
            })
        }
        TelegramBotClient.getSpyClient('fhClient').login()
    }

    private loginMTPClient() {
        if (!TelegramBotClient.getSpyClient('botMTPClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'botMTPClient',
                client: clientFactory.create('botMTPClient')
            })
        }
        TelegramBotClient.getSpyClient('botMTPClient').login()
    }

    public async loginUserClient() {
        if (!TelegramBotClient.getSpyClient('userMTPClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'userMTPClient',
                client: clientFactory.create('userMTPClient')
            })
        }
        const authParams: UserAuthParams = {
            onError(err: Error): Promise<boolean> | void {
                console.error(err)
            },
            phoneNumber: async () =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请输入你的手机号码（需要带国家区号，例如：+8613355558888）').then(res => {
                        this.waitInputCommand = 'phoneNumber'
                        const intervalId = setInterval(() => {
                            if (this.phoneNumber) {
                                const phoneNumber = this.phoneNumber
                                this.phoneNumber = undefined
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneNumber)
                            }
                        }, 1000)
                    })
                }),
            password: async (hint?: string) =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请输入你的二步验证密码:').then(res => {
                        this.waitInputCommand = 'password'
                        const intervalId = setInterval(() => {
                            if (this.password) {
                                const password = this.password
                                this.password = undefined
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(password)
                            }
                        }, 1000)
                    })
                }),
            phoneCode: async (isCodeViaApp?) =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请输入你收到的验证码:_ _ _ _ _\n', {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {text: '1', callback_data: 'num-1'},
                                    {text: '2', callback_data: 'num-2'},
                                    {text: '3', callback_data: 'num-3'}
                                ],
                                [
                                    {text: '4', callback_data: 'num-4'},
                                    {text: '5', callback_data: 'num-5'},
                                    {text: '6', callback_data: 'num-6'}
                                ],
                                [
                                    {text: '7', callback_data: 'num-7'},
                                    {text: '8', callback_data: 'num-8'},
                                    {text: '9', callback_data: 'num-9'}
                                ],
                                [
                                    {text: '0', callback_data: 'num-0'},
                                    {text: 'Del', callback_data: 'num--1'},
                                ]
                            ]
                        }
                    }).then(res => {
                        const intervalId = setInterval(() => {
                            if (this.phoneCode && this.phoneCode.length === 5) {
                                const phoneCode = this.phoneCode
                                this.phoneCode = ''
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneCode)
                            }
                        }, 1000)
                    })
                }),
        }
        TelegramBotClient.getSpyClient('userMTPClient').login(authParams)
    }


    private async botLaunch(bot: Telegraf, retryCount = 5) {
        if (retryCount >= 0) {
            bot.launch(() => {
                // 保存 botID
                this.configurationService.getConfig().then(config => {
                    if (!config.botId || config.botId == 0) {
                        const botId = this.client.botInfo.id
                        config.botId = botId
                        this.configurationService.saveConfig(config)
                    }
                    this.hasLogin = true
                    if (config.chatId > 0) {
                        this.loginUserClient()
                        // 登录微信客户端
                        this.loginWechatClient()
                        // 登录 botMTP 客户端
                        this.loginMTPClient()
                    }
                })
            }).then(() => {
                // 启动后做的事情
            }).catch(error => {
                this.botLaunch(bot, retryCount - 1)
            })
        }
        process.once('SIGINT', () => bot.stop('SIGINT'))
        process.once('SIGTERM', () => bot.stop('SIGTERM'))
    }

    private async dealWithCommand(ctx: Context, text: string) {
        if (this.waitInputCommand === 'phoneNumber') {
            this.waitInputCommand = undefined
            // 等待输入手机号
            this.phoneNumber = text
            await ctx.deleteMessage()
            return true
        }

        if (this.waitInputCommand === 'password') {
            this.waitInputCommand = undefined
            // 等待输入密码
            this.password = text
            await ctx.deleteMessage()
            return true
        }
        return false
    }

}