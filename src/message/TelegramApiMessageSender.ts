import {MessageSender, Option, SendResult} from './MessageSender'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import * as messageMethods from 'telegram/client/messages'
import * as uploadMethods from 'telegram/client/uploads'
import {CustomFile} from 'telegram/client/uploads'
import fs from 'node:fs'

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
                this.sender.editMessage(inputPeerChannelFromMessage, sendParam).then(res => {
                    if (tempFilePath) {
                        fs.rmSync('save-files/temp_file')
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
        this.sendAction(Number(chatId), 'typing')
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
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult> {
        const inputPeerChannelFromMessage = await this.sender.getInputEntity(chatId) || chatId
        this.sendAction(Number(chatId), 'upload_document')
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