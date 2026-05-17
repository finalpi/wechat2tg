import {Context, Markup, session, Telegraf} from 'telegraf'
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
import {FileUtils, LargeFileDownloadProgress} from '../util/FileUtils'
import sharp from 'sharp'
import {ConverterHelper} from '../util/FfmpegUtils'
import * as path from 'node:path'
import TgCommandHelper from '../service/TelegramCommandHelper'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {WxContactRepository} from '../repository/WxContactRepository'
import {KeyboardPageUtils} from '../util/KeyboardPageUtils'
import {BindGroup} from '../entity/BindGroup'
import {WxRoomRepository} from '../repository/WxRoomRepository'
import {WeChatClient} from './WechatClient'
import {SpeechService} from '../service/SpeechService'
import {WxBot} from 'wx2tg-puppet'
import {Message as WxMessage} from 'wx2tg-puppet'
import {toolsApi} from 'wx2tg-puppet/dist/api/ToolsApi'
import {configService as wxConfigService} from 'wx2tg-puppet/dist/services/config.service'
import {FileChunkHelper} from 'wx2tg-puppet/dist/utils/FileChunkHelper'
import {MessageBufferService} from '../util/MessageBufferService'
import {FileBox} from 'file-box'
import I18n from '../i18n'
import http from 'http'
import {LogUtils} from '../util/LogUtil'
import {ChatHistoryAttachment, getChatHistory, NestedChatHistory} from '../util/handleMsg'
import {MessageTypeUtils} from '../util/MessageTypeUtils'
import {normalizeEscapedTelegramCommandText} from '../util/TelegramTextUtils'
import {AiReplyService} from '../service/AiReplyService'
import {CustomFile} from 'telegram/client/uploads'
import {Api} from 'telegram'

interface LargeFileProgressEditor {
    update(text: string, force?: boolean, inlineKeyboard?: Array<{ text: string, callback_data: string }>): Promise<void>
}

const TELEGRAM_BOT_API_UPLOAD_LIMIT = 50 * 1024 * 1024
const TELEGRAM_BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024
const TELEGRAM_MT_UPLOAD_TIMEOUT_MS = 180_000

type FileSendResult = {
    success: boolean
    skipRetry?: boolean
}

class TelegramUploadResultUnknownError extends Error {
    readonly skipRetry = true

    constructor(message: string) {
        super(message)
        this.name = 'TelegramUploadResultUnknownError'
    }
}

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
                return ctx.reply(this.i18n.t('auth.not_authorized')) // 如果用户未授权，发送提示消息
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

        // 检查消息是否已经在处理中（避免重复发送）
        const existingMessageId = `${message.chatId}_${message.id}`
        if (this.processingMessages.has(existingMessageId)) {
            this.logger.warn(`消息已在处理中，跳过重复发送: ${message.id}`)
            return true
        }

        // 标记消息正在处理
        this.processingMessages.add(existingMessageId)

        try {
            // 将消息添加到缓冲区
            const messageId = this.messageBufferService.addMessage(message)

            // 文本消息立即加入顺序队列，避免异步操作导致顺序混乱
            if (message.type === 0) {
                this.addTextMessageToQueue(message, messageId)
                return true
            }

            // 非文本消息才进行数据库操作
            const messageEntity = this.createMessageEntity(message)
            await this.messageService.createOrUpdate(messageEntity)

            if (message.type === 1) {
                const result = await this.sendFileMessage(message, messageEntity)
                if (result.success) {
                    this.messageBufferService.markMessageAsSent(messageId)
                } else {
                    if (result.skipRetry) {
                        this.messageBufferService.markMessageAsSent(messageId)
                    } else {
                        this.messageBufferService.markMessageAsFailed(messageId, async (msg) => (await this.sendFileMessage(msg, messageEntity)).success)
                    }
                }
            } else if (message.type === 4) {
                const success = await this.sendBusinessCardMessage(message, messageEntity)
                if (success) {
                    this.messageBufferService.markMessageAsSent(messageId)
                } else {
                    this.messageBufferService.markMessageAsFailed(messageId, async (msg) => {
                        const retryEntity = this.createMessageEntity(msg)
                        await this.messageService.createOrUpdate(retryEntity)
                        return await this.sendBusinessCardMessage(msg, retryEntity)
                    })
                }
            } else if (message.type === 5) {
                const success = await this.sendLocationMessage(message, messageEntity)
                if (success) {
                    this.messageBufferService.markMessageAsSent(messageId)
                } else {
                    this.messageBufferService.markMessageAsFailed(messageId, async (msg) => {
                        const retryEntity = this.createMessageEntity(msg)
                        await this.messageService.createOrUpdate(retryEntity)
                        return await this.sendLocationMessage(msg, retryEntity)
                    })
                }
            } else if (message.type === 6) {
                const success = await this.sendRevokeMessage(message, messageEntity)
                if (success) {
                    this.messageBufferService.markMessageAsSent(messageId)
                } else {
                    this.messageBufferService.markMessageAsFailed(messageId, async (msg) => {
                        const retryEntity = this.createMessageEntity(msg)
                        await this.messageService.createOrUpdate(retryEntity)
                        return await this.sendRevokeMessage(msg, retryEntity)
                    })
                }
            }
            return true
        } catch (error) {
            this.logger.error('发送消息失败:', error)
            // 不要在这里调用markMessageAsFailed，避免重复添加
            return false
        } finally {
            // 处理完成后移除标记（延迟移除，避免重试时被阻止）
            setTimeout(() => {
                this.processingMessages.delete(existingMessageId)
            }, 30000) // 30秒后移除
        }
    }

    private createMessageEntity(message: BaseMessage): Message {
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.wxMsgId = message.id
        messageEntity.type = message.type
        messageEntity.wxSenderId = message.senderId
        messageEntity.content = message.content
        messageEntity.fhMsgId = message.fhMsgId
        messageEntity.source_type = message.source_type
        messageEntity.source_text = message.source_text
        messageEntity.sender = message.sender
        messageEntity.toWxid = message.toWxid
        messageEntity.msgId = message.msgId
        // 如果没有 createTime，使用当前时间戳（秒级）作为默认值
        messageEntity.createTime = message.createTime || Math.floor(Date.now() / 1000)
        return messageEntity
    }

    private async sendFileMessage(message: BaseMessage, messageEntity: Message): Promise<FileSendResult> {
        try {
            const configuration = await this.configurationService.getConfig()
            if (message.file.sendType === 'voice' && config.TENCENT_SECRET_ID && config.TENCENT_SECRET_KEY && configuration.autoTranscript) {
                try {
                    const audioTranscript = await SpeechService.getInstance().getTranscript(message.file.file)
                    this.logger.info('语音转文字转换成功文本内容：', audioTranscript)
                    message.sender = `${message.sender}\n${audioTranscript}`
                } catch (e) {
                    this.logger.error('语音转文字失败:', e)
                }
            }

            const shouldUseTelegramApiForLargeFile = message.file.sendType === 'document' && message.file.file.length > TELEGRAM_BOT_API_UPLOAD_LIMIT
            const msgRes = shouldUseTelegramApiForLargeFile
                ? await this.sendLargeDocumentViaTelegramApi(message)
                : await this.messageSender.sendFile(message.chatId, {
                    buff: message.file.file,
                    filename: message.file.fileName,
                    fileType: message.file.sendType,
                    caption: message.sender
                }, {
                    parse_mode: 'HTML'
                })

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return {success: true}
        } catch (e) {
            this.dealException(e, message)
            if (e instanceof TelegramUploadResultUnknownError || e?.skipRetry) {
                return {success: false, skipRetry: true}
            }
            return {success: false}
        }
    }

    private async sendLargeDocumentViaTelegramApi(message: BaseMessage): Promise<{ message_id: string | number }> {
        const botMTPClient = TelegramBotClient.getSpyClient('botMTPClient')
        if (!botMTPClient?.hasLogin || !botMTPClient?.client) {
            throw new Error('Telegram API client not logged in')
        }

        const fileName = message.file.fileName || 'wechat-large-file'
        const totalSize = message.file.file.length
        const progressNoticeMessageId = message.param?.telegramUploadNoticeMessageId
            || await this.sendTelegramFileNotice(message.chatId, fileName)
        const progressEditor = await this.createTelegramUploadProgressEditor(message.chatId, fileName, totalSize, progressNoticeMessageId)
        const uploadStartedAt = Date.now()
        await progressEditor.update(this.formatTelegramUploadProgress(fileName, 0, totalSize), true)

        try {
            const inputPeer = await botMTPClient.client.getInputEntity(message.chatId)
            const result = await this.runTelegramUploadWithTimeout(
                fileName,
                totalSize,
                async () => botMTPClient.client.sendFile(inputPeer, {
                    file: new CustomFile(fileName, totalSize, '', message.file.file),
                    caption: message.sender,
                    parseMode: 'html',
                    forceDocument: true,
                    workers: 3,
                    progressCallback: async (progress: number) => {
                        const uploaded = Math.max(0, Math.min(totalSize, Math.round(progress * totalSize)))
                        this.logger.info(`Telegram 大文件上传进度: fileName=${fileName}, uploaded=${this.formatBytes(uploaded)}, total=${this.formatBytes(totalSize)}, percent=${Math.min(100, Math.round(progress * 100))}%`)
                        await progressEditor.update(this.formatTelegramUploadProgress(fileName, uploaded, totalSize))
                    }
                })
            )
            await this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
            return {message_id: result.id}
        } catch (e) {
            await this.resetBotMTPClientConnection(botMTPClient).catch(resetError => {
                this.logger.warn(`重置 Telegram MTProto 连接失败: fileName=${fileName}, error=${resetError?.message || resetError}`)
            })

            const uploadedMessageId = await this.findRecentUploadedTelegramDocumentMessageId(
                botMTPClient,
                message.chatId,
                fileName,
                totalSize,
                uploadStartedAt
            )
            if (uploadedMessageId) {
                this.logger.info(`Telegram 大文件上传超时后确认已成功: fileName=${fileName}, tgMsgId=${uploadedMessageId}`)
                await this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
                return {message_id: uploadedMessageId}
            }

            const resultUnknownError = new TelegramUploadResultUnknownError(
                `网络中断或上传超时，结果未知。请先检查 Telegram 是否已收到该文件；如果未收到，再手动重试。原始错误: ${e?.message || e}`
            )
            await progressEditor.update(
                `上传状态未知\n${fileName}\n请先检查 Telegram 是否已收到；如果未收到，再手动重试`,
                true,
                [{text: '重试上传', callback_data: `wmr:${message.id}`}]
            )
            throw resultUnknownError
        }
    }

    private async runTelegramUploadWithTimeout<T>(fileName: string, totalSize: number, uploadFn: () => Promise<T>): Promise<T> {
        let timeoutId: NodeJS.Timeout | undefined
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Telegram upload timeout after ${Math.round(TELEGRAM_MT_UPLOAD_TIMEOUT_MS / 1000)}s`))
                }, TELEGRAM_MT_UPLOAD_TIMEOUT_MS)
            })
            return await Promise.race([uploadFn(), timeoutPromise])
        } catch (e) {
            this.logger.warn(`Telegram 大文件上传超时/失败: fileName=${fileName}, totalSize=${this.formatBytes(totalSize)}, error=${e?.message || e}`)
            throw e
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
        }
    }

    private async deleteTelegramMessage(chatId: number, messageId?: number): Promise<void> {
        if (!messageId) {
            return
        }
        const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        await bot.telegram.deleteMessage(chatId, messageId).catch(() => {})
    }

    private async findRecentUploadedTelegramDocumentMessageId(
        botMTPClient: any,
        chatId: number,
        fileName: string,
        totalSize: number,
        uploadStartedAt: number
    ): Promise<number | undefined> {
        try {
            const inputPeer = await botMTPClient.client.getInputEntity(chatId)
            const messages = await botMTPClient.client.getMessages(inputPeer, {limit: 10})
            for (const msg of messages || []) {
                const document = msg?.document
                if (!document) {
                    continue
                }

                const uploadedAt = Number(msg?.date ? new Date(msg.date * 1000).getTime() : 0)
                if (uploadedAt && uploadedAt + 10_000 < uploadStartedAt) {
                    continue
                }

                const uploadedFileName = document.attributes?.find((attr: any) => attr instanceof Api.DocumentAttributeFilename)?.fileName
                const uploadedSize = Number(document.size || 0)
                if (uploadedFileName === fileName && uploadedSize === totalSize) {
                    return Number(msg.id)
                }
            }
        } catch (e) {
            this.logger.warn(`回查 Telegram 最近上传文件失败: chatId=${chatId}, fileName=${fileName}, error=${e?.message || e}`)
        }
        return undefined
    }

    private async resetBotMTPClientConnection(botMTPClient: any): Promise<void> {
        if (!botMTPClient?.client) {
            return
        }
        try {
            await botMTPClient.client.disconnect()
        } catch {
            // ignore disconnect errors during forced reset
        }
        await botMTPClient.client.connect()
    }

    private async sendTelegramFileNotice(chatId: number, fileName: string): Promise<number> {
        const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const sent = await bot.telegram.sendMessage(chatId, fileName)
        return sent.message_id
    }

    private async sendBusinessCardMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            const msgRes = await client.telegram.sendPhoto(message.chatId, {source: message.file.file, filename: message.file.fileName}, {
                caption: message.content,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback('添加为好友', `af:${message.businessCardId}`)]]
                },
            })

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return true
        } catch (e) {
            this.dealException(e, message)
            return false
        }
    }

    private async sendLocationMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            const msgJson = TelegramBotClient.getSpyClient('wxClient').client.Message.getXmlToJson(message.source_text)
            const msgRes = await client.telegram.sendLocation(message.chatId, parseFloat(msgJson.msg.location.x), parseFloat(msgJson.msg.location.y), {
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback(msgJson.msg.location.poiname || msgJson.msg.location.label, 'null')]]
                }
            })

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return true
        } catch (e) {
            this.dealException(e, message)
            return false
        }
    }

    private async sendRevokeMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const revokeMsg = await this.messageService.getByWxMsgId(message.revokeMsgId)
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            let param = undefined
            if (revokeMsg) {
                param = {
                    reply_parameters: {
                        message_id: revokeMsg.tgBotMsgId
                    }
                }
            }
            const msgRes = await client.telegram.sendMessage(message.chatId, message.content, param)

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return true
        } catch (e) {
            this.dealException(e, message)
            return false
        }
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
    // 添加消息缓冲服务
    private messageBufferService = MessageBufferService.getInstance()
    // 正在处理的消息集合，避免重复发送
    private processingMessages = new Set<string>()
    // 文本消息顺序队列
    private textMessageQueue: { message: BaseMessage, messageId: string }[] = []
    private isProcessingQueue = false
    // i18n实例
    private i18n = I18n.getInstance()
    // Telegram Bot 连接状态管理
    private isConnected = false
    private isReconnecting = false
    private reconnectAttempts = 0
    private readonly MAX_RECONNECT_ATTEMPTS = 10
    private readonly RECONNECT_BASE_DELAY = 5000 // 5秒基础延迟
    private healthCheckInterval: NodeJS.Timeout | null = null
    private readonly HEALTH_CHECK_INTERVAL = 60000 // 60秒检查一次

    static getInstance(): TelegramBotClient {
        if (!TelegramBotClient.instance) {
            TelegramBotClient.instance = new TelegramBotClient()
        }
        return TelegramBotClient.instance
    }

    private constructor() {
        super()
        // 重新初始化 logger，使用更具体的类别名
        this.logger = LogUtils.config().getLogger('TelegramBot')

        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info) as unknown as http.Agent
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const proxyUrl = `${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`
            const httpAgent = new HttpsProxyAgent(proxyUrl) as unknown as http.Agent
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
            // 设置语言
            if (config.language) {
                this.i18n.setLanguage(config.language)
            }
        })
        this.bindGroupService = BindGroupService.getInstance()
        this.messageService = MessageService.getInstance()
        // 判断文件夹是否存在
        if (!fs.existsSync('save-files')) {
            fs.mkdirSync('save-files')
        }
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendTextMsg.bind(this), 617)
        this.messageSender = SenderFactory.createSender(this.client)
    }

    private async sendTextMsg(message: BaseMessage): Promise<boolean> {
        // 为了保持向后兼容性，保留此方法，但建议使用 sendTextMsgSynchronously
        this.logger.debug(`使用legacy sendTextMsg方法: ${message.id}`)
        return await this.sendTextMsgSynchronously(message)
    }

    private async dealException(e, message: BaseMessage) {
        this.logger.error('消息发送异常:', e)

        // 检查是否是Telegram API响应错误
        if (e.response && e.response.error_code) {
            if (e.response.error_code === 403) {
                this.bindGroupService.removeByChatIdOrWxId(message.chatId, message.senderId)
                const config = await this.configurationService.getConfig()
                message.chatId = config.botId
                this.sendTextMsg(message)
            }
            // Telegram Too Many Requests
            else if (e.response.error_code === 429) {
                const retryAfter = e.response.parameters?.retry_after || 20
                this.logger.warn(`429错误，${retryAfter}秒后通过缓冲区重试: ${message.id}`)
                this.sendMessage(message)
            }
        }
        // 处理网络错误 (如 FetchError, ECONNRESET 等)
        else if (e.code === 'ECONNRESET' || e.type === 'system' || e.name === 'FetchError') {
            this.logger.warn(`网络错误，消息将通过缓冲区重试: ${message.id} - ${e.message}`)
            // 网络错误让缓冲区处理重试
        }
        // 其他未知错误
        else {
            this.logger.warn(`未知错误，消息将通过缓冲区重试: ${message.id} - ${e.message || e}`)
        }
    }

    private onBotAction(bot: Telegraf) {
        // 数字键盘点击
        bot.action(/num-(.+)/, ctx => {
            const match = ctx.match[1]
            if (match === '100') {
                this.phoneCode = this.phoneCode.substring(0, this.phoneCode.length - 1)
            } else {
                this.phoneCode = this.phoneCode + match
            }
            let inputCode
            if (match === '#') {
                inputCode = this.phoneCode.substring(0, this.phoneCode.length - 1)
            }else {
                inputCode = this.phoneCode
            }
            ctx.editMessageText(`${this.i18n.t('auth.verification_code_2')}: ${inputCode}`, {
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
                            {text: 'Del⬅️', callback_data: 'num-100'},
                            {text: '0', callback_data: 'num-0'},
                            {text: 'Sub✅', callback_data: 'num-#'},
                        ]
                    ]
                }
            })
            ctx.answerCbQuery()
        })

        bot.action(/^af:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            const friend = wxClient.getCardByWxId(wxId)
            if (friend) {
                friend.v3 = friend.username
                TelegramBotClient.getSpyClient('wxClient').client.Friendship.add(friend, this.i18n.t('add.greeting'))
                ctx.reply(this.i18n.t('add.request_sent'))
            } else {
                ctx.reply(this.i18n.t('add.no_user'))
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })

        bot.action(/^message/, async ctx => {
            const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
            if (bindGroup) {
                bindGroup.isReceive = !bindGroup.isReceive
                await this.bindGroupService.createOrUpdate(bindGroup)
                ctx.editMessageReplyMarkup({
                    inline_keyboard: [[{
                        text: `状态：${bindGroup.isReceive ? '接收消息' : '屏蔽消息'}`,
                        callback_data: 'message'
                    }]]
                })
            }
            ctx.answerCbQuery()
        })

        bot.action(/^forward/, async ctx => {
            const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
            if (bindGroup) {
                bindGroup.isForwardOthers = !bindGroup.isForwardOthers
                await this.bindGroupService.createOrUpdate(bindGroup)
                ctx.editMessageReplyMarkup({
                    inline_keyboard: [[{
                        text: `状态：${bindGroup.isForwardOthers ? '转发' : '不转发'}`,
                        callback_data: 'forward'
                    }]]
                })
            }
            ctx.answerCbQuery()
        })

        bot.action(/^st:/, async ctx => {
            const booleanKey = ctx.match.input.split(':')[1]
            const config = await this.configurationService.getConfig()
            config[booleanKey] = !config[booleanKey]
            await this.configurationService.saveConfig(config)
            ctx.editMessageReplyMarkup(await this.getSettingButton())
            ctx.answerCbQuery()
        })

        // 处理语言切换
        bot.action(/^lang:switch/, async ctx => {
            const config = await this.configurationService.getConfig()
            // 切换语言
            config.language = config.language === 'zh-CN' ? 'en-US' : 'zh-CN'
            // 保存设置
            await this.configurationService.saveConfig(config)
            // 设置i18n当前语言
            this.i18n.setLanguage(config.language)
            // 更新按钮
            ctx.editMessageReplyMarkup(await this.getSettingButton())
            // 更新设置
            TgCommandHelper.setCommand(bot)
            // 发送语言已切换的提示
            ctx.answerCbQuery(this.i18n.t('settings.language_changed'))
        })

        bot.action(/^us:page-/, async ctx => {
            const pageNum = ctx.match.input.split('-')[1]
            const data = await WxContactRepository.getInstance().getAll()
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.userName
                }
            })
            const page = new KeyboardPageUtils(dataMap, parseInt(pageNum), 'us')
            ctx.editMessageReplyMarkup(page.getMarkup())
            ctx.answerCbQuery()
        })

        bot.action(/^us:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const contact = await TelegramBotClient.getSpyClient('wxClient').client.Contact.find({id: wxId})
            if (contact) {
                if (ctx.chat && ctx.chat.type.includes('group')) {
                    await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, wxId)
                    // 群组中使用，重新绑定
                    const group = new BindGroup()
                    group.chatId = ctx.chat.id
                    group.wxId = wxId
                    group.type = 0
                    group.name = contact.name()
                    await this.bindGroupService.createOrUpdate(group)
                    this.updateGroupByChatId(group.chatId)
                    ctx.reply(this.i18n.t('binding.success'))
                } else {
                    // bot中使用，创建新的群组
                    const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
                    let bindGroup = new BindGroup()
                    bindGroup.wxId = wxId
                    bindGroup.name = contact.name()
                    bindGroup.avatarLink = await contact.avatar()
                    bindGroup.type = 0
                    const alias = await contact.alias()
                    if (alias !== bindGroup.name) {
                        bindGroup.alias = alias
                    }
                    bindGroup = await telegramGroupOperateService.createGroup(bindGroup)
                    const inviteLink = await ctx.telegram.exportChatInviteLink(bindGroup.chatId)
                    if (inviteLink) {
                        ctx.reply(this.i18n.t('group.create_success'), {
                            reply_markup: {
                                inline_keyboard: [
                                    [{text: this.i18n.t('group.open'), url: inviteLink}]
                                ]
                            }
                        })
                    }
                }
            }
            ctx.answerCbQuery()
        })

        bot.action(/^ro:page-/, async ctx => {
            const pageNum = ctx.match.input.split('-')[1]
            const data = await WxRoomRepository.getInstance().getAll()
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.chatroomId
                }
            })
            const page = new KeyboardPageUtils(dataMap, parseInt(pageNum), 'ro')
            ctx.editMessageReplyMarkup(page.getMarkup())
            ctx.answerCbQuery()
        })

        bot.action(/^ro:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const room = await TelegramBotClient.getSpyClient('wxClient').client.Room.find({id: wxId})
            if (room) {
                if (ctx.chat && ctx.chat.type.includes('group')) {
                    await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, wxId)
                    // 群组中使用，重新绑定
                    const group = new BindGroup()
                    group.chatId = ctx.chat.id
                    group.wxId = wxId
                    group.type = 1
                    group.name = room.name
                    await this.bindGroupService.createOrUpdate(group)
                    this.updateGroupByChatId(group.chatId)
                    ctx.reply(this.i18n.t('binding.success'))
                } else {
                    // bot中使用，创建新的群组
                    const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
                    let bindGroup = new BindGroup()
                    bindGroup.wxId = wxId
                    bindGroup.name = room.name
                    const avatar = await room.avatar()
                    bindGroup.avatarLink = avatar.url
                    bindGroup.type = 1
                    bindGroup = await telegramGroupOperateService.createGroup(bindGroup)
                    const inviteLink = await ctx.telegram.exportChatInviteLink(bindGroup.chatId)
                    if (inviteLink) {
                        ctx.reply(this.i18n.t('group.create_success'), {
                            reply_markup: {
                                inline_keyboard: [
                                    [{text: this.i18n.t('group.open'), url: inviteLink}]
                                ]
                            }
                        })
                    }
                }
            }
            ctx.answerCbQuery()
        })

        bot.action(/^fr:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            const friend = wxClient.getFriendShipByWxId(wxId)
            if (friend) {
                friend.accept()
                ctx.reply(this.i18n.t('add.request_sent'))
            } else {
                ctx.reply(this.i18n.t('add.no_user'))
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })

        bot.action(/^chr:/, async ctx => {
            try {
                const [, tgBotMsgId, nestedId] = ctx.match.input.split(':')
                const storedMessage = await this.messageService.getByBotMsgId(ctx.chat.id, Number(tgBotMsgId))
                await this.replyNestedChatHistory(ctx, storedMessage, Number(tgBotMsgId), nestedId)
            } catch (e) {
                this.logger.error('展开嵌套聊天记录失败:', e)
                await ctx.answerCbQuery('展开失败')
            }
        })

        bot.action(/^chrw:/, async ctx => {
            try {
                const [, wxMsgId, nestedId] = ctx.match.input.split(':')
                const storedMessage = await this.messageService.getByWxMsgId(wxMsgId)
                const replyToMessageId = ctx.callbackQuery?.message?.['message_id']
                await this.replyNestedChatHistory(ctx, storedMessage, Number(replyToMessageId || storedMessage?.tgBotMsgId || 0), nestedId)
            } catch (e) {
                this.logger.error('展开嵌套聊天记录失败:', e)
                await ctx.answerCbQuery('展开失败')
            }
        })

        bot.action(/^chrfw:/, async ctx => {
            try {
                const [, wxMsgId, nestedId, attachmentId] = ctx.match.input.split(':')
                await ctx.answerCbQuery('开始下载')
                const statusMessage = await ctx.reply('正在下载合并消息附件...')
                const storedMessage = await this.messageService.getByWxMsgId(wxMsgId)
                if (!storedMessage?.source_text) {
                    await ctx.reply('原始聊天记录已过期，无法下载附件')
                    return
                }

                const attachment = await this.findChatHistoryAttachment(storedMessage, nestedId, attachmentId)
                if (!attachment) {
                    await ctx.reply('没有找到这个附件')
                    return
                }
                const fileBuffer = await this.downloadChatHistoryAttachment(attachment, storedMessage)
                const replyToMessageId = ctx.callbackQuery?.message?.['message_id'] || storedMessage.tgBotMsgId
                await this.sendChatHistoryAttachment(ctx.chat.id, fileBuffer, attachment, Number(replyToMessageId))
                await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {})
            } catch (e) {
                this.logger.error('下载聊天记录附件失败:', e)
                await ctx.reply('附件下载失败')
            }
        })

        bot.action(/^chrf:/, async ctx => {
            try {
                const [, tgBotMsgId, nestedId, attachmentId] = ctx.match.input.split(':')
                await ctx.answerCbQuery('开始下载')
                const statusMessage = await ctx.reply('正在下载合并消息附件...')
                const storedMessage = await this.messageService.getByBotMsgId(ctx.chat.id, Number(tgBotMsgId))
                if (!storedMessage?.source_text) {
                    await ctx.reply('原始聊天记录已过期，无法下载附件')
                    return
                }

                const attachment = await this.findChatHistoryAttachment(storedMessage, nestedId, attachmentId)
                if (!attachment) {
                    await ctx.reply('没有找到这个附件')
                    return
                }
                const fileBuffer = await this.downloadChatHistoryAttachment(attachment, storedMessage)
                await this.sendChatHistoryAttachment(ctx.chat.id, fileBuffer, attachment, Number(tgBotMsgId))
                await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => {})
            } catch (e) {
                this.logger.error('下载聊天记录附件失败:', e)
                await ctx.reply('附件下载失败')
            }
        })

        bot.action(/^wmr:/, async ctx => {
            const wxMsgId = ctx.match.input.split(':')[1]
            try {
                await ctx.answerCbQuery('开始重试下载')
                await this.retryWechatMediaDownload(ctx, wxMsgId)
            } catch (e) {
                this.logger.error(`重试微信媒体下载失败: wxMsgId=${wxMsgId}`, e)
                await ctx.answerCbQuery('重试失败')
            }
        })
    }

    onMessage(bot: Telegraf) {
        bot.on(message('text'), async ctx => {
            // 识别文本类型
            const rawText = ctx.message.text
            const text = normalizeEscapedTelegramCommandText(rawText)
            const isEscapedCommandText = rawText.startsWith('\\/')
            // 处理完毕
            const messageId = ctx.message.message_id
            const chatId = ctx.chat.id
            const exist = await this.bindGroupService.getByChatId(chatId)
            // 处理等待用户输入的指令
            if (await this.dealWithCommand(ctx, rawText)) {
                return
            }
            if (!exist) {
                // 未绑定消息直接返回
                return
            }
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            // 其他 bot 的命令会进来，不处理
            if (!isEscapedCommandText && typeof text === 'string' && text.startsWith('/')) {
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

        bot.on(message('sticker'), async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply(this.i18n.t('login.please_login_wx'))
                return
            }
            const chatId = ctx.chat.id
            const exist = await this.bindGroupService.getByChatId(chatId)
            if (!exist) {
                // 未绑定消息直接返回
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
                    }).catch(() => ctx.reply(this.i18n.t('send.failed'), {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    }))
                } else {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                }
            }).catch(e => {
                ctx.reply(this.i18n.t('send.failed'), {
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
                await ctx.reply(this.i18n.t('send.sticker_convert_failed'), {
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
            this.logError(this.i18n.t('send.failed'))
            await ctx.reply(this.i18n.t('send.failed'), {
                reply_parameters: {
                    message_id: ctx.message.message_id
                }
            })
        }
    }

    private async handleFileMessage(ctx: any, fileType: string | 'audio' | 'video' | 'document' | 'photo' | 'voice') {
        if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
            ctx.reply(this.i18n.t('login.please_login_wx'))
            return
        }
        const messageId = ctx.message.message_id
        const chatId = ctx.chat.id
        const exist = await this.bindGroupService.getByChatId(chatId)
        if (!exist) {
            // 未绑定消息直接返回
            return
        }
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
            const duration = ctx.message[fileType].duration
            if (!fileName && fileType === 'photo') {
                fileName = new Date().getTime() + '.png'
            }
            if (!fileName && fileType === 'video') {
                fileName = new Date().getTime() + '.mp4'
            }
            if (!fileId) {
                fileId = ctx.message[fileType][ctx.message[fileType].length - 1].file_id
                fileSize = ctx.message[fileType][ctx.message[fileType].length - 1].file_size
            }
            if (fileSize && fileSize > TELEGRAM_BOT_API_DOWNLOAD_LIMIT) {
                // 配置了大文件发送则发送大文件
                const cachePath = this.getTelegramLargeFileCachePath(ctx.chat.id, ctx.message.message_id, fileName)
                this.logger.info(`收到 Telegram 大文件，开始下载: messageId=${ctx.message.message_id}, chatId=${ctx.chat.id}, fileName=${fileName}, fileSize=${this.formatBytes(fileSize)}, cachePath=${cachePath}`)
                const progressEditor = this.createLargeFileProgressEditor(ctx, fileName, fileSize)
                const cachedBuffer = this.readTelegramLargeFileCache(cachePath, fileSize)
                const downloadPromise = cachedBuffer
                    ? Promise.resolve(cachedBuffer)
                    : (progressEditor.update('开始下载 Telegram 大文件...'),
                        FileUtils.getInstance().downloadLargeFile(ctx.message.message_id, ctx.chat.id, progress => {
                            void progressEditor.update(this.formatLargeFileDownloadProgress(fileName, progress))
                        }).then(buff => {
                            if (buff) {
                                const buffer = Buffer.from(buff)
                                this.writeTelegramLargeFileCache(cachePath, buffer)
                                return buffer
                            }
                            return buff
                        }))
                if (cachedBuffer) {
                    progressEditor.update(`使用已缓存的大文件，正在发送到微信...\n${fileName}\n大小: ${this.formatBytes(cachedBuffer.length)}`)
                }
                downloadPromise.then(buff => {
                    if (buff) {
                        const buffer = Buffer.from(buff)
                        this.logger.info(`Telegram 大文件下载完成，准备发送到微信: messageId=${ctx.message.message_id}, fileName=${fileName}, bufferSize=${this.formatBytes(buffer.length)}`)
                        progressEditor.update(`下载完成，正在发送到微信...\n${fileName}\n大小: ${this.formatBytes(buffer.length)}`)
                        baseMessage.content = fileName
                        baseMessage.file = {
                            fileName: fileName,
                            file: buffer,
                        }
                        TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                            .then(success => {
                                this.logger.info(`Telegram 大文件已提交微信发送: messageId=${ctx.message.message_id}, fileName=${fileName}`)
                                if (success === false) {
                                    progressEditor.update(`发送到微信失败，已保留缓存，可重新发送避免重复下载\n${fileName}`)
                                } else {
                                    this.deleteTelegramLargeFileCache(cachePath)
                                    progressEditor.update(`已提交微信发送\n${fileName}`)
                                }
                            })
                            .catch(err => {
                                this.logger.error(`Telegram 大文件提交微信发送失败: messageId=${ctx.message.message_id}, fileName=${fileName}`, err)
                                progressEditor.update(`发送到微信失败，已保留缓存，可重新发送避免重复下载\n${fileName}\n${err?.message || err}`)
                            })
                    } else {
                        this.logger.warn(`Telegram 大文件下载返回空内容: messageId=${ctx.message.message_id}, fileName=${fileName}`)
                        progressEditor.update(`下载失败\n${fileName}`)
                        ctx.reply(this.i18n.t('send.failed'), {
                            reply_parameters: {
                                message_id: ctx.message.message_id
                            }
                        })
                    }
                }).catch(err => {
                    this.logger.error(`Telegram 大文件下载失败: messageId=${ctx.message.message_id}, fileName=${fileName}`, err)
                    this.logError('use telegram api download file error: ' + err)
                    progressEditor.update(`下载失败\n${fileName}\n${err?.message || err}`)
                    ctx.reply(this.i18n.t('send.failed'), {
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
                FileUtils.downloadBufferWithProxy(fileLink.toString()).then(async buffer => {
                    // 如果图片大小小于100k,则添加元数据使其大小达到100k,否则会被微信压缩质量
                    if (fileSize && fileSize < 100 * 1024 && (fileType === 'photo' || (fileName.endsWith('jpg') || fileName.endsWith('jpeg') || fileName.endsWith('png')))) {
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
                            ctx.reply(this.i18n.t('send.failed'), {
                                reply_parameters: {
                                    message_id: ctx.message.message_id
                                }
                            })
                        })
                        return
                    }
                    if (fileType === 'voice') {
                        const nameTemp = `语音-${new Date().getTime()}`
                        fileName = `${nameTemp}.mp3`
                        const fb = FileBox.fromBuffer(buffer)
                        await fb.toFile(`save-files/${nameTemp}.ogg`)
                        buffer = await new ConverterHelper().oggToMp3(`save-files/${nameTemp}.ogg`, `save-files/${nameTemp}.mp3`)
                    }
                    baseMessage.content = fileName
                    baseMessage.file = {
                        fileName: fileName,
                        file: buffer,
                        duration: duration
                    }
                    TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                }).catch(() => ctx.reply(this.i18n.t('send.failed'), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                }))
            }).catch(reason => {
                ctx.reply(this.i18n.t('send.failed'), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        }
        // 带有文本的消息单独发送文本
        if (ctx.text) {
            const text = normalizeEscapedTelegramCommandText(ctx.text)
            const textMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: text,
                type: 0
            }
            TelegramBotClient.getSpyClient('wxClient').sendMessage(textMessage)
        }
    }

    private onBotCommand(bot: Telegraf) {
        TgCommandHelper.setCommand(bot)
        TgCommandHelper.setSimpleCommandHandler(bot)

        bot.start(ctx => {
            ctx.reply(this.i18n.t('login.welcome'), Markup.removeKeyboard())
        })

        bot.help((ctx) => ctx.replyWithMarkdownV2(`${this.i18n.t('help.title')}

${this.i18n.t('help.description')}

${this.i18n.t('help.instructions')}`))

        bot.command('login', async ctx => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                return ctx.reply(this.i18n.t('login.group_not_allowed'))
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient')
            if (wxClient && wxClient.hasLogin) {
                return ctx.reply(this.i18n.t('login.already_logged_in'))
            }
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // todo 先判断是否登录 TG user client
            const userClient = TelegramBotClient.getSpyClient('userMTPClient')

            if (userClient && userClient.hasLogin){
                this.loginWechatClient()
            }else {
                this.loginUserClient()
            }
        })

        bot.command('relogin', async ctx => {
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient

            if (wxClient && wxClient.hasLogin) {
                return ctx.reply(this.i18n.t('login.already_logged_in'))
            }
            const status = await wxClient.client.loginTwice()
            if (status) {
                await wxClient.loginSuccess()
            } else {
                return ctx.reply(this.i18n.t('login.failed'))
            }
        })

        bot.command('logout', async ctx => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                return ctx.reply(this.i18n.t('login.group_not_allowed'))
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient')
            const wxBot = wxClient.client as WxBot
            await wxBot.clearCache()
            wxClient.hasLogin = false
            return ctx.reply(this.i18n.t('logout.success'))
        })

        bot.command('flogin', async ctx => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                return ctx.reply(this.i18n.t('login.group_not_allowed'))
            }
            const fhClient = TelegramBotClient.getSpyClient('fhClient')
            if (fhClient && fhClient.hasLogin) {
                return ctx.reply(this.i18n.t('login.already_logged_in'))
            }
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
        })

        bot.command('quit', async ctx => {
            if (!TelegramBotClient.getSpyClient('userMTPClient').hasLogin) {
                return ctx.reply(this.i18n.t('login.please_login_user_bot'))
            }
            const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
            telegramGroupOperateService.quitChat(ctx.chat.id)
        })

        bot.command('settings', async ctx => {
            ctx.sendMessage(this.i18n.t('settings.title'), {
                reply_markup: await this.getSettingButton()
            })
        })

        bot.command('ai', async ctx => {
            await this.handleAiCommand(ctx)
        })

        bot.command('update', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.updateGroupByChatId(ctx.chat.id)
            } else {
                return ctx.reply(this.i18n.t('update.group_only'))
            }
        })

        bot.command('unbind', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, undefined)
                ctx.reply(this.i18n.t('unbind.success'))
            } else {
                return ctx.reply(this.i18n.t('unbind.group_only'))
            }
        })

        bot.command('message', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
                if (!bindGroup) {
                    ctx.reply(this.i18n.t('message.not_bound'))
                    return
                }
                ctx.reply(this.i18n.t('message.status_prompt'), {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: `${this.i18n.t('message.status_receiving')}：${bindGroup.isReceive ? this.i18n.t('message.status_receiving') : this.i18n.t('message.status_blocking')}`,
                                callback_data: 'message'
                            }
                        ]]
                    }
                })
            } else {
                return ctx.reply(this.i18n.t('message.group_only'))
            }
        })

        bot.command('forward', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
                if (!bindGroup) {
                    ctx.reply(this.i18n.t('forward.not_bound'))
                    return
                }
                ctx.reply(this.i18n.t('forward.status_prompt'), {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: `${this.i18n.t('forward.status_on')}：${bindGroup.isForwardOthers ? this.i18n.t('forward.status_on') : this.i18n.t('forward.status_off')}`,
                                callback_data: 'forward'
                            }
                        ]]
                    }
                })
            } else {
                return ctx.reply(this.i18n.t('forward.group_only'))
            }
        })

        bot.command('add', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply(this.i18n.t('login.please_login_wx'))
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/add\s+([\p{L}\p{N}_]+)/u)
            if (match && match.length > 1) {
                const contact = await TelegramBotClient.getSpyClient('wxClient').client.Friendship.search(match[1])
                if (!contact.v3) {
                    return ctx.reply(this.i18n.t('add.no_user'))
                }
                TelegramBotClient.getSpyClient('wxClient').client.Friendship.add(contact, this.i18n.t('add.greeting'))
                ctx.reply(this.i18n.t('add.request_sent'))
            } else {
                ctx.reply(this.i18n.t('add.usage'))
            }
        })

        bot.command('user', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply(this.i18n.t('login.please_login_wx'))
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/user\s+([\p{L}\p{N}_]+)/u)
            let data
            if (match) {
                const userName = match[1]
                data = await WxContactRepository.getInstance().getByNickNameOrRemark(userName)
            } else {
                data = await WxContactRepository.getInstance().getAll()
            }
            if (!data || data.length === 0) {
                ctx.reply(this.i18n.t('user.no_contacts'))
                return
            }
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.userName
                }
            })
            const page = new KeyboardPageUtils(dataMap, 1, 'us')
            if (match) {
                page.pageSize = 999
            }
            let text
            if (ctx.chat && ctx.chat.type.includes('group')) {
                text = this.i18n.t('user.bind_contact')
            } else {
                text = this.i18n.t('user.create_contact_group')
            }
            ctx.reply(text, {
                reply_markup: page.getMarkup()
            })
        })

        bot.command('room', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply(this.i18n.t('login.please_login_wx'))
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/room\s+([\p{L}\p{N}_]+)/u)
            let data
            if (match) {
                const userName = match[1]
                data = await WxRoomRepository.getInstance().getByNickNameOrRemark(userName)
            } else {
                data = await WxRoomRepository.getInstance().getAll()
            }
            if (!data || data.length === 0) {
                ctx.reply(this.i18n.t('room.no_groups'))
                return
            }
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.chatroomId
                }
            })
            const page = new KeyboardPageUtils(dataMap, 1, 'ro')
            if (match) {
                page.pageSize = 999
            }
            let text
            if (ctx.chat && ctx.chat.type.includes('group')) {
                text = this.i18n.t('room.bind_group')
            } else {
                text = this.i18n.t('room.create_wx_group')
            }
            ctx.reply(text, {
                reply_markup: page.getMarkup()
            })
        })

        bot.command('revoke', async ctx => {
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            if (!replyMessageId) {
                return ctx.reply(this.i18n.t('revoke.reply_required'))
            }
            const msg = await this.messageService.getByBotMsgId(ctx.chat.id, replyMessageId)
            if (!msg) {
                return ctx.reply(this.i18n.t('revoke.failed'))
            }
            const wxClient: WeChatClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            if (wxClient.wxInfo.wxid !== msg.wxSenderId) {
                return ctx.reply(this.i18n.t('revoke.cannot_revoke_others'))
            }
            await wxClient.revokeMessage(msg)
            ctx.reply(this.i18n.t('revoke.request_sent'))
        })

        bot.command('getqr', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply(this.i18n.t('login.please_login_wx'))
                return
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient').client
            const qr = await wxClient.qrcode()
            const base64Data = qr.qrCode.replace(/^data:image\/\w+;base64,/, '')
            const imageBuffer = Buffer.from(base64Data, 'base64')
            ctx.replyWithPhoto({source: imageBuffer})
        })
    }

    private async updateGroupByChatId(chatId: number) {
        const bindItem = await this.bindGroupService.getByChatId(chatId)
        if (bindItem) {
            const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
            if (bindItem.type === 0) {
                const wxContact = await TelegramBotClient.getSpyClient('wxClient').client.Contact.find({id: bindItem.wxId})
                if (wxContact) {
                    await wxContact.sync()
                    bindItem.name = wxContact.name()
                    bindItem.avatarLink = await wxContact.avatar()
                    const alias = await wxContact.alias()
                    if (alias !== bindItem.name) {
                        bindItem.alias = alias
                    }
                    telegramGroupOperateService.updateGroup(bindItem)
                }
            } else {
                const wxRoom = await TelegramBotClient.getSpyClient('wxClient').client.Room.find({id: bindItem.wxId})
                if (wxRoom) {
                    await wxRoom.sync()
                    bindItem.name = wxRoom.name
                    bindItem.alias = wxRoom.remark
                    const avatar = await wxRoom.avatar()
                    bindItem.avatarLink = avatar.url
                    telegramGroupOperateService.updateGroup(bindItem)
                }
            }
        } else {
            this.messageSender.sendText(chatId, this.i18n.t('message.not_bound'))
        }
    }

    private async getSettingButton() {
        const settings = await this.configurationService.getSetting()
        const inline_keyboard = []
        const keys = settings.keys()
        for (const key of keys) {
            inline_keyboard.push([Markup.button.callback(`${settings.get(key).description}(${settings.get(key).options.get(settings.get(key).value)})`, `st:${key}`)])
        }

        // 添加语言切换按钮
        const config = await this.configurationService.getConfig()
        const currentLang = config.language || 'zh-CN'
        inline_keyboard.push([
            Markup.button.callback(`${this.i18n.t('settings.language')}(${currentLang === 'zh-CN' ? '中文' : 'English'})`, 'lang:switch')
        ])

        return {
            inline_keyboard: inline_keyboard,
        }
    }

    private async handleAiCommand(ctx: Context) {
        const text = ctx.text || ''
        const args = text.replace(/^\/ai(@\w+)?\s*/i, '').trim()
        const [action] = args.split(/\s+/).filter(Boolean)
        const aiOptions = this.parseAiCommandOptions(args)

        if (!args || action === 'help') {
            await ctx.reply([
                '/ai status',
                this.i18n.t('ai.help.generate'),
                this.i18n.t('ai.help.context'),
                this.i18n.t('ai.help.context_config'),
                '',
                this.i18n.t('ai.help.config')
            ].join('\n'))
            return
        }

        if (action === 'status') {
            const appConfig = await this.configurationService.getConfig()
            await ctx.reply([
                `AI Key: ${config.AI_API_KEY ? this.i18n.t('ai.status.configured') : this.i18n.t('ai.status.not_configured')}`,
                `AI URL: ${config.AI_API_URL || this.i18n.t('ai.status.not_configured')}`,
                `AI Model: ${config.AI_MODEL || 'gpt-4o-mini'}`,
                `AI Context: ${appConfig.aiContextLimit || config.AI_CONTEXT_LIMIT || 20}`
            ].join('\n'))
            return
        }

        if (action === 'context') {
            await this.handleAiContextConfigCommand(ctx, args)
            return
        }

        if (!ctx.chat?.id) {
            await ctx.reply(this.i18n.t('ai.error.no_chat'))
            return
        }

        if (!config.AI_API_KEY || !config.AI_API_URL) {
            await ctx.reply(this.i18n.t('ai.error.not_configured'))
            return
        }

        const waitingMessage = await ctx.reply(this.i18n.t('ai.generating'))
        try {
            const appConfig = await this.configurationService.getConfig()
            const defaultContextLimit = appConfig.aiContextLimit || (config.AI_CONTEXT_LIMIT > 0 ? config.AI_CONTEXT_LIMIT : 20)
            const contextLimit = aiOptions.contextLimit || defaultContextLimit
            const recentMessages = await this.messageService.listRecentByChatId(ctx.chat.id, contextLimit * 3)
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            const selfWxId = wxClient?.wxInfo?.wxid || ''
            const suggestion = await AiReplyService.getInstance().generateReplySuggestion(recentMessages, aiOptions.instruction, contextLimit, this.i18n.getLanguage(), selfWxId)
            const formattedSuggestion = AiReplyService.getInstance().formatSuggestionsForTelegram(suggestion)
            await ctx.telegram.editMessageText(ctx.chat.id, waitingMessage.message_id, undefined, formattedSuggestion, {parse_mode: 'MarkdownV2'}).catch(async () => {
                await ctx.reply(formattedSuggestion, {parse_mode: 'MarkdownV2'})
            })
        } catch (error) {
            const errorMessage = this.i18n.t('ai.error.generate_failed', {
                error: error.message || String(error)
            })
            await ctx.telegram.editMessageText(ctx.chat.id, waitingMessage.message_id, undefined, errorMessage).catch(async () => {
                await ctx.reply(errorMessage)
            })
        }
    }

    private async handleAiContextConfigCommand(ctx: Context, args: string) {
        const tokens = args.split(/\s+/).filter(Boolean)
        const parsed = parseInt(tokens[1] || '', 10)
        if (Number.isNaN(parsed) || parsed <= 0) {
            await ctx.reply(this.i18n.t('ai.error.invalid_context_limit'))
            return
        }

        const appConfig = await this.configurationService.getConfig()
        appConfig.aiContextLimit = parsed
        await this.configurationService.saveConfig(appConfig)
        await ctx.reply(this.i18n.t('ai.context_saved', {
            count: String(parsed)
        }))
    }

    private parseAiCommandOptions(args: string): {contextLimit?: number, instruction: string} {
        const tokens = args.split(/\s+/).filter(Boolean)
        const instructionTokens: string[] = []
        let contextLimit: number | undefined

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]
            if (token === '-n' || token === '--context') {
                const parsed = parseInt(tokens[i + 1] || '', 10)
                if (!Number.isNaN(parsed) && parsed > 0) {
                    contextLimit = parsed
                    i++
                    continue
                }
            }

            if (token.startsWith('--context=')) {
                const parsed = parseInt(token.replace('--context=', ''), 10)
                if (!Number.isNaN(parsed) && parsed > 0) {
                    contextLimit = parsed
                    continue
                }
            }

            instructionTokens.push(token)
        }

        return {
            contextLimit,
            instruction: instructionTokens.join(' ')
        }
    }

    private loginWechatClient() {
        if (!TelegramBotClient.getSpyClient('wxClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'wxClient',
                client: clientFactory.create('wxClient')
            })
        }
        if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
            TelegramBotClient.getSpyClient('wxClient').login()
        }
    }

    private loginMTPClient() {
        if (!TelegramBotClient.getSpyClient('botMTPClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'botMTPClient',
                client: clientFactory.create('botMTPClient')
            })
        }
        if (!TelegramBotClient.getSpyClient('botMTPClient').hasLogin) {
            TelegramBotClient.getSpyClient('botMTPClient').login()
        }
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
            onError: (err: Error): Promise<boolean> | void => {
                this.logger.error('认证错误:', err)
            },
            phoneNumber: async () =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, this.i18n.t('auth.phone_number')).then(res => {
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
                    this.client.telegram.sendMessage(this.chatId, this.i18n.t('auth.password')).then(res => {
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
                    this.client.telegram.sendMessage(this.chatId, this.i18n.t('auth.verification_code'), {
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
                                    {text: 'Del⬅️', callback_data: 'num-100'},
                                    {text: '0', callback_data: 'num-0'},
                                    {text: 'Sub✅', callback_data: 'num-#'},
                                ]
                            ]
                        }
                    }).then(res => {
                        const intervalId = setInterval(() => {
                            if (this.phoneCode && this.phoneCode.endsWith('#')) {
                                const phoneCode = this.phoneCode
                                this.phoneCode = ''
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneCode.substring(0, phoneCode.length - 1))
                            }
                        }, 1000)
                    })
                }),
        }
        if (!TelegramBotClient.getSpyClient('userMTPClient').hasLogin) {
            TelegramBotClient.getSpyClient('userMTPClient').login(authParams).then(login => {
                if (login) {
                    this.client.telegram.sendMessage(this.chatId, this.i18n.t('login.success'))
                    this.loginWechatClient()
                }
            })
        }
    }

    private async botLaunch(bot: Telegraf, retryCount = 5) {
        if (retryCount >= 0) {
            try {
                await bot.launch(() => {
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
                            // 登录 botMTP 客户端
                            this.loginMTPClient()
                        }
                    })
                })

                // 启动成功
                this.isConnected = true
                this.reconnectAttempts = 0
                this.logger.info('Telegram Bot 启动成功，开始监听消息')

                // 启动健康检查
                this.startHealthCheck()

                // 设置错误处理
                this.setupErrorHandlers(bot)

            } catch (error) {
                this.logger.error(`Telegram Bot 启动失败 (剩余重试次数: ${retryCount}):`, error)
                this.isConnected = false

                if (retryCount > 0) {
                    const delay = this.RECONNECT_BASE_DELAY * (6 - retryCount)
                    this.logger.info(`${delay}ms 后重试启动...`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                    await this.botLaunch(bot, retryCount - 1)
                } else {
                    this.logger.error('Telegram Bot 启动失败，已达最大重试次数')
                    throw error
                }
            }
        }

        // 优雅退出处理
        process.once('SIGINT', () => {
            this.logger.info('收到 SIGINT 信号，正在关闭...')
            this.cleanup()
            bot.stop('SIGINT')
        })
        process.once('SIGTERM', () => {
            this.logger.info('收到 SIGTERM 信号，正在关闭...')
            this.cleanup()
            bot.stop('SIGTERM')
        })
    }

    /**
     * 设置错误处理器，监听各种错误事件
     */
    private setupErrorHandlers(bot: Telegraf) {
        // 监听轮询错误
        bot.catch((err, ctx) => {
            this.logger.error('Telegram Bot 处理更新时发生错误:', err)
            if (ctx) {
                this.logger.error('错误上下文:', {
                    updateType: ctx.updateType,
                    chatId: ctx.chat?.id,
                    messageId: ctx.message?.['message_id']
                })
            }
        })

        // 监听未捕获的错误
        const errorHandler = (error: Error) => {
            // 检查是否是网络相关错误
            const isNetworkError =
                error.message?.includes('ENOTFOUND') ||
                error.message?.includes('ECONNREFUSED') ||
                error.message?.includes('ETIMEDOUT') ||
                error.message?.includes('ECONNRESET') ||
                error.message?.includes('socket hang up') ||
                error.message?.includes('Network error') ||
                error.message?.includes('Client network socket disconnected')

            if (isNetworkError) {
                this.logger.error('检测到 Telegram Bot 网络错误:', error.message)
                this.handleConnectionLost()
            } else {
                this.logger.error('Telegram Bot 发生未知错误:', error)
            }
        }

        // 为 bot 的 telegram 客户端添加错误监听
        if (bot.telegram) {
            const originalCallApi = bot.telegram.callApi.bind(bot.telegram)
            bot.telegram.callApi = async function(...args) {
                try {
                    return await originalCallApi(...args)
                } catch (error) {
                    errorHandler(error)
                    throw error
                }
            }
        }
    }

    /**
     * 启动健康检查
     */
    private startHealthCheck() {
        // 清除旧的检查
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval)
        }

        this.healthCheckInterval = setInterval(async () => {
            try {
                // 调用 getMe 检查连接
                await this.client.telegram.getMe()

                // 如果之前断开过连接，现在恢复了
                if (!this.isConnected) {
                    this.logger.info('✅ Telegram Bot 连接已恢复，可以正常收发消息')
                    this.isConnected = true
                    this.reconnectAttempts = 0
                }
            } catch (error) {
                this.logger.warn('健康检查失败:', error.message)

                if (this.isConnected) {
                    this.logger.error('检测到 Telegram Bot 连接断开')
                    this.handleConnectionLost()
                }
            }
        }, this.HEALTH_CHECK_INTERVAL)

        this.logger.info(`已启动健康检查，每 ${this.HEALTH_CHECK_INTERVAL / 1000} 秒检查一次`)
    }

    /**
     * 处理连接丢失
     */
    private handleConnectionLost() {
        if (this.isReconnecting) {
            return // 已在重连中
        }

        this.isConnected = false
        this.isReconnecting = true

        this.logger.warn('Telegram Bot 连接丢失，准备重连...')

        // 尝试重连
        this.reconnect()
    }

    /**
     * 重连逻辑
     */
    private async reconnect() {
        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            this.logger.error(`❌ Telegram Bot 重连失败，已达最大重试次数 (${this.MAX_RECONNECT_ATTEMPTS})，请检查网络或重启服务`)
            this.isReconnecting = false
            return
        }

        this.reconnectAttempts++

        // 指数退避延迟
        const delay = Math.min(
            this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
            300000 // 最大 5 分钟
        )

        this.logger.info(`第 ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} 次重连尝试，${delay}ms 后执行...`)

        await new Promise(resolve => setTimeout(resolve, delay))

        try {
            // 尝试调用 API 检查连接
            await this.client.telegram.getMe()

            // 连接成功
            this.logger.info('✅ Telegram Bot 重连成功')
            this.isConnected = true
            this.isReconnecting = false
            this.reconnectAttempts = 0
        } catch (error) {
            this.logger.error(`重连失败 (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}):`, error.message)

            // 继续尝试重连
            await this.reconnect()
        }
    }

    /**
     * 清理资源
     */
    private cleanup() {
        this.logger.info('正在清理 TelegramBotClient 资源...')

        // 停止健康检查
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval)
            this.healthCheckInterval = null
        }

        this.isConnected = false
        this.isReconnecting = false
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

    private addTextMessageToQueue(message: BaseMessage, messageId: string) {
        // 将消息和messageId一起存储
        const queueItem = { message, messageId }
        this.textMessageQueue.push(queueItem)

        if (!this.isProcessingQueue) {
            this.processTextMessageQueue()
        }
    }

    private async processTextMessageQueue() {
        this.isProcessingQueue = true

        while (this.textMessageQueue.length > 0) {
            const queueItem = this.textMessageQueue.shift()
            if (!queueItem) continue

            const { message, messageId } = queueItem

            try {
                // 确保消息完全发送完成后再处理下一个
                const success = await this.sendTextMsgSynchronously(message)
                if (success) {
                    this.messageBufferService.markMessageAsSent(messageId)
                } else {
                    this.logger.warn(`消息发送返回失败，准备重试: wxMsgId=${message.id}, chatId=${message.chatId}`)
                    this.messageBufferService.markMessageAsFailed(messageId, async (msg) => {
                        // 重试的消息不进入队列，直接发送（保持顺序）
                        this.logger.info(`消息重试，不进入队列: ${msg.id}`)
                        return await this.sendTextMsgSynchronously(msg)
                    })
                }
            } catch (error) {
                this.logger.error(`消息处理抛出异常: wxMsgId=${message.id}, chatId=${message.chatId}`)
                this.logger.error(`异常详情: ${error.message}`, error.stack)
                // 检查是否是超时错误
                const isTimeoutError = this.isTimeoutError(error)
                this.messageBufferService.markMessageAsFailed(messageId, async (msg) => {
                    return await this.sendTextMsgSynchronously(msg)
                }, isTimeoutError)
            }

            // 增加延迟确保发送完全完成
            await new Promise(resolve => setTimeout(resolve, 200))
        }

        this.isProcessingQueue = false
    }

    /**
     * 检查错误是否是超时类型错误
     * 超时错误时消息可能已经发送成功，不应该重试
     */
    private isTimeoutError(error: any): boolean {
        return error.code === 'ETIMEDOUT' ||
               error.code === 'ECONNRESET' ||
               error.code === 'ESOCKETTIMEDOUT' ||
               (error.message && error.message.includes('timeout'))
    }

    // 新增：同步发送文本消息，确保严格顺序
    private async sendTextMsgSynchronously(message: BaseMessage): Promise<boolean> {
        // 先验证 chatId 和格式化内容，确认可以发送后再保存数据库
        // 优先使用 message.chatId（已经在 WechatClient.onMessage 中设置好了）
        // 只有在 chatId 无效时才通过 wxId 查询数据库
        let targetChatId = message.chatId
        if (!targetChatId) {
            const bindGroup = await this.bindGroupService.getByWxId(message.wxId)
            if (!bindGroup) {
                this.logger.error(`文本消息发送失败: 未找到绑定群组 - wxId=${message.wxId}, msgId=${message.id}`)
                return false
            }
            targetChatId = bindGroup.chatId
        }

        if (!targetChatId) {
            this.logger.error(`文本消息发送失败: chatId 无效 - wxId=${message.wxId}, msgId=${message.id}`)
            return false
        }

        // 在这里进行格式化，如果格式化失败会抛出异常，在保存数据库之前被捕获
        let sendTextFormat: string
        try {
            sendTextFormat = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, message.content)
        } catch (error) {
            this.logger.error(`文本消息格式化失败: ${message.id}`, error)
            return false
        }

        // 所有验证通过后，才保存到数据库
        const messageEntity = this.createMessageEntity(message)
        await this.messageService.createOrUpdate(messageEntity)
        this.logger.info(`开始发送文本消息: wxMsgId=${message.id}, chatId=${targetChatId}`)

        const option: Option = {
            parse_mode: 'HTML'
        }
        if (message.param?.reply_id) {
            option.reply_id = message.param.reply_id
        }
        if (message.param?.inline_keyboard) {
            option.inline_keyboard = message.param.inline_keyboard
        }
        if (message.param?.nestedChatHistories?.length || message.param?.chatHistoryAttachments?.length) {
            const downloadableAttachments = this.getDownloadableChatHistoryAttachments(message.param?.chatHistoryAttachments || [])
            option.inline_keyboard = [
                ...this.buildNestedChatHistoryKeyboardByWxMsgId(message.id, message.param.nestedChatHistories || []),
                ...this.buildChatHistoryAttachmentKeyboardByWxMsgId(message.id, 'root', downloadableAttachments)
            ].flat()
        }

        let newMsg
        let success = true

        // 长文本分片发送 - 确保每片都按顺序发送
        const html = message.content
        const maxLength = 9000
        if (html.length > maxLength) {
            const result = []
            let currentLength = 0
            let currentChunk = ''

            const regex = /(<[^>]+>|[^<]+)/g
            let match

            while ((match = regex.exec(html)) !== null) {
                const chunk = match[0]
                const chunkLength = chunk.length

                if (currentLength + chunkLength > maxLength) {
                    result.push(currentChunk)
                    currentChunk = ''
                    currentLength = 0
                }

                currentChunk += chunk
                currentLength += chunkLength
            }

            if (currentChunk) {
                result.push(currentChunk)
            }

            // 按顺序发送每个分片，等待每个完成后再发送下一个
            this.logger.info(`长文本消息将分 ${result.length} 片发送: ${message.id}`)
            for (let i = 0; i < result.length; i++) {
                let sendMsg = result[i]
                if (result.length > 1) {
                    sendMsg = `<b>part${i + 1}:</b>` + sendMsg
                }
                let partSendTextFormat: string
                try {
                    partSendTextFormat = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, sendMsg)
                } catch (error) {
                    this.logger.error(`文本消息分片格式化失败 (分片${i + 1}): ${message.id}`, error)
                    success = false
                    break
                }
                try {
                    if (i == 0) {
                        newMsg = await this.messageSender.sendText(targetChatId, partSendTextFormat, option)
                    } else {
                        await this.messageSender.sendText(targetChatId, partSendTextFormat, option)
                    }
                    // 等待分片发送完成
                    await new Promise(resolve => setTimeout(resolve, 50))
                } catch (e) {
                    this.logger.error(`文本消息发送失败 (分片${i + 1}/${result.length}): ${message.id} - ${e.message}`)
                    this.logger.error(`错误详情: chatId=${targetChatId}, wxMsgId=${message.id}, error_code=${e.response?.error_code}, error=${e.code || e.name}`)
                    await this.dealException(e, message)
                    success = false
                    break // 如果某个分片失败，停止发送后续分片
                }
            }
        } else {
            try {
                newMsg = await this.messageSender.sendText(targetChatId, sendTextFormat, option)
            } catch (e) {
                this.logger.error(`文本消息发送失败: ${message.id} - ${e.message}`)
                this.logger.error(`错误详情: chatId=${targetChatId}, wxMsgId=${message.id}, error_code=${e.response?.error_code}, error=${e.code || e.name}`)
                await this.dealException(e, message)
                success = false
            }
        }

        // 更新chatId
        if (newMsg && success) {
            messageEntity.tgBotMsgId = parseInt(newMsg.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            if (message.param?.nestedChatHistories?.length || message.param?.chatHistoryAttachments?.length) {
                try {
                    await this.attachChatHistoryButtons(
                        targetChatId,
                        messageEntity.tgBotMsgId,
                        message.param.nestedChatHistories || [],
                        message.param.chatHistoryAttachments || []
                    )
                } catch (e) {
                    this.logger.warn(`聊天记录按钮添加失败: wxMsgId=${message.id}, tgBotMsgId=${messageEntity.tgBotMsgId}`)
                }
            }
            this.logger.info(`文本消息发送成功: wxMsgId=${message.id}, tgBotMsgId=${messageEntity.tgBotMsgId}`)
        } else if (!success) {
            this.logger.warn(`消息保存到数据库但 tgBotMsgId=0: wxMsgId=${message.id}, chatId=${targetChatId}`)
        }

        return success
    }

    private async attachChatHistoryButtons(chatId: number, tgBotMsgId: number, nestedChatHistories: {id: string, title: string}[], attachments: ChatHistoryAttachment[] = []) {
        const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const inlineKeyboard = this.buildNestedChatHistoryKeyboard(tgBotMsgId, nestedChatHistories)
        const downloadableAttachments = this.getDownloadableChatHistoryAttachments(attachments)
        inlineKeyboard.push(...this.buildChatHistoryAttachmentKeyboard(tgBotMsgId, 'root', downloadableAttachments))
        await client.telegram.editMessageReplyMarkup(chatId, tgBotMsgId, undefined, {
            inline_keyboard: inlineKeyboard
        })
    }

    private buildNestedChatHistoryKeyboard(tgBotMsgId: string | number, nestedChatHistories: {id: string, title: string}[]) {
        return nestedChatHistories.map((record, index) => [{
            text: nestedChatHistories.length === 1 ? '展开聊天记录' : `展开聊天记录 ${index + 1}`,
            callback_data: `chr:${tgBotMsgId}:${record.id}`
        }])
    }

    private buildNestedChatHistoryKeyboardByWxMsgId(wxMsgId: string, nestedChatHistories: {id: string, title: string}[]) {
        return nestedChatHistories.map((record, index) => ({
            text: nestedChatHistories.length === 1 ? '展开聊天记录' : `展开聊天记录 ${index + 1}`,
            callback_data: `chrw:${wxMsgId}:${record.id}`
        }))
    }

    private buildChatHistoryAttachmentKeyboard(tgBotMsgId: string | number, nestedId: string, attachments: ChatHistoryAttachment[]) {
        return attachments.map((attachment, index) => [{
            text: attachments.length === 1 ? this.getAttachmentButtonText(attachment) : `${this.getAttachmentButtonText(attachment)} ${index + 1}`,
            callback_data: `chrf:${tgBotMsgId}:${nestedId}:${attachment.id}`
        }])
    }

    private buildChatHistoryAttachmentKeyboardByWxMsgId(wxMsgId: string, nestedId: string, attachments: ChatHistoryAttachment[]) {
        return attachments.map((attachment, index) => ({
            text: attachments.length === 1 ? this.getAttachmentButtonText(attachment) : `${this.getAttachmentButtonText(attachment)} ${index + 1}`,
            callback_data: `chrfw:${wxMsgId}:${nestedId}:${attachment.id}`
        }))
    }

    private getDownloadableChatHistoryAttachments(attachments: ChatHistoryAttachment[]) {
        return attachments
    }

    private getAttachmentButtonText(attachment: ChatHistoryAttachment) {
        return attachment.type === 'image' ? '下载图片' : '下载文件'
    }

    private async replyNestedChatHistory(ctx: Context, storedMessage: Message | undefined, replyToMessageId: number, nestedId: string) {
        if (!storedMessage?.source_text) {
            await ctx.answerCbQuery('聊天记录已过期')
            return
        }

        const msgJson = WxMessage.getXmlToJson(storedMessage.source_text)
        const recordJson = WxMessage.getXmlToJson(msgJson.msg.appmsg.recorditem)
        const chatHistory = await getChatHistory(recordJson, {type: () => storedMessage.source_type, text: () => storedMessage.source_text}, WxMessage.Type, WxMessage.getXmlToJson)
        const nestedRecord = this.findNestedChatHistory(chatHistory.nestedRecords, nestedId)
        if (!nestedRecord) {
            await ctx.answerCbQuery('没有找到内层聊天记录')
            return
        }

        const replyOptions: any = {
            parse_mode: 'HTML',
            reply_parameters: {
                message_id: replyToMessageId || storedMessage.tgBotMsgId
            }
        }
        const downloadableAttachments = this.getDownloadableChatHistoryAttachments(nestedRecord.attachments)
        if (nestedRecord.nestedRecords.length > 0 || downloadableAttachments.length > 0) {
            replyOptions.reply_markup = {
                inline_keyboard: [
                    ...this.buildNestedChatHistoryKeyboardByWxMsgId(storedMessage.wxMsgId, nestedRecord.nestedRecords).map(button => [button]),
                    ...this.buildChatHistoryAttachmentKeyboardByWxMsgId(storedMessage.wxMsgId, nestedId, downloadableAttachments).map(button => [button])
                ]
            }
        }

        await ctx.reply(nestedRecord.content, replyOptions)
        await ctx.answerCbQuery('已展开')
    }

    private async findChatHistoryAttachment(storedMessage: Message, nestedId: string, attachmentId: string): Promise<ChatHistoryAttachment | undefined> {
        const msgJson = WxMessage.getXmlToJson(storedMessage.source_text)
        const recordJson = WxMessage.getXmlToJson(msgJson.msg.appmsg.recorditem)
        const chatHistory = await getChatHistory(recordJson, {type: () => storedMessage.source_type, text: () => storedMessage.source_text}, WxMessage.Type, WxMessage.getXmlToJson)
        if (nestedId === 'root') {
            return chatHistory.attachments.find(attachment => attachment.id === attachmentId)
        }
        const nestedRecord = this.findNestedChatHistory(chatHistory.nestedRecords, nestedId)
        return nestedRecord?.attachments.find(attachment => attachment.id === attachmentId)
    }

    private findNestedChatHistory(nestedRecords: NestedChatHistory[], nestedId: string): NestedChatHistory | undefined {
        for (const record of nestedRecords) {
            if (record.id === nestedId) {
                return record
            }

            const childRecord = this.findNestedChatHistory(record.nestedRecords || [], nestedId)
            if (childRecord) {
                return childRecord
            }
        }

        return undefined
    }

    private async downloadChatHistoryAttachment(attachment: ChatHistoryAttachment, storedMessage: Message): Promise<Buffer> {
        const wxConfig = await wxConfigService.get()
        const wxid = wxConfig?.wxid || ''
        if (attachment.type === 'image') {
            const recordItemAesKey = attachment.payload.rawFileAesKey || attachment.payload.fileAesKey
            this.logger.info(`下载聊天记录图片附件(recorditem): cdnDataUrl=${String(attachment.payload.fileNo).slice(0, 60)}, aesKey=${attachment.payload.fileAesKey}, rawKey=${attachment.payload.rawFileAesKey}, usedKey=${recordItemAesKey}, dataSize=${attachment.payload.dataLen}`)
            const response = await toolsApi.CdnDownloadRecordItem({
                CdnDataKey: recordItemAesKey,
                CdnDataUrl: attachment.payload.fileNo,
                DataId: attachment.id,
                DataSize: attachment.payload.dataLen || 0,
                FullMd5: attachment.payload.fullMd5 || '',
                IsThumb: 0,
                Wxid: wxid
            })
            this.logger.info(`下载聊天记录图片附件(recorditem): message=${response.data?.Message}, success=${response.data?.Success}, dataKeys=${Object.keys(response.data?.Data || {}).join(',')}`)
            if (response.data?.Message === '成功' || response.data?.Success === true) {
                try {
                    return this.extractImageDownloadBuffer(response.data)
                } catch (e) {
                    this.logger.warn('聊天记录图片 recorditem CDN 返回成功但解析失败，尝试分片下载')
                }
            }

            return await this.downloadImageAttachmentChunks(attachment, wxid, storedMessage)
        }

        if (attachment.type === 'file') {
            return await this.downloadRecordItemFileAttachment(attachment, wxid)
        }

        return await this.downloadFileAttachmentChunks(attachment, wxid)
    }

    private extractImageDownloadBuffer(responseData: any): Buffer {
        const bufferSource = responseData?.Data?.Image?.Image ||
            responseData?.Data?.Image ||
            responseData?.Image?.Image ||
            responseData?.Image ||
            this.findDownloadBufferSource(responseData, ['Base64', 'base64', 'Buffer', 'buffer', 'Image', 'image'])
        const buffer = this.decodeDownloadBuffer(bufferSource)
        if (!buffer.length) {
            throw new Error(`Decoded image buffer is empty, sourceType=${typeof bufferSource}`)
        }
        this.logger.info(`聊天记录图片附件解析完成: size=${this.formatBytes(buffer.length)}`)
        return buffer
    }

    private async downloadRecordItemFileAttachment(attachment: ChatHistoryAttachment, wxid: string): Promise<Buffer> {
        const recordItemKey = attachment.payload.rawCdnDataKey || attachment.payload.cdnDataKey
        this.logger.info(`下载聊天记录文件附件(recorditem): cdnDataUrl=${String(attachment.payload.cdnDataUrl).slice(0, 60)}, aesKey=${attachment.payload.cdnDataKey}, rawKey=${attachment.payload.rawCdnDataKey}, usedKey=${recordItemKey}, dataSize=${attachment.payload.dataLen}`)
        const response = await toolsApi.CdnDownloadRecordItem({
            CdnDataKey: recordItemKey,
            CdnDataUrl: attachment.payload.cdnDataUrl,
            DataId: attachment.id,
            DataSize: attachment.payload.dataLen || 0,
            FullMd5: attachment.payload.fullMd5 || '',
            IsThumb: 0,
            Wxid: wxid
        })
        this.logger.info(`下载聊天记录文件附件(recorditem): message=${response.data?.Message}, success=${response.data?.Success}, dataKeys=${Object.keys(response.data?.Data || {}).join(',')}`)
        if (response.data?.Message === '成功' || response.data?.Success === true) {
            return this.extractImageDownloadBuffer(response.data)
        }
        return await this.downloadFileAttachmentChunks(attachment, wxid)
    }

    private async downloadFileAttachmentChunks(attachment: ChatHistoryAttachment, wxid: string): Promise<Buffer> {
        const totalSize = Number(attachment.payload.dataLen || 0)
        if (totalSize <= 0) {
            throw new Error(`Invalid attachment size for ${attachment.type}`)
        }

        const firstChunk = FileChunkHelper.getChunk(totalSize, 0)
        if (!firstChunk) {
            throw new Error('Invalid first file chunk')
        }

        this.logger.info(`下载聊天记录文件附件: size=${totalSize}, userName=${attachment.payload.userName}, attachId=${String(attachment.payload.attachId).slice(0, 80)}`)
        const firstResp = await this.retryDownload(() => toolsApi.DownloadFile({
            AppID: attachment.payload.appId,
            AttachId: attachment.payload.attachId,
            DataLen: totalSize,
            Section: firstChunk,
            UserName: attachment.payload.userName,
            Wxid: wxid
        }))

        const firstChunkData = this.extractChunkDownloadBuffer(firstResp.data)
        const downloadedLength = firstChunkData.length || firstChunkData.buffer.length
        const chunks = FileChunkHelper.calculateChunks(totalSize, downloadedLength)
        let completeBuffer = firstChunkData.buffer

        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i]
            const response = await this.retryDownload(() => toolsApi.DownloadFile({
                AppID: attachment.payload.appId,
                AttachId: attachment.payload.attachId,
                DataLen: totalSize,
                Section: chunk,
                UserName: attachment.payload.userName,
                Wxid: wxid,
            }))
            const chunkData = this.extractChunkDownloadBuffer(response.data)
            completeBuffer = Buffer.concat([completeBuffer, chunkData.buffer])
        }

        return completeBuffer
    }

    private async downloadImageAttachmentChunks(attachment: ChatHistoryAttachment, wxid: string, storedMessage: Message): Promise<Buffer> {
        const totalSize = Number(attachment.payload.dataLen || 0)
        const msgId = storedMessage.msgId
        const toWxidCandidates = [
            storedMessage.toWxid,
            storedMessage.wxSenderId,
            attachment.payload.toWxid,
            attachment.payload.userName
        ].filter(Boolean)
        const toWxidList = Array.from(new Set(toWxidCandidates))
        if (totalSize <= 0 || !msgId || toWxidList.length === 0) {
            throw new Error(`Invalid image download params: size=${totalSize}, msgId=${msgId}, toWxid=${toWxidList.join('|')}`)
        }

        const firstChunk = FileChunkHelper.getChunk(totalSize, 0)
        if (!firstChunk) {
            throw new Error('Invalid first image chunk')
        }

        let firstResp: any
        let selectedToWxid = ''
        let lastError: any
        for (const toWxid of toWxidList) {
            try {
                this.logger.info(`下载聊天记录图片分片: size=${totalSize}, msgId=${msgId}, toWxid=${toWxid}`)
                firstResp = await this.retryDownload(() => toolsApi.DownloadImg({
                    CompressType: 0,
                    DataLen: totalSize,
                    MsgId: Number(msgId),
                    Section: firstChunk,
                    ToWxid: toWxid,
                    Wxid: wxid
                }))
                selectedToWxid = toWxid
                break
            } catch (error) {
                lastError = error
            }
        }

        if (!firstResp) {
            throw lastError || new Error('Image download failed')
        }

        const firstChunkData = this.extractChunkDownloadBuffer(firstResp.data)
        const downloadedLength = firstChunkData.length || firstChunkData.buffer.length
        const chunks = FileChunkHelper.calculateChunks(totalSize, downloadedLength)
        let completeBuffer = firstChunkData.buffer

        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i]
            const response = await this.retryDownload(() => toolsApi.DownloadImg({
                CompressType: 0,
                DataLen: totalSize,
                MsgId: Number(msgId),
                Section: chunk,
                ToWxid: selectedToWxid,
                Wxid: wxid
            }))
            const chunkData = this.extractChunkDownloadBuffer(response.data)
            completeBuffer = Buffer.concat([completeBuffer, chunkData.buffer])
        }

        return completeBuffer
    }

    private extractChunkDownloadBuffer(responseData: any): {buffer: Buffer, length: number} {
        const data = responseData?.Data ?? responseData?.data ?? responseData
        const bufferNode = data?.data ?? data
        const bufferSource = bufferNode?.buffer ?? bufferNode?.Buffer ?? data?.buffer ?? data?.Buffer
        const length = Number(bufferNode?.iLen ?? bufferNode?.ILen ?? data?.iLen ?? data?.ILen ?? 0)
        return {
            buffer: this.decodeDownloadBuffer(bufferSource),
            length
        }
    }

    private async retryDownload(downloadFn: () => any): Promise<any> {
        let lastError: any
        for (let i = 0; i < 3; i++) {
            try {
                const response = await downloadFn()
                if (response?.data?.Data?.BaseResponse?.ret === 0) {
                    return response
                }
                lastError = new Error(`Download failed with ret code: ${response?.data?.Data?.BaseResponse?.ret}, message=${this.getDownloadErrorMessage(response?.data)}`)
            } catch (error) {
                lastError = error
            }
            if (i < 2) {
                await new Promise(resolve => setTimeout(resolve, 1000))
            }
        }
        throw new Error(`Download failed after 3 attempts. Last error: ${lastError?.message}`)
    }

    private getDownloadErrorMessage(responseData: any): string {
        const errMsg = responseData?.Data?.BaseResponse?.errMsg?.string ||
            responseData?.Data?.BaseResponse?.errMsg ||
            responseData?.Message ||
            responseData?.message ||
            ''
        if (typeof errMsg === 'string') {
            return errMsg
        }
        try {
            return JSON.stringify(errMsg)
        } catch {
            return String(errMsg)
        }
    }

    private decodeDownloadBuffer(bufferSource: any): Buffer {
        if (Buffer.isBuffer(bufferSource)) {
            return bufferSource
        }

        if (Array.isArray(bufferSource)) {
            return Buffer.from(bufferSource)
        }

        if (typeof bufferSource === 'string') {
            const base64 = bufferSource.replace(/^data:[^;]+;base64,/, '')
            return Buffer.from(base64, 'base64')
        }

        throw new Error('Unsupported download response format')
    }

    private findDownloadBufferSource(value: any, preferredKeys: string[] = []): any {
        if (!value) {
            return undefined
        }

        if (Buffer.isBuffer(value) || Array.isArray(value) || typeof value === 'string') {
            return value
        }

        if (typeof value !== 'object') {
            return undefined
        }

        const fallbackKeys = ['Image', 'image', 'Buffer', 'buffer', 'FileData', 'fileData', 'Base64', 'base64']
        for (const key of [...preferredKeys, ...fallbackKeys]) {
            if (value[key]) {
                const candidate = this.findDownloadBufferSource(value[key])
                if (candidate) {
                    return candidate
                }
            }
        }

        for (const key of Object.keys(value)) {
            const candidate = this.findDownloadBufferSource(value[key])
            if (candidate) {
                return candidate
            }
        }

        return undefined
    }

    private async sendChatHistoryAttachment(chatId: number, fileBuffer: Buffer, attachment: ChatHistoryAttachment, replyToMessageId: number) {
        await this.sendWechatRetryFile(chatId, fileBuffer, {
            fileName: attachment.fileName,
            fileType: attachment.type === 'image' ? 'photo' : 'document',
            caption: attachment.type === 'image' ? undefined : attachment.title,
            replyToMessageId,
            useDedicatedUploadNotice: true
        })
    }

    private async retryWechatMediaDownload(ctx: Context, wxMsgId: string) {
        const storedMessage = await this.messageService.getByWxMsgId(wxMsgId)
        const callbackMessage = ctx.callbackQuery?.message
        const replyToMessageId = callbackMessage?.['message_id']
        if (!storedMessage || !storedMessage.source_text || !storedMessage.source_type) {
            await ctx.reply('原始消息记录不存在，无法重试下载')
            return
        }

        await this.editWechatMediaRetryMessage(ctx, '正在重试下载...')
        const wxMessage = this.buildWechatRetryMessage(storedMessage)
        try {
            const filebox = await wxMessage.toFileBox()
            if (!filebox) {
                throw new Error('下载结果为空')
            }

            const fileBuffer = await filebox.toBuffer()
            await this.sendWechatRetryFile(ctx.chat.id, fileBuffer, {
                fileName: filebox.name,
                fileType: this.wxTypeToTgFileType(storedMessage.source_type),
                caption: storedMessage.sender,
                replyToMessageId
            })
            await this.editWechatMediaRetryMessage(ctx, '重试下载成功，文件已发送', false)
        } catch (e) {
            await this.editWechatMediaRetryMessage(ctx, `${this.buildWechatRetryFallbackTitle(storedMessage)}\n重试下载失败: ${e?.message || e}`)
            throw e
        }
    }

    private buildWechatRetryMessage(storedMessage: Message): WxMessage {
        return new WxMessage({
            MsgId: Number(storedMessage.msgId || 0),
            FromUserName: storedMessage.wxSenderId || storedMessage.toWxid || '',
            ToUserName: storedMessage.toWxid || '',
            MsgType: Number(storedMessage.source_type),
            Content: storedMessage.source_text,
            CreateTime: storedMessage.createTime || Math.floor(Date.now() / 1000),
            NewMsgId: storedMessage.wxMsgId,
            xml: storedMessage.source_text
        } as any)
    }

    private async sendWechatRetryFile(chatId: number, fileBuffer: Buffer, options: {
        fileName: string
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
        caption?: string
        replyToMessageId?: number
        useDedicatedUploadNotice?: boolean
    }) {
        if (options.fileType === 'document' && fileBuffer.length > TELEGRAM_BOT_API_UPLOAD_LIMIT) {
            await this.sendLargeDocumentViaTelegramApi({
                id: `retry-${Date.now()}`,
                senderId: '',
                wxId: '',
                sender: options.caption || '',
                chatId,
                content: '',
                type: 1,
                file: {
                    fileName: options.fileName,
                    file: fileBuffer,
                    sendType: 'document'
                },
                param: options.replyToMessageId && !options.useDedicatedUploadNotice ? {
                    telegramUploadNoticeMessageId: options.replyToMessageId
                } : undefined
            })
            return
        }

        const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const sendOptions: any = {
            caption: options.caption,
            parse_mode: 'HTML'
        }
        if (options.replyToMessageId) {
            sendOptions.reply_parameters = {
                message_id: options.replyToMessageId
            }
        }

        if (options.fileType === 'photo') {
            await client.telegram.sendPhoto(chatId, {source: fileBuffer, filename: options.fileName}, sendOptions)
            return
        }
        if (options.fileType === 'video') {
            await client.telegram.sendVideo(chatId, {source: fileBuffer, filename: options.fileName}, sendOptions)
            return
        }
        if (options.fileType === 'voice') {
            await client.telegram.sendVoice(chatId, {source: fileBuffer, filename: options.fileName}, sendOptions)
            return
        }
        if (options.fileType === 'animation') {
            await client.telegram.sendAnimation(chatId, {source: fileBuffer, filename: options.fileName}, sendOptions)
            return
        }

        await client.telegram.sendDocument(chatId, {source: fileBuffer, filename: options.fileName}, sendOptions)
    }

    private async editWechatMediaRetryMessage(ctx: Context, text: string, keepRetryButton = true) {
        const callbackMessage = ctx.callbackQuery?.message
        const messageId = callbackMessage?.['message_id']
        if (!messageId) {
            return
        }

        const extra: any = keepRetryButton ? {
            reply_markup: callbackMessage?.['reply_markup']
        } : {
            reply_markup: undefined
        }
        await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, extra).catch(e => {
            if (!String(e?.message || e).includes('message is not modified')) {
                throw e
            }
        })
    }

    private buildWechatRetryFallbackTitle(storedMessage: Message): string {
        const typeName = MessageTypeUtils.getTypeName(storedMessage.source_type || '')
        return `[${typeName}]`
    }

    private wxTypeToTgFileType(wxType: string): 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice' {
        if (wxType === WxMessage.Type.Image.toString()) {
            return 'photo'
        }
        if (wxType === WxMessage.Type.Video.toString()) {
            return 'video'
        }
        if (wxType === WxMessage.Type.Voice.toString()) {
            return 'voice'
        }
        if (wxType === WxMessage.Type.Emoji.toString()) {
            return 'animation'
        }
        return 'document'
    }

    private createLargeFileProgressEditor(ctx: Context, fileName: string, totalSize?: number): LargeFileProgressEditor {
        const chatId = ctx.chat.id
        const messageId = ctx.message['message_id']
        const minEditInterval = 2500
        let lastText = ''
        let lastEditTime = 0
        let userbotDisabled = false
        let fallbackMessageId: number | undefined

        const editWithUserbot = async (text: string) => {
            const userClient = TelegramBotClient.getSpyClient('userMTPClient')
            if (!userClient?.hasLogin || !userClient?.client) {
                throw new Error('userbot not logged in')
            }

            const inputChat = await userClient.client.getInputEntity(chatId)
            await userClient.client.editMessage(inputChat, {
                message: messageId,
                text
            })
        }

        const editFallbackMessage = async (text: string, inlineKeyboard?: Array<{ text: string, callback_data: string }>) => {
            const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            if (fallbackMessageId) {
                await bot.telegram.editMessageText(chatId, fallbackMessageId, undefined, text, inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : undefined).catch(async e => {
                    if (!String(e?.message || e).includes('message is not modified')) {
                        throw e
                    }
                })
                return
            }

            const sent = await bot.telegram.sendMessage(chatId, text, {
                ...(inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : {}),
                reply_parameters: {
                    message_id: messageId
                }
            })
            fallbackMessageId = sent.message_id
        }

        return {
            update: async (text: string, force = false, inlineKeyboard) => {
                const now = Date.now()
                if (!force && text === lastText) {
                    return
                }
                if (!force && now - lastEditTime < minEditInterval) {
                    return
                }

                lastText = text
                lastEditTime = now

                if (!userbotDisabled) {
                    try {
                        await editWithUserbot(text)
                        return
                    } catch (e) {
                        userbotDisabled = true
                        this.logger.warn(`userbot 编辑大文件进度失败，降级为 bot 回复: messageId=${messageId}, fileName=${fileName}, totalSize=${totalSize ? this.formatBytes(totalSize) : 'unknown'}, error=${e?.message || e}`)
                    }
                }

                try {
                    await editFallbackMessage(text, inlineKeyboard)
                } catch (e) {
                    this.logger.warn(`bot 更新大文件进度失败: messageId=${messageId}, fileName=${fileName}, error=${e?.message || e}`)
                }
            }
        }
    }

    private async createTelegramUploadProgressEditor(chatId: number, fileName: string, totalSize?: number, existingMessageId?: number): Promise<LargeFileProgressEditor> {
        const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const messageId = existingMessageId ?? (await bot.telegram.sendMessage(chatId, fileName)).message_id
        let lastText = ''
        let lastEditTime = 0
        let retryAfterUntil = 0
        const minEditInterval = 5000

        return {
            update: async (text: string, force = false, inlineKeyboard) => {
                const now = Date.now()
                if (!force && now < retryAfterUntil) {
                    return
                }
                if (!force && text === lastText) {
                    return
                }
                if (!force && now - lastEditTime < minEditInterval) {
                    return
                }
                lastText = text
                lastEditTime = now
                await bot.telegram.editMessageText(chatId, messageId, undefined, text, inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : undefined).catch(e => {
                    const errorText = String(e?.message || e)
                    const retryAfterMatch = errorText.match(/retry after (\d+)/i)
                    if (retryAfterMatch) {
                        retryAfterUntil = Date.now() + Number(retryAfterMatch[1]) * 1000
                        return
                    }
                    if (!errorText.includes('message is not modified')) {
                        this.logger.warn(`更新 Telegram 上传进度失败: messageId=${messageId}, fileName=${fileName}, totalSize=${totalSize ? this.formatBytes(totalSize) : 'unknown'}, error=${e?.message || e}`)
                    }
                })
            }
        }
    }

    private formatTelegramUploadProgress(fileName: string, uploaded: number, totalSize: number): string {
        const percent = totalSize > 0 ? Math.min(100, Math.round(uploaded / totalSize * 100)) : 0
        return [
            '文件上传中',
            fileName,
            `${this.formatBytes(uploaded)} / ${this.formatBytes(totalSize)}`,
            `进度: ${percent}%`
        ].join('\n')
    }

    private formatLargeFileDownloadProgress(fileName: string, progress: LargeFileDownloadProgress): string {
        const totalText = progress.total ? this.formatBytes(progress.total) : 'unknown'
        const percentText = progress.total ? `${progress.percent}%` : 'unknown'
        return [
            '正在下载 Telegram 大文件...',
            fileName,
            `${this.formatBytes(progress.downloaded)} / ${totalText}`,
            `进度: ${percentText}`
        ].join('\n')
    }

    private getTelegramLargeFileCachePath(chatId: number, messageId: number, fileName: string): string {
        const cacheDir = path.join('save-files', 'tg-large-cache')
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, {recursive: true})
        }

        const safeFileName = path.basename(fileName || 'telegram-large-file').replace(/[^\w.\-()[\]\u4e00-\u9fa5]/g, '_')
        return path.join(cacheDir, `${chatId}_${messageId}_${safeFileName}`)
    }

    private readTelegramLargeFileCache(cachePath: string, expectedSize?: number): Buffer | undefined {
        if (!fs.existsSync(cachePath)) {
            return undefined
        }

        const stat = fs.statSync(cachePath)
        if (expectedSize && stat.size !== expectedSize) {
            this.logger.warn(`Telegram 大文件缓存大小不匹配，删除旧缓存: cachePath=${cachePath}, cacheSize=${stat.size}, expectedSize=${expectedSize}`)
            fs.unlinkSync(cachePath)
            return undefined
        }

        this.logger.info(`命中 Telegram 大文件缓存: cachePath=${cachePath}, size=${this.formatBytes(stat.size)}`)
        return fs.readFileSync(cachePath)
    }

    private writeTelegramLargeFileCache(cachePath: string, buffer: Buffer) {
        fs.writeFileSync(cachePath, buffer)
        this.logger.info(`Telegram 大文件已写入缓存: cachePath=${cachePath}, size=${this.formatBytes(buffer.length)}`)
    }

    private deleteTelegramLargeFileCache(cachePath: string) {
        if (!fs.existsSync(cachePath)) {
            return
        }

        fs.unlinkSync(cachePath)
        this.logger.info(`Telegram 大文件缓存已删除: cachePath=${cachePath}`)
    }

    private formatBytes(bytes: number): string {
        if (!bytes) {
            return '0B'
        }

        const units = ['B', 'KB', 'MB', 'GB']
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
        return `${(bytes / Math.pow(1024, index)).toFixed(2)}${units[index]}`
    }
}
