import {MessageSender, Option, SendResult} from './MessageSender'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import * as messageMethods from 'telegram/client/messages'
import * as uploadMethods from 'telegram/client/uploads'
import {CustomFile} from 'telegram/client/uploads'

export class TelegramApiMessageSender implements MessageSender {
    private sender: GramClient

    constructor(sender: GramClient) {
        this.sender = sender
    }

    async editFile(chatId: string | number, msgId: string | number, file: {
        buff?: Buffer;
        filename?: string;
        caption?: string;
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video'
    }, option?: Option): Promise<SendResult> {
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        return new Promise((resolve, reject) => {
            const sendParam: messageMethods.EditMessageParams = {
                message: parseInt(msgId + '')
            }
            if (option) {
                if (option.parse_mode) {
                    sendParam.parseMode = option.parse_mode.toLowerCase()
                }
            }
            if (file.buff) {
                sendParam.file = new CustomFile(file.filename, file.buff.length, '', file.buff)
            }
            if (file.caption) {
                sendParam.text = file.caption
            }
            this.sender.editMessage(inputPeerChannelFromMessage, sendParam).then(res => {
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
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        return new Promise((resolve, reject) => {
            const sendParam: messageMethods.SendMessageParams = {
                message: text,
            }
            if (option) {
                if (option.reply_id) {
                    sendParam.replyTo = option.reply_id
                }
                if (option.parse_mode) {
                    sendParam.parseMode = option.parse_mode.toLowerCase()
                }
            }
            this.sender.sendMessage(inputPeerChannelFromMessage, sendParam).then(res => {
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
        fileType: 'audio' | 'video' | 'document' | 'photo' | 'voice'
    }, option?: Option): Promise<SendResult> {
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        return new Promise((resolve, reject) => {
            const sendParam: uploadMethods.SendFileInterface = {
                workers: 3,
                file: new CustomFile(file.filename, file.buff.length, '', file.buff),
            }
            if (option) {
                if (option.reply_id) {
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
            this.sender.sendFile(inputPeerChannelFromMessage, sendParam).then(res => {
                resolve({
                    message_id: res.id
                })
            }).catch(e => {
                reject(e)
            })
        })
    }
}