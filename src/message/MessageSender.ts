export interface MessageSender {
    sendText(chatId: string|number,text: string,option?:Option): Promise<SendResult>
    sendFile(chatId: string|number,file: File,option?:Option): Promise<SendResult>
    deleteMessage(chatId: undefined|number,msgId: number)
}

export interface Option{
    reply_id?: number,
    // todo 暂未实现
    inline_keyboard?:InlineKeyboard[],
    parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML'
}

export interface File{
    buff: Buffer,
    filename:string,
    caption?:string,
    fileType: 'audio' | 'video' | 'document' | 'photo' | 'voice'
}

export interface InlineKeyboard{
    text: string,
    query: string,
}

export interface SendResult{
    message_id: string|number
}