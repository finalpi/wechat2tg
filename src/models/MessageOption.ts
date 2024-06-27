import {InlineKeyboardButton} from '@telegraf/types/markup'

export interface MessageOption{
    // 发送消息的模式
    parse_mode?: string,
    // 引用消息的id
    reply_id?:number
    // 内联键盘
    inline_keyboard?: InlineKeyboardButton[][]
}