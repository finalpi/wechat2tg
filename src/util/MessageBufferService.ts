import type BaseMessage from '../base/BaseMessage'
import {LogUtils} from './LogUtil'
import {config} from '../config'
import {MqttNotifyService} from '../service/MqttNotifyService'
import {TelegramOutbox,OutboxKind,OutboxRow,TextProgress} from '../repository/TelegramOutbox'

export interface MessageRetryResult {
    success:boolean
    retryAfterMs?:number
    retryable?:boolean
    deliveryUncertain?:boolean
    skipRetry?:boolean
    deferred?:boolean
}
type Dispatcher = (message:BaseMessage,key:string)=>Promise<MessageRetryResult>
type Logger = Pick<Console,'info'|'warn'|'error'>
interface Options {maxRetries?:number;retryDelay?:number;intervalMs?:number;now?:()=>number;logger?:Logger;notify?:()=>void}

/** Durable outbox scheduler. Memory holds only bounded active deliveries, not the backlog. */
export class MessageBufferService {
    private static instance:MessageBufferService
    private account:()=>string|undefined = ()=>undefined
    private dispatch?:Dispatcher
    private status?:(remoteId:string,state:string)=>Promise<unknown>
    private active = new Map<string,{kind:OutboxKind;task:Promise<void>}>()
    private timer?:NodeJS.Timeout
    private scanning?:Promise<void>
    private requested = false
    private stopped = false
    private now:()=>number
    private logger:Logger
    private maxRetries:number
    private retryDelay:number
    private intervalMs:number
    private nextCleanup = 0
    private notify:()=>void
    constructor(private store = new TelegramOutbox(),options:Options = {}) {
        this.now = options.now || Date.now
        this.logger = options.logger || LogUtils.config().getLogger('MessageBuffer')
        this.maxRetries = Math.max(0,options.maxRetries ?? config.SEND_TO_TG_MAX_RETRIES ?? 3)
        this.retryDelay = Math.max(1,options.retryDelay ?? config.SEND_TO_TG_RETRY_DELAY ?? 5000)
        this.intervalMs = options.intervalMs ?? 5000
        this.notify = options.notify || (()=>MqttNotifyService.getInstance().notify('Telegram 转发尚未完成','消息已保留；结果未知时请先核对 Telegram，再在 WebUI 手动同步。','error'))
    }
    static getInstance():MessageBufferService {
        return this.instance ??= new MessageBufferService()
    }
    configure(account:()=>string|undefined,dispatch:Dispatcher,status?:(remoteId:string,state:string)=>Promise<unknown>) {
        this.account = account;this.dispatch = dispatch;this.status = status
        if(!this.timer && this.intervalMs > 0){this.timer = setInterval(()=>this.kick(),this.intervalMs);this.timer.unref()}
        this.kick()
    }
    private kick() {void this.drain().catch(()=>this.logger.error('Telegram outbox storage unavailable; queued data retained'))}
    async addMessage(message:BaseMessage):Promise<string> {
        const account = this.account()
        if(!account)throw new Error('Forwarding account unavailable')
        const key = await this.store.enqueue(account,message,this.now())
        this.kick()
        return key
    }
    async hasScheduledMessage(remoteId:string):Promise<boolean> {
        const account = this.account()
        return account ? this.store.active(account,remoteId) : false
    }
    /** Called immediately before a Telegram request, never after it. */
    async beginAttempt(key:string):Promise<boolean> {
        const account = this.account()
        return Boolean(account && await this.store.begin(key,account))
    }
    hasTextCheckpoint(key:string):Promise<boolean> {return this.store.hasTextProgress(key)}
    textProgress(key:string,chunks:string[],message?:BaseMessage):Promise<TextProgress> {return this.store.textProgress(key,chunks,message)}
    checkpoint(key:string,progress:TextProgress) {return this.store.checkpoint(key,progress)}
    accountIdentity() {return this.account()}
    async externallySent(message:BaseMessage,account = this.account()) {
        if(account)await this.store.externallySent(account,message.id,message.conversationWxId || message.wxId || '')
    }
    async externallyUnknown(message:BaseMessage,account = this.account()) {
        if(account)await this.store.externallyUnknown(account,message.id,message.conversationWxId || message.wxId || '')
    }
    async drain():Promise<void> {
        this.requested = true
        if(this.scanning)return this.scanning
        if(this.stopped || !this.dispatch)return
        const scan = this.scanRequested()
        this.scanning = scan
        try {await scan} finally {if(this.scanning === scan)this.scanning = undefined}
    }
    private async scanRequested():Promise<void> {
        while(this.requested && !this.stopped){
            this.requested = false
            const account = this.account()
            if(!account)return
            await this.scan(account)
        }
    }
    private async scan(account:string):Promise<void> {
        // Separate budgets: stalled uploads cannot consume all text slots.
        for(const [kind,capacity] of [['message',8],['media',2],['recall',2]] as const){
            const free = capacity - [...this.active.values()].filter(job=>job.kind === kind).length
            if(free <= 0)continue
            const rows = await this.store.due(account,kind,this.now(),free)
            for(const row of rows){
                if(this.stopped || account !== this.account())return
                if(!await this.store.claim(row.key,account))continue
                const task = this.deliver(row).catch(()=>this.logger.error('Telegram outbox completion failed; record retained'))
                this.active.set(row.key,{kind,task})
                void task.finally(()=>{this.active.delete(row.key);this.kick()})
            }
        }
        if(this.now() >= this.nextCleanup){
            await this.store.cleanup(this.now() - Math.max(config.MESSAGE_BUFFER_EXPIRE_TIME || 0,7 * 86400000))
            this.nextCleanup = this.now() + 3600000
        }
    }
    private async deliver(row:OutboxRow):Promise<void> {
        let result:MessageRetryResult
        try {
            if(row.account !== this.account())result = {success:false,deferred:true}
            else result = await this.dispatch(await this.store.message(row.key),row.key)
        } catch {
            // A dispatcher can throw after a write: never assume it is safe to replay.
            const current = await this.store.row(row.key)
            result = {success:false,deliveryUncertain:current?.state === 'sending'}
        }
        const attempts = row.attempts + (result.deferred ? 0 : 1)
        const uncertain = result.deliveryUncertain || result.skipRetry
        const retry = result.deferred || result.retryable || this.maxRetries === 0 || attempts <= this.maxRetries
        const state = uncertain ? 'unknown' : result.success ? 'sent' : retry ? 'queued' : 'failed'
        const backoff = Math.min(this.retryDelay * 2 ** Math.min(attempts - 1,20),300000)
        const delay = Math.max(backoff,Number.isFinite(result.retryAfterMs) ? result.retryAfterMs || 0 : 0)
        // Retrying a local journal write is safe; re-running the Telegram request is not.
        let saved = false
        while(!saved){
            try {await this.store.finish(row.key,state,attempts,state === 'queued' ? this.now() + delay : 0);saved = true}
            catch {
                if(this.stopped)return
                this.logger.error('Telegram outbox checkpoint unavailable; delivery will not be repeated')
                await new Promise(resolve=>setTimeout(resolve,5000))
            }
        }
        // A simultaneous manual sync or recall can have completed this record.
        if(this.stopped || (await this.store.row(row.key))?.state !== state)return
        await this.status?.(row.remoteId,state === 'sent' ? 'synced' : state === 'queued' ? 'pending' : state).catch(()=>undefined)
        if(state === 'unknown' || state === 'failed')this.logger.warn(`Telegram forwarding retained for review: ${state}`)
        if(!result.success && attempts === (config.MQTT_NOTIFY_FAIL_COUNT || 5)){
            this.notify()
        }
    }
    async getBufferStats() {
        const account = this.account()
        return account ? this.store.stats(account) : []
    }
    async idle() {await Promise.all([...this.active.values()].map(job=>job.task))}
    async destroy() {
        this.stopped = true
        if(this.timer)clearInterval(this.timer)
        await this.scanning?.catch(()=>undefined)
        await this.idle()
        await this.store.close()
        if(MessageBufferService.instance === this)MessageBufferService.instance = undefined
    }
}