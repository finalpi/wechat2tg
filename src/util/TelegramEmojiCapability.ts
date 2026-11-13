export type EmojiTransport = 'botApi' | 'mtproto'
export type EmojiCapabilityState = 'unknown' | 'supported' | 'unsupported'
export type EmojiCapabilityReason = 'notChecked' | 'confirmed' | 'buttonConfirmed' | 'buttonMissing' | 'missingEntities' | 'rejected' | 'requestFailed' | 'expired'
export interface EmojiCapabilitySnapshot {
    state: EmojiCapabilityState
    reason: EmojiCapabilityReason
    checkedAt: number | null
    expiresAt: number | null
}

const SUPPORTED_TTL = 24 * 60 * 60 * 1000
const UNSUPPORTED_TTL = 6 * 60 * 60 * 1000

/** A successful private-chat test is evidence for that destination and transport. */
export class TelegramEmojiCapability {
    generation = 0
    private entries = new Map<string,EmojiCapabilitySnapshot>()
    constructor(private now = Date.now) {}
    clear(): void {this.entries.clear();this.generation++}
    snapshot(chatId: string | number, transport: EmojiTransport = 'botApi'): EmojiCapabilitySnapshot {
        const entry = this.entries.get(`${transport}:${chatId}`)
        if (!entry) return {state:'unknown',reason:'notChecked',checkedAt:null,expiresAt:null}
        if (entry.expiresAt !== null && entry.expiresAt <= this.now()) return {...entry,state:'unknown',reason:'expired'}
        return {...entry}
    }
    record(chatId: string | number, state: EmojiCapabilityState, reason: EmojiCapabilityReason, transport: EmojiTransport = 'botApi'): void {
        const key = `${transport}:${chatId}`, now = this.now()
        // Transport errors do not discard still-valid, confirmed evidence.
        if (state === 'unknown' && this.snapshot(chatId,transport).state !== 'unknown') return
        if (!this.entries.has(key) && this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value)
        this.entries.set(key,{state,reason,checkedAt:now,expiresAt:state === 'unknown' ? null : now + (state === 'supported' ? SUPPORTED_TTL : UNSUPPORTED_TTL)})
    }
    observe(chatId: string | number, html: string, result: unknown, transport: EmojiTransport = 'botApi'): void {
        const expected = [...html.matchAll(/<tg-emoji\b[^>]*\bemoji-id=["'](\d+)["'][^>]*>/g)].map(match=>match[1])
        if (!expected.length || !result || typeof result !== 'object') return
        const message = result as {text?:string;caption?:string;message?:string;entities?:any[];caption_entities?:any[]}
        if (![message.text,message.caption,message.message].some(value=>typeof value === 'string')) return
        const entities = [...(message.entities || []),...(message.caption_entities || [])]
        const received = entities.filter(entity=>entity.type === 'custom_emoji' || entity.className === 'MessageEntityCustomEmoji')
            .map(entity=>String(entity.custom_emoji_id ?? entity.documentId ?? ''))
        const supported = expected.length === received.length && expected.every((id,index)=>id === received[index])
        this.record(chatId,supported ? 'supported' : 'unsupported',supported ? 'confirmed' : 'missingEntities',transport)
    }
    observeButton(chatId:number,iconId:string,result:unknown):boolean {
        const message = result as {message_id?:number;reply_markup?:{inline_keyboard?:{icon_custom_emoji_id?:string}[][]}}
        if(!Number.isSafeInteger(message?.message_id))return false
        const buttons = message.reply_markup?.inline_keyboard?.flat() || []
        const supported = buttons.some(button=>button.icon_custom_emoji_id === iconId)
        this.record(chatId,supported ? 'supported' : 'unsupported',supported ? 'buttonConfirmed' : 'buttonMissing')
        return true
    }
}
