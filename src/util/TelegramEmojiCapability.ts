import fs from 'node:fs'
import path from 'node:path'

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
const MAX_ENTRIES = 1000
const storageKey = /^(?:botApi|mtproto):(-?[1-9]\d{0,15})$/
const isEvidence = (state:unknown,reason:unknown):boolean=>state === 'supported' && (reason === 'confirmed' || reason === 'buttonConfirmed')
    || state === 'unsupported' && (reason === 'rejected' || reason === 'missingEntities' || reason === 'buttonMissing')
const expiry = (state:EmojiCapabilityState,checkedAt:number)=>checkedAt + (state === 'supported' ? SUPPORTED_TTL : UNSUPPORTED_TTL)

/** A successful private-chat test is evidence for that destination and transport. */
export class TelegramEmojiCapability {
    generation = 0
    private entries = new Map<string,EmojiCapabilitySnapshot>()
    private storage?:{file:string;botId:number;ownerId:number}
    private lastSavedAt = -Infinity
    constructor(private now = Date.now) {}
    clear(): void {
        this.entries.clear();this.storage = undefined;this.lastSavedAt = -Infinity;this.generation++
    }
    restore(file:string,botId:number,ownerId:number):void {
        this.clear()
        this.storage = {file,botId,ownerId}
        try {
            if(fs.statSync(file).size > 256 * 1024)return
            const stored = JSON.parse(fs.readFileSync(file,'utf8'))
            if(stored.version !== 1 || stored.botId !== botId || stored.ownerId !== ownerId || !Array.isArray(stored.entries))return
            const now = this.now()
            for(const value of stored.entries.slice(0,MAX_ENTRIES)) {
                const {key,state,reason,checkedAt} = value || {},match = typeof key === 'string' && storageKey.exec(key)
                if(!match || !Number.isSafeInteger(Number(match[1])) || !isEvidence(state,reason)
                    || !Number.isSafeInteger(checkedAt) || checkedAt < 0 || checkedAt > now)continue
                const expiresAt = expiry(state,checkedAt)
                if(expiresAt > now)this.entries.set(key,{state,reason,checkedAt,expiresAt})
            }
        } catch { /* Missing or invalid evidence is unknown, not a display-settings error. */ }
    }
    private persist():void {
        if(!this.storage)return
        const {file,botId,ownerId} = this.storage,now = this.now()
        const entries = [...this.entries].filter(([key,entry])=>storageKey.test(key) && isEvidence(entry.state,entry.reason) && entry.expiresAt > now)
            .map(([key,{state,reason,checkedAt}])=>({key,state,reason,checkedAt}))
        const temporary = `${file}.${process.pid}.tmp`
        try {
            fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
            fs.writeFileSync(temporary,JSON.stringify({version:1,botId,ownerId,entries}),{mode:0o600})
            fs.renameSync(temporary,file)
            this.lastSavedAt = now
        } catch { /* Keep live results even if private storage is unavailable. */ }
        finally {try {fs.unlinkSync(temporary)} catch { /* Renamed or not created. */ }}
    }
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
        const previous = this.entries.get(key)
        if (!previous && this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value)
        this.entries.set(key,{state,reason,checkedAt:now,expiresAt:state === 'unknown' ? null : expiry(state,now)})
        if(isEvidence(state,reason) && (previous?.state !== state || previous?.reason !== reason
            || previous.expiresAt <= now || now - this.lastSavedAt >= 60000))this.persist()
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