import {File, MessageSender, Option, SendResult} from './MessageSender'
import {Telegraf} from 'telegraf'
import * as tt from 'telegraf/src/telegram-types'
import {MessageService} from '../service/MessageService'
import TelegramError from 'telegraf/src/core/network/error'

export class TelegramBotApiMessageSender implements MessageSender {
    private sender:Telegraf

    constructor(sender:Telegraf) {
        this.sender = sender
    }

    deleteMessage(chatId: undefined | number, msgId: number) {
        this.sender.telegram.deleteMessage(chatId,msgId)
    }

    sendText(chatId: string | number, text: string, option?: Option): Promise<SendResult> {
        const sendParam: tt.ExtraReplyMessage = {}
        return new Promise((resolve, reject) => {
            if (option){
                if (option.reply_id){
                    sendParam.reply_parameters = {
                        message_id: option.reply_id
                    }
                }
                if (option.parse_mode){
                    sendParam.parse_mode = option.parse_mode
                }
            }
            this.sender.telegram.sendMessage(chatId,text,sendParam).then(res=>{
                resolve({message_id: res.message_id})
            }).catch(e=>{
                reject(e)
            })
        })
    }
    sendFile(chatId: string | number, file: File, option?: Option): Promise<SendResult> {
        const sendParam: tt.ExtraReplyMessage = {}
        if (option){
            if (option.reply_id){
                sendParam.reply_parameters = {
                    message_id: option.reply_id
                }
            }
            if (option.parse_mode){
                sendParam.parse_mode = option.parse_mode
            }
        }
        return new Promise<SendResult>((resolve, reject) => {
            this.sender.telegram['send' + file.fileType.charAt(0).toUpperCase() + file.fileType.slice(1)](
                chatId, {source: file.buff, filename: file.filename}, {
                    caption: file.caption
                },sendParam).then((msg: { message_id: number }) => {
                resolve({message_id: msg.message_id})
            }).catch((e: TelegramError) => {
                reject(e)
            })
        })
    }
}