import {AutomationEvent,eventSchema} from './contracts'

// A live-only seam: no history imports, database UPDATE notifications, or HTTP
// test payloads can enter it. The application registers one trusted consumer.
let consumer:((event:AutomationEvent)=>Promise<void>) | undefined
export function listenAutomations(listener:(event:AutomationEvent)=>Promise<void>):()=>void {
    consumer = listener
    return ()=>{if(consumer === listener)consumer = undefined}
}
function publish(event:AutomationEvent) {
    const parsed = eventSchema.safeParse(event)
    if(parsed.success && consumer)void consumer(parsed.data).catch(()=>undefined)
}
export function nativeSolitaire(xml:string,accountId:string):{id?:string;joined:boolean} {
    const raw = xml.match(/<solitaire_info>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/solitaire_info>/i)?.[1] || ''
    const body = raw.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    // Only an explicit stable field in the solitaire envelope is acceptable.
    // Message IDs and titles change/repeat and are never a round identity.
    const envelope = body.split(/<content\b/i)[0]
    const id = envelope.match(/<(?:solitaire_id|solitaireid|solitaireId|id)>\s*(?:<!\[CDATA\[)?([a-zA-Z0-9_.:-]{1,160})(?:\]\]>)?\s*<\/(?:solitaire_id|solitaireid|solitaireId|id)>/)?.[1]
    const participants = [...body.matchAll(/<u>\s*(?:<!\[CDATA\[)?([^<]*?)(?:\]\]>)?\s*<\/u>/g)].map(m=>m[1])
    return {id,joined:participants.includes(accountId)}
}
export async function emitWechatAutomation(msg:any,accountId:string):Promise<void> {
    if(!consumer || !accountId || msg.self())return
    try {
        const room = await msg.room(),groupId = room?.chatroomId || [msg.fromId,msg.toId].find(v=>typeof v === 'string' && v.endsWith('@chatroom'))
        if(!groupId || !msg.newMsgId || !['text','solitaire'].includes(String(msg.type())))return
        const sender = await msg.from(),solitaire = msg.type() === 'solitaire'
        const native = solitaire ? nativeSolitaire(String(msg._xml || ''),accountId) : undefined
        // A native list already naming this account must not be joined again.
        if(native?.joined)return
        publish({id:String(msg.newMsgId),source:'wechat',accountId,groupId,type:solitaire ? 'solitaire.received' : 'message.received',text:String(msg.text() || '').slice(0,16000),sender:{id:String(sender?._wxid || msg.fromId),name:String(sender?.name?.() || '').slice(0,200)},timestamp:Number(msg._createTime ?? msg.date()) * 1000,self:false,...(solitaire ? {solitaire:{...(native?.id ? {id:native.id} : {}),title:String(msg.text() || '').slice(0,8000),messageId:String(msg.newMsgId)}} : {})})
    } catch { /* Optional automation capture must never break ordinary forwarding. */ }
}
export function emitTelegramAutomation(ctx:any) {
    if(!consumer)return
    const message = ctx.message,chat = ctx.chat,from = ctx.from
    if(!message || !['group','supergroup'].includes(chat?.type) || from?.is_bot || typeof message.text !== 'string' || !ctx.botInfo?.id)return
    publish({id:String(message.message_id),source:'telegram',accountId:String(ctx.botInfo.id),groupId:String(chat.id),...(message.message_thread_id ? {topicId:String(message.message_thread_id)} : {}),type:'message.received',text:message.text.slice(0,16000),sender:{id:String(from.id),name:String(from.first_name || '').slice(0,200)},timestamp:Number(message.date) * 1000,self:false})
}