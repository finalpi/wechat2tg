import fs from 'node:fs'
import path from 'node:path'

export type TelegramDisplayMode = 'auto' | 'compatible' | 'enhanced'
export type DisplayFeature = 'customEmoji' | 'richMessage'
export const isDisplayMode = (value:unknown):value is TelegramDisplayMode => typeof value === 'string' && ['auto','compatible','enhanced'].includes(value)
const validId = (value:unknown):value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0
const PREMIUM_TTL = 24 * 60 * 60 * 1000
const REJECTION_TTL = 6 * 60 * 60 * 1000
interface Preferences {global?:TelegramDisplayMode;chats:Record<string,TelegramDisplayMode>}

/** Membership is evidence about the configured owner, never client-version detection.
 * Persistent preferences are isolated by BOTH bot and owner. Observations expire and
 * are deliberately memory-only, so a restart never trusts stale Premium entitlement. */
export class TelegramDisplayPolicy {
    private botId = 0
    private ownerId = 0
    private premium?:{value:boolean;at:number}
    private rejected = new Map<string,number>()
    private preferences:Preferences = {chats:{}}
    constructor(private file:string,private defaultMode:TelegramDisplayMode = 'auto',private now = Date.now) {}
    configure(botId:number,ownerId:number):void {
        if(!validId(botId) || botId < 0 || !validId(ownerId) || ownerId < 0){
            this.botId = 0;this.ownerId = 0;this.premium = undefined;this.rejected.clear();this.preferences = {chats:{}}
            return
        }
        if(this.botId === botId && this.ownerId === ownerId)return
        this.botId = botId;this.ownerId = ownerId;this.premium = undefined;this.rejected.clear();this.preferences = {chats:{}}
        if(!fs.existsSync(this.file))return
        // Invalid preferences fail closed to compatible instead of silently enabling rich output.
        try {
            const stat = fs.statSync(this.file)
            if(stat.size > 256 * 1024)throw new Error('displayPreferencesTooLarge')
            const data = JSON.parse(fs.readFileSync(this.file,'utf8'))
            if(data.version !== 1 || data.botId !== botId || data.ownerId !== ownerId)return
            if(data.global !== undefined && !isDisplayMode(data.global))throw new Error('invalidDisplayMode')
            const chats:Record<string,TelegramDisplayMode> = {}
            for(const [id,mode] of Object.entries(data.chats || {})){
                if(!/^-?[1-9]\d*$/.test(id) || !validId(Number(id)) || !isDisplayMode(mode))throw new Error('invalidDisplayChat')
                chats[id] = mode
            }
            this.preferences = {global:data.global,chats}
        } catch {this.preferences = {global:'compatible',chats:{}}}
    }
    observeOwner(user:{id:number;is_bot?:boolean;is_premium?:boolean}|undefined):void {
        if(!user || user.id !== this.ownerId || user.is_bot)return
        this.premium = {value:user.is_premium === true,at:this.now()}
    }
    ownerPremium():boolean|undefined {
        return this.premium && this.now() - this.premium.at < PREMIUM_TTL ? this.premium.value : undefined
    }
    mode(chatId?:number|string):TelegramDisplayMode {
        const key = String(chatId)
        return (Object.prototype.hasOwnProperty.call(this.preferences.chats,key) ? this.preferences.chats[key] : undefined) || this.preferences.global || this.defaultMode
    }
    allows(feature:DisplayFeature,chatId?:number|string):boolean {
        const mode = this.mode(chatId)
        if(mode === 'compatible' || (this.rejected.get(`${feature}:${chatId}`) || 0) > this.now())return false
        // Enhanced is an explicit opt-in, also supporting Fragment-authorized bots.
        // Auto is conservative until an authenticated owner update confirms Premium.
        return mode === 'enhanced' || this.ownerPremium() === true
    }
    reject(feature:DisplayFeature,chatId?:number|string):void {
        for(const [key,until] of this.rejected)if(until <= this.now())this.rejected.delete(key)
        if(this.rejected.size >= 1000)this.rejected.delete(this.rejected.keys().next().value)
        this.rejected.set(`${feature}:${chatId}`,this.now() + REJECTION_TTL)
    }
    setMode(mode:TelegramDisplayMode|'inherit',chatId?:number):void {
        if(!this.botId || !this.ownerId)throw new Error('displayOwnerUnavailable')
        if(mode !== 'inherit' && !isDisplayMode(mode))throw new Error('invalidDisplayMode')
        if(chatId !== undefined && !validId(chatId))throw new Error('invalidDisplayChat')
        const next:Preferences = {global:this.preferences.global,chats:{...this.preferences.chats}}
        if(chatId === undefined)next.global = mode === 'inherit' ? undefined : mode
        else if(mode === 'inherit')delete next.chats[String(chatId)]
        else next.chats[String(chatId)] = mode
        if(Object.keys(next.chats).length > 1000)throw new Error('tooManyDisplayChats')
        fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700})
        const temporary = `${this.file}.${process.pid}.tmp`
        try {
            fs.writeFileSync(temporary,JSON.stringify({version:1,botId:this.botId,ownerId:this.ownerId,...next}),{mode:0o600})
            fs.renameSync(temporary,this.file)
        } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
        this.preferences = next
    }
}

/** Only definitive API rejections qualify; never timeouts, 429, 5xx or generic 403. */
export function customEmojiRejected(error:unknown):boolean {
    const value = error as {response?:{error_code?:number;description?:string};errorMessage?:string;code?:number}
    const response = value?.response
    if(response?.error_code === 400 && typeof response.description === 'string'){
        return /CUSTOM_EMOJI_(?:INVALID|NOT_ALLOWED)|PREMIUM_ACCOUNT_REQUIRED|custom emoji.*(?:not allowed|not supported|premium|forbidden)|(?:premium|not allowed).*custom emoji/i.test(response.description)
    }
    return value?.code === 400 && /^(?:PREMIUM_ACCOUNT_REQUIRED|CUSTOM_EMOJI_NOT_ALLOWED|CUSTOM_EMOJI_INVALID)$/.test(value.errorMessage || '')
}