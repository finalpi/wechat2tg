import {annotateTelegramRecall} from '../webui/telegram-recall'
import {Context, Markup, session, Telegraf} from 'telegraf'
import {config, useProxy} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import * as fs from 'node:fs'
import {AsyncLocalStorage} from 'node:async_hooks'
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
import {renderWechatCustomEmojiHtml, splitTelegramHtml} from '../util/WechatCustomEmoji'
import {Message} from '../entity/Message'
import {MessageService} from '../service/MessageService'
import {FileUtils, LargeFileDownloadProgress} from '../util/FileUtils'
import sharp from 'sharp'
import {ConverterHelper} from '../util/FfmpegUtils'
import * as path from 'node:path'
import TgCommandHelper from '../service/TelegramCommandHelper'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {WxContactRepository} from '../repository/WxContactRepository'
import {DirectoryKind, DirectoryPager, DirectoryScope, DirectoryState} from '../util/DirectoryPager'
import {createGroupMentionService} from '../webui/mentions'
import {answerDirectoryCallback, deliverDirectoryPage, isRichDirectoryMessage, replyDirectoryText} from '../util/DirectoryPageDelivery'
import {BindGroup} from '../entity/BindGroup'
import {WxRoomRepository} from '../repository/WxRoomRepository'
import {WeChatClient} from './WechatClient'
import {SpeechService} from '../service/SpeechService'
import {WxBot} from 'wx2tg-puppet'
import {Message as WxMessage} from 'wx2tg-puppet'
import {toolsApi} from 'wx2tg-puppet/dist/api/ToolsApi'
import {configService as wxConfigService} from 'wx2tg-puppet/dist/services/config.service'
import {FileChunkHelper} from 'wx2tg-puppet/dist/utils/FileChunkHelper'
import {MessageBufferService, MessageRetryResult} from '../util/MessageBufferService'
import {FileBox} from 'file-box'
import I18n from '../i18n'
import http from 'http'
import {LogUtils} from '../util/LogUtil'
import {ChatHistoryAttachment, getChatHistory, NestedChatHistory} from '../util/handleMsg'
import {MessageTypeUtils} from '../util/MessageTypeUtils'
import {normalizeEscapedTelegramCommandText} from '../util/TelegramTextUtils'
import {AiReplyService} from '../service/AiReplyService'
import {CustomFile} from 'telegram/client/uploads'
import {WebMessageStore} from '../webui/message-store'
import {telegramDeliveryUncertain} from '../webui/delivery'
import {Api} from 'telegram'
import {getTelegramThreadId, isSameTelegramDestination} from '../util/TelegramTopicUtils'
import {WechatAccountClassificationService} from '../service/WechatAccountClassificationService'
import {createGroupMemberNameResolver} from '../service/GroupMemberNameService'
import {sendSolitaireCreate, sendSolitaireJoin, solitaireCreateBody, solitaireJoinBody, solitaireJoins} from '../service/SolitaireService'

interface LargeFileProgressEditor {
    update(text: string, force?: boolean, inlineKeyboard?: Array<{ text: string, callback_data: string }>): Promise<void>
}

const TELEGRAM_BOT_API_UPLOAD_LIMIT = 50 * 1024 * 1024
const TELEGRAM_BOT_API_DOWNLOAD_LIMIT = 20 * 1024 * 1024
const TELEGRAM_MT_UPLOAD_TIMEOUT_MS = 180_000
const TELEGRAM_GLOBAL_SEND_INTERVAL_MS = 100
const TELEGRAM_PRIVATE_CHAT_SEND_INTERVAL_MS = 1100
const TELEGRAM_GROUP_CHAT_SEND_INTERVAL_MS = 3200
const TELEGRAM_RETRY_AFTER_MARGIN_MS = 1000

type FileSendResult = {
    success: boolean
    skipRetry?: boolean
}

type TelegramSendResult = MessageRetryResult & {
    deliveryUncertain?:boolean
    skipRetry?: boolean
}

interface TelegramSendAttempt {
    retryAfterMs?: number
    deliveryUncertain: boolean
}

interface QueuedTelegramMessage {
    webui?: boolean
    message: BaseMessage
    messageId: string
    isRetry: boolean
    resolve?: (result: TelegramSendResult) => void
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
            const messageId = this.messageBufferService.addMessage(message)

            // 媒体与非媒体分别保持顺序，上传不会阻塞同一聊天的后续文本。
            this.enqueueTelegramMessage({message, messageId, isRetry: false})
            setTimeout(() => this.processingMessages.delete(existingMessageId), 30000)
            return true
        } catch (error) {
            this.logger.error('发送消息失败:', error)
            this.processingMessages.delete(existingMessageId)
            return false
        }
    }

    private enqueueTelegramMessage(item: QueuedTelegramMessage): void {
        this.telegramMessageQueue.push(item)
        // Media stays ordered without holding up later text in the same chat.
        const chatKey = `${item.message.chatId ?? 0}:${item.message.type === 1 ? 'media' : 'message'}`
        const previous = this.chatLanes.get(chatKey) ?? Promise.resolve()
        const lane = previous.then(() => this.runQueuedTelegramItem(item)).catch(() => undefined)
        this.chatLanes.set(chatKey, lane)
        void lane.finally(() => {
            const index = this.telegramMessageQueue.indexOf(item)
            if (index >= 0) this.telegramMessageQueue.splice(index, 1)
            if (this.chatLanes.get(chatKey) === lane) this.chatLanes.delete(chatKey)
        })
    }
    public mirrorWebUI(message:BaseMessage):Promise<TelegramSendResult> {
        return new Promise(resolve=>this.enqueueTelegramMessage({message,messageId:`webui:${message.id}`,isRetry:true,webui:true,resolve}))
    }
    public isWebUISyncActive(wxMsgId:string) {
        return this.activeWebUISync.has(wxMsgId) || this.telegramMessageQueue.some(item=>item.message.id === wxMsgId) || this.messageBufferService.hasScheduledMessage(wxMsgId)
    }

    private enqueueTelegramRetry(message: BaseMessage, messageId: string): Promise<TelegramSendResult> {
        return new Promise(resolve => {
            this.enqueueTelegramMessage({message, messageId, isRetry: true, resolve})
        })
    }

    /** Sends one queued item with state isolated from all other active lanes. */
    private async runQueuedTelegramItem(item: QueuedTelegramMessage): Promise<void> {
        // Lazy initialization also supports clients created from the prototype in tests.
        this.telegramSendAttempt ??= new AsyncLocalStorage<TelegramSendAttempt>()
        const attempt: TelegramSendAttempt = {deliveryUncertain: false}
        await this.telegramSendAttempt.run(attempt, async () => {
            this.activeWebUISync.add(item.message.id)
            if(process.env.WEBUI_ENABLED !== 'false')await WebMessageStore.getInstance().setTelegramStatus(item.message.id,'syncing').catch(() => undefined)
            let result: TelegramSendResult
            try {
                result = await this.sendBufferedMessage(item.message)
            } catch (error) {
                this.logger.error(`Telegram 队列发送失败: ${item.message.id}`, error)
                result = {success: false}
            }

            const retryAfterMs = Math.max(result.retryAfterMs || 0, attempt.retryAfterMs || 0) || undefined
            const deliveryUncertain = Boolean(attempt.deliveryUncertain || result.skipRetry || result.deliveryUncertain)
            this.activeWebUISync.delete(item.message.id)
            if(process.env.WEBUI_ENABLED !== 'false')await WebMessageStore.getInstance().setTelegramStatus(item.message.id,deliveryUncertain ? 'unknown' : result.success ? 'synced' : 'failed').catch(() => undefined)
            result = {...result, retryAfterMs, deliveryUncertain}

            if (item.isRetry) {
                // The buffer only understands success/failure: terminal uncertainty must
                // stop its retry chain, while WebUI still receives the actual outcome.
                item.resolve?.(item.webui ? result : result.skipRetry || deliveryUncertain ? {...result, success: true} : result)
                return
            }

            if (result.success || result.skipRetry || deliveryUncertain) {
                this.messageBufferService.markMessageAsSent(item.messageId)
            } else {
                this.messageBufferService.markMessageAsFailed(
                    item.messageId,
                    message => this.enqueueTelegramRetry(message, item.messageId),
                    false,
                    retryAfterMs
                )
            }
        })
    }

    private async sendBufferedMessage(message: BaseMessage): Promise<TelegramSendResult> {
        if (message.type !== 6 && message.chatId && (!message.threadId || message.threadId === 1)
            && await this.bindGroupService.isManagedForum(message.chatId)) return {success: false}
        if (message.type === 0) {
            return {success: await this.sendTextMsgSynchronously(message)}
        }

        const messageEntity = this.createMessageEntity(message)
        await this.messageService.createOrUpdate(messageEntity)

        if (message.type === 1) {
            return this.sendFileMessage(message, messageEntity)
        }
        if (message.type === 4) {
            return {success: await this.sendBusinessCardMessage(message, messageEntity)}
        }
        if (message.type === 5) {
            return {success: await this.sendLocationMessage(message, messageEntity)}
        }
        if (message.type === 6) {
            return {success: await this.sendRevokeMessage(message, messageEntity)}
        }

        return {success: true}
    }

    private async sendTelegramRequest<T>(chatId: number, request: () => Promise<T>): Promise<T> {
        await this.waitForTelegramSendSlot(chatId)
        try {
            return await request()
        } catch (error) {
            this.recordTelegramRetryAfter(error)
            if(telegramDeliveryUncertain(error))this.currentDeliveryUncertain = true
            throw error
        }
    }

    private recordTelegramRetryAfter(error: any): {seconds: number, waitMs: number} | undefined {
        const retryAfterMatch = String(error?.message || '').match(/retry after (\d+)/i)
        const errorCode = Number(error?.response?.error_code || error?.error_code || 0)
        const rawRetryAfter = error?.response?.parameters?.retry_after
            ?? error?.parameters?.retry_after
            ?? error?.seconds
            ?? retryAfterMatch?.[1]

        if (errorCode !== 429 && rawRetryAfter === undefined) {
            return undefined
        }

        const retryAfterValue = Number(rawRetryAfter || 20)
        const seconds = Number.isFinite(retryAfterValue) && retryAfterValue > 0
            ? Math.ceil(retryAfterValue)
            : 20
        const waitMs = seconds * 1000 + TELEGRAM_RETRY_AFTER_MARGIN_MS
        const attempt = this.telegramSendAttempt?.getStore()
        if (attempt) attempt.retryAfterMs = Math.max(attempt.retryAfterMs || 0, waitMs)
        this.telegramQueueBlockedUntil = Math.max(this.telegramQueueBlockedUntil, Date.now() + waitMs)
        return {seconds, waitMs}
    }

    private async waitForTelegramSendSlot(chatId: number): Promise<void> {
        const chatKey = String(chatId)
        const chatInterval = chatId < 0
            ? TELEGRAM_GROUP_CHAT_SEND_INTERVAL_MS
            : TELEGRAM_PRIVATE_CHAT_SEND_INTERVAL_MS

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const now = Date.now()
            const nextAllowedAt = Math.max(
                this.telegramQueueBlockedUntil,
                this.telegramNextGlobalSendAt,
                this.telegramNextSendAtByChat.get(chatKey) || 0
            )
            const waitMs = nextAllowedAt - now
            if (waitMs <= 0) {
                break
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(waitMs, 60000)))
        }

        const now = Date.now()
        this.telegramNextGlobalSendAt = now + TELEGRAM_GLOBAL_SEND_INTERVAL_MS
        this.telegramNextSendAtByChat.set(chatKey, now + chatInterval)
    }

    private createMessageEntity(message: BaseMessage): Message {
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.threadId = message.threadId
        messageEntity.conversationWxId = message.conversationWxId
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
            // Transcription is network-bound: send the audio first and append the text
            // by editing the caption, so a slow ASR call cannot hold the chat lane.
            const shouldTranscribe = message.file.sendType === 'voice'
                && Boolean(config.TENCENT_SECRET_ID && config.TENCENT_SECRET_KEY && configuration.autoTranscript)

            const shouldUseTelegramApiForLargeFile = message.file.sendType === 'document' && message.file.file.length > TELEGRAM_BOT_API_UPLOAD_LIMIT
            const msgRes = shouldUseTelegramApiForLargeFile
                ? await this.sendLargeDocumentViaTelegramApi(message)
                : await this.sendTelegramRequest(message.chatId, () => this.messageSender.sendFile(message.chatId, {
                    buff: message.file.file,
                    filename: message.file.fileName,
                    fileType: message.file.sendType,
                    caption: message.sender
                }, {
                    parse_mode: 'HTML',
                    message_thread_id: message.threadId,
                    reply_id: message.param?.reply_id
                }))

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            if (shouldTranscribe) {
                // Detached edits are not part of the delivered audio's retry attempt.
                const append = () => this.appendTranscript(message, messageEntity.tgBotMsgId)
                void (this.telegramSendAttempt ? this.telegramSendAttempt.exit(append) : append())
            }
            return {success: true}
        } catch (e) {
            await this.dealException(e, message)
            if (e instanceof TelegramUploadResultUnknownError || e?.skipRetry) {
                return {success: false, skipRetry: true}
            }
            return {success: false}
        }
    }

    /** Runs after the audio is delivered; failure only leaves the caption unchanged. */
    private async appendTranscript(message: BaseMessage, messageId: number): Promise<void> {
        try {
            const text = await SpeechService.getInstance().getTranscript(message.file.file)
            if (!text) return
            this.logger.info('语音转文字转换成功文本内容：', text)
            await this.sendTelegramRequest(message.chatId, () => this.messageSender.editAudio(message.chatId, messageId, `${message.sender}\n${text}`))
        } catch (error) {
            this.logger.error('语音转文字失败:', error)
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
            || await this.sendTelegramFileNotice(message.chatId, fileName, message.threadId)
        const progressEditor = await this.createTelegramUploadProgressEditor(message.chatId, fileName, totalSize, progressNoticeMessageId, message.threadId)
        const uploadStartedAt = Date.now()
        await progressEditor.update(this.formatTelegramUploadProgress(fileName, 0, totalSize), true)

        try {
            const inputPeer = await botMTPClient.client.getInputEntity(message.chatId)
            const result = await this.sendTelegramRequest(message.chatId, () => this.runTelegramUploadWithTimeout(
                fileName,
                totalSize,
                async () => botMTPClient.client.sendFile(inputPeer, {
                    file: new CustomFile(fileName, totalSize, '', message.file.file),
                    caption: renderWechatCustomEmojiHtml(message.sender, config.WECHAT_CUSTOM_EMOJI_ENABLED, 1024),
                    replyTo: message.param?.reply_id ?? message.threadId,
                    topMsgId: message.threadId,
                    parseMode: 'html',
                    forceDocument: true,
                    workers: 3,
                    progressCallback: async (progress: number) => {
                        const uploaded = Math.max(0, Math.min(totalSize, Math.round(progress * totalSize)))
                        this.logger.info(`Telegram 大文件上传进度: fileName=${fileName}, uploaded=${this.formatBytes(uploaded)}, total=${this.formatBytes(totalSize)}, percent=${Math.min(100, Math.round(progress * 100))}%`)
                        await progressEditor.update(this.formatTelegramUploadProgress(fileName, uploaded, totalSize))
                    }
                })
            ))
            await this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
            setTimeout(() => {
                void this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
            }, 1500)
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
                uploadStartedAt,
                message.threadId
            )
            if (uploadedMessageId) {
                this.logger.info(`Telegram 大文件上传超时后确认已成功: fileName=${fileName}, tgMsgId=${uploadedMessageId}`)
                await this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
                setTimeout(() => {
                    void this.deleteTelegramMessage(message.chatId, progressNoticeMessageId)
                }, 1500)
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
        await this.sendTelegramRequest(chatId, () => bot.telegram.deleteMessage(chatId, messageId)).catch(() => undefined)
    }

    private async findRecentUploadedTelegramDocumentMessageId(
        botMTPClient: any,
        chatId: number,
        fileName: string,
        totalSize: number,
        uploadStartedAt: number,
        threadId?: number
    ): Promise<number | undefined> {
        try {
            const inputPeer = await botMTPClient.client.getInputEntity(chatId)
            const messages = await botMTPClient.client.getMessages(inputPeer, {limit: 10})
            for (const msg of messages || []) {
                if (getTelegramThreadId(msg) !== threadId) continue
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

    private async sendTelegramFileNotice(chatId: number, fileName: string, threadId?: number): Promise<number> {
        const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const sent = await this.sendTelegramRequest(chatId, () => bot.telegram.sendMessage(chatId, fileName, {message_thread_id: threadId}))
        return sent.message_id
    }

    private async sendBusinessCardMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            const msgRes = await this.sendTelegramRequest(message.chatId, () => client.telegram.sendPhoto(message.chatId, {source: message.file.file, filename: message.file.fileName}, {
                message_thread_id: message.threadId,
                caption: renderWechatCustomEmojiHtml(message.content, config.WECHAT_CUSTOM_EMOJI_ENABLED, 1024),
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback('添加为好友', `af:${message.businessCardId}`)]]
                },
            }))

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return true
        } catch (e) {
            await this.dealException(e, message)
            return false
        }
    }

    private async sendLocationMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            const msgJson = TelegramBotClient.getSpyClient('wxClient').client.Message.getXmlToJson(message.source_text)
            const msgRes = await this.sendTelegramRequest(message.chatId, () => client.telegram.sendLocation(message.chatId, parseFloat(msgJson.msg.location.x), parseFloat(msgJson.msg.location.y), {
                message_thread_id: message.threadId,
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback(msgJson.msg.location.poiname || msgJson.msg.location.label, 'null')]]
                }
            }))

            messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
            await this.messageService.createOrUpdate(messageEntity)
            return true
        } catch (e) {
            await this.dealException(e, message)
            return false
        }
    }

    private async sendRevokeMessage(message: BaseMessage, messageEntity: Message): Promise<boolean> {
        try {
            const revokeMsg = await this.messageService.getByWxMsgId(message.revokeMsgId)
            // Recall follows the original delivery, not today's routing or feature flag.
            const chatId = revokeMsg?.chatId || message.chatId
            const original = revokeMsg || {threadId: message.threadId}
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            await annotateTelegramRecall(WebMessageStore.getInstance(),client.telegram,message.wxId,String(message.revokeMsgId),chatId,original,'',message.content || '消息已撤回',action=>this.sendTelegramRequest(chatId,action))
            return true
        } catch (e) {
            await this.dealException(e, message)
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
    // 所有转发消息和重试共用同一发送队列
    private telegramMessageQueue: QueuedTelegramMessage[] = []
    /** Per-chat media/non-media serial lanes, sharing the same rate limiter. */
    private chatLanes = new Map<string, Promise<void>>()
    private activeWebUISync = new Set<string>()
    private isProcessingQueue = false
    private telegramQueueBlockedUntil = 0
    private telegramNextGlobalSendAt = 0
    private telegramNextSendAtByChat = new Map<string, number>()
    private telegramSendAttempt?: AsyncLocalStorage<TelegramSendAttempt>
    // Standalone callers/tests can send without a queued attempt. Queued sends
    // always read/write their async-local state, never this compatibility fallback.
    private standaloneDeliveryUncertain = false
    private get currentDeliveryUncertain(): boolean {
        return this.telegramSendAttempt?.getStore()?.deliveryUncertain ?? this.standaloneDeliveryUncertain ?? false
    }
    private set currentDeliveryUncertain(value: boolean) {
        const attempt = this.telegramSendAttempt?.getStore()
        if (attempt) attempt.deliveryUncertain = value
        else this.standaloneDeliveryUncertain = value
    }
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

            // SAFETY: Proxy agents implement Node's Agent contract; this bridges differing dependency type versions.
            const socksAgent = new SocksProxyAgent(info) as unknown as http.Agent
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const proxyUrl = `${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`
            // SAFETY: Proxy agents implement Node's Agent contract; this bridges differing dependency type versions.
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
            if (e.response.error_code === 403 && !message.threadId && !await this.bindGroupService.isManagedForum(message.chatId)) {
                this.bindGroupService.removeByChatIdOrWxId(message.chatId, message.senderId)
                const config = await this.configurationService.getConfig()
                message.chatId = config.botId
            }
            // Telegram Too Many Requests
            else if (e.response.error_code === 429) {
                const retryAfter = this.recordTelegramRetryAfter(e)
                this.logger.warn(`Telegram 429，暂停发送 ${retryAfter?.seconds || 20} 秒后从统一队列重试: ${message.id}`)
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

    private currentThread(ctx: Context): number | undefined {
        return getTelegramThreadId(ctx.message ?? ctx.callbackQuery?.message)
    }

    private belongsToContext(stored: Message | undefined, ctx: Context): boolean {
        return isSameTelegramDestination(stored, ctx.chat?.id, this.currentThread(ctx))
    }

    private async blockForumMutation(ctx: Context, directoryMarkup?: Parameters<typeof replyDirectoryText>[2]): Promise<boolean> {
        if (!await this.bindGroupService.isManagedForum(ctx.chat?.id)) return false
        const text = '公众号话题群不支持整群解绑、重绑、更新或退出。请在私聊中使用 /official。'
        if (directoryMarkup) await replyDirectoryText(ctx, text, directoryMarkup)
        else await ctx.reply(text, {message_thread_id: this.currentThread(ctx)})
        return true
    }

    private async ingressReply(ctx: Context): Promise<{replyMessageId: number} | undefined> {
        const replyId = ctx.message?.['reply_to_message']?.message_id
        if (!replyId) return undefined
        const stored = await this.messageService.getByBotMsgId(ctx.chat.id, replyId, this.currentThread(ctx))
        return this.belongsToContext(stored, ctx) ? {replyMessageId: replyId} : undefined
    }

    /** Owner-only: the group nickname is what WeChat shows in the solitaire list. */
    private async handleSolitaireJoin(ctx: Context, callback: string): Promise<void> {
        try {
            await ctx.answerCbQuery()
        } catch (error) {
            this.logger?.debug?.('Solitaire callback acknowledge failed', error?.code || error?.name)
        }
        const ownerId = ctx.from?.id
        const config = await this.configurationService.getConfig()
        if (!ownerId || ownerId !== config.chatId) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.owner_only'))
            return
        }
        const token = callback.slice(3)
        const target = solitaireJoins.resolve(token, ownerId)
        if (!target) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.expired'))
            return
        }
        const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
        if (!wxClient?.hasLogin) {
            await replyDirectoryText(ctx, this.i18n.t('login.please_login_wx'))
            return
        }
        try {
            this.groupMemberNames ??= createGroupMemberNameResolver(() => wxClient.wxInfo?.wxid || '')
            const fallback = wxClient.wxInfo?.nickName || target.selfId
            const name = await this.groupMemberNames(target.toWxid, target.selfId, fallback)
            if (typeof name !== 'string' || !name.trim()) {
                // Only a genuinely missing name is refused; a nickname that reads
                // "undefined" is real data and must stay joinable.
                this.logger?.warn('Solitaire join skipped: no usable WeChat name')
                await replyDirectoryText(ctx, this.i18n.t('solitaire.no_name'))
                return
            }
            const body = solitaireJoinBody({
                wxid: target.selfId, toWxid: target.toWxid, content: name,
                msgId: target.msgId, newMsgId: target.newMsgId,
            })
            const outcome = await sendSolitaireJoin(body)
            if (outcome.status === 'joined') {
                await this.sendSolitaireUpdate(ctx, target, outcome.title, outcome.newMsgId)
            } else if (outcome.status === 'rejected') {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.rejected', {reason: outcome.reason}))
            } else {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.unknown'))
            }
        } catch (error) {
            this.logger?.warn('Solitaire join unavailable', error?.message || error?.name)
            await replyDirectoryText(ctx, this.i18n.t('solitaire.unknown'))
        }
    }

    /** Sends the updated list as a fresh message with both join buttons. */
    private async sendSolitaireUpdate(ctx: Context, target: {toWxid: string, selfId: string}, title?: string, newMsgId?: string): Promise<void> {
        if (!title) return
        const ownerId = ctx.from?.id
        if (!ownerId) return
        try {
            const {joinToken, customToken} = solitaireJoins.register(ownerId, target.toWxid, target.selfId, newMsgId)
            const html = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
            const threadId = this.currentThread(ctx)
            await ctx.reply(html, {
                parse_mode: 'HTML',
                reply_markup: {inline_keyboard: [[
                    {text: this.i18n.t('solitaire.join_button'), callback_data: `sl:${joinToken}`},
                    {text: this.i18n.t('solitaire.custom_button'), callback_data: `slc:${customToken}`},
                ]]},
                ...(threadId ? {message_thread_id: threadId} : {}),
            })
        } catch (error) {
            this.logger?.warn('Solitaire update send failed', error?.code || error?.name)
        }
    }

    /** Resolves the newest solitaire for the bound WeChat conversation. */
    private async latestSolitaireTarget(ctx: Context, ownerId: number) {
        if (!ctx.chat?.type.includes('group')) return undefined
        const binding = await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))
        if (!binding?.wxId) return undefined
        return solitaireJoins.latest(ownerId, binding.wxId) || solitaireJoins.latest(ownerId, binding.wxId)
    }

    /** Asks for the entry text; the reply is the plain-text fallback for rich input. */
    private async handleSolitaireCustom(ctx: Context, callback: string): Promise<void> {
        try {
            await ctx.answerCbQuery()
        } catch (error) {
            this.logger?.debug?.('Solitaire custom acknowledge failed', error?.code || error?.name)
        }
        const ownerId = ctx.from?.id
        const config = await this.configurationService.getConfig()
        if (!ownerId || ownerId !== config.chatId) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.owner_only'))
            return
        }
        const target = solitaireJoins.resolve(callback.slice(4), ownerId)
        if (!target) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.expired'))
            return
        }
        solitaireJoins.setPending(ownerId, ctx.chat?.id, this.currentThread(ctx), target)
        await ctx.reply(this.i18n.t('solitaire.custom_prompt'), {
            reply_markup: {force_reply: true, selective: true},
            reply_parameters: ctx.callbackQuery?.message ? {message_id: ctx.callbackQuery.message.message_id} : undefined,
        })
    }

    /** Shared by the custom prompt and /join; content replaces the nickname entirely. */
    private async submitSolitaireContent(ctx: Context, target: {toWxid: string, selfId: string, msgId?: string, newMsgId?: string}, content: string): Promise<void> {
        const text = String(content ?? '').replace(/\r\n?/g, '\n').trim()
        if (!text) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.custom_empty'))
            return
        }
        const ownerId = ctx.from?.id
        if (!ownerId) return
        const config = await this.configurationService.getConfig()
        if (ownerId !== config.chatId) {
            await replyDirectoryText(ctx, this.i18n.t('solitaire.owner_only'))
            return
        }
        try {
            const body = solitaireJoinBody({wxid: target.selfId, toWxid: target.toWxid, content: text,
                msgId: target.msgId, newMsgId: target.newMsgId})
            const outcome = await sendSolitaireJoin(body)
            if (outcome.status === 'rejected') {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.rejected', {reason: outcome.reason}))
            } else if (outcome.status === 'unknown') {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.unknown'))
            } else {
                await this.sendSolitaireUpdate(ctx, target, outcome.title, outcome.newMsgId)
            }
        } catch (error) {
            this.logger?.warn('Solitaire custom join unavailable', error?.message || error?.name)
            await replyDirectoryText(ctx, this.i18n.t('solitaire.unknown'))
        }
    }

    private onBotAction(bot: Telegraf) {
        bot.action(/^dl:/, ctx => this.handleDirectoryCallback(ctx, ctx.match.input))
        bot.action(/^(?:us|of|ro):/, ctx => this.handleDirectoryCallback(ctx, ctx.match.input))
        bot.action(/^sl:/, ctx => this.handleSolitaireJoin(ctx, ctx.match.input))
        bot.action(/^slc:/, ctx => this.handleSolitaireCustom(ctx, ctx.match.input))

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
            const bindGroup = await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))
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
            const bindGroup = await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))
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
                const storedMessage = await this.messageService.getByBotMsgId(ctx.chat.id, Number(tgBotMsgId), this.currentThread(ctx))
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
                if (!this.belongsToContext(storedMessage, ctx) || !storedMessage?.source_text) {
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
                await this.sendChatHistoryAttachment(ctx.chat.id, fileBuffer, attachment, Number(replyToMessageId), storedMessage.threadId)
                await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => undefined)
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
                const storedMessage = await this.messageService.getByBotMsgId(ctx.chat.id, Number(tgBotMsgId), this.currentThread(ctx))
                if (!this.belongsToContext(storedMessage, ctx) || !storedMessage?.source_text) {
                    await ctx.reply('原始聊天记录已过期，无法下载附件')
                    return
                }

                const attachment = await this.findChatHistoryAttachment(storedMessage, nestedId, attachmentId)
                if (!attachment) {
                    await ctx.reply('没有找到这个附件')
                    return
                }
                const fileBuffer = await this.downloadChatHistoryAttachment(attachment, storedMessage)
                await this.sendChatHistoryAttachment(ctx.chat.id, fileBuffer, attachment, Number(tgBotMsgId), storedMessage.threadId)
                await ctx.telegram.deleteMessage(ctx.chat.id, statusMessage.message_id).catch(() => undefined)
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
            const exist = await this.bindGroupService.resolveTelegram(chatId, this.currentThread(ctx))
            // 处理等待用户输入的指令
            if (await this.dealWithCommand(ctx, rawText)) {
                return
            }
            if (!exist) {
                // 未绑定消息直接返回
                return
            }
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
                threadId: this.currentThread(ctx),
                conversationWxId: exist.wxId,
                content: text,
                type: 0
            }
            message.param = await this.ingressReply(ctx)
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
            const exist = await this.bindGroupService.resolveTelegram(chatId, this.currentThread(ctx))
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
            const exist = await this.bindGroupService.resolveTelegram(chatId, this.currentThread(ctx))
            if (!exist) return
            const baseMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                threadId: this.currentThread(ctx),
                conversationWxId: exist.wxId,
                param: await this.ingressReply(ctx),
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
        const exist = await this.bindGroupService.resolveTelegram(chatId, this.currentThread(ctx))
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
            threadId: this.currentThread(ctx),
            conversationWxId: exist.wxId,
            param: await this.ingressReply(ctx),
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
        if (ctx.text || ctx.message.caption) {
            const text = normalizeEscapedTelegramCommandText(ctx.text || ctx.message.caption)
            const textMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                threadId: this.currentThread(ctx),
                conversationWxId: exist.wxId,
                param: baseMessage.param,
                content: text,
                type: 0
            }
            TelegramBotClient.getSpyClient('wxClient').sendMessage(textMessage)
        }
    }

    private async getContactList(official: boolean, query = '') {
        const repository = WxContactRepository.getInstance()
        const contacts = query
            ? await repository.getByNickNameOrRemark(query)
            : await repository.getAll()
        const classified = await WechatAccountClassificationService.getInstance().classifyContacts(contacts || [])
        return {contacts: official ? classified.official : classified.contacts, unknown: classified.unknown.length}
    }

    private directoryPager?: DirectoryPager
    private directoryCallbacks?: Map<string, Promise<void>>
    private directoryPendingCallbacks?: Map<string, Promise<void>>
    private directoryMembers?: ReturnType<typeof createGroupMentionService>
    private groupMemberNames?: ReturnType<typeof createGroupMemberNameResolver>

    private getDirectoryMembers() {
        return this.directoryMembers ??= createGroupMentionService(() => {
            const client = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            return client?.hasLogin ? client.wxInfo?.wxid || '' : ''
        })
    }

    private getDirectoryPager(): DirectoryPager {
        return this.directoryPager ??= new DirectoryPager()
    }

    private directoryScope(ctx: Context): DirectoryScope {
        const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
        const account = wxClient?.wxInfo
        const threadId = this.currentThread(ctx)
        return {
            chatId: ctx.chat?.id,
            userId: ctx.from?.id,
            threadId: threadId && threadId > 1 ? threadId : undefined,
            accountId: account?.wxid || account?.['id']
        }
    }

    private async handleDirectoryCallback(ctx: Context, callback: string): Promise<void> {
        // Acknowledge before repositories or the per-message queue can block.
        const acknowledgement = answerDirectoryCallback(ctx)
        const scope = this.directoryScope(ctx)
        if (!Number.isSafeInteger(scope.chatId) || !Number.isSafeInteger(scope.userId) || scope.userId <= 0) {
            await acknowledgement
            return
        }
        const key = String(ctx.chat?.id) + ':' + ctx.callbackQuery?.message?.message_id
        const pending = this.directoryPendingCallbacks ??= new Map()
        const callbackKey = JSON.stringify([key, scope, callback])
        const existing = pending.get(callbackKey)
        if (existing) {
            await acknowledgement
            await existing
            return
        }
        if (pending.size >= 1024) {
            await acknowledgement
            await replyDirectoryText(ctx, this.i18n.t('pagination.unavailable'))
            return
        }
        const queues = this.directoryCallbacks ??= new Map()
        const previous = queues.get(key) ?? Promise.resolve()
        const operation = previous.then(async () => {
            await acknowledgement
            if (JSON.stringify(scope) !== JSON.stringify(this.directoryScope(ctx))) {
                await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                return
            }
            if (callback.startsWith('dl:')) {
                // Resolve inside the queue: ownership, account changes and expiry are checked at execution time.
                const resolved = this.getDirectoryPager().resolve(this.directoryScope(ctx), callback)
                if (!resolved) {
                    await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                    return
                }
                const {state} = resolved
                if (resolved.type === 'select') {
                    if (state.kind === 'gr') {
                        await this.showDirectoryPage(ctx, 'gm', '', 1, true, !isRichDirectoryMessage(ctx), {
                            roomId: resolved.item.action, parentToken: state.token
                        })
                    } else if (state.kind === 'ct' || state.kind === 'gm') {
                        await this.showContactDetails(ctx, state, resolved.item.action, resolved.item.remark)
                    } else {
                        await this.selectDirectoryItem(ctx, state.kind, resolved.item.action, state.token)
                    }
                } else {
                    let page = state.page
                    if (resolved.type === 'page') page = resolved.page
                    else if (resolved.type !== 'back' && resolved.type !== 'compat') page = 1
                    const compatibility = resolved.type === 'compat' || !isRichDirectoryMessage(ctx)
                    await this.showDirectoryPage(ctx, state.kind, resolved.type === 'all' ? '' : state.query, page, true, compatibility, state)
                }
                return
            }
            const legacy = /^(us|of|ro):(.+)$/.exec(callback)
            if (!legacy) {
                await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                return
            }
            const kind = legacy[1] as 'us' | 'of' | 'ro'
            if (legacy[2].startsWith('page-')) {
                const rawPage = legacy[2].slice(5)
                const page = /^-?\d+$/.test(rawPage) ? Number(rawPage) : NaN
                if (!Number.isSafeInteger(page)) {
                    await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                    return
                }
                await this.showDirectoryPage(ctx, kind, '', Math.max(1, page), true, true)
            } else if (/^[^:\s]+$/.test(legacy[2])) {
                await this.selectDirectoryItem(ctx, kind, legacy[2])
            } else {
                await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
            }
        }).catch(async error => {
            this.logger?.warn('Directory callback unavailable', error?.code || error?.name)
            await replyDirectoryText(ctx, this.i18n.t('pagination.unavailable'))
        })
        queues.set(key, operation)
        // Coalesce only overlapping clicks; a completed transient failure must
        // not permanently disable its button. Retrying later remains explicit.
        pending.set(callbackKey, operation)
        try {
            await operation
        } finally {
            if (queues.get(key) === operation) queues.delete(key)
            if (pending.get(callbackKey) === operation) pending.delete(callbackKey)
        }
    }

    private translateDirectory(key: string, params: Record<string, string | number> = {}): string {
        return this.i18n.t(key, Object.fromEntries(Object.entries(params).map(([name, value]) => [name, String(value)])))
    }

    private async showContactList(ctx: Context, query: string, official: boolean) {
        await this.showDirectoryPage(ctx, official ? 'of' : 'us', query, 1, false)
    }

    private async showDirectoryPage(ctx: Context, kind: DirectoryKind, query: string, page: number, edit: boolean, compatibility = false,
        context: {roomId?: string; parentToken?: string} = {}) {
        if (!TelegramBotClient.getSpyClient('wxClient')?.hasLogin) {
            await replyDirectoryText(ctx, this.i18n.t('login.please_login_wx'))
            return
        }
        try {
            const scope = this.directoryScope(ctx)
            let unknown = 0
            let notice: string | undefined
            let items: Array<{remark: string, action: string}>
            if (kind === 'gm') {
                if (!context.roomId) throw new Error('Missing member directory room')
                const members = await this.getDirectoryMembers().members(context.roomId)
                const contacts = await WxContactRepository.getInstance().getAll()
                const remarks = new Map(contacts.map(contact => [contact.userName, contact.remark]))
                const search = query.toLocaleLowerCase()
                items = members.filter(member => !query || [member.wxId, member.name, member.nickname, remarks.get(member.wxId)]
                    .some(value => value?.toLocaleLowerCase().includes(search)))
                    .map(member => ({remark: member.displayName || remarks.get(member.wxId) || member.name, action: member.wxId}))
                const rooms = await WxRoomRepository.getInstance().getAll()
                const room = rooms.find(row => row.chatroomId === context.roomId)
                notice = (room?.remark || room?.nickName || context.roomId) + '\n' + context.roomId
            } else if (kind === 'ro' || kind === 'gr') {
                const repository = WxRoomRepository.getInstance()
                const rooms = query ? await repository.getByNickNameOrRemark(query) : await repository.getAll()
                items = (rooms || []).map(room => ({remark: room.remark || room.nickName || room.chatroomId, action: room.chatroomId}))
            } else {
                const result = await this.getContactList(kind === 'of', query)
                unknown = result.unknown
                items = result.contacts.map(contact => ({remark: contact.remark || contact.nickName || contact.userName, action: contact.userName}))
            }
            if (JSON.stringify(scope) !== JSON.stringify(this.directoryScope(ctx))) {
                await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                return
            }
            const inGroup = ctx.chat?.type.includes('group')
            const labels = {
                ro: {bind: 'room.bind_group', create: 'room.create_wx_group', empty: 'room.no_groups'},
                of: {bind: 'official.bind_account', create: 'official.create_account_group', empty: 'official.no_accounts'},
                us: {bind: 'user.bind_contact', create: 'user.create_contact_group', empty: 'user.no_contacts'},
                ct: {bind: 'directory.contacts_prompt', create: 'directory.contacts_prompt', empty: 'user.no_contacts'},
                gr: {bind: 'directory.groups_prompt', create: 'directory.groups_prompt', empty: 'room.no_groups'},
                gm: {bind: 'directory.members_prompt', create: 'directory.members_prompt', empty: 'directory.no_members'}
            }[kind]
            const view = this.getDirectoryPager().render({
                scope, kind, query, page, items,
                roomId: context.roomId, parentToken: context.parentToken,
                prompt: this.i18n.t(inGroup ? labels.bind : labels.create),
                notice: notice || (unknown ? this.i18n.t('contact.classification_pending', {count: String(unknown)}) : undefined),
                emptyText: unknown ? '' : this.i18n.t(labels.empty)
            }, (key, params) => this.translateDirectory(key, params))
            await deliverDirectoryPage(ctx, view, edit, compatibility)
        } catch (error) {
            this.logger?.warn('Directory unavailable', error?.code || error?.name)
            await replyDirectoryText(ctx, this.i18n.t('pagination.unavailable'))
        }
    }

    private async showContactDetails(ctx: Context, state: DirectoryState, wxId: string, selectedName: string) {
        const markup = {inline_keyboard: [[this.getDirectoryPager().backButton(state.token,
            (key, params) => this.translateDirectory(key, params))]]}
        const reply = (text: string) => replyDirectoryText(ctx, text, markup)
        if (!TelegramBotClient.getSpyClient('wxClient')?.hasLogin) {
            await reply(this.i18n.t('login.please_login_wx'))
            return
        }
        const contact = await WxContactRepository.getInstance().getByUserName(wxId)
        if (!this.getDirectoryPager().resolve(this.directoryScope(ctx), 'dl:' + state.token + ':b')) {
            await reply(this.i18n.t('pagination.expired'))
            return
        }
        if (!contact && state.kind !== 'gm') {
            await reply(this.i18n.t('pagination.selection_unavailable'))
            return
        }
        const lines = [this.i18n.t('directory.detail_title')]
        const field = (key: string, value: unknown) => {
            if (typeof value !== 'string' || !value.trim()) return
            const clean = Array.from(value, char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char).join('').trim()
            const points = Array.from(clean)
            lines.push(this.i18n.t('directory.' + key) + '：' + (points.length > 200 ? points.slice(0, 199).join('') + '…' : clean))
        }
        field('wxid', wxId)
        if (state.kind === 'gm') field('group_nickname', selectedName)
        field('nickname', contact?.nickName)
        field('remark', contact?.remark)
        field('alias', contact?.alias)
        if (contact?.sex === 1 || contact?.sex === 2) {
            field('sex', this.i18n.t(contact.sex === 1 ? 'directory.male' : 'directory.female'))
        }
        field('region', [contact?.country, contact?.province, contact?.city].filter(Boolean).join(' / '))
        field('signature', contact?.signature)
        field('description', contact?.description)
        lines.push(this.i18n.t('directory.cache_notice'))
        await reply(lines.join('\n'))
    }

    private async selectDirectoryItem(ctx: Context, kind: 'us' | 'of' | 'ro', wxId: string, returnToken?: string) {
        const back = returnToken
            ? this.getDirectoryPager().backButton(returnToken, (key, params) => this.translateDirectory(key, params))
            : {text: this.i18n.t('pagination.back'), callback_data: kind + ':page-1'}
        const markup = {inline_keyboard: [[back]]}
        const reply = (text: string) => replyDirectoryText(ctx, text, markup)
        const scope = this.directoryScope(ctx)
        const isCurrent = () => JSON.stringify(scope) === JSON.stringify(this.directoryScope(ctx))
            && (!returnToken || this.getDirectoryPager().resolve(scope, 'dl:' + returnToken + ':b'))
        try {
            if (await this.blockForumMutation(ctx, markup)) return
            const wxClient = TelegramBotClient.getSpyClient('wxClient')
            if (!wxClient?.hasLogin) {
                await reply(this.i18n.t('login.please_login_wx'))
                return
            }
            const isRoom = kind === 'ro'
            const item = isRoom ? await wxClient.client.Room.find({id: wxId}) : await wxClient.client.Contact.find({id: wxId})
            if (!isCurrent()) {
                await reply(this.i18n.t('pagination.expired'))
                return
            }
            if (!item) {
                await reply(this.i18n.t('pagination.selection_unavailable'))
                return
            }
            const name = isRoom ? item.name : item.name()
            if (ctx.chat?.type.includes('group')) {
                await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, wxId)
                const group = new BindGroup()
                group.chatId = ctx.chat.id
                group.wxId = wxId
                group.type = isRoom ? 1 : 0
                group.name = name
                await this.bindGroupService.createOrUpdate(group)
                try {
                    await this.updateGroupByChatId(group.chatId)
                } catch (error) {
                    this.logger?.warn('Directory binding metadata update failed', error?.code || error?.name)
                }
                await reply(this.i18n.t('binding.success'))
                return
            }
            if (!isRoom) {
                let topic: BindGroup | undefined
                try {
                    topic = await this.bindGroupService.resolveWechat(wxId, name)
                } catch (error) {
                    this.logger?.warn('Contact destination is not ready', error?.code || error?.name)
                    await reply(this.i18n.t('official.destination_unavailable'))
                    return
                }
                if (topic?.threadId) {
                    await reply('https://t.me/c/' + String(topic.chatId).replace(/^-100/, '') + '/' + topic.threadId)
                    return
                }
            }
            const service = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
            let group = new BindGroup()
            group.wxId = wxId
            group.name = name
            group.type = isRoom ? 1 : 0
            const avatar = await item.avatar()
            group.avatarLink = isRoom ? avatar?.url : avatar
            if (!isRoom) {
                const alias = await item.alias()
                if (alias !== name) group.alias = alias
            }
            if (!isCurrent()) {
                await reply(this.i18n.t('pagination.expired'))
                return
            }
            // External creation is intentionally attempted once, even if its result is uncertain.
            group = await service.createGroup(group)
            if (!group?.chatId) {
                await reply(this.i18n.t('pagination.selection_unavailable'))
                return
            }
            const inviteLink = await ctx.telegram.exportChatInviteLink(group.chatId)
            await replyDirectoryText(ctx, this.i18n.t('group.create_success'), {
                inline_keyboard: [
                    ...(inviteLink ? [[{text: this.i18n.t('group.open'), url: inviteLink}]] : []),
                    [back]
                ]
            })
        } catch (error) {
            this.logger?.warn('Directory selection unavailable', error?.code || error?.name)
            await reply(this.i18n.t('pagination.selection_unavailable'))
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
            if (await this.blockForumMutation(ctx)) return
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
            if (await this.blockForumMutation(ctx)) return
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.updateGroupByChatId(ctx.chat.id)
            } else {
                return ctx.reply(this.i18n.t('update.group_only'))
            }
        })

        bot.command('unbind', async (ctx) => {
            if (await this.blockForumMutation(ctx)) return
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, undefined)
                ctx.reply(this.i18n.t('unbind.success'))
            } else {
                return ctx.reply(this.i18n.t('unbind.group_only'))
            }
        })

        bot.command('message', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindGroup = await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))
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
                const bindGroup = await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))
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

        // Initiate a solitaire in the bound WeChat group: /solitaire 标题 | 首条 | 尾注
        bot.command('solitaire', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient')?.hasLogin) {
                await replyDirectoryText(ctx, this.i18n.t('login.please_login_wx'))
                return
            }
            const payload = ctx.payload.trim()
            const [title, first, ...rest] = payload.split('|').map(part => part.trim())
            if (!title || !first) {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.create_usage'))
                return
            }
            const binding = ctx.chat?.type.includes('group')
                ? await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx)) : undefined
            if (!binding || binding.type !== 1 || !binding.wxId?.endsWith('@chatroom')) {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.create_group_only'))
                return
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            try {
                const body = solitaireCreateBody({
                    wxid: wxClient.wxInfo?.wxid || '', toWxid: binding.wxId,
                    title, content: first, tail: rest.join(' | ') || undefined,
                })
                const outcome = await sendSolitaireCreate(body)
                if (outcome.status === 'rejected') {
                    await replyDirectoryText(ctx, this.i18n.t('solitaire.rejected', {reason: outcome.reason}))
                } else if (outcome.status === 'unknown') {
                    await replyDirectoryText(ctx, this.i18n.t('solitaire.unknown'))
                } else {
                    await this.sendSolitaireUpdate(ctx, {toWxid: binding.wxId, selfId: wxClient.wxInfo?.wxid || ''}, outcome.title, outcome.newMsgId)
                }
            } catch (error) {
                this.logger?.warn('Solitaire create unavailable', error?.message || error?.name)
                await replyDirectoryText(ctx, this.i18n.t('solitaire.create_usage'))
            }
        })

        // Join with custom text: /join 2 份  (replaces the nickname entirely)
        bot.command('join', async ctx => {
            const ownerId = ctx.from?.id
            const config = await this.configurationService.getConfig()
            if (!ownerId || ownerId !== config.chatId) {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.owner_only'))
                return
            }
            const content = ctx.payload.trim()
            const threadId = this.currentThread(ctx)
            const target = solitaireJoins.takePending(ownerId, ctx.chat?.id, threadId)
                || await this.latestSolitaireTarget(ctx, ownerId)
            if (!target) {
                await replyDirectoryText(ctx, this.i18n.t('solitaire.no_target'))
                return
            }
            if (!content) {
                solitaireJoins.setPending(ownerId, ctx.chat?.id, threadId, target)
                await replyDirectoryText(ctx, this.i18n.t('solitaire.custom_prompt'))
                return
            }
            await this.submitSolitaireContent(ctx, target, content)
        })

        // Telegraf's payload already excludes /command@bot and preserves the full query.
        bot.command('user', ctx => this.showContactList(ctx, ctx.payload.trim(), false))
        bot.command('official', ctx => this.showContactList(ctx, ctx.payload.trim(), true))

        bot.command('room', ctx => this.showDirectoryPage(ctx, 'ro', ctx.payload.trim(), 1, false))

        // Read-only browsing never enters the existing bind/create selection path.
        bot.command('contacts', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient')?.hasLogin) {
                await replyDirectoryText(ctx, this.i18n.t('login.please_login_wx'))
                return
            }
            try {
                const scope = this.directoryScope(ctx)
                const query = ctx.payload.trim()
                const binding = !query && ctx.chat?.type.includes('group')
                    ? await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx)) : undefined
                if (JSON.stringify(scope) !== JSON.stringify(this.directoryScope(ctx))) {
                    await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                    return
                }
                if (binding?.type === 0 && binding.wxId && !binding.wxId.endsWith('@chatroom')) {
                    // Retain a scoped return route without loading or sending the full directory first.
                    const view = this.getDirectoryPager().render({
                        scope, kind: 'ct', query: '', page: 1,
                        items: [{remark: binding.name || binding.wxId, action: binding.wxId}],
                        prompt: '', emptyText: ''
                    }, (key, params) => this.translateDirectory(key, params))
                    await this.showContactDetails(ctx, view.state, binding.wxId, binding.name)
                } else {
                    await this.showDirectoryPage(ctx, 'ct', query, 1, false)
                }
            } catch (error) {
                this.logger?.warn('Contact details unavailable', error?.code || error?.name)
                await replyDirectoryText(ctx, this.i18n.t('pagination.unavailable'))
            }
        })
        bot.command('members', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient')?.hasLogin) {
                await replyDirectoryText(ctx, this.i18n.t('login.please_login_wx'))
                return
            }
            try {
                const scope = this.directoryScope(ctx)
                const query = ctx.payload.trim()
                const binding = !query && ctx.chat?.type.includes('group')
                    ? await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx)) : undefined
                if (JSON.stringify(scope) !== JSON.stringify(this.directoryScope(ctx))) {
                    await replyDirectoryText(ctx, this.i18n.t('pagination.expired'))
                    return
                }
                if (binding?.type === 1 && binding.wxId?.endsWith('@chatroom')) {
                    await this.showDirectoryPage(ctx, 'gm', '', 1, false, false, {roomId: binding.wxId})
                } else {
                    await this.showDirectoryPage(ctx, 'gr', query, 1, false)
                }
            } catch (error) {
                this.logger?.warn('Member directory unavailable', error?.code || error?.name)
                await replyDirectoryText(ctx, this.i18n.t('pagination.unavailable'))
            }
        })

        bot.command('revoke', async ctx => {
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            if (!replyMessageId) {
                return ctx.reply(this.i18n.t('revoke.reply_required'))
            }
            const msg = await this.messageService.getByBotMsgId(ctx.chat.id, replyMessageId, this.currentThread(ctx))
            if (!this.belongsToContext(msg, ctx)) {
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
        if (await this.bindGroupService.isManagedForum(chatId)) return
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
                    await telegramGroupOperateService.updateGroup(bindItem)
                }
            } else {
                const wxRoom = await TelegramBotClient.getSpyClient('wxClient').client.Room.find({id: bindItem.wxId})
                if (wxRoom) {
                    await wxRoom.sync()
                    bindItem.name = wxRoom.name
                    bindItem.alias = wxRoom.remark
                    const avatar = await wxRoom.avatar()
                    bindItem.avatarLink = avatar.url
                    await telegramGroupOperateService.updateGroup(bindItem)
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
        if (await this.bindGroupService.isManagedForum(ctx.chat?.id)
            && !await this.bindGroupService.resolveTelegram(ctx.chat.id, this.currentThread(ctx))) {
            await ctx.reply('请在有效的公众号话题中使用 /ai。', {message_thread_id: this.currentThread(ctx)})
            return
        }
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
            const recentMessages = await this.messageService.listRecentByChatId(ctx.chat.id, contextLimit * 3, this.currentThread(ctx))
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

    private async botLaunch(bot: Telegraf) {
        let retryCount = 0

        // bot.launch 会在 long polling 运行期间一直等待；运行中的短暂网络错误
        // 由 Telegraf 自身持续重试。这里负责覆盖首次启动时网络尚未恢复，
        // 以及 polling 意外退出的场景，不能因为有限次数重试耗尽而永久假活。
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                await bot.launch(() => {
                    this.isConnected = true
                    retryCount = 0
                    this.logger.info('Telegram API 连接成功，正在启动消息监听')

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
                this.logger.warn('Telegram Bot polling 已停止，准备重新启动')
            } catch (error) {
                this.logger.error(`Telegram Bot 启动或监听失败 (第 ${retryCount + 1} 次):`, error)
            }

            this.isConnected = false
            retryCount++

            const delay = Math.min(
                this.RECONNECT_BASE_DELAY * Math.pow(2, retryCount - 1),
                300000 // 最大 5 分钟，之后持续重试
            )
            this.logger.info(`${delay}ms 后重新启动 Telegram Bot（不会放弃重试）...`)
            await new Promise(resolve => setTimeout(resolve, delay))
        }
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
        // A pending custom-solitaire entry consumes the next plain text from the owner.
        const ownerId = ctx.from?.id
        if (ownerId && typeof text === 'string' && text.trim() && !text.trimStart().startsWith('/')) {
            const target = solitaireJoins.takePending(ownerId, ctx.chat?.id, this.currentThread(ctx))
            if (target) {
                await this.submitSolitaireContent(ctx, target, text)
                return true
            }
        }
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
            const bindGroup = await this.bindGroupService.resolveWechat(message.wxId, message.sender)
            if (!bindGroup) {
                this.logger.error(`文本消息发送失败: 未找到绑定群组 - wxId=${message.wxId}, msgId=${message.id}`)
                return false
            }
            targetChatId = bindGroup.chatId
            message.threadId = bindGroup.threadId
            message.conversationWxId = bindGroup.wxId
        }

        if (!targetChatId) {
            this.logger.error(`文本消息发送失败: chatId 无效 - wxId=${message.wxId}, msgId=${message.id}`)
            return false
        }

        message.chatId = targetChatId
        if ((!message.threadId || message.threadId === 1) && await this.bindGroupService.isManagedForum(targetChatId)) return false

        // 在这里进行格式化，如果格式化失败会抛出异常，在保存数据库之前被捕获
        let chunks: string[]
        try {
            const formatted = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, message.content, message.memberName)
            const html = renderWechatCustomEmojiHtml(formatted, config.WECHAT_CUSTOM_EMOJI_ENABLED)
            chunks = splitTelegramHtml(html, 4096)
            if (!chunks.length) chunks = [html]
        } catch (error) {
            this.logger.error(`文本消息格式化失败: ${message.id}`, error)
            return false
        }

        // 所有验证通过后，才保存到数据库
        const messageEntity = this.createMessageEntity(message)
        await this.messageService.createOrUpdate(messageEntity)
        this.logger.info(`开始发送文本消息: wxMsgId=${message.id}, chatId=${targetChatId}`)

        const option: Option = {
            message_thread_id: message.threadId,
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

        // Split the final rendered HTML, keeping tags balanced and emoji entities intact.
        // Await every part: a failed/uncertain send must not send later parts or restart the sequence.
        if (chunks.length > 1) this.logger.info(`长文本消息将分 ${chunks.length} 片发送: ${message.id}`)
        for (let i = 0; i < chunks.length; i++) {
            try {
                const sent = await this.sendTelegramRequest(targetChatId, () => this.messageSender.sendText(targetChatId, chunks[i], option))
                if (i === 0) newMsg = sent
            } catch (e) {
                this.logger.error(`文本消息发送失败 (分片${i + 1}/${chunks.length}): ${message.id} - ${e.message}`)
                this.logger.error(`错误详情: chatId=${targetChatId}, wxMsgId=${message.id}, error_code=${e.response?.error_code}, error=${e.code || e.name}`)
                await this.dealException(e, message)
                success = false
                break
            }
        }

        if(newMsg && !success)this.currentDeliveryUncertain = true
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
        await this.sendTelegramRequest(chatId, () => client.telegram.editMessageReplyMarkup(chatId, tgBotMsgId, undefined, {
            inline_keyboard: inlineKeyboard
        }))
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
        return attachment.type === 'image' ? '下载图片' : attachment.type === 'video' ? '下载视频' : '下载文件'
    }

    private async replyNestedChatHistory(ctx: Context, storedMessage: Message | undefined, replyToMessageId: number, nestedId: string) {
        if (!this.belongsToContext(storedMessage, ctx) || !storedMessage?.source_text) {
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
            message_thread_id: storedMessage.threadId,
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

        const html = renderWechatCustomEmojiHtml(nestedRecord.content, config.WECHAT_CUSTOM_EMOJI_ENABLED)
        for (const chunk of splitTelegramHtml(html, 4096)) {
            await ctx.reply(chunk, replyOptions)
        }
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

    public async downloadChatHistoryAttachment(attachment: ChatHistoryAttachment, storedMessage: Message): Promise<Buffer> {
        const wxConfig = await wxConfigService.get()
        const wxid = wxConfig?.wxid || ''
        if (attachment.type === 'video') {
            // Forwarded records have CDN credentials, not the ordinary video's
            // 32-bit MsgId. Download the full video with the server's type-4 path.
            const response = await toolsApi.CdnDownloadRecordItem({
                Wxid: wxid,
                CdnDataKey: attachment.payload.rawCdnDataKey,
                CdnDataUrl: attachment.payload.cdnDataUrl,
                DataId: attachment.payload.dataId || attachment.id,
                DataSize: attachment.payload.dataLen || 0,
                DataType: 4,
                IsThumb: 0,
                FullMd5: attachment.payload.fullMd5 || '',
                Diagnostic: false
            })
            if (response.data?.Success !== true || Number(response.data?.Code) !== 0) {
                throw new Error('聊天记录视频下载失败')
            }
            const buffer = this.extractImageDownloadBuffer(response.data)
            if (buffer.length < 12 || buffer.subarray(4, 8).toString() !== 'ftyp') {
                throw new Error('聊天记录视频返回格式不是 MP4')
            }
            return buffer
        }
        if (attachment.type === 'image') {
            const recordItemAesKey = attachment.payload.rawFileAesKey || attachment.payload.fileAesKey
            this.logger.info(`下载聊天记录图片附件(recorditem): dataSize=${attachment.payload.dataLen}`)
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
        this.logger.info(`下载聊天记录文件附件(recorditem): dataSize=${attachment.payload.dataLen}`)
        try {
            const response = await toolsApi.CdnDownloadRecordItem({
                CdnDataKey: recordItemKey,
                CdnDataUrl: attachment.payload.cdnDataUrl,
                DataId: attachment.id,
                DataSize: attachment.payload.dataLen || 0,
                DataType: 8,
                FullMd5: attachment.payload.fullMd5 || '',
                IsThumb: 0,
                Wxid: wxid
            })
            if (response.data?.Success === true && Number(response.data?.Code) === 0) {
                const buffer = this.extractImageDownloadBuffer(response.data)
                const expected = Number(attachment.payload.dataLen || 0)
                if (expected > 0 && buffer.length !== expected) throw new Error('聊天记录文件长度不一致')
                return buffer
            }
        } catch {
            // Do not log Axios request details: they contain CDN credentials.
        }
        this.logger.warn('聊天记录文件 CDN 下载未完成，尝试文件分片下载')
        return await this.downloadFileAttachmentChunks(attachment, wxid)
    }

    private async downloadFileAttachmentChunks(attachment: ChatHistoryAttachment, wxid: string): Promise<Buffer> {
        const totalSize = Number(attachment.payload.dataLen || 0)
        if (!Number.isSafeInteger(totalSize) || totalSize <= 0 || totalSize > 0xffffffff || !attachment.payload.attachId) {
            throw new Error('Invalid file attachment size or identifier')
        }
        this.logger.info(`下载聊天记录文件附件: size=${totalSize}`)
        return await toolsApi.DownloadFileBuffer({
            AppID: attachment.payload.appId,
            AttachId: attachment.payload.attachId,
            DataLen: totalSize,
            UserName: attachment.payload.userName,
            Wxid: wxid
        })
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

    private async sendChatHistoryAttachment(chatId: number, fileBuffer: Buffer, attachment: ChatHistoryAttachment, replyToMessageId: number, threadId?: number) {
        await this.sendWechatRetryFile(chatId, fileBuffer, {
            threadId,
            fileName: attachment.fileName,
            fileType: attachment.type === 'image' ? 'photo' : attachment.type === 'video' ? 'video' : 'document',
            caption: attachment.type === 'image' ? undefined : String(attachment.title ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            replyToMessageId,
            useDedicatedUploadNotice: true
        })
    }

    private async retryWechatMediaDownload(ctx: Context, wxMsgId: string) {
        const storedMessage = await this.messageService.getByWxMsgId(wxMsgId)
        const callbackMessage = ctx.callbackQuery?.message
        const replyToMessageId = callbackMessage?.['message_id']
        if (!this.belongsToContext(storedMessage, ctx) || !storedMessage.source_text || !storedMessage.source_type) {
            await ctx.reply('原始消息记录不存在，无法重试下载')
            return
        }

        await this.editWechatMediaRetryMessage(ctx, '正在重试下载...')
        try {
            const wxMessage = this.buildWechatRetryMessage(storedMessage)
            const filebox = await wxMessage.toFileBox()
            if (!filebox) {
                throw new Error('下载结果为空')
            }

            const fileBuffer = await filebox.toBuffer()
            await this.sendWechatRetryFile(storedMessage.chatId, fileBuffer, {
                threadId: storedMessage.threadId,
                conversationWxId: storedMessage.conversationWxId,
                fileName: filebox.name,
                fileType: this.wxTypeToTgFileType(wxMessage.type()),
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
        // Stored SDK types are names (e.g. "file"), while Message expects the
        // native MsgType. Numeric types from older saved messages remain valid.
        const mediaTypes: Record<string, number> = {
            [WxMessage.Type.File]: 49,
            [WxMessage.Type.Image]: 3,
            [WxMessage.Type.Video]: 43,
            [WxMessage.Type.Voice]: 34,
            [WxMessage.Type.Emoji]: 47
        }
        const storedType = String(storedMessage.source_type || '').trim()
        const nativeType = /^\d+$/.test(storedType) ? Number(storedType) : mediaTypes[storedType]
        if (!Number.isSafeInteger(nativeType) || nativeType <= 0) {
            throw new Error('原始消息类型不支持下载')
        }
        return new WxMessage({
            MsgId: Number(storedMessage.msgId || 0),
            FromUserName: storedMessage.wxSenderId || storedMessage.toWxid || '',
            ToUserName: storedMessage.toWxid || '',
            MsgType: nativeType,
            Content: storedMessage.source_text,
            CreateTime: storedMessage.createTime || Math.floor(Date.now() / 1000),
            NewMsgId: storedMessage.wxMsgId,
            xml: storedMessage.source_text
        } as any)
    }

    private async sendWechatRetryFile(chatId: number, fileBuffer: Buffer, options: {
        fileName: string
        threadId?: number
        conversationWxId?: string
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
                threadId: options.threadId,
                conversationWxId: options.conversationWxId,
                content: '',
                type: 1,
                file: {
                    fileName: options.fileName,
                    file: fileBuffer,
                    sendType: 'document'
                },
                param: {
                    reply_id: options.replyToMessageId,
                    telegramUploadNoticeMessageId: !options.useDedicatedUploadNotice ? options.replyToMessageId : undefined
                }
            })
            return
        }

        const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const sendOptions: any = {
            message_thread_id: options.threadId,
            caption: options.caption === undefined ? undefined : renderWechatCustomEmojiHtml(options.caption, config.WECHAT_CUSTOM_EMOJI_ENABLED, 1024),
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
            await this.sendTelegramRequest(chatId, () => userClient.client.editMessage(inputChat, {
                message: messageId,
                text
            }))
        }

        const editFallbackMessage = async (text: string, inlineKeyboard?: Array<{ text: string, callback_data: string }>) => {
            const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            if (fallbackMessageId) {
                await this.sendTelegramRequest(chatId, () => bot.telegram.editMessageText(chatId, fallbackMessageId, undefined, text, inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : undefined)).catch(async e => {
                    if (!String(e?.message || e).includes('message is not modified')) {
                        throw e
                    }
                })
                return
            }

            const sent = await this.sendTelegramRequest(chatId, () => bot.telegram.sendMessage(chatId, text, {
                message_thread_id: this.currentThread(ctx),
                ...(inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : {}),
                reply_parameters: {
                    message_id: messageId
                }
            }))
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

    private async createTelegramUploadProgressEditor(chatId: number, fileName: string, totalSize?: number, existingMessageId?: number, threadId?: number): Promise<LargeFileProgressEditor> {
        const bot = TelegramBotClient.getSpyClient('botClient').client as Telegraf
        const messageId = existingMessageId ?? (await this.sendTelegramRequest(chatId, () => bot.telegram.sendMessage(chatId, fileName, {message_thread_id: threadId}))).message_id
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
                await this.sendTelegramRequest(chatId, () => bot.telegram.editMessageText(chatId, messageId, undefined, text, inlineKeyboard ? {
                    reply_markup: {
                        inline_keyboard: [inlineKeyboard]
                    }
                } : undefined)).catch(e => {
                    const errorText = String(e?.message || e)
                    const retryAfterMatch = errorText.match(/retry after (\d+)/i)
                    if (retryAfterMatch) {
                        const retryAfter = this.recordTelegramRetryAfter(e)
                        retryAfterUntil = Date.now() + (retryAfter?.waitMs || Number(retryAfterMatch[1]) * 1000)
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