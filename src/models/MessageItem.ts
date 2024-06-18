export interface MessageItem {
    wechat_message_id: string,
    chat_id: string,
    telegram_message_id: number,
    // 消息类型
    type: number,
    msg_text: string,
    // 发送者名字
    send_by: string,
    create_time: number
}