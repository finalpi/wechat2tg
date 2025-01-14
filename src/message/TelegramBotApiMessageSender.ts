import {MessageSender, Option, SendResult} from './MessageSender'
import {Telegraf, TelegramError} from 'telegraf'
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
        return new Promise<SendResult>((resolve, reject) => {
            this.sender.telegram.editMessageMedia(chatId, parseInt(msgId + ''), undefined, {
                type: file.fileType,
                media: {source: file.buff, filename: file.filename},
                caption: file.caption,
                parse_mode: option?.parse_mode
            }, {}).then(() => {
                resolve({message_id: msgId})
            }).catch(e => reject(e))
        })
    }

    editAudio(chatId: string | number, msgId: string | number, caption: string): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing')
        return new Promise<SendResult>((resolve, reject) => {
            this.sender.telegram.editMessageCaption(chatId, parseInt(msgId + ''), undefined, caption, {parse_mode: 'HTML'})
                .then(() => {
                resolve({message_id: msgId})
            }).catch(e => reject(e))
        })
    }

    deleteMessage(chatId: undefined | number, msgId: number) {
        this.sender.telegram.deleteMessage(chatId, msgId)
    }

    sendText(chatId: string | number, text: string, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'typing')
        const sendParam: tt.ExtraReplyMessage = {}
        return new Promise((resolve, reject) => {
            if (option) {
                if (option.reply_id) {
                    sendParam.reply_parameters = {
                        message_id: option.reply_id
                    }
                }
                if (option.parse_mode) {
                    sendParam.parse_mode = option.parse_mode
                }
            }
            this.sender.telegram.sendMessage(chatId, text, sendParam).then(res => {
                resolve({message_id: res.message_id})
            }).catch(e => {
                reject(e)
            })
        })
    }

    sendFile(chatId: string | number, file: {
        buff: Buffer,
        filename: string,
        caption?: string,
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult> {
        this.sendAction(Number(chatId), 'upload_document')
        const sendParam: tt.ExtraReplyMessage = {}
        if (option) {
            if (option.reply_id) {
                sendParam.reply_parameters = {
                    message_id: option.reply_id
                }
            }
            if (option.parse_mode) {
                sendParam.parse_mode = option.parse_mode
            }
        }
        if (file.fileType === 'photo' && file.buff.length > 5 * 1024 * 1024) {
            // 大于5mb采用document方式发送
            file.fileType = 'document'
        }
        return new Promise<SendResult>((resolve, reject) => {
            this.sender.telegram['send' + file.fileType.charAt(0).toUpperCase() + file.fileType.slice(1)](
                chatId, {source: file.buff, filename: file.filename}, {
                    caption: file.caption,
                    ...sendParam
                }).then((msg: { message_id: number }) => {
                resolve({message_id: msg.message_id})
            }).catch((e: TelegramError) => {
                reject(e)
            })
        })
    }
}