import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {TelegramEmojiCapability, EmojiTransport} from './TelegramEmojiCapability'
import type {SettingsDatabase} from '../webui/settings-db'

export type TelegramDisplayMode = 'auto' | 'compatible' | 'enhanced'
export type DisplayFeature = 'customEmoji' | 'richMessage'
export const isDisplayMode = (value:unknown):value is TelegramDisplayMode => typeof value === 'string' && ['auto','compatible','enhanced'].includes(value)
const validId = (value:unknown):value is number => typeof value === 'number' && Number.isSafeInteger(value) && value !== 0
const PREMIUM_TTL = 24 * 60 * 60 * 1000
const REJECTION_TTL = 6 * 60 * 60 * 1000
interface Preferences {global?:TelegramDisplayMode;chats:Record<string,TelegramDisplayMode>}

/** Membership guides rich layouts; emoji capability is learned from real delivery.
 * Preferences and expiring emoji evidence are isolated by BOTH bot and owner.
 * Premium membership used for rich layouts is still kept only in memory. */
export class TelegramDisplayPolicy {
    prepareEmoji?: (chatId:number|string)=>Promise<boolean>
    readonly emoji: TelegramEmojiCapability
    private botId = 0
    private ownerId = 0
    private premium?:{value:boolean;at:number}
    private rejected = new Map<string,number>()
    private preferences:Preferences = {chats:{}}
    private queue = Promise.resolve()
    constructor(private file:string,private defaultMode:TelegramDisplayMode = 'auto',private now = Date.now,
        private database?:SettingsDatabase,private envMode?:TelegramDisplayMode) {this.emoji = new TelegramEmojiCapability(now)}
    private document(botId:number,ownerId:number) {return this.database?.document(`telegram-display:${botId}:${ownerId}`)}
    configure(botId:number,ownerId:number):void {
        if(!validId(botId) || botId < 0 || !validId(ownerId) || ownerId < 0){
            this.botId = 0;this.ownerId = 0;this.premium = undefined;this.rejected.clear();this.preferences = {chats:{}};this.emoji.clear()
            return
        }
        if(this.botId === botId && this.ownerId === ownerId)return
        this.botId = botId;this.ownerId = ownerId;this.premium = undefined;this.rejected.clear();this.preferences = {chats:{}}
        this.emoji.restore(path.join(path.dirname(this.file),`${path.basename(this.file,'.json')}-emoji.json`),botId,ownerId)
        // Invalid preferences fail closed to compatible instead of silently enabling rich output.
        try {
            let raw:string|undefined
            if(this.database)raw = this.document(botId,ownerId).read() ?? this.database.document('telegram-display-v1').read()
            else if(fs.existsSync(this.file)){
                if(fs.statSync(this.file).size > 256 * 1024)throw new Error('displayPreferencesTooLarge')
                raw = fs.readFileSync(this.file,'utf8')
            }
            if(raw === undefined)return
            const data = JSON.parse(raw)
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
        return (Object.prototype.hasOwnProperty.call(this.preferences.chats,key) ? this.preferences.chats[key] : undefined) || this.envMode || this.preferences.global || this.defaultMode
    }
    overrideSnapshot() {
        const {botId,ownerId,preferences} = this
        return {available:Boolean(botId && ownerId),global:preferences.global ?? 'inherit',chats:{...preferences.chats},envOverridden:Boolean(this.envMode),
            revision:createHash('sha256').update(JSON.stringify([botId,ownerId,preferences])).digest('hex')}
    }
    canAttempt(feature:DisplayFeature,chatId?:number|string):boolean {
        return this.mode(chatId) !== 'compatible' && (this.rejected.get(`${feature}:${chatId}`) || 0) <= this.now()
    }
    allows(feature:DisplayFeature,chatId?:number|string,transport:EmojiTransport = 'botApi'):boolean {
        if(!this.canAttempt(feature,chatId))return false
        // Auto attempts the real message when capability is unknown. The separate
        // custom-emoji switch and explicit compatible overrides remain authoritative.
        if(feature === 'customEmoji')return this.emoji.snapshot(chatId,transport).state !== 'unsupported'
        return this.mode(chatId) === 'enhanced' || this.ownerPremium() === true
    }
    reject(feature:DisplayFeature,chatId?:number|string,transport:EmojiTransport = 'botApi'):void {
        if(feature === 'customEmoji'){this.emoji.record(chatId,'unsupported','rejected',transport);return}
        for(const [key,until] of this.rejected)if(until <= this.now())this.rejected.delete(key)
        if(this.rejected.size >= 1000)this.rejected.delete(this.rejected.keys().next().value)
        this.rejected.set(`${feature}:${chatId}`,this.now() + REJECTION_TTL)
    }
    setMode(mode:TelegramDisplayMode|'inherit',chatId?:number,revision?:string):void|Promise<void> {
        const {botId,ownerId} = this
        if(!botId || !ownerId)throw new Error('displayOwnerUnavailable')
        if(this.database){
            const operation = this.queue.then(async()=>{
                if(this.botId !== botId || this.ownerId !== ownerId || revision !== undefined && revision !== this.overrideSnapshot().revision)
                    throw Object.assign(new Error('conflict'),{status:409,code:'conflict'})
                const next = this.nextMode(mode,chatId)
                await this.document(botId,ownerId).write(JSON.stringify({version:1,botId,ownerId,...next}))
                if(this.botId === botId && this.ownerId === ownerId)this.preferences = next
            })
            this.queue = operation.catch(()=>undefined)
            return operation
        }
        const next = this.nextMode(mode,chatId)
        fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700})
        const temporary = `${this.file}.${process.pid}.tmp`
        try {
            fs.writeFileSync(temporary,JSON.stringify({version:1,botId,ownerId,...next}),{mode:0o600})
            fs.renameSync(temporary,this.file)
        } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
        this.preferences = next
    }
    private nextMode(mode:TelegramDisplayMode|'inherit',chatId?:number):Preferences {
        if(mode !== 'inherit' && !isDisplayMode(mode))throw new Error('invalidDisplayMode')
        if(chatId !== undefined && !validId(chatId))throw new Error('invalidDisplayChat')
        const next:Preferences = {global:this.preferences.global,chats:{...this.preferences.chats}}
        if(chatId === undefined)next.global = mode === 'inherit' ? undefined : mode
        else if(mode === 'inherit')delete next.chats[String(chatId)]
        else next.chats[String(chatId)] = mode
        if(Object.keys(next.chats).length > 1000)throw new Error('tooManyDisplayChats')
        return next
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