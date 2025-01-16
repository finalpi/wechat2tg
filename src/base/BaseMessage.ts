export default interface BaseMessage {
    id: number,
    content: string,
    // 发送者身份id，可能是 chatId 也可能是 wxId
    senderId: string,
    // 发送者描述
    sender: string,
    // 消息类型 0:文本消息，1:文件消息
    type: 0 | 1,
    file?: {
        fileName: string,
        file: Buffer
    }
    param?: any
}