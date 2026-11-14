import {MessageSender, Option, SendResult} from './MessageSender'
import {Telegraf, TelegramError} from 'telegraf'
import {config} from '../config'
import {sendTelegramHtml} from '../util/TelegramPresentation'
import {telegramCallbackButtons} from '../util/TelegramKeyboard'
import {prepareTelegramMedia} from '../util/TelegramMedia'
import AbortController from 'abort-controller'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as tt from 'telegraf/src/telegram-types'

export class TelegramBotApiMessageSender extends MessageSender {
    private sender: Telegraf

    constructor(sender: Telegraf) {
        super()
        this.sender = sender
    }

    editFile(chatId: string | number, msgId: string | number, file: {
        buff?: Buffer;
        filename?: string;
        caption?: string;
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video'
    }, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'upload_document')
        if (file.buff && file.fileType === 'photo' && file.buff.length > 5 * 1024 * 1024) {
            // 大于5mb采用document方式发送
            file.fileType = 'document'
        }
        const buttons = telegramCallbackButtons(option?.inline_keyboard)
        const extra = buttons.length ? {reply_markup:{inline_keyboard:[buttons]}} : {}
        return new Promise<SendResult>((resolve, reject) => {
            const send = (caption:string|undefined) => this.sender.telegram.editMessageMedia(chatId, parseInt(msgId + ''), undefined, {
                type: file.fileType,
                media: {source: file.buff, filename: file.filename},
                caption,
                parse_mode: option?.parse_mode
            }, extra)
            const pending = file.caption !== undefined && option?.parse_mode === 'HTML'
                ? sendTelegramHtml(chatId,file.caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,send,()=>true,'botApi',
                    (_message,caption)=>this.sender.telegram.editMessageCaption(chatId,parseInt(msgId + ''),undefined,caption,{parse_mode:option.parse_mode,...extra})) : send(file.caption)
            pending.then(() => {
                resolve({message_id: msgId})
            }).catch(e => reject(e))
        })
    }

    editAudio(chatId: string | number, msgId: string | number, caption: string): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing')
        return new Promise<SendResult>((resolve, reject) => {
            sendTelegramHtml(chatId,caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,
                html=>this.sender.telegram.editMessageCaption(chatId,parseInt(msgId + ''),undefined,html,{parse_mode:'HTML'}),()=>true,'botApi',
                (_message,html)=>this.sender.telegram.editMessageCaption(chatId,parseInt(msgId + ''),undefined,html,{parse_mode:'HTML'}))
                .then(() => {
                resolve({message_id: msgId})
            }).catch(e => reject(e))
        })
    }

    deleteMessage(chatId: undefined | number, msgId: number) {
        this.sender.telegram.deleteMessage(chatId, msgId)
    }

    sendText(chatId: string | number, text: string, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing', option?.message_thread_id)
        const sendParam: tt.ExtraReplyMessage = {}

        // 文本消息添加 30 秒超时控制
        const timeoutMs = 30000

        return new Promise((resolve, reject) => {
            if (option) {
                if (option.message_thread_id !== undefined) {
                    sendParam.message_thread_id = option.message_thread_id
                }
                if (option.reply_id) {
                    sendParam.reply_parameters = {
                        message_id: option.reply_id
                    }
                }
                if (option.parse_mode) {
                    sendParam.parse_mode = option.parse_mode
                }
                const buttons = telegramCallbackButtons(option.inline_keyboard)
                if (buttons.length) sendParam.reply_markup = {inline_keyboard: [buttons]}
            }

            // 创建超时定时器
            let timedOut = false
            const timeoutId = setTimeout(() => {
                timedOut = true
                reject(new Error(`Request timeout after ${timeoutMs}ms`))
            }, timeoutMs)
            const send = (html:string)=>this.sender.telegram.sendMessage(chatId,html,sendParam).then(message=>{clearTimeout(timeoutId);return message})
            const pending = option?.parse_mode === 'HTML'
                ? sendTelegramHtml(chatId,text,config.WECHAT_CUSTOM_EMOJI_ENABLED,4096,send,()=>!timedOut,'botApi',
                    (message,html)=>{
                        const extra:tt.ExtraEditMessageText = {parse_mode:'HTML'}
                        if(sendParam.reply_markup && 'inline_keyboard' in sendParam.reply_markup)extra.reply_markup = sendParam.reply_markup
                        return this.sender.telegram.editMessageText(chatId,message.message_id,undefined,html,extra)
                    }) : send(text)
            pending.then(res => {
                clearTimeout(timeoutId)
                resolve({message_id: res.message_id})
            }).catch(e => {
                clearTimeout(timeoutId)
                reject(e)
            })
        })
    }

    async sendFile(chatId: string | number, file: {
        buff: Buffer,
        filename: string,
        caption?: string,
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult> {
        file = await prepareTelegramMedia(file)
        this.sendAction(Number(chatId), 'upload_document', option?.message_thread_id)
        const sendParam: tt.ExtraReplyMessage = {}
        if (option) {
            if (option.message_thread_id !== undefined) {
                sendParam.message_thread_id = option.message_thread_id
            }
            if (option.reply_id) {
                sendParam.reply_parameters = {
                    message_id: option.reply_id
                }
            }
            if (option.parse_mode) {
                sendParam.parse_mode = option.parse_mode
            }
        }

        const buttons = telegramCallbackButtons(option?.inline_keyboard)
        const replyMarkup = buttons.length ? {inline_keyboard:[buttons]} : undefined
        if(replyMarkup)sendParam.reply_markup = replyMarkup
        const originalFileType = file.fileType

        if (file.fileType === 'photo' && file.buff.length > 5 * 1024 * 1024) {
            // 大于5mb采用document方式发送
            file.fileType = 'document'
        }

        return new Promise<SendResult>((resolve, reject) => {
            const abortController = new AbortController()
            let timeoutId: NodeJS.Timeout | undefined
            let settled = false

            if (originalFileType === 'photo') {
                timeoutId = setTimeout(() => {
                    settled = true
                    abortController.abort()
                    reject(new Error('Photo upload timeout after 30000ms'))
                }, 30000)
            }

            const mediaParamName = this.getTelegramMediaParamName(file.fileType)
            const send = (caption:string|undefined)=>this.sender.telegram.callApi(`send${file.fileType.charAt(0).toUpperCase()}${file.fileType.slice(1)}` as any, {
                chat_id: chatId,
                [mediaParamName]: {source: file.buff, filename: file.filename},
                caption,
                ...sendParam,
                // Pinned Telegraf serializes reply_markup in multipart, but not
                // the newer reply_parameters object. Encode it explicitly so
                // photo/media replies do not silently lose their target.
                ...(sendParam.reply_parameters ? {reply_parameters:JSON.stringify(sendParam.reply_parameters)} : {})
            }, {signal: abortController.signal}).then(message=>{if(timeoutId)clearTimeout(timeoutId);return message})
            const pending = file.caption !== undefined && option?.parse_mode === 'HTML'
                ? sendTelegramHtml(chatId,file.caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,send,()=>!settled,'botApi',
                    (message,caption)=>this.sender.telegram.editMessageCaption(chatId,message.message_id,undefined,caption,{parse_mode:'HTML',...(replyMarkup ? {reply_markup:replyMarkup} : {})})) : send(file.caption)
            pending.then((msg: { message_id: number }) => {
                settled = true
                if (timeoutId) clearTimeout(timeoutId)
                resolve({message_id: msg.message_id})
            }).catch((e: TelegramError) => {
                if (settled) {
                    return
                }
                if (timeoutId) clearTimeout(timeoutId)
                reject(e)
            })
        })
    }

    private getTelegramMediaParamName(fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'): string {
        return fileType
    }
}
