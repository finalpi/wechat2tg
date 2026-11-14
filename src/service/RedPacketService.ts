import sqlite3 from 'sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import axios from 'axios'
import {readWechatRedPacket} from '../util/WechatRedPacket'

export type RedPacketState = 'ready'|'opening'|'received'|'unavailable'|'unknown'
export interface RedPacketResult {state:RedPacketState;canOpen:boolean;amountFen?:number;reason?:string}
export interface RedPacketSession {accountId:string;ownerId:number;baseURL:string}
interface PacketRow {key:string;token:string;account:string;owner:number;conversation:string;remoteId:string;xml:string;state:RedPacketState;amount:number|null;reason:string|null;chatId:number|null;threadId:number|null}
interface PacketInput {accountId:string;conversation:string;remoteId:string;source:string;chatId?:number;threadId?:number}
export const redPacketError = (code = 'redPacketUnavailable',status = 409)=>Object.assign(new Error(code),{code,status})

/** A fresh HTTP client avoids SDK interceptors that log private payment XML.
 * AutoHongBao is the registered route in the bundled server, unlike its stale Swagger alias.
 * Never retry or switch endpoints after dispatching this money-affecting request. */
export async function requestRedPacketOpen(session:RedPacketSession,xml:string,conversation:string) {
    return axios.post(session.baseURL.replace(/\/+$/,'') + '/TenPay/AutoHongBao',{
        Wxid:session.accountId,Xml:xml,SendUserName:conversation.endsWith('@chatroom') ? conversation : '',
    },{timeout:15000,maxRedirects:0,maxContentLength:262144,maxBodyLength:262144,responseType:'json',validateStatus:()=>true})
}

/** The Go endpoint can return Code=0 with a zero-filled result after a decode failure.
 * An outer success flag alone is NOT evidence that money was received. */
export function redPacketOutcome(response:{status:number;data:any},sendId:string):RedPacketResult {
    if([404,405].includes(response?.status))return {state:'unavailable',canOpen:false,reason:'routeUnavailable'}
    const body = response?.data, data = body?.Data
    if(response?.status !== 200 || body?.Code !== 0 || body?.Success !== true || !data || typeof data !== 'object')return {state:'unknown',canOpen:false}
    if(Number.isSafeInteger(data.retcode) && data.retcode !== 0)return {state:'unavailable',canOpen:false,reason:'wechatRejected'}
    if(data.retcode === 0 && data.sendId === sendId && typeof data.receiveId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(data.receiveId)
        && Number.isSafeInteger(data.amount) && data.amount > 0)return {state:'received',canOpen:false,amountFen:data.amount}
    return {state:'unknown',canOpen:false}
}

export function redPacketResultText(result:RedPacketResult):string {
    if(result.state === 'received')return `已确认领取 ¥${((result.amountFen || 0) / 100).toFixed(2)}`
    if(result.state === 'opening')return '正在处理，请勿重复打开。'
    if(result.state === 'unknown')return '领取结果未知，请到微信核实；不会重复请求。'
    if(result.state === 'unavailable')return result.reason === 'routeUnavailable' ? '当前协议未提供可用的红包领取路由，请在微信打开。' : '微信未确认领取成功，红包可能已领完或过期，请在微信查看。'
    return '打开红包将尝试领取到当前微信账号。'
}

/** One writer per private storage directory. Opening is persisted BEFORE network I/O.
 * Both WebUI and Telegram share the account+native-packet key, including after restart. */
export class RedPacketService {
    private db:sqlite3.Database
    private ready:Promise<void>
    private confirmations = new Map<string,{token:string;account:string;owner:number;scope:string;expires:number}>()
    constructor(private session:()=>Promise<RedPacketSession|undefined>,private send = requestRedPacketOpen,file = 'storage/db/red-packets.db') {
        fs.mkdirSync(path.dirname(file),{recursive:true})
        if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx',0o600))
        fs.chmodSync(file,0o600)
        this.ready = new Promise((resolve,reject)=>{
            this.db = new sqlite3.Database(file,error=>{
                if(error)return reject(error)
                this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
                    CREATE TABLE IF NOT EXISTS red_packets (
                        key TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,account TEXT NOT NULL,owner INTEGER NOT NULL,
                        conversation TEXT NOT NULL,remoteId TEXT NOT NULL,xml TEXT,state TEXT NOT NULL,
                        amount INTEGER,reason TEXT,chatId INTEGER,threadId INTEGER,updatedAt INTEGER NOT NULL);
                    UPDATE red_packets SET state='unknown',xml=NULL WHERE state='opening';`,err=>err ? reject(err) : resolve())
            })
        })
        void this.ready.catch(()=>undefined)
    }
    private async run(sql:string,params:unknown[] = []):Promise<number> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.run(sql,params,function(error){error ? reject(error) : resolve(this.changes)}))
    }
    private async row(token:string):Promise<PacketRow|undefined> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.get<PacketRow>('SELECT * FROM red_packets WHERE token=?',[token],(error,row)=>error ? reject(error) : resolve(row)))
    }
    private result(row:PacketRow):RedPacketResult {
        return {state:row.state,canOpen:row.state === 'ready',...(row.state === 'received' && row.amount !== null ? {amountFen:row.amount} : {}),...(row.reason ? {reason:row.reason} : {})}
    }
    private async authorized(token:string,scope?:{chatId:number;threadId?:number;conversation?:string}) {
        if(!/^[a-f0-9]{32}$/.test(token))throw redPacketError()
        const row = await this.row(token), session = await this.session()
        if(!session || !row || row.account !== session.accountId || row.owner !== session.ownerId)throw redPacketError()
        if(scope && (row.chatId !== scope.chatId || (row.threadId || undefined) !== scope.threadId
            || scope.conversation !== undefined && row.conversation !== scope.conversation))throw redPacketError()
        return {row,session}
    }
    async register(input:PacketInput):Promise<{token:string}&RedPacketResult> {
        const session = await this.session(), packet = readWechatRedPacket(input.source)
        if(!session || session.accountId !== input.accountId || !Number.isSafeInteger(session.ownerId) || session.ownerId <= 0
            || !packet?.claimable || !input.conversation || !/^[1-9]\d{0,29}$/.test(input.remoteId))throw redPacketError()
        const key = createHash('sha256').update(JSON.stringify([session.accountId,packet.sendId])).digest('hex')
        const token = randomBytes(16).toString('hex')
        await this.run(`INSERT OR IGNORE INTO red_packets(key,token,account,owner,conversation,remoteId,xml,state,chatId,threadId,updatedAt)
            VALUES(?,?,?,?,?,?,?,'ready',?,?,?)`,[key,token,session.accountId,session.ownerId,input.conversation,input.remoteId,packet.xml,input.chatId ?? null,input.threadId ?? null,Date.now()])
        const stored:PacketRow = await new Promise((resolve,reject)=>this.db.get<PacketRow>('SELECT * FROM red_packets WHERE key=?',[key],(error,row)=>error ? reject(error) : resolve(row)))
        if(stored.owner !== session.ownerId || stored.conversation !== input.conversation)throw redPacketError()
        if(input.chatId !== undefined){
            if(stored.chatId !== null && (stored.chatId !== input.chatId || (stored.threadId || undefined) !== input.threadId))throw redPacketError()
            await this.run('UPDATE red_packets SET chatId=?,threadId=? WHERE key=? AND chatId IS NULL',[input.chatId,input.threadId ?? null,key])
        }
        // Recheck after persistence; account switches must not authorize an old target.
        return {token:stored.token,...await this.status(stored.token)}
    }
    async status(token:string,scope?:{chatId:number;threadId?:number;conversation?:string}):Promise<RedPacketResult> {
        return this.result((await this.authorized(token,scope)).row)
    }
    async prepare(token:string,scope:string,destination?:{chatId:number;threadId?:number;conversation?:string}):Promise<RedPacketResult&{confirmation?:string}> {
        const {row,session} = await this.authorized(token,destination), result = this.result(row)
        if(!result.canOpen)return result
        for(const [key,value] of this.confirmations)if(value.expires < Date.now())this.confirmations.delete(key)
        if(this.confirmations.size >= 256)this.confirmations.delete(this.confirmations.keys().next().value)
        const confirmation = randomBytes(16).toString('hex')
        this.confirmations.set(confirmation,{token,account:session.accountId,owner:session.ownerId,scope,expires:Date.now() + 120000})
        return {...result,confirmation}
    }
    async open(token:string,confirmation:string,scope:string,guard:()=>Promise<boolean> = async()=>true,destination?:{chatId:number;threadId?:number;conversation?:string},beforeDispatch?:()=>Promise<void>):Promise<RedPacketResult> {
        const {row,session} = await this.authorized(token,destination)
        if(row.state !== 'ready')return this.result(row)
        const consent = this.confirmations.get(confirmation)
        this.confirmations.delete(confirmation)
        if(!consent || consent.token !== token || consent.scope !== scope || consent.expires < Date.now()
            || consent.account !== session.accountId || consent.owner !== session.ownerId)throw redPacketError('redPacketConfirmationExpired',400)
        if(!await guard())throw redPacketError()
        if(await this.run('UPDATE red_packets SET state=\'opening\',updatedAt=? WHERE key=? AND state=\'ready\'',[Date.now(),row.key]) !== 1)return this.status(token,destination)
        // No request has been made yet; a failed final authorization may safely release the claim.
        let current:RedPacketSession
        try {
            // Telegram may wait briefly after explicit one-click consent. The
            // durable reservation already prevents another entry from sending.
            await beforeDispatch?.()
            if(consent.expires < Date.now())throw redPacketError('redPacketConfirmationExpired',400)
            await this.authorized(token,destination)
            if(!await guard())throw redPacketError()
            current = await this.session()
            if(!current || current.accountId !== session.accountId || current.ownerId !== session.ownerId)throw redPacketError()
        } catch(error) {
            await this.run('UPDATE red_packets SET state=\'ready\' WHERE key=? AND state=\'opening\'',[row.key])
            throw error
        }
        let result:RedPacketResult = {state:'unknown',canOpen:false}
        try {
            const packet = readWechatRedPacket(row.xml)
            if(!packet?.claimable)throw redPacketError()
            result = redPacketOutcome(await this.send(current,packet.xml,row.conversation),packet.sendId)
        } catch { /* No raw payment XML, URLs, or transport error objects in logs/responses. */ }
        try {
            await this.run('UPDATE red_packets SET state=?,amount=?,reason=?,xml=NULL,updatedAt=? WHERE key=?',
                [result.state,result.amountFen ?? null,result.reason ?? null,Date.now(),row.key])
        } catch {return {state:'unknown',canOpen:false}}
        await this.authorized(token,destination)
        return result
    }
    async confirm(confirmation:string,scope:string,destination:{chatId:number;threadId?:number;conversation?:string},guard:()=>Promise<boolean>,beforeDispatch?:(token:string)=>Promise<void>) {
        const consent = this.confirmations.get(confirmation)
        if(!consent)throw redPacketError('redPacketConfirmationExpired',400)
        return {...await this.open(consent.token,confirmation,scope,guard,destination,()=>beforeDispatch?.(consent.token)),token:consent.token}
    }
    async cancel(confirmation:string,scope:string,destination?:{chatId:number;threadId?:number;conversation?:string}):Promise<string|undefined> {
        const consent = this.confirmations.get(confirmation)
        if(!consent || consent.scope !== scope)return
        await this.authorized(consent.token,destination)
        this.confirmations.delete(confirmation)
        return consent.token
    }
    async close(){await this.ready;await new Promise<void>((resolve,reject)=>this.db.close(error=>error ? reject(error) : resolve()))}
}

let singleton:RedPacketService|undefined
export function redPacketService():RedPacketService {
    return singleton ||= new RedPacketService(async()=>{
        const {AbstractClient} = await import('../base/BaseClient')
        const {ConfigurationService} = await import('./ConfigurationService')
        const {config} = await import('../config')
        const owner = (await ConfigurationService.getInstance().getConfig()).chatId
        const wx = AbstractClient.getSpyClient('wxClient') as any
        if(!wx?.hasLogin || !wx.wxInfo?.wxid || !Number.isSafeInteger(owner) || owner <= 0)return undefined
        return {accountId:wx.wxInfo.wxid,ownerId:owner,baseURL:wx.client?.baseUrl || config.BASE_API}
    })
}