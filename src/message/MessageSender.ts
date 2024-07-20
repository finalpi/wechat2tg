import {TelegramBotClient} from '../client/TelegramBotClient'
import {ChatAction} from 'telegraf/types'

export abstract class MessageSender {
    abstract sendText(chatId: string | number, text: string, option?: Option): Promise<SendResult>

    abstract sendFile(chatId: string | number, file: {
        buff: Buffer,
        filename: string,
        caption?: string,
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult>

    abstract editFile(chatId: string | number, msgId: string | number, file: {
        buff?: Buffer,
        filename?: string,
        caption?: string,
        fileType: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    }, option?: Option): Promise<SendResult>

    abstract deleteMessage(chatId: undefined | number, msgId: number)

    sendAction(chatId: number, action: ChatAction) {
        TelegramBotClient.getInstance().bot.telegram.sendChatAction(chatId, action)
    }
}

export interface Option {
    reply_id?: number,
    // todo 暂未实现
    inline_keyboard?: InlineKeyboard[],
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML'
}

interface InlineKeyboard {
    text: string,
    query: string,
}

export interface SendResult {
    message_id: string | number
}