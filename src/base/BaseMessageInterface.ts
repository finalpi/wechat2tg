import {FileBox} from 'file-box'
import {MessageOption} from '../models/MessageOption'
import {TelegramMessage} from '../models/TelegramMessage'

export interface BaseMessageInterface{
    sendMessage(text:string,option?:MessageOption):TelegramMessage
    sendMessage(fileBox:FileBox,caption:string,option?:MessageOption):TelegramMessage
    editMessage(messageId: number,text:string,option?:MessageOption):TelegramMessage
    editMessage(messageId: number,fileBox?:FileBox,caption?:string,option?:MessageOption):TelegramMessage
    deleteMessage(messageId: number):TelegramMessage
    deleteMessage(messageId: number):TelegramMessage
}