import sqlite3 from 'sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import axios from 'axios'
import {readWechatTransfer,transferExpired,WechatTransfer} from '../util/WechatTransfer'

export type TransferState = 'ready'|'accepting'|'received'|'unavailable'|'unknown'
export type TransferResult = {state:TransferState;canAccept:boolean;amountFen:number}
export type TransferSession = {accountId:string;ownerId:number;baseURL:string}
type Destination = {chatId:number;threadId?:number;conversation:string}
type Row = {key:string;token:string;account:string;owner:number;conversation:string;chatId:number;threadId:number|null;
    transferId:string;transactionId:string;invalidTime:string;amount:number;state:TransferState}
const unavailable = ()=>new Error('转账不可操作，账号、主人或会话可能已切换。')

export async function requestTransferAccept(session:TransferSession,packet:{transferId:string;transactionId:string;invalidTime:string},conversation:string) {
    return axios.post(session.baseURL.replace(/\/+$/,'') + '/TenPay/Collectmoney',{
        Wxid:session.accountId,ToUserName:conversation,TransFerId:packet.transferId,TransactionId:packet.transactionId,InvalidTime:packet.invalidTime,
    },{timeout:15000,maxRedirects:0,maxContentLength:262144,maxBodyLength:262144,responseType:'json',validateStatus:()=>true})
}

export function transferButtonText(result:TransferResult) {
    if(result.state === 'received')return `已收款 ¥${(result.amountFen / 100).toFixed(2)}`
    if(result.state === 'unknown')return '结果待核实 · 请在微信查看'
    if(result.state === 'unavailable')return '接收失败 · 请在微信查看'
    if(result.state === 'accepting')return '正在接收 · 请勿重复操作'
    return `接收转账 ¥${(result.amountFen / 100).toFixed(2)}`
}

/** A distinct durable journal: registering/forwarding a card never moves money.
 * Only an authenticated owner's explicit callback can dispatch one confirmation.
 * The protocol's outer Code=0 is not proof of receipt; incoming native receipt
 * cards reconcile the result, including after a timeout or restart. */
export class TransferService {
    private db:sqlite3.Database
    private ready:Promise<void>
    constructor(private session:()=>Promise<TransferSession|undefined>,private send = requestTransferAccept,file = 'storage/db/transfers.db') {
        fs.mkdirSync(path.dirname(file),{recursive:true})
        if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx',0o600))
        fs.chmodSync(file,0o600)
        this.ready = new Promise((resolve,reject)=>{
            this.db = new sqlite3.Database(file,error=>{
                if(error)return reject(error)
                this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
                    CREATE TABLE IF NOT EXISTS transfers (key TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,
                    account TEXT NOT NULL,owner INTEGER NOT NULL,conversation TEXT NOT NULL,chatId INTEGER NOT NULL,threadId INTEGER,
                    transferId TEXT NOT NULL,transactionId TEXT NOT NULL,invalidTime TEXT NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL);
                    UPDATE transfers SET state='unknown' WHERE state='accepting';`,err=>err ? reject(err) : resolve())
            })
        })
        void this.ready.catch(()=>undefined)
    }
    private async run(sql:string,values:unknown[] = []):Promise<number> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.run(sql,values,function(error){error ? reject(error) : resolve(this.changes)}))
    }
    private async row(token:string):Promise<Row|undefined> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.get<Row>('SELECT * FROM transfers WHERE token=?',[token],(error,row)=>error ? reject(error) : resolve(row)))
    }
    private key(account:string,packet:WechatTransfer) {return createHash('sha256').update(JSON.stringify([account,packet.sendId])).digest('hex')}
    private result(row:Row):TransferResult {
        const state = row.state === 'ready' && transferExpired(row.invalidTime) ? 'unavailable' : row.state
        return {state,canAccept:state === 'ready',amountFen:row.amount}
    }
    private async authorized(token:string,destination:Destination) {
        if(!/^[a-f0-9]{32}$/.test(token))throw unavailable()
        const row = await this.row(token),session = await this.session()
        if(!row || !session || row.account !== session.accountId || row.owner !== session.ownerId
            || row.chatId !== destination.chatId || (row.threadId || undefined) !== destination.threadId || row.conversation !== destination.conversation)throw unavailable()
        return {row,session}
    }
    async register(source:string,account:string,destination:Destination) {
        const packet = readWechatTransfer(source),session = await this.session()
        if(!packet?.claimable || !session || session.accountId !== account || session.ownerId <= 0 || !Number.isSafeInteger(session.ownerId)
            || packet.receiver !== account || transferExpired(packet.invalidTime)
            || !/^[a-zA-Z0-9_.-]{1,128}$/.test(destination.conversation)
            || destination.conversation === account || (packet.payer && packet.payer !== destination.conversation))throw unavailable()
        const key = this.key(account,packet),token = randomBytes(16).toString('hex')
        await this.run(`INSERT OR IGNORE INTO transfers(key,token,account,owner,conversation,chatId,threadId,transferId,transactionId,invalidTime,amount,state)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,'ready')`,[key,token,account,session.ownerId,destination.conversation,destination.chatId,destination.threadId ?? null,packet.sendId,packet.transactionId,packet.invalidTime,packet.amountFen])
        const stored:Row = await new Promise((resolve,reject)=>this.db.get<Row>('SELECT * FROM transfers WHERE key=?',[key],(error,row)=>error ? reject(error) : resolve(row)))
        if(stored.amount !== packet.amountFen || stored.transactionId !== packet.transactionId || stored.invalidTime !== packet.invalidTime)throw unavailable()
        return {token:stored.token,...await this.status(stored.token,destination)}
    }
    async observeReceipt(source:string,account:string,conversation:string) {
        const packet = readWechatTransfer(source),session = await this.session()
        if(!packet?.received || !session || session.accountId !== account || packet.receiver !== account || (packet.payer && packet.payer !== conversation))return
        await this.run('UPDATE transfers SET state=\'received\' WHERE key=? AND account=? AND owner=? AND conversation=? AND amount=? AND transactionId=?',
            [this.key(account,packet),account,session.ownerId,conversation,packet.amountFen,packet.transactionId])
    }
    async status(token:string,destination:Destination) {return this.result((await this.authorized(token,destination)).row)}
    async accept(token:string,destination:Destination,guard:()=>Promise<boolean>):Promise<TransferResult> {
        const {row,session} = await this.authorized(token,destination)
        if(!this.result(row).canAccept)return this.result(row)
        if(!await guard())throw unavailable()
        if(await this.run('UPDATE transfers SET state=\'accepting\' WHERE key=? AND state=\'ready\'',[row.key]) !== 1)return this.status(token,destination)
        let current:TransferSession
        try {
            const authorized = await this.authorized(token,destination)
            if(authorized.row.state !== 'accepting')return this.result(authorized.row)
            if(!await guard())throw unavailable()
            const final = await this.authorized(token,destination)
            if(final.row.state !== 'accepting')return this.result(final.row)
            current = final.session
            if(current.accountId !== session.accountId || current.ownerId !== session.ownerId || current.baseURL !== session.baseURL)throw unavailable()
            if(transferExpired(row.invalidTime)) {
                await this.run('UPDATE transfers SET state=\'unavailable\' WHERE key=? AND state=\'accepting\'',[row.key])
                return this.status(token,destination)
            }
        } catch(error) {
            await this.run('UPDATE transfers SET state=\'ready\' WHERE key=? AND state=\'accepting\'',[row.key])
            throw error
        }
        let state:TransferState = 'unknown'
        try {
            const response = await this.send(current,row,row.conversation)
            // A missing route is definitive. All transport/decoding/business
            // uncertainty remains non-retryable; no alternate endpoint is tried.
            if([404,405].includes(response.status))state = 'unavailable'
        } catch { /* Never log raw payment identifiers or HTTP error objects. */ }
        try {await this.run('UPDATE transfers SET state=? WHERE key=? AND state=\'accepting\'',[state,row.key])}
        catch {return {state:'unknown',canAccept:false,amountFen:row.amount}}
        return this.status(token,destination)
    }
    async close() {await this.ready;await new Promise<void>((resolve,reject)=>this.db.close(error=>error ? reject(error) : resolve()))}
}

let singleton:TransferService
export function transferService() {
    return singleton ||= new TransferService(async()=>{
        const {AbstractClient} = await import('../base/BaseClient')
        const {ConfigurationService} = await import('./ConfigurationService')
        const {config} = await import('../config')
        const owner = (await ConfigurationService.getInstance().getConfig()).chatId
        const wx = AbstractClient.getSpyClient('wxClient') as any
        if(!wx?.hasLogin || !wx.wxInfo?.wxid || !Number.isSafeInteger(owner) || owner <= 0)return
        return {accountId:wx.wxInfo.wxid,ownerId:owner,baseURL:wx.client?.baseUrl || config.BASE_API}
    })
}