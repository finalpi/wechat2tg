import sqlite3 from 'sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import {isControlMessage,isNoiseMessage} from './message-visibility'
import {getWechatCallStatus} from '../util/WechatCallStatus'
import {cleanMediaBody} from './message-body'

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
    private pendingSends = new Map<string, Set<{promise:Promise<void>;origin:string}>>()
    private managedReceipts = new Map<string,number>()
    private recallBackfills = new Map<string,Promise<void>>()
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
                            const hide="UPDATE inbox SET hidden=1,telegramStatus='excluded',telegramTracked=0 WHERE (type NOT IN ('text','0','1') AND (COALESCE(source,'') LIKE '%<name>HandOffMaster</name>%' OR COALESCE(source,'') LIKE '%<handofflist%' OR (type='unknown' AND COALESCE(source,'') LIKE '%<op id=%'))) OR type IN ('file_start','new_monment_timeline') OR (type IN ('unknown','text','0') AND trim(body)='' AND COALESCE(source,'')='' AND attachmentId IS NULL AND details IS NULL);"
                            this.db.exec(sql+migration+hide+"UPDATE inbox SET hidden=1 WHERE type='revoke' OR source LIKE '%<revokemsg>%' OR source LIKE '%<revokemsg %';"+"CREATE UNIQUE INDEX IF NOT EXISTS inbox_revoke_request ON inbox(revokeRequestId); UPDATE inbox SET telegramStatus='unknown' WHERE telegramStatus='syncing'; UPDATE inbox SET revokeStatus='unknown' WHERE revokeStatus='revoking'; UPDATE inbox SET revokeTelegramStatus='unknown' WHERE revokeTelegramStatus='syncing';",e=>e?reject(e):this.hideStoredControls().then(resolve,reject))
                        })
                    })
            })
        })
    }
    private async hideStoredControls() {
        // Run once during initialization, including old rows mistakenly marked
        // pending/synced. Do not remove source data or actual system notices.
        const rows:any[]=await new Promise((resolve,reject)=>this.db.all("SELECT id,type,source FROM inbox WHERE type NOT IN ('text','0','1') AND (type='function_msg' OR source LIKE '%functionmsg%' OR source LIKE '%gamecenter%' OR source LIKE '%<newcount>%')",(error,rows)=>error?reject(error):resolve(rows)))
        const ids=rows.filter(row=>isControlMessage(row.type,row.source||'')).map(row=>row.id)
        for(let start=0;start<ids.length;start+=400){
            const batch=ids.slice(start,start+400)
            await new Promise<void>((resolve,reject)=>this.db.run(`UPDATE inbox SET hidden=1,telegramStatus='excluded',telegramTracked=0 WHERE id IN (${batch.map(()=>'?').join(',')})`,batch,error=>error?reject(error):resolve()))
        }
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
        if(isControlMessage(message.type,message.source||'')||isNoiseMessage(message.type,message.body,message.source||'')&&!message.attachmentId&&!message.details)await this.run("UPDATE inbox SET hidden=1,telegramStatus='excluded',telegramTracked=0 WHERE wxId=? AND remoteId=?",[message.wxId,message.remoteId])
        return (await this.all('SELECT * FROM inbox WHERE requestId = ? OR (wxId = ? AND remoteId = ?) ORDER BY id DESC LIMIT 1', [message.requestId ?? null, message.wxId, message.remoteId ?? null]))[0]
    }
    async byRequest(requestId: string) {return (await this.all('SELECT * FROM inbox WHERE requestId = ?', [requestId]))[0]}
    async importHistory(messages:InboxMessage[]){
        const keys=['wxId','remoteId','senderId','senderName','body','direction','type','status','timestamp','telegramStatus','source','bodyFormat','hidden']
        for(let start=0;start<messages.length;start+=40){
            const batch=messages.slice(start,start+40).map(message=>isNoiseMessage(message.type,message.body,message.source||'')?{...message,telegramStatus:'excluded'}:message)
            const values=batch.flatMap(m=>keys.map(key=>key==='hidden'?Number(isNoiseMessage(m.type,m.body,m.source||'')):m[key]??null))
            await this.run(`INSERT INTO inbox (${keys.join(',')}) VALUES ${batch.map(()=>`(${keys.map(()=>'?').join(',')})`).join(',')} ON CONFLICT(wxId,remoteId) DO UPDATE SET
                telegramStatus=CASE WHEN excluded.hidden=1 THEN 'excluded' WHEN inbox.telegramTracked=0 AND inbox.telegramStatus IN ('none','pending') THEN excluded.telegramStatus ELSE inbox.telegramStatus END,
                telegramTracked=CASE WHEN excluded.hidden=1 THEN 0 ELSE inbox.telegramTracked END,
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
    async byRemoteId(wxId:string,remoteId:string) {return (await this.all('SELECT * FROM inbox WHERE wxId=? AND remoteId=?',[wxId,remoteId]))[0]}
    async context(wxId:string,id:number) {
        const target=await this.byId(id)
        if(!target||target.hidden||target.wxId!==wxId)return null
        const [older,newer]=await Promise.all([
            this.all('SELECT * FROM inbox WHERE hidden=0 AND wxId=? AND (timestamp<? OR (timestamp=? AND id<?)) ORDER BY timestamp DESC,id DESC LIMIT 26',[wxId,target.timestamp,target.timestamp,id]),
            this.all('SELECT * FROM inbox WHERE hidden=0 AND wxId=? AND (timestamp>? OR (timestamp=? AND id>?)) ORDER BY timestamp,id LIMIT 25',[wxId,target.timestamp,target.timestamp,id])
        ])
        const messages=[...older.slice(0,25).reverse(),target,...newer.slice(0,24)].map(({source,details,...message})=>({...message,details:details?JSON.parse(details):null}))
        return {messages,hasMore:older.length>25,hasNewer:newer.length>24,before:messages[0]?.id||0,targetId:id}
    }
    async observe(msg: any) {
        const revokeXML=String(msg._xml||msg.text()||'')
        if(msg.type()==='revoke'||/<sysmsg\b[^>]*type=["']revokemsg["']/i.test(revokeXML)){
            const id=revokeXML.match(/<newmsgid>\s*(?:<!\[CDATA\[)?(\d+)(?:\]\]>)?\s*<\/newmsgid>/)?.[1]
            const peer=[msg.fromId,msg.toId].find(v=>typeof v==='string'&&v.endsWith('@chatroom'))||revokeXML.match(/<session>\s*(?:<!\[CDATA\[)?([^<]+?)(?:\]\]>)?\s*<\/session>/)?.[1]||(msg.self()?msg.toId:msg.fromId)
            if(id&&peer){
                await this.observeRevoke(peer,id,{timestamp:Number(msg._createTime??msg.date())||Math.floor(Date.now()/1000),senderId:msg.fromId,direction:msg.self()?'outgoing':'incoming'})
                return
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
        const waiting=outgoing?[...(this.pendingSends.get(wxId)||[])]:[]
        if(waiting.length)await Promise.all(waiting.map(send=>send.promise))
        if(outgoing){
            const managed=await this.byRemoteId(wxId,String(msg.newMsgId))
            if(managed?.requestId){
                // A native echo may contain a numeric MsgId missing from the
                // HTTP receipt (some SDK media responses use a local UUID).
                // Enrich only the exact same native message, never its text.
                const nativeId=typeof msg._msgId==='number'&&!Number.isSafeInteger(msg._msgId)?'':String(msg._msgId??'')
                const validId=(value:any)=>(typeof value!=='number'||Number.isSafeInteger(value))&&/^[1-9]\d{0,19}$/.test(String(value||''))&&BigInt(String(value))<=18446744073709551615n
                let source:any;try{source=JSON.parse(managed.source||'{}')}catch{source={}}
                if(validId(nativeId)&&!validId(source.ClientMsgId||source.MsgId)){
                    source.MsgId=nativeId;source.ClientMsgId=nativeId
                    await this.run('UPDATE inbox SET source=? WHERE id=?',[JSON.stringify(source),managed.id])
                }
                return
            }
            if(this.managedReceipts.has(`${wxId}:${msg.newMsgId}`))return
        }
        const body = callStatus || (type.toLowerCase() === 'text' || type === '1' ? String(msg.text() || '') : '')
        const codes={image:3,voice:34,video:43,emoji:47,file:49,link:49,contact:42,location:48,text:1,quote:49,voip:callStatus?50:10002}
        const createdAt=Number(msg._createTime??msg.date())||Math.floor(Date.now()/1000)
        const source=JSON.stringify({MsgId:String(msg._msgId||0),FromUserName:msg.fromId,ToUserName:msg.toId,NewMsgId:msg.newMsgId,CreateTime:createdAt,MsgType:codes[type]||0,Content:msg._xml||msg.text(),xml:msg._xml})
        // Without an exact native ID, preserve independent phone messages and
        // leave an unresolved Telegram send unknown instead of guessing a pair.
        await this.insert({wxId,remoteId:String(msg.newMsgId),senderId:sender?._wxid||msg.fromId,senderName:sender?.name?.()||'',body,direction:outgoing?'outgoing':'incoming',type,status:outgoing?'submitted':'received',timestamp:createdAt,telegramStatus:!callStatus&&['unknown','file_start','add_friend','voip','new_monment_timeline','real_time_location'].includes(type)?'excluded':'pending',telegramTracked:1,source:source.length<=524288?source:null})
    }
    async byId(id:number) {return (await this.all('SELECT * FROM inbox WHERE id=?',[id]))[0]}
    async claimSync(id:number) {
        await this.ready
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE inbox SET telegramStatus='syncing',telegramTracked=1 WHERE id=? AND hidden=0 AND telegramStatus NOT IN ('synced','syncing','excluded')",[id],function(error){error?reject(error):resolve(this.changes===1)}))
    }
    async claimRevoke(id:number,requestId:string){
        await this.ready
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE inbox SET revokeStatus='revoking',revokeRequestId=? WHERE id=? AND revokeStatus NOT IN ('revoked','revoking')",[requestId,id],function(error){error?reject(error):resolve(this.changes===1)}))
    }
    async claimRecallNotice(key:string,confirm=false){
        await this.run("INSERT OR IGNORE INTO telegram_recalls(key,status) VALUES(?,'none')",[key])
        return new Promise<boolean>((resolve,reject)=>this.db.run("UPDATE telegram_recalls SET status='syncing' WHERE key=? AND (status IN ('none','failed') OR (?=1 AND status='unknown'))",[key,confirm?1:0],function(e){e?reject(e):resolve(this.changes===1)}))
    }
    async observeRevoke(wxId:string,remoteId:string,options:{timestamp?:number;senderId?:string;direction?:'incoming'|'outgoing'}={}){
        if(!wxId||!remoteId||remoteId.startsWith('revoke:'))return
        const timestamp=Number.isFinite(options.timestamp)&&options.timestamp>=0?Math.floor(options.timestamp):Math.floor(Date.now()/1000)
        await this.run("UPDATE inbox SET revokeStatus='revoked',revokedAt=COALESCE(revokedAt,?) WHERE wxId=? AND remoteId=? AND type<>'revoke_notice'",[timestamp,wxId,remoteId])
        const original=await this.byRemoteId(wxId,remoteId)
        const visible=original&&!original.hidden&&original.type!=='revoke_notice'?original:null
        const text=(value:any)=>String(value||'').replace(/<[^>]*>/g,'').replace(/^👤\s*/,'').trim()
        const type=String(visible?.type||'').toLowerCase(),labels={image:'图片',video:'视频',voice:'语音',audio:'音频',emoji:'表情',file:'文件',link:'链接',quote:'引用消息',chat_histroy:'聊天记录',contact:'名片',location:'位置'}
        let preview=`[${labels[type]||'消息'}]`
        const safeText=(candidate:string)=>{
            if(/<(?:\?xml|msg|sysmsg|recordinfo|appmsg)\b|&lt;(?:msg|sysmsg|recordinfo|appmsg)\b/i.test(candidate))return ''
            if(/^\s*\{/.test(candidate)){try{const packet=JSON.parse(candidate);if(packet.Content!==undefined||packet.xml!==undefined||packet.fileAesKey!==undefined||packet.cdnDataKey!==undefined)return ''}catch{}}
            return text(candidate).slice(0,500)
        }
        if(visible&&['text','0','1','quote'].includes(type)){
            let candidate=String(visible.body||'')
            if(type==='quote'){try{candidate=String(JSON.parse(visible.details||'{}').title||candidate)}catch{}}
            // Some legacy rows stored raw transport XML as their visible body.
            // Do not turn its private fields into a quote preview by stripping tags.
            preview=safeText(candidate)||preview
        }else if(visible&&labels[type]){
            let title='';try{title=String(JSON.parse(visible.details||'{}').title||'')}catch{}
            const caption=cleanMediaBody(type,String(visible.body||''),visible.source)
            const summary=safeText(title)||safeText(caption)
            if(summary)preview=`${preview} ${summary}`.slice(0,500)
        }
        const codes={text:1,image:3,voice:34,video:43,emoji:47,file:49,link:49,quote:49,chat_histroy:49,location:48,contact:42}
        const replyTo={...(visible?{id:visible.id}:{}),remoteId,wxId,name:text(visible?.senderName||visible?.senderId||'').slice(0,200),preview,type:codes[type]||1}
        const details=JSON.stringify({replyTo})
        const notice=await this.insert({wxId,remoteId:`revoke:${remoteId}`,senderId:options.senderId||visible?.senderId||'',senderName:visible?.senderName||'',body:'消息已撤回',direction:options.direction||visible?.direction||'incoming',type:'revoke_notice',status:'received',timestamp:original?.revokedAt??timestamp,telegramStatus:'excluded',details})
        // A callback may precede the original import. Enrich the same notice
        // once the original exists, preserving its first observed event time.
        if(notice&&visible&&notice.details!==details){await this.run('UPDATE inbox SET details=? WHERE id=?',[details,notice.id]);notice.details=details}
        return notice
    }
    async ensureRevokeNotices(wxId:string){
        if(!this.recallBackfills.has(wxId)){
            const pending=(async()=>{
                const rows=await this.all("SELECT remoteId,revokedAt,timestamp FROM inbox WHERE wxId=? AND hidden=0 AND revokeStatus='revoked' AND type<>'revoke_notice' AND remoteId IS NOT NULL",[wxId])
                for(const row of rows)await this.observeRevoke(wxId,row.remoteId,{timestamp:row.revokedAt??row.timestamp??0})
            })()
            this.recallBackfills.set(wxId,pending)
            void pending.catch(()=>this.recallBackfills.delete(wxId))
        }
        await this.recallBackfills.get(wxId)
        const missing=await this.all("SELECT o.remoteId,n.timestamp FROM inbox n JOIN inbox o ON o.wxId=n.wxId AND n.remoteId='revoke:'||o.remoteId WHERE n.wxId=? AND n.type='revoke_notice' AND o.hidden=0 AND o.type<>'revoke_notice' AND (o.revokeStatus<>'revoked' OR COALESCE(n.details,'') NOT LIKE '%\"id\":%')",[wxId])
        for(const row of missing)await this.observeRevoke(wxId,row.remoteId,{timestamp:row.timestamp})
    }
    async setTelegramStatus(remoteId:string,status:string) {await this.run('UPDATE inbox SET telegramStatus=?,telegramTracked=1 WHERE remoteId=?',[status,remoteId])}
    async recents() {
        return this.all("SELECT i.wxId,i.timestamp,i.body,i.type,i.id AS sequence FROM inbox i WHERE i.hidden=0 AND i.id=(SELECT j.id FROM inbox j WHERE j.hidden=0 AND j.wxId=i.wxId ORDER BY j.timestamp DESC,j.id DESC LIMIT 1)")
    }
    beginSend(wxId:string,origin='webui') {
        let release:()=>void
        const promise=new Promise<void>(resolve=>{release=resolve})
        const pending=this.pendingSends.get(wxId)||new Set(),entry={promise,origin}
        pending.add(entry);this.pendingSends.set(wxId,pending)
        return ()=>{release();pending.delete(entry);if(!pending.size&&this.pendingSends.get(wxId)===pending)this.pendingSends.delete(wxId)}
    }
    rememberManagedReceipt(wxId:string,remoteId:string){
        const now=Date.now();for(const [key,expires] of this.managedReceipts)if(expires<now)this.managedReceipts.delete(key)
        this.managedReceipts.set(`${wxId}:${remoteId}`,now+600000)
        if(this.managedReceipts.size>2000)this.managedReceipts.delete(this.managedReceipts.keys().next().value)
    }
    async completeManagedSend(id:number,remoteId:string,source:string,timestamp:number){
        // OR REPLACE removes only an unowned exact-ID echo. A separate managed
        // send with the same ID must never be overwritten by a bad receipt.
        const row=await this.byId(id)
        if(!row)return
        this.rememberManagedReceipt(row.wxId,remoteId)
        await this.run("UPDATE OR REPLACE inbox SET remoteId=?,source=?,timestamp=?,status='submitted',telegramStatus='synced',telegramTracked=0 WHERE id=? AND NOT EXISTS(SELECT 1 FROM inbox other WHERE other.wxId=inbox.wxId AND other.remoteId=? AND other.id<>inbox.id AND other.requestId IS NOT NULL)",[remoteId,source,timestamp,id,remoteId])
    }
    async isManagedEcho(msg:any) {
        if(!msg.self())return false
        const peer=[msg.toId,msg.fromId].find(id=>typeof id==='string'&&id.endsWith('@chatroom'))||msg.toId
        const pending=[...(this.pendingSends.get(peer)||[])]
        if(pending.length)await Promise.all(pending.map(send=>send.promise))
        if(this.managedReceipts.has(`${peer}:${msg.newMsgId}`))return true
        const row=await this.byRemoteId(peer,String(msg.newMsgId))
        return Boolean(row?.requestId)
    }
    async close() {await this.ready; return new Promise<void>((resolve, reject) => this.db.close(error => error ? reject(error) : resolve()))}
}
