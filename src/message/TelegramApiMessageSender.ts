import {MessageSender, Option, SendResult} from './MessageSender'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import * as messageMethods from 'telegram/client/messages'
import * as uploadMethods from 'telegram/client/uploads'
import {CustomFile} from 'telegram/client/uploads'
import fs from 'node:fs'
import {Api} from 'telegram'
import {config} from '../config'
import {sendTelegramHtml} from '../util/TelegramPresentation'

export class TelegramApiMessageSender extends MessageSender {
    private sender: GramClient

    constructor(sender: GramClient) {
        super()
        this.sender = sender
    }

    async editFile(chatId: string | number, msgId: string | number, file: {
        buff?: Buffer;
        filename?: string;
        caption?: string;
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'upload_document')
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        return new Promise((resolve, reject) => {
            const sendParam: messageMethods.EditMessageParams = {
                message: parseInt(msgId + '')
            }
            if (option) {
                if (option.parse_mode) {
                    sendParam.parseMode = option.parse_mode.toLowerCase()
                }
                if (option.inline_keyboard) {
                    // Same normalisation as the Bot API sender: never emit an empty button.
                    const rows = option.inline_keyboard as any[]
                    const buttons = (Array.isArray(rows[0]) ? rows.flat() : rows)
                        .filter(button => button && typeof button.text === 'string' && button.text.trim()
                            && (button.callback_data || button.query))
                        .map(button => new Api.KeyboardButtonCallback({
                            text: button.text,
                            data: Buffer.from(button.callback_data || button.query)
                        }))
                    if (buttons.length) sendParam.buttons = [buttons]
                }
            }
            if (file.buff && file.fileType === 'photo' && file.buff.length > 5 * 1024 * 1024) {
                // 大于5mb采用document方式发送
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                sendParam.forceDocument = true
            }
            let tempFilePath = undefined
            if (file.buff) {
                tempFilePath = `save-files/${file.filename}`
                fs.writeFileSync(tempFilePath,file.buff)
                sendParam.file = new CustomFile(file.filename, file.buff.length, tempFilePath)
            }
            if (file.caption) {
                sendParam.text = file.caption
            }
            if (sendParam.message) {
                const pending = file.caption !== undefined && option?.parse_mode === 'HTML'
                    ? sendTelegramHtml(chatId,file.caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,
                        text=>this.sender.editMessage(inputPeerChannelFromMessage,{...sendParam,text}))
                    : this.sender.editMessage(inputPeerChannelFromMessage,sendParam)
                pending.then(res => {
                    if (tempFilePath) {
                        fs.rm(tempFilePath,err=>{
                            if (err){
                                console.log(`rm ${tempFilePath} error`)
                            }
                        })
                    }
                    resolve({
                        message_id: res.id
                    })
                }).catch(e => {
                    reject(e)
                })
            }
        })
    }

    async editAudio(chatId: string | number, msgId: string | number, caption: string): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing')
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        const sendParam: messageMethods.EditMessageParams = {
            message: parseInt(msgId + ''),
            text: caption,
            parseMode: 'html'
        }
        return new Promise((resolve, reject) => {
            sendTelegramHtml(chatId,caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,
                text=>this.sender.editMessage(inputPeerChannelFromMessage,{...sendParam,text})).then(res => {
                resolve({
                    message_id: res.id
                })
            }).catch(e => {
                reject(e)
            })
        })
    }

    async deleteMessage(chatId: undefined | number, msgId: number) {
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        await this.sender.deleteMessages(inputPeerChannelFromMessage, [msgId], {})
    }

    async sendText(chatId: string | number, text: string, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing', option?.message_thread_id)
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        return new Promise((resolve, reject) => {
            const sendParam: messageMethods.SendMessageParams = {
                message: text,
            }
            if (option) {
                if (option.message_thread_id !== undefined) {
                    sendParam.topMsgId = option.message_thread_id
                    // GramJS only constructs InputReplyToMessage when replyTo is set.
                    sendParam.replyTo = option.reply_id ?? option.message_thread_id
                } else if (option.reply_id) {
                    sendParam.replyTo = option.reply_id
                }
                if (option.parse_mode) {
                    sendParam.parseMode = option.parse_mode.toLowerCase()
                }
            }
            const pending = option?.parse_mode === 'HTML'
                ? sendTelegramHtml(chatId,text,config.WECHAT_CUSTOM_EMOJI_ENABLED,4096,
                    html=>this.sender.sendMessage(inputPeerChannelFromMessage,{...sendParam,message:html}))
                : this.sender.sendMessage(inputPeerChannelFromMessage,sendParam)
            pending.then(res => {
                resolve({
                    message_id: res.id
                })
            }).catch(e => {
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
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        this.sendAction(Number(chatId), 'upload_document', option?.message_thread_id)
        return new Promise((resolve, reject) => {
            const sendParam: uploadMethods.SendFileInterface = {
                workers: 3,
                file: new CustomFile(file.filename, file.buff.length, '', file.buff),
            }
            if (file.buff.length > 5 * 1024 * 1024) {
                // 大于5mb采用document方式发送
                sendParam.forceDocument = true
            }
            if (option) {
                if (option.message_thread_id !== undefined) {
                    sendParam.topMsgId = option.message_thread_id
                    // GramJS only constructs InputReplyToMessage when replyTo is set.
                    sendParam.replyTo = option.reply_id ?? option.message_thread_id
                } else if (option.reply_id) {
                    sendParam.replyTo = option.reply_id
                }
                if (option.parse_mode) {
                    sendParam.parseMode = option.parse_mode.toLowerCase()
                }
            }
            if (file.fileType === 'document') {
                sendParam.forceDocument = true
            }
            if (file.caption) {
                sendParam.caption = file.caption
            }
            const pending = file.caption !== undefined && option?.parse_mode === 'HTML'
                ? sendTelegramHtml(chatId,file.caption,config.WECHAT_CUSTOM_EMOJI_ENABLED,1024,
                    caption=>this.sender.sendFile(inputPeerChannelFromMessage,{...sendParam,caption}))
                : this.sender.sendFile(inputPeerChannelFromMessage,sendParam)
            pending.then(res => {
                resolve({
                    message_id: res.id
                })
            }).catch(e => {
                reject(e)
            })
        })
    }
}