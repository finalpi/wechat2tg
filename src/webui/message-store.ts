import sqlite3 from 'sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {isNoiseMessage} from './message-visibility'
import {getWechatCallStatus} from '../util/WechatCallStatus'

export interface InboxMessage {
    id?: number
    requestId?: string
    wxId: string
    remoteId?: string
    senderId?: string
    senderName?: string
    body: string
    direction: 'incoming' | 'outgoing'
    type?: string
    status: 'received' | 'sending' | 'submitted' | 'unknown' | 'failed'
    timestamp: number
    attachmentId?: string
    telegramStatus?: string
    source?: string
    details?: string
    telegramTracked?:number
    bodyFormat?:string
}

export class WebMessageStore {
    private static instance: WebMessageStore
    private db: sqlite3.Database
    private ready: Promise<void>
    private pendingSends = new Map<string, Promise<void>>()
    static getInstance() {
        if (!this.instance) this.instance = new WebMessageStore()
        return this.instance
    }
    constructor(file = 'storage/db/webui-messages.db') {
        fs.mkdirSync(path.dirname(file), {recursive: true})
        this.ready = new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(file, error => {
                if (error) return reject(error)
                this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
                    CREATE TABLE IF NOT EXISTS inbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT, requestId TEXT UNIQUE,
                        wxId TEXT NOT NULL, remoteId TEXT, senderId TEXT, senderName TEXT,
                        body TEXT NOT NULL, direction TEXT NOT NULL, type TEXT,
                        status TEXT NOT NULL, timestamp INTEGER NOT NULL,
                        UNIQUE(wxId, remoteId));
                    CREATE INDEX IF NOT EXISTS inbox_conversation ON inbox(wxId, id);
                    CREATE INDEX IF NOT EXISTS inbox_chronology ON inbox(wxId, timestamp, id);
                    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT,kind TEXT,mime TEXT,size INTEGER,digest TEXT);
                    CREATE TABLE IF NOT EXISTS transcript_media(cacheKey TEXT PRIMARY KEY,attachmentId TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS telegram_recalls(key TEXT PRIMARY KEY,status TEXT NOT NULL);
                    UPDATE telegram_recalls SET status='unknown' WHERE status='syncing';
                    UPDATE inbox SET status='unknown' WHERE status='sending';`, err => {
                        if(err)return reject(err)
                        this.db.all('PRAGMA table_info(inbox)',(e,columns:any[])=>{
                            if(e)return reject(e)
                            const additions={attachmentId:'TEXT',telegramStatus:"TEXT DEFAULT 'none'",source:'TEXT',details:'TEXT',telegramTracked:'INTEGER DEFAULT 0',bodyFormat:"TEXT DEFAULT 'plain'",hidden:'INTEGER DEFAULT 0',revokeStatus:"TEXT DEFAULT 'none'",revokeRequestId:'TEXT',revokedAt:'INTEGER',revokeTelegramStatus:"TEXT DEFAULT 'none'"}
                            const sql=Object.entries(additions).filter(([name])=>!columns.some(c=>c.name===name)).map(([name,type])=>`ALTER TABLE inbox ADD COLUMN ${name} ${type};`).join('')
                            const migration=!columns.some(c=>c.name==='telegramTracked')?"UPDATE inbox SET telegramTracked=1 WHERE requestId IS NOT NULL AND status='submitted'; UPDATE inbox SET telegramStatus='unverified' WHERE telegramTracked=0 AND telegramStatus IN ('none','pending','failed','unknown','syncing');":''
                            const hide="UPDATE inbox SET hidden=1 WHERE (type NOT IN ('text','0') AND (COALESCE(source,'') LIKE '%<name>HandOffMaster</name>%' OR COALESCE(source,'') LIKE '%<handofflist%' OR (type='unknown' AND COALESCE(source,'') LIKE '%<op id=%'))) OR type IN ('file_start','new_monment_timeline') OR (type IN ('unknown','text','0') AND trim(body)='' AND COALESCE(source,'')='' AND attachmentId IS NULL AND details IS NULL);"
                            this.db.exec(sql+migration+hide+"UPDATE inbox SET hidden=1 WHERE type='revoke' OR source LIKE '%<revokemsg>%' OR source LIKE '%<revokemsg %';"+"CREATE UNIQUE INDEX IF NOT EXISTS inbox_revoke_request ON inbox(revokeRequestId); UPDATE inbox SET telegramStatus='unknown' WHERE telegramStatus='syncing'; UPDATE inbox SET revokeStatus='unknown' WHERE revokeStatus='revoking'; UPDATE inbox SET revokeTelegramStatus='unknown' WHERE revokeTelegramStatus='syncing';",e=>e?reject(e):resolve())
                        })
                    })
            })
        })
    }
    async all(sql: string, params: unknown[] = []): Promise<any[]> {
        await this.ready
        return new Promise((resolve, reject) => this.db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)))
    }
    async run(sql: string, params: unknown[] = []): Promise<number> {
        await this.ready
        return new Promise((resolve, reject) => this.db.run(sql, params, function (error) {error ? reject(error) : resolve(this.lastID)}))
    }
    async insert(message: InboxMessage) {
        const keys = ['requestId', 'wxId', 'remoteId', 'senderId', 'senderName', 'body', 'direction', 'type', 'status', 'timestamp','attachmentId','telegramStatus','source','details','telegramTracked','bodyFormat']
        message.telegramTracked=message.telegramTracked||0
        message.bodyFormat=message.bodyFormat||'plain'
        message.telegramStatus=message.telegramStatus||'none'
        await this.run(`INSERT OR IGNORE INTO inbox (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => message[key] ?? null))
        if(isNoiseMessage(message.type,message.body,message.source||'')&&!message.attachmentId&&!message.details)await this.run('UPDATE inbox SET hidden=1 WHERE wxId=? AND remoteId=?',[message.wxId,message.remoteId])
        return (await this.all('SELECT * FROM inbox WHERE requestId = ? OR (wxId = ? AND remoteId = ?) ORDER BY id DESC LIMIT 1', [message.requestId ?? null, message.wxId, message.remoteId ?? null]))[0]
    }
    async byRequest(requestId: string) {return (await this.all('SELECT * FROM inbox WHERE requestId = ?', [requestId]))[0]}
    async importHistory(messages:InboxMessage[]){
        const keys=['wxId','remoteId','senderId','senderName','body','direction','type','status','timestamp','telegramStatus','source','bodyFormat','hidden']
        for(let start=0;start<messages.length;start+=40){
            const batch=messages.slice(start,start+40)
            const values=batch.flatMap(m=>keys.map(key=>key==='hidden'?Number(isNoiseMessage(m.type,m.body,m.source||'')):m[key]??null))
            await this.run(`INSERT INTO inbox (${keys.join(',')}) VALUES ${batch.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',')} ON CONFLICT(wxId,remoteId) DO UPDATE SET
                telegramStatus=CASE WHEN inbox.telegramTracked=0 AND inbox.telegramStatus IN ('none','pending') THEN excluded.telegramStatus ELSE inbox.telegramStatus END,
                bodyFormat=CASE WHEN inbox.requestId IS NULL THEN excluded.bodyFormat ELSE inbox.bodyFormat END,
                type=CASE WHEN inbox.requestId IS NULL AND (inbox.source IS NULL OR inbox.type GLOB '[0-9]*') THEN excluded.type ELSE inbox.type END,
                source=CASE WHEN inbox.requestId IS NULL THEN COALESCE(inbox.source,excluded.source) ELSE inbox.source END,
                hidden=MAX(inbox.hidden,excluded.hidden)`,values)
        }
    }
    async history(wxId: string, before = 0, query = '') {
        const rows = await this.all('SELECT * FROM inbox WHERE hidden=0 AND wxId = ? AND (? = 0 OR timestamp < (SELECT timestamp FROM inbox WHERE id = ?) OR (timestamp = (SELECT timestamp FROM inbox WHERE id = ?) AND id < ?)) AND body LIKE ? ORDER BY timestamp DESC, id DESC LIMIT 51', [wxId, before, before, before, before, `%${query}%`])
        const hasMore = rows.length > 50
        const messages = rows.slice(0, 50).reverse().map(({source,details,...message})=>({...message,details:details?JSON.parse(details):null}))
        return {messages, hasMore, before: messages[0]?.id || 0}
    }
    async observe(msg: any) {
        const revokeXML=String(msg._xml||msg.text()||'')
        if(msg.type()==='revoke'||/<sysmsg\b[^>]*type=["']revokemsg["']/i.test(revokeXML)){
            const id=revokeXML.match(/<newmsgid>\s*(?:<!\[CDATA\[)?(\d+)(?:\]\]>)?\s*<\/newmsgid>/)?.[1]
            const peer=[msg.fromId,msg.toId].find(v=>typeof v==='string'&&v.endsWith('@chatroom'))||revokeXML.match(/<session>\s*(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?\s*<\/session>/)?.[1]||(msg.self()?msg.toId:msg.fromId)
            if(id&&peer){
                const original=(await this.all('SELECT id FROM inbox WHERE wxId=? AND remoteId=?',[peer,id]))[0]
                if(original){await this.observeRevoke(peer,id);return}
            }
            // Unmatched recalls are explicit notices, never generic media.
            if(peer&&msg.newMsgId)await this.insert({wxId:peer,remoteId:String(msg.newMsgId),senderId:msg.fromId,body:'消息已撤回',direction:msg.self()?'outgoing':'incoming',type:'revoke_notice',status:'received',timestamp:Number(msg._createTime??msg.date())||Math.floor(Date.now()/1000),telegramStatus:'excluded'})
            return
        }
        const callStatus = getWechatCallStatus(msg._xml || msg.text())
        const type = callStatus ? 'voip' : String(msg.type() || 'unknown')
        if(isNoiseMessage(type,String(msg.text()||''),String(msg._xml||msg.text()||'')))return
        const outgoing = msg.self()
        const room = await msg.room()
        const contact = outgoing ? await msg.to() : await msg.from()
        const sender = await msg.from()
        const rawRoom=[msg.fromId,msg.toId].find(id=>typeof id==='string'&&id.endsWith('@chatroom'))
        const wxId = room?.chatroomId || rawRoom || contact?._wxid || (outgoing ? msg.toId : msg.fromId)
        if (!wxId || !msg.newMsgId || ['undefined','null','0'].includes(String(msg.newMsgId))) return
        const body = callStatus || (type.toLowerCase() === 'text' || type === '1' ? String(msg.text() || '') : '')
        const codes={image:3,voice:34,video:43,emoji:47,file:49,link:49,contact:42,location:48,text:1,quote:49,voip:callStatus?50:10002}
        const createdAt=Number(msg._createTime??msg.date())||Math.floor(Date.now()/1000)
        const source=JSON.stringify({MsgId:String(msg._msgId||0),FromUserName:msg.fromId,ToUserName:msg.toId,NewMsgId:msg.newMsgId,CreateTime:createdAt,MsgType:codes[type]||0,Content:msg._xml||msg.text(),xml:msg._xml})
        await this.insert({wxId,remoteId:String(msg.newMsgId),senderId:sender?._wxid||msg.fromId,senderName:sender?.name?.()||'',body,direction:outgoing?'outgoing':'incoming',type,status:outgoing?'submitted':'received',timestamp:createdAt,telegramStatus:!callStatus&&['unknown','file_start','add_friend','voip','new_monment_timeline','real_time_location'].includes(type)?'excluded':'pending',telegramTracked:1,source:source.length<=524288?source:null})
    }
    async byId(id:number) {return (await this.all('SELECT * FROM inbox WHERE id=?',[id]))[0]}
    async claimSync(id:number) {
        await this.ready
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE inbox SET telegramStatus='syncing',telegramTracked=1 WHERE id=? AND telegramStatus NOT IN ('synced','syncing')",[id],function(error){error?reject(error):resolve(this.changes===1)}))
    }
    async claimRevoke(id:number,requestId:string){
        await this.ready
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE inbox SET revokeStatus='revoking',revokeRequestId=? WHERE id=? AND revokeStatus NOT IN ('revoked','revoking')",[requestId,id],function(error){error?reject(error):resolve(this.changes===1)}))
    }
    async claimRecallNotice(key:string,confirm=false){
        await this.run("INSERT OR IGNORE INTO telegram_recalls(key,status) VALUES(?,'none')",[key])
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE telegram_recalls SET status='syncing' WHERE key=? AND (status IN ('none','failed') OR (?=1 AND status='unknown'))",[key,confirm?1:0],function(e){e?reject(e):resolve(this.changes===1)}))
    }
    async observeRevoke(wxId:string,remoteId:string){await this.run("UPDATE inbox SET revokeStatus='revoked',revokedAt=? WHERE wxId=? AND remoteId=?",[Math.floor(Date.now()/1000),wxId,remoteId])}
    async setTelegramStatus(remoteId:string,status:string) {await this.run('UPDATE inbox SET telegramStatus=?,telegramTracked=1 WHERE remoteId=?',[status,remoteId])}
    async recents() {
        return this.all("SELECT i.wxId,i.timestamp,i.body,i.type,i.id AS sequence FROM inbox i WHERE i.hidden=0 AND i.id=(SELECT j.id FROM inbox j WHERE j.hidden=0 AND j.wxId=i.wxId ORDER BY j.timestamp DESC,j.id DESC LIMIT 1)")
    }
    beginSend(wxId:string) {
        let release:()=>void
        const promise=new Promise<void>(resolve=>{release=resolve})
        this.pendingSends.set(wxId,promise)
        return ()=>{release();if(this.pendingSends.get(wxId)===promise)this.pendingSends.delete(wxId)}
    }
    async isManagedEcho(msg:any) {
        if(!msg.self())return false
        const peer=[msg.toId,msg.fromId].find(id=>typeof id==='string'&&id.endsWith('@chatroom'))||msg.toId
        const pending=this.pendingSends.get(peer)
        if(pending)await pending
        return (await this.all('SELECT id FROM inbox WHERE remoteId=? AND requestId IS NOT NULL',[String(msg.newMsgId)])).length>0
    }
    async close() {await this.ready; return new Promise<void>((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()))}
}
