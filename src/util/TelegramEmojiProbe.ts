import {TelegramEmojiCapability} from './TelegramEmojiCapability'
import {customEmojiRejected} from './TelegramDisplayPolicy'
import {WECHAT_CUSTOM_EMOJI} from './WechatCustomEmojiData'
import fs from 'node:fs'
import path from 'node:path'

export class TelegramEmojiProbe {
    private pending?: {key:string;promise:Promise<void>}
    private lastAttempt?: {key:string;at:number;failed:boolean}
    private receipt?:{botId:number;chatId:number;messageId:number}
    constructor(private capability:TelegramEmojiCapability,private now = Date.now,private timeoutMs = 15000,private receiptFile?:string) {}
    messageId(botId:number,chatId:number):number|undefined {
        if(!this.receipt && this.receiptFile){
            try {
                if(fs.statSync(this.receiptFile).size > 1024)return
                const value = JSON.parse(fs.readFileSync(this.receiptFile,'utf8'))
                if([value.botId,value.chatId,value.messageId].every(id=>Number.isSafeInteger(id) && id > 0))this.receipt = value
            } catch { /* A missing or invalid receipt requires a new control message. */ }
        }
        return this.receipt?.botId === botId && this.receipt.chatId === chatId ? this.receipt.messageId : undefined
    }
    remember(botId:number,chatId:number,messageId:number):void {
        if(![botId,chatId,messageId].every(id=>Number.isSafeInteger(id) && id > 0))return
        this.receipt = {botId,chatId,messageId}
        if(!this.receiptFile)return
        const temporary = `${this.receiptFile}.${process.pid}.tmp`
        try {
            fs.mkdirSync(path.dirname(this.receiptFile),{recursive:true})
            fs.writeFileSync(temporary,JSON.stringify(this.receipt),{mode:0o600})
            fs.renameSync(temporary,this.receiptFile)
        } catch {console.warn('[Telegram] Emoji probe receipt persistence failed')}
        finally {try {fs.unlinkSync(temporary)} catch { /* Renamed or absent. */ }}
    }
    private key(chatId:number):string {return `${this.capability.generation}:${chatId}`}
    status(chatId:number) {
        const attempt = this.lastAttempt?.key === this.key(chatId) ? this.lastAttempt : undefined
        return {...this.capability.snapshot(chatId),probing:this.pending?.key === this.key(chatId),
            retryAfter:attempt ? Math.max(0,Math.ceil((attempt.at + 60000 - this.now()) / 1000)) : 0,
            lastProbeFailed:attempt?.failed || false}
    }
    async run(chatId:number,check:(iconId:string,signal:AbortSignal)=>Promise<unknown>):Promise<void> {
        const key = this.key(chatId),generation = this.capability.generation
        if (this.pending?.key === key) return this.pending.promise
        if (this.status(chatId).retryAfter) throw Object.assign(new Error('emojiProbeRateLimited'),{code:'emojiProbeRateLimited',status:429})
        this.lastAttempt = {key,at:this.now(),failed:false}
        const operation = (async()=>{
            const emoji = WECHAT_CUSTOM_EMOJI['[微笑]']
            const controller = new AbortController()
            let timer:NodeJS.Timeout
            const deadline = new Promise<never>((_,reject)=>{timer = setTimeout(()=>{controller.abort();reject(new Error('emojiProbeTimeout'))},this.timeoutMs)})
            try {
                const result = await Promise.race([check(emoji.id,controller.signal),deadline])
                if (this.capability.generation === generation) {
                    if(!this.capability.observeButton(chatId,emoji.id,result)){
                        this.capability.record(chatId,'unknown','requestFailed')
                        if(this.lastAttempt?.key === key)this.lastAttempt.failed = true
                    }
                }
            } catch(error) {
                if (this.capability.generation !== generation) return
                const denied = customEmojiRejected(error)
                this.capability.record(chatId,denied ? 'unsupported' : 'unknown',denied ? 'rejected' : 'requestFailed')
                if (this.lastAttempt?.key === key) this.lastAttempt.failed = !denied
            } finally {clearTimeout(timer)}
        })()
        this.pending = {key,promise:operation}
        try {await operation} finally {if (this.pending?.promise === operation) this.pending = undefined}
    }
}
