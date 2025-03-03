export default interface BaseMessage {
    id: string,
    chatId: number,
    content: string,
    // 发送者身份id
    senderId: string,
    wxId: string,
    // 发送者描述
    sender: string,
    // 消息类型 0:文本消息，1:文件消息, 2: 文件传输助手转发消息,3: 文件消息，4: 名片消息,5: 位置消息,6:撤回消息
    type: 0 | 1 | 2 | 3 | 4 | 5 | 6,
    // 文件传输助手的 msgId
    fhMsgId?: string,
    file?: {
        fileName: string,
        file: Buffer,
        // 发送的类型
        sendType?: 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'
    },
    // 名片微信id
    businessCardId?: string,
    param?: any,
    source_text?: string,
    source_type?: number,
    toWxid?: string,
    createTime?: number,
    msgId?: string,
    revokeMsgId?: string
}