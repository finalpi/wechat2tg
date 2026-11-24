import {Api,utils} from 'telegram'
import type {TelegramClient} from 'telegram'

export interface EmojiHistoryMessage {
    botId:number
    chatId:number
    messageId:number
    senderId:number
    text:string
}

/** Read only the message already delivered by Bot API, using the same bot account. */
export async function readTelegramEmojiEntities(client:TelegramClient,expected:EmojiHistoryMessage) {
    if(!client.connected || ![expected.botId,expected.chatId,expected.messageId,expected.senderId].every(Number.isSafeInteger)
        || expected.botId <= 0 || !expected.chatId || expected.messageId <= 0 || !expected.senderId)return
    if((await client.getMe(true))?.userId?.toString() !== String(expected.botId))return
    const peer = await client.getInputEntity(expected.chatId)
    const [message] = await client.getMessages(peer,{ids:[expected.messageId]})
    if(!(message instanceof Api.Message) || message.noforwards || message.id !== expected.messageId
        || utils.getPeerId(message.peerId) !== String(expected.chatId) || message.senderId?.toString() !== String(expected.senderId)
        || message.message !== expected.text)return
    return message.entities
}

export class TelegramIngressEmojiHistory {
    private pending = false
    private nextAt = 0
    constructor(private now = Date.now,private timeout = 800) {}
    async lookup(client:TelegramClient,message:EmojiHistoryMessage) {
        if(this.pending || this.now() < this.nextAt)return {status:'limited' as const}
        this.pending = true
        this.nextAt = this.now() + 500
        let timer:NodeJS.Timeout
        const work = readTelegramEmojiEntities(client,message)
            .then(entities=>({status:'checked' as const,entities}),()=>({status:'unavailable' as const}))
            .finally(()=>{this.pending = false})
        try {
            return await Promise.race([work,new Promise<{status:'timeout'}>(resolve=>{
                timer = setTimeout(()=>resolve({status:'timeout'}),this.timeout)
            })])
        } finally {clearTimeout(timer)}
    }
}