export interface MessageItem {
    wechat_message_id: string,
    chat_id: string,
    telegram_message_id: number,
    // 消息类型
    type: number,
    msg_text: string,
    // 展示名字
    send_by: string,
    create_time: number,
    // telegram用户消息id
    telegram_user_message_id: number,
    // 发送者id
    sender_id: string,
}

export type MessageItemUpdate = {
    wechat_message_id?: string,
    chat_id?: string,
    telegram_message_id?: number,
    type?: number,
    msg_text?: string,
    send_by?: string,
    create_time?: number,
    telegram_user_message_id?: number,
    sender_id?: string,
}