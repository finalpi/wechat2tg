import sqlite3 from 'sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import type BaseMessage from '../base/BaseMessage'

export type OutboxState = 'queued' | 'enqueued' | 'sending' | 'sent' | 'unknown' | 'failed' | 'cancelled'
export type OutboxKind = 'message' | 'media' | 'recall'
export interface OutboxRow {key:string;account:string;remoteId:string;conversation:string;chatId:number;kind:OutboxKind;state:OutboxState;attempts:number;nextAt:number}
export interface TextProgress {chunks:string[];ids:number[]}

/** Private, durable forwarding journal. Never share writable storage between instances. */
export class TelegramOutbox {
    private db:sqlite3.Database
    private ready:Promise<void>
    constructor(file = 'storage/db/telegram-outbox.db') {
        fs.mkdirSync(path.dirname(file),{recursive:true})
        if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx',0o600))
        this.ready = new Promise((resolve,reject)=>{
            this.db = new sqlite3.Database(file,error=>{
                if(error)return reject(error)
                this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
                    CREATE TABLE IF NOT EXISTS outbox (
                        seq INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL UNIQUE,account TEXT NOT NULL,
                        remoteId TEXT NOT NULL,conversation TEXT NOT NULL,chatId INTEGER NOT NULL,kind TEXT NOT NULL,
                        state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,nextAt INTEGER NOT NULL,
                        updatedAt INTEGER NOT NULL,payload TEXT,media BLOB,progress TEXT);
                    CREATE INDEX IF NOT EXISTS outbox_due ON outbox(account,state,kind,nextAt);
                    CREATE INDEX IF NOT EXISTS outbox_remote ON outbox(account,remoteId);
                    CREATE INDEX IF NOT EXISTS outbox_lane ON outbox(account,chatId,kind,state,seq);
                    CREATE INDEX IF NOT EXISTS outbox_chat ON outbox(account,chatId,state,seq);
                    UPDATE outbox SET state='unknown' WHERE state='sending';
                    UPDATE outbox SET state='queued' WHERE state='enqueued';`,e=>e ? reject(e) : resolve())
            })
        })
        // Account setup may finish later; callers still receive this rejection.
        void this.ready.catch(()=>undefined)
    }
    private async run(sql:string,params:unknown[] = []):Promise<number> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.run(sql,params,function(error){error ? reject(error) : resolve(this.changes)}))
    }
    private async all<T>(sql:string,params:unknown[] = []):Promise<T[]> {
        await this.ready
        return new Promise((resolve,reject)=>this.db.all<T>(sql,params,(error,rows)=>error ? reject(error) : resolve(rows)))
    }
    async enqueue(account:string,message:BaseMessage,now = Date.now()):Promise<string> {
        if(!account || !message.id)throw new Error('Forwarding account/message identity unavailable')
        const conversation = message.conversationWxId || message.wxId || ''
        const key = createHash('sha256').update(JSON.stringify([account,conversation,message.id,message.type])).digest('hex')
        const kind:OutboxKind = message.type === 1 || message.redPacket?.coverUrl || message.articles?.some(article=>article.coverUrl) ? 'media' : message.type === 6 ? 'recall' : 'message'
        const {file,...rest} = message
        if(file && !Buffer.isBuffer(file.file))throw new Error('Invalid forwarding media')
        const payload = JSON.stringify({...rest,...(file ? {file:{fileName:file.fileName,sendType:file.sendType,duration:file.duration}} : {})})
        await this.run('INSERT OR IGNORE INTO outbox(key,account,remoteId,conversation,chatId,kind,state,nextAt,updatedAt,payload,media) VALUES(?,?,?,?,?,?,\'queued\',?,?,?,?)',
            [key,account,message.id,conversation,message.chatId || 0,kind,now,now,payload,file?.file || null])
        // Do not resurrect an unsent message after WeChat has recalled it. The
        // running lane still owns any request already in progress.
        if(message.type === 6 && message.revokeMsgId)await this.run(`UPDATE outbox SET state='cancelled',payload=NULL,media=NULL,updatedAt=?
            WHERE account=? AND conversation=? AND remoteId=? AND state IN ('queued','enqueued')`,[now,account,conversation,message.revokeMsgId])
        return key
    }
    async due(account:string,kind:OutboxKind,now:number,limit:number):Promise<OutboxRow[]> {
        return this.all<OutboxRow>(`SELECT q.key,q.account,q.remoteId,q.conversation,q.chatId,q.kind,q.state,q.attempts,q.nextAt FROM outbox q
            WHERE q.account=? AND q.kind=? AND q.state='queued' AND q.nextAt<=?
            AND NOT EXISTS(SELECT 1 FROM outbox a WHERE a.account=q.account AND a.chatId=q.chatId AND a.kind=q.kind
                AND (a.state IN ('enqueued','sending') OR (a.state='queued' AND a.nextAt<=? AND a.seq<q.seq)))
            AND (q.kind!='recall' OR NOT EXISTS(SELECT 1 FROM outbox a WHERE a.account=q.account AND a.chatId=q.chatId
                AND a.seq<q.seq AND a.state IN ('queued','enqueued','sending')))
            ORDER BY q.seq LIMIT ?`,[account,kind,now,now,limit])
    }
    async claim(key:string,account:string):Promise<boolean> {
        return await this.run('UPDATE outbox SET state=\'enqueued\' WHERE key=? AND account=? AND state=\'queued\'',[key,account]) === 1
    }
    async begin(key:string,account:string):Promise<boolean> {
        return await this.run('UPDATE outbox SET state=\'sending\',updatedAt=? WHERE key=? AND account=? AND state IN (\'enqueued\',\'sending\')',[Date.now(),key,account]) === 1
    }
    async message(key:string):Promise<BaseMessage> {
        const [row] = await this.all<{payload:string;media:Buffer|null}>('SELECT payload,media FROM outbox WHERE key=?',[key])
        if(!row?.payload)throw new Error('Forwarding payload unavailable')
        try {
            const message:BaseMessage = JSON.parse(row.payload)
            if(!message || typeof message.id !== 'string' || !Number.isInteger(message.type))throw new Error('Invalid payload')
            if(message.file){
                if(!Buffer.isBuffer(row.media))throw new Error('Missing media')
                message.file.file = row.media
            }
            return message
        } catch {throw new Error('Invalid stored forwarding payload')}
    }
    async row(key:string):Promise<OutboxRow|undefined> {return (await this.all<OutboxRow>('SELECT key,account,remoteId,conversation,chatId,kind,state,attempts,nextAt FROM outbox WHERE key=?',[key]))[0]}
    async finish(key:string,state:OutboxState,attempts:number,nextAt = 0):Promise<void> {
        const complete = state === 'sent' || state === 'cancelled'
        await this.run(`UPDATE outbox SET state=?,attempts=?,nextAt=?,updatedAt=?,
            payload=CASE WHEN ? THEN NULL ELSE payload END,media=CASE WHEN ? THEN NULL ELSE media END,
            progress=CASE WHEN ? THEN NULL ELSE progress END WHERE key=? AND state NOT IN ('cancelled','sent','unknown')`,[state,attempts,nextAt,Date.now(),complete,complete,complete,key])
    }
    async active(account:string,remoteId:string):Promise<boolean> {
        return (await this.all('SELECT key FROM outbox WHERE account=? AND remoteId=? AND state IN (\'queued\',\'enqueued\',\'sending\') LIMIT 1',[account,remoteId])).length > 0
    }
    async externallySent(account:string,remoteId:string,conversation:string) {
        await this.run('UPDATE outbox SET state=\'sent\',payload=NULL,media=NULL,progress=NULL,updatedAt=? WHERE account=? AND remoteId=? AND conversation=? AND state IN (\'queued\',\'enqueued\',\'unknown\',\'failed\')',[Date.now(),account,remoteId,conversation])
    }
    async externallyUnknown(account:string,remoteId:string,conversation:string) {
        await this.run('UPDATE outbox SET state=\'unknown\',updatedAt=? WHERE account=? AND remoteId=? AND conversation=? AND state IN (\'queued\',\'enqueued\',\'failed\')',[Date.now(),account,remoteId,conversation])
    }
    async hasTextProgress(key:string):Promise<boolean> {
        return (await this.all('SELECT key FROM outbox WHERE key=? AND progress IS NOT NULL',[key])).length > 0
    }
    async textProgress(key:string,chunks:string[],message?:BaseMessage):Promise<TextProgress> {
        await this.run('UPDATE outbox SET progress=?,payload=COALESCE(?,payload),chatId=COALESCE(?,chatId) WHERE key=? AND progress IS NULL AND state IN (\'queued\',\'enqueued\',\'sending\')',
            [JSON.stringify({chunks,ids:[]}),message ? JSON.stringify(message) : null,message?.chatId ?? null,key])
        const [row] = await this.all<{progress:string}>('SELECT progress FROM outbox WHERE key=?',[key])
        try {
            const progress:TextProgress = JSON.parse(row?.progress)
            if(!progress || !Array.isArray(progress.chunks) || !progress.chunks.every(chunk=>typeof chunk === 'string')
                || !Array.isArray(progress.ids) || progress.ids.length > progress.chunks.length
                || !progress.ids.every(id=>Number.isSafeInteger(id) && id > 0))throw new Error('Invalid progress')
            return progress
        } catch {throw new Error('Invalid stored forwarding progress')}
    }
    async checkpoint(key:string,progress:TextProgress) {await this.run('UPDATE outbox SET progress=?,updatedAt=? WHERE key=?',[JSON.stringify(progress),Date.now(),key])}
    async stats(account:string) {
        return this.all<{state:OutboxState;count:number}>('SELECT state,COUNT(*) AS count FROM outbox WHERE account=? GROUP BY state',[account])
    }
    async cleanup(before:number) {
        // Only completed tombstones expire. Pending, failed and unknown payloads
        // survive both the old five-minute cache TTL and process restarts.
        await this.run('DELETE FROM outbox WHERE state IN (\'sent\',\'cancelled\') AND updatedAt<?',[before])
    }
    async close() {await this.ready;await new Promise<void>((resolve,reject)=>this.db.close(error=>error ? reject(error) : resolve()))}
}