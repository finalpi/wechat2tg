import BaseMessage from '../base/BaseMessage'
import {WebMessageStore} from './message-store'
import {WebMediaStore} from './media'
import {cleanMediaBody} from './message-body'

export interface TelegramOutboxEntry {
    id?:number
    requestId:string
    wxId:string
    duplicate:boolean
}
export interface TelegramOutboxContext {wxId:string;selfId:string;selfName?:string;quote?:any}
export interface TelegramWireInfo {body?:string;quote?:any;wireType?:number;appType?:number;source?:string}

const remoteId=(value:any):string=>{
    if(typeof value==='number'&&!Number.isSafeInteger(value))return ''
    const id=String(value??'')
    return /^[1-9]\d{0,19}$/.test(id)&&BigInt(id)<=18446744073709551615n?id:''
}
const parse=(value:string)=>{try{return JSON.parse(value||'{}')}catch{return {}}}
const publicText=(value:any)=>String(value??'').replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').slice(0,500)
const kindFor=(message:BaseMessage)=>{
    if(!message.file)return 'text'
    const file=message.file,name=file.fileName
    if(name.endsWith('.mp4'))return 'video'
    if(name.startsWith('语音')&&name.endsWith('mp3'))return 'voice'
    if(name.endsWith('.gif'))return 'emoji'
    if(/\.(png|jpg|jpeg|bmp|webp)$/i.test(name))return 'image'
    return ({photo:'image',animation:'emoji',voice:'voice',audio:'audio',video:'video'}[file.sendType]||'file')
}
const wireFor=(type:string)=>({text:1,quote:49,image:3,emoji:47,voice:34,video:43,audio:49,file:49}[type]||1)

/** Journal Telegram-origin sends without participating in the delivery retry loop. */
export class TelegramOutbox {
    private static instance:TelegramOutbox
    private accepting:Promise<any>=Promise.resolve()
    private accepted=new Map<string,TelegramOutboxEntry>()
    static getInstance(){
        if(!this.instance){const store=WebMessageStore.getInstance();this.instance=new TelegramOutbox(store,new WebMediaStore(store))}
        return this.instance
    }
    constructor(private store:WebMessageStore,private media:WebMediaStore,private onError:()=>void=()=>console.warn('WebUI Telegram send journal could not be updated')){}
    private report(){try{this.onError()}catch{}}
    private rememberAccepted(key:string,entry:TelegramOutboxEntry){
        this.accepted.set(key,entry)
        while(this.accepted.size>5000)this.accepted.delete(this.accepted.keys().next().value)
    }
    private async replyTo(quote:any,wxId:string){
        const id=remoteId(quote?.wxMsgId||quote?.remoteId)
        if(!id)return null
        const row=await this.store.byRemoteId(wxId,id)
        const type=String(row?.type||quote?.source_type||'text')
        const raw=cleanMediaBody(type,String(row?.body||quote?.content||''),row?.source)
        const packet=/^\s*\{/.test(raw)?parse(raw):{}
        const transport=/<(?:\?xml|msg|sysmsg|appmsg)\b/i.test(raw)||['Content','xml','fileAesKey','cdnDataKey'].some(key=>packet[key]!==undefined)
        const preview=transport?`[${type}]`:publicText(raw)||`[${type}]`
        return {...(row&&!row.hidden?{id:row.id}:{}),remoteId:id,wxId,name:publicText(row?.senderName||quote?.sender||quote?.wxSenderId||''),preview,type:wireFor(type)}
    }
    async begin(message:BaseMessage,context:TelegramOutboxContext):Promise<TelegramOutboxEntry|null>{
        if(process.env.WEBUI_ENABLED==='false')return null
        const part=message.file?'media':'text',requestId=`telegram:${message.chatId}:${message.id}:${part}`
        const fallback:TelegramOutboxEntry={requestId,wxId:context.wxId,duplicate:false}
        const accepted=this.accepted.get(requestId)
        if(accepted)return {...accepted,duplicate:true}
        // Reserve before touching SQLite: a journal outage must not turn a
        // repeated Telegram update (even a fresh JS object) into another send.
        this.rememberAccepted(requestId,fallback)
        const operation=this.accepting.then(async()=>{
            try{
                const previous=await this.store.byRequest(requestId)
                if(previous){const entry={...fallback,id:previous.id,duplicate:true};this.rememberAccepted(requestId,entry);return entry}
                const kind=kindFor(message),file=message.file
                const body=file&&String(message.content||'')===file.fileName?'':String(message.content??'')
                const details:any={origin:'telegram',telegram:{chatId:String(message.chatId),messageId:String(message.id),part}}
                if(context.quote){const reply=await this.replyTo(context.quote,context.wxId);if(reply)details.replyTo=reply}
                if(file)Object.assign(details,{title:file.fileName,size:file.file.length})
                const type=kind==='text'&&details.replyTo?'quote':kind
                const source={FromUserName:context.selfId,ToUserName:context.wxId,MsgType:wireFor(type),...(wireFor(type)===49?{AppType:type==='quote'?57:6}:{}),Content:body}
                const row=await this.store.insert({requestId,wxId:context.wxId,senderId:context.selfId,senderName:context.selfName||context.selfId,body,direction:'outgoing',type,status:'sending',timestamp:Math.floor(Date.now()/1000),telegramStatus:'synced',telegramTracked:0,details:JSON.stringify(details),source:JSON.stringify(source)})
                const entry={...fallback,id:row.id}
                this.rememberAccepted(requestId,entry)
                if(file){
                    try{
                        const saved=await this.media.save(file.fileName,kind==='voice'?'voice':'auto',(async function*(){yield file.file})())
                        await this.store.run('UPDATE inbox SET attachmentId=?,details=? WHERE id=?',[saved.id,JSON.stringify({...details,title:saved.name,size:saved.size,mime:saved.mime}),row.id])
                    }catch{this.report();await this.store.run('UPDATE inbox SET details=? WHERE id=?',[JSON.stringify({...details,attachmentUnavailable:true}),row.id]).catch(()=>{})}
                }
                return entry
            }catch{this.report();return fallback}
        })
        this.accepting=operation.catch(()=>{})
        return operation
    }
    async attempt(entry:TelegramOutboxEntry|null,info:TelegramWireInfo={}):Promise<()=>void>{
        if(!entry)return ()=>{}
        const release=this.store.beginSend(entry.wxId,'telegram')
        try{
            if(entry.id){
                const row=await this.store.byId(entry.id),details=parse(row?.details),source=parse(row?.source)
                if(info.quote){const quote=await this.replyTo(info.quote,entry.wxId);if(quote)details.replyTo=quote}
                if(info.source!==undefined){source.Content=info.source;source.xml=info.source}
                if(info.wireType!==undefined)source.MsgType=info.wireType
                if(info.appType!==undefined)source.AppType=info.appType
                const type=['text','quote'].includes(row.type)&&details.replyTo?'quote':row.type
                if(type==='quote'){source.MsgType=49;source.AppType=57}
                await this.store.run("UPDATE inbox SET status='sending',timestamp=?,body=?,type=?,details=?,source=?,telegramStatus='synced',telegramTracked=0 WHERE id=?",[Math.floor(Date.now()/1000),info.body!==undefined?info.body:row.body,type,JSON.stringify(details),JSON.stringify(source),entry.id])
            }
        }catch{this.report()}
        return release
    }
    async complete(entry:TelegramOutboxEntry|null,receipt:any,info:TelegramWireInfo={}):Promise<void>{
        if(!entry)return
        const nativeId=remoteId(receipt?.newMsgId)
        if(nativeId&&(!receipt.toWxid||receipt.toWxid===entry.wxId))this.store.rememberManagedReceipt(entry.wxId,nativeId)
        try{
            if(!entry.id)return
            const row=await this.store.byId(entry.id)
            if(!row)return
            if(!nativeId||receipt.toWxid&&receipt.toWxid!==entry.wxId){await this.store.run("UPDATE inbox SET status='unknown' WHERE id=?",[entry.id]);return}
            const echo=await this.store.byRemoteId(entry.wxId,nativeId)
            const source={...parse(row.source),...(echo&&!echo.requestId?parse(echo.source):{})}
            if(info.source!==undefined){source.Content=info.source;source.xml=info.source}
            if(info.wireType!==undefined)source.MsgType=info.wireType
            if(info.appType!==undefined)source.AppType=info.appType
            const time=Number(receipt.createTime),timestamp=Number.isFinite(time)&&time>0?Math.floor(time):row.timestamp
            const clientId=remoteId(receipt.msgId)||remoteId(source.ClientMsgId)||remoteId(source.MsgId)
            Object.assign(source,{NewMsgId:nativeId,MsgId:clientId,ClientMsgId:clientId,CreateTime:timestamp,ToUserName:entry.wxId})
            await this.store.completeManagedSend(entry.id,nativeId,JSON.stringify(source),timestamp)
            const final=await this.store.byId(entry.id)
            if(final?.remoteId!==nativeId)await this.store.run("UPDATE inbox SET status='unknown' WHERE id=?",[entry.id])
        }catch{this.report();if(entry.id)await this.store.run("UPDATE inbox SET status='unknown' WHERE id=? AND status='sending'",[entry.id]).catch(()=>{})}
    }
    async fail(entry:TelegramOutboxEntry|null,error:any,{attempted}:{attempted:boolean}):Promise<void>{
        if(!entry?.id)return
        try{
            const rejected=error?.code==='wechatSendRejected'||error?.deliveryRejected===true
            const status=!attempted||rejected?'failed':'unknown'
            await this.store.run('UPDATE inbox SET status=?,telegramStatus=\'synced\',telegramTracked=0 WHERE id=? AND status<>\'submitted\'',[status,entry.id])
        }catch{this.report()}
    }
}
