import {AppDataSource, getGeWeChatDataSource} from '../data-sourse'
import {AbstractClient} from '../base/BaseClient'
import {BindGroup} from '../entity/BindGroup'
import {WxContact} from '../entity/WxContact'
import {WxRoom} from '../entity/WxRoom'
import {Message} from '../entity/Message'
import {WebMessageStore} from './message-store'
import {WebMediaStore,MediaFile} from './media'
import {Message as WxMessage} from 'wx2tg-puppet'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {BindGroupService} from '../service/BindGroupService'
import {ConfigurationService} from '../service/ConfigurationService'
import {config} from '../config'
import BaseMessage from '../base/BaseMessage'
import {loadAvatar} from './avatars'
import {getChatHistory} from '../util/handleMsg'
import {parseTranscript,transcriptAttachments,publicTranscriptAttachments} from './transcripts'
import {MAX_MEDIA_BYTES} from './media'
import {createGroupMentionService,normalizeMentions,Mentions} from './mentions'
import {quoteReference,quoteXML,sendQuote} from './quotes'
import {revokePayload,revokeWechat,revokePolicy} from './revoke'
import {annotateTelegramRecall} from './telegram-recall'
import {FormatUtils} from '../util/FormatUtils'

export interface MessageCenterAdapter {
    status(): Promise<unknown>
    contacts(query: string, kind: string, offset: number): Promise<unknown>
    history(wxId: string, before: number, query: string): Promise<unknown>
    send(wxId: string, body: string, requestId: string, attachmentId?:string,mentions?:Mentions,replyToId?:number): Promise<unknown>
    groupMembers(wxId:string,query:string,offset:number,refresh?:boolean):Promise<unknown>
    revoke(id:number,requestId:string,confirmUncertain?:boolean):Promise<unknown>
    conversations(offset:number):Promise<unknown>
    newMessages(cursor:number|undefined,wxId:string|undefined,limit:number):Promise<unknown>
    sendStatus(requestId:string):Promise<unknown>
    upload?(name:string,preference:string,stream:AsyncIterable<Uint8Array>):Promise<unknown>
    media?(id:string):Promise<MediaFile>
    attachment?(messageId:number):Promise<MediaFile>
    sync?(messageId:number,confirm:boolean):Promise<unknown>
    avatar?(wxId:string):Promise<Buffer>
    transcriptAttachment?(messageId:number,path:string,id:string):Promise<MediaFile>
}
export class MessageCenterError extends Error {
    constructor(public code: string, public status = 400) {super(code)}
}

export function createMessageCenter(store = WebMessageStore.getInstance(),media = new WebMediaStore(store)): MessageCenterAdapter {
    const mentionService=createGroupMentionService(()=>client()?.hasLogin?(client() as any)?.wxInfo?.wxid||'':'')
    const revoking=new Map<number,Promise<any>>(),revokeSync=new Map<number,Promise<void>>()
    const syncRevocation=(id:number,confirm=false)=>{
        if(revokeSync.has(id))return
        const operation=(async()=>{
            await store.run("UPDATE inbox SET revokeTelegramStatus='syncing' WHERE id=?",[id])
            try{
                if(synchronization.has(id))await synchronization.get(id)
                const row=await store.byId(id),binding=await AppDataSource.getRepository(BindGroup).findOneBy({wxId:row.wxId})
                const original=binding?await AppDataSource.getRepository(Message).findOneBy({wxMsgId:row.remoteId,chatId:binding.chatId}):null
                if(binding){
                    const bot:any=AbstractClient.getSpyClient('botClient')
                    if(!bot?.hasLogin||!bot.client?.telegram)throw new Error('offline')
                    const language=(await ConfigurationService.getInstance().getConfig()).language
                    const notice=language==='en-US'?'Message revoked':'消息已撤回'
                    const body=original?.type===1?original.sender||'':original?FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY,original.sender||'',original.content||''):''
                    await annotateTelegramRecall(store,bot.client.telegram,row.wxId,row.remoteId,binding.chatId,original,body,notice,undefined,confirm)
                }
                await store.run("UPDATE inbox SET revokeTelegramStatus='synced' WHERE id=?",[id])
            }catch{await store.run("UPDATE inbox SET revokeTelegramStatus='failed' WHERE id=?",[id])}
        })()
        revokeSync.set(id,operation);void operation.finally(()=>revokeSync.delete(id)).catch(()=>{})
    }
    const imported = new Set<string>()
    let sendQueue = Promise.resolve()
    let pending = 0
    let accepting = Promise.resolve()
    const client = () => AbstractClient.getSpyClient('wxClient')
    let ownershipRepair:Promise<void>
    const repairOwnership=async()=>{
        const selfId=(client() as any)?.wxInfo?.wxid
        if(!selfId)return
        if(!ownershipRepair)ownershipRepair=(async()=>{
            const wrong=await store.all('SELECT * FROM inbox WHERE wxId=? AND hidden=0 AND requestId IS NULL',[selfId])
            for(const row of wrong){
                const legacy=/^legacy:(\d+)$/.exec(row.remoteId||'')
                const matches=await AppDataSource.query(`SELECT b.wxId,m.wxSenderId,m.toWxid FROM message m LEFT JOIN bind_group b ON b.chatId=m.chatId WHERE ${legacy?'m.id=?':'m.wxMsgId=?'} ORDER BY m.tgBotMsgId DESC LIMIT 1`,[legacy?Number(legacy[1]):row.remoteId])
                const m=matches[0]
                let peer=m?.wxId||(m?.wxSenderId===selfId?m.toWxid:m?.wxSenderId)
                if(!peer&&row.source){try{const s=JSON.parse(row.source);peer=[s.FromUserName,s.ToUserName].find(id=>id&&id!==selfId)}catch{}}
                if(!peer||peer===selfId)continue
                const existing=(await store.all('SELECT id FROM inbox WHERE wxId=? AND remoteId=?',[peer,row.remoteId]))[0]
                if(existing){
                    await store.run('UPDATE inbox SET attachmentId=COALESCE(attachmentId,?),source=COALESCE(source,?) WHERE id=?',[row.attachmentId,row.source,existing.id])
                    await store.run('UPDATE inbox SET hidden=1 WHERE id=?',[row.id])
                }else await store.run('UPDATE inbox SET wxId=? WHERE id=?',[peer,row.id])
            }
        })()
        await ownershipRepair
    }
    const synchronization=new Map<number,Promise<void>>()
    const escape=(text:string)=>String(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const avatar=async(wxId:string)=>{
        let url=''
        if(getGeWeChatDataSource().isInitialized){
            const group=wxId.endsWith('@chatroom')
            const row:any=await getGeWeChatDataSource().getRepository(group?WxRoom as any:WxContact as any).findOneBy(group?{chatroomId:wxId}:{userName:wxId})
            url=row?.smallHeadImgUrl||row?.bigHeadImgUrl||''
        }
        if(!url)url=(await AppDataSource.getRepository(BindGroup).findOneBy({wxId}))?.avatarLink||''
        return loadAvatar(url)
    }
    const reconcile=async()=>{
        await store.run("UPDATE inbox SET telegramStatus='unverified' WHERE telegramTracked=0 AND telegramStatus IN ('none','pending','syncing','unknown','failed')")
        const pending=await store.all("SELECT DISTINCT remoteId FROM inbox WHERE telegramStatus IN ('unverified','pending','syncing','unknown','failed') AND remoteId IS NOT NULL")
        for(let start=0;start<pending.length;start+=400){
            const ids=pending.slice(start,start+400).map(p=>p.remoteId)
            const rows=await AppDataSource.getRepository(Message).createQueryBuilder('m').select(['m.wxMsgId','m.tgBotMsgId']).where('m.wxMsgId IN (:...ids) AND m.tgBotMsgId > 0',{ids}).getMany()
            if(rows.length)await store.run(`UPDATE inbox SET telegramStatus='synced' WHERE remoteId IN (${rows.map(()=>'?').join(',')})`,rows.map(r=>r.wxMsgId))
        }
    }
    const attachment=async(messageId:number)=>{
        const row=await store.byId(messageId)
        if(!row)throw new MessageCenterError('mediaMissing',404)
        if(row.attachmentId)return media.get(row.attachmentId)
        if(!row.source)throw new MessageCenterError('mediaMissing',404)
        const msg=new WxMessage(JSON.parse(row.source))
        const box=await msg.toFileBox()
        if(!box)throw new MessageCenterError('mediaMissing',404)
        const buffer=await box.toBuffer()
        const result=await media.save(box.name||'attachment.bin','auto',(async function*(){yield buffer})())
        await store.run('UPDATE inbox SET attachmentId=? WHERE id=?',[result.id,messageId])
        return media.get(result.id)
    }
    const transcriptDownload=async(messageId:number,nestedPath:string,attachmentId:string)=>{
        const row=await store.byId(messageId)
        if(!row||row.hidden||!row.source)throw new MessageCenterError('mediaMissing',404)
        const cacheKey=`transcript:${messageId}:${nestedPath}:${attachmentId}`
        const cached=(await store.all('SELECT attachmentId FROM transcript_media WHERE cacheKey=?',[cacheKey]))[0]
        if(cached)return media.get(cached.attachmentId)
        const records=await parseTranscript(row.source)
        const found=transcriptAttachments(records).find(a=>a.path===nestedPath&&a.attachment.id===attachmentId)?.attachment
        if(!found)throw new MessageCenterError('mediaMissing',404)
        if(Number(found.payload?.dataLen)>MAX_MEDIA_BYTES)throw new MessageCenterError('mediaTooLarge',413)
        const bot=AbstractClient.getSpyClient('botClient') as any
        if(!bot?.downloadChatHistoryAttachment)throw new MessageCenterError('messagesUnavailable',503)
        const source=JSON.parse(row.source)
        const stored=Object.assign(new Message(),{wxMsgId:row.remoteId,msgId:String(source.MsgId||''),toWxid:source.ToUserName,wxSenderId:row.senderId,source_text:source.Content})
        const buffer=await bot.downloadChatHistoryAttachment(found,stored)
        const file=await media.save(found.fileName||'attachment.bin','auto',(async function*(){yield buffer})())
        await store.run('INSERT OR REPLACE INTO transcript_media(cacheKey,attachmentId) VALUES(?,?)',[cacheKey,file.id])
        return media.get(file.id)
    }
    const sync=async(id:number,confirm=false)=>{
        await reconcile()
        let row=await store.byId(id)
        if(!row||!row.remoteId||!['submitted','received'].includes(row.status))throw new MessageCenterError('messageNotSubmitted',409)
        if(row.revokeStatus==='revoked'){syncRevocation(id,confirm);return {id,telegramStatus:'syncing'}}
        if(row.telegramStatus==='synced')return {id:row.id,telegramStatus:'synced'}
        if(row.telegramStatus==='excluded')throw new MessageCenterError('messageExcluded',409)
        const bot=AbstractClient.getSpyClient('botClient') as any
        if(!bot?.hasLogin||!bot.mirrorWebUI)throw new MessageCenterError('telegramOffline',503)
        if(synchronization.has(id)||bot.isWebUISyncActive?.(row.remoteId))throw new MessageCenterError('telegramQueued',409)
        if(['unknown','unverified'].includes(row.telegramStatus)&&!confirm)throw new MessageCenterError('syncUncertain',409)
        if(!await store.claimSync(id))throw new MessageCenterError('telegramQueued',409)
        const operation=(async()=>{
            try {
                let binding=await AppDataSource.getRepository(BindGroup).findOneBy({wxId:row.wxId})
                if(!binding){
                    const user=AbstractClient.getSpyClient('userMTPClient')
                    if(!user?.hasLogin)throw new Error('bindingUnavailable')
                    const sdk=client()?.client
                    const room=row.wxId.endsWith('@chatroom')?await sdk.Room.find({id:row.wxId}):null
                    const contact=room?null:await sdk.Contact.find({id:row.wxId})
                    const b=Object.assign(new BindGroup(),{wxId:row.wxId,type:room?1:0,name:room?.name||contact?.name?.()||row.wxId,alias:room?.remark||contact?._alias||'',isReceive:true})
                    binding=await new TelegramGroupOperateService(BindGroupService.getInstance(),user.client).createGroup(b)
                    if(!binding?.chatId)throw new Error('bindingUnavailable')
                }
                const source=row.source?JSON.parse(row.source):null
                const language=(await ConfigurationService.getInstance().getConfig()).language
                const ownName=(client() as any)?.wxInfo?.nickName|| (language==='en-US'?'Me':'我')
                const message:BaseMessage={id:row.remoteId,wxId:row.wxId,chatId:binding.chatId,senderId:row.senderId|| (client() as any)?.wxInfo?.wxid||'',sender:`<b>👤${escape(row.direction==='outgoing'?ownName:row.senderName)}${row.requestId?' · WebUI':''}</b>`,content:escape(row.body),type:0,createTime:row.timestamp,toWxid:row.wxId,msgId:String(source?.ClientMsgId||source?.MsgId||row.remoteId)}
                const detail=row.details?JSON.parse(row.details):{}
                if(detail.replyTo){
                    const original=await AppDataSource.getRepository(Message).findOneBy({wxMsgId:detail.replyTo.remoteId,chatId:binding.chatId})
                    if(original?.tgBotMsgId>0)message.param={reply_id:original.tgBotMsgId}
                    else message.content=`<blockquote>${escape(detail.replyTo.name)}: ${escape(detail.replyTo.preview)}</blockquote>\n${message.content}`
                }
                if(row.attachmentId||['image','video','voice','audio','emoji','file'].includes(row.type)){
                    const file=await attachment(id),prepared=await media.prepare(file)
                    message.type=1;message.file={file:prepared.buffer,fileName:prepared.name,duration:prepared.duration,sendType:prepared.sendType};message.sender+=row.body?'\n'+escape(row.body):''
                }else if(source&&row.type==='location'){message.type=5;message.source_text=source.Content}
                else if(source&&row.type==='contact'){message.type=4;message.source_text=source.Content;message.businessCardId=(await detailsFor(row)).wxId}
                else if(row.type!=='text'){
                    const details=await detailsFor(row)
                    message.content=[escape(details.title||`[${row.type}]`),escape(details.description||''),details.url?`<a href="${escape(details.url).replace(/"/g,'&quot;')}">${escape(details.url)}</a>`:''].filter(Boolean).join('\n')
                }
                if(bot.isWebUISyncActive?.(row.remoteId)){await store.run("UPDATE inbox SET telegramStatus='pending' WHERE id=?",[id]);return}
                const result=await bot.mirrorWebUI(message)
                await store.run('UPDATE inbox SET telegramStatus=? WHERE id=?',[result.success?'synced':result.deliveryUncertain||result.skipRetry?'unknown':'failed',id])
            }catch{await store.run("UPDATE inbox SET telegramStatus='failed' WHERE id=?",[id])}
        })()
        synchronization.set(id,operation)
        void operation.finally(()=>synchronization.delete(id)).catch(()=>{})
        return {id:row.id,telegramStatus:'syncing'}
    }
    const detailsFor=async(row:any)=>{
        if(row.details){const saved=JSON.parse(row.details);if(row.type!=='quote'||saved.replyTo)return saved}
        if(!row.source)return {}
        try{
            const source=JSON.parse(row.source),xml=WxMessage.getXmlToJson(source.xml||source.Content)
            const app=xml.msg?.appmsg,location=xml.msg?.location
            const details:any= row.type==='link'?{title:app?.title||'',description:app?.des||'',url:/^https?:\/\//i.test(app?.url||'')?app.url:''}:row.type==='location'?{title:location?.['@_label']||location?.['@_poiname']||'',latitude:Number(location?.['@_x']),longitude:Number(location?.['@_y'])}:row.type==='contact'?{title:xml.msg?.['@_nickname']||'',wxId:xml.msg?.['@_username']||''}:{title:app?.title||''}
            if(row.type==='quote'&&app?.refermsg){
                const ref=app.refermsg,refType=Number(ref.type)||1
                let preview=refType===1?String(ref.content||''):`[${refType===3?'图片':refType===34?'语音':refType===43?'视频':refType===49?'文件或链接':'消息'}]`
                if(refType===49){try{const quoted=WxMessage.getXmlToJson(String(ref.content||''));preview=quoted.msg?.appmsg?.title||quoted.appmsg?.title||preview}catch{}}
                details.replyTo={remoteId:String(ref.svrid||''),senderId:String(ref.chatusr||''),name:String(ref.displayname||ref.chatusr||''),preview:preview.slice(0,500),type:refType}
            }
            await store.run('UPDATE inbox SET details=? WHERE id=?',[JSON.stringify(details),row.id])
            return details
        }catch{return {}}
    }
    const list = async (query: string, kind: string, offset: number) => {
        await repairOwnership()
        const available = getGeWeChatDataSource().isInitialized
        const contacts = []
        if (available) {
            for (const [entity, type] of [[WxContact, 'contact'], [WxRoom, 'group']] as const) {
                if (kind === 'contact' && type === 'group') continue
                const qb = getGeWeChatDataSource().getRepository(entity as any).createQueryBuilder('c')
                const id = type === 'contact' ? 'userName' : 'chatroomId'
                const rows = await qb.select([`c.${id}`,'c.nickName','c.remark','c.smallHeadImgUrl',...(type==='contact'?['c.bigHeadImgUrl']:[])]).where(`(c.nickName LIKE :q OR c.remark LIKE :q OR c.${id} LIKE :q)`, {q: `%${query}%`}).getMany()
                contacts.push(...rows.map((c: any) => ({wxId: c[id],name:c.remark||c.nickName||c[id],nickname:c.nickName||'',kind:c[id].endsWith('@chatroom')?'group':'contact',hasAvatar:Boolean(c.smallHeadImgUrl||c.bigHeadImgUrl)})).filter(c=>kind==='all'||c.kind===kind))
            }
        }
        const bindings = await AppDataSource.getRepository(BindGroup).createQueryBuilder('b').where('(b.name LIKE :q OR b.alias LIKE :q OR b.wxId LIKE :q)', {q: `%${query}%`}).getMany()
        contacts.push(...bindings.map(b => ({wxId:b.wxId,name:b.alias||b.name||b.wxId,nickname:b.name||'',kind:b.wxId.endsWith('@chatroom')||b.type===1?'group':'contact',hasAvatar:Boolean(b.avatarLink)})).filter(b=>kind==='all'||b.kind===kind))
        // Prefer actual WeChat directory names over formatted Telegram binding titles.
        const directory = new Map()
        for (const contact of contacts) {if(!directory.has(contact.wxId))directory.set(contact.wxId,contact);else if(contact.hasAvatar)directory.get(contact.wxId).hasAvatar=true}
        await reconcile()
        const legacy=await AppDataSource.query('SELECT b.wxId,MAX(m.createTime) AS timestamp FROM bind_group b JOIN message m ON m.chatId=b.chatId GROUP BY b.wxId')
        const recent=new Map(legacy.map(r=>[r.wxId,{...r,body:'',type:'text'}]))
        for(const row of await store.recents())if(row.timestamp>=(recent.get(row.wxId) as any)?.timestamp||!recent.has(row.wxId))recent.set(row.wxId,row)
        const unconfirmed=new Map<string,Set<string>>()
        for(const row of await store.all("SELECT wxId,remoteId,id FROM inbox WHERE hidden=0 AND revokeStatus<>'revoked' AND telegramTracked=1 AND telegramStatus IN ('pending','syncing','failed') AND (direction='incoming' OR status='submitted')")){if(!unconfirmed.has(row.wxId))unconfirmed.set(row.wxId,new Set());unconfirmed.get(row.wxId).add(row.remoteId||`journal:${row.id}`)}
        const unique = [...directory.values()].map(c=>({...c,lastActivity:Number((recent.get(c.wxId) as any)?.timestamp)||0,lastSequence:Number((recent.get(c.wxId) as any)?.sequence)||0,lastBody:String((recent.get(c.wxId) as any)?.body||'').slice(0,100),lastType:(recent.get(c.wxId) as any)?.type||'text',unsyncedCount:unconfirmed.get(c.wxId)?.size||0})).sort((a,b)=>(kind==='all'?b.lastActivity-a.lastActivity||b.lastSequence-a.lastSequence:0)||a.name.localeCompare(b.name)||a.wxId.localeCompare(b.wxId))
        return {contacts: unique.slice(offset, offset + 60), hasMore: unique.length > offset + 60, offset: offset + 60, directoryAvailable: available}
    }
    const recipient = async (wxId: string) => {
        if (getGeWeChatDataSource().isInitialized) {
            const group = wxId.endsWith('@chatroom')
            const found = await getGeWeChatDataSource().getRepository(group ? WxRoom as any : WxContact as any).findOneBy(group ? {chatroomId: wxId} : {userName: wxId})
            if (found) return {wxId, kind: group ? 'group' : 'contact'}
            if(group&&await getGeWeChatDataSource().getRepository(WxContact).findOneBy({userName:wxId}))return {wxId,kind:'group'}
        }
        const binding = await AppDataSource.getRepository(BindGroup).findOneBy({wxId})
        if (!binding) throw new MessageCenterError('recipientMissing', 404)
        return {wxId, kind: wxId.endsWith('@chatroom')||binding.type === 1 ? 'group' : 'contact'}
    }
    return {
        status: async () => {await repairOwnership();return {available:true,wechatOnline:Boolean(client()?.hasLogin),telegramOnline:Boolean(AbstractClient.getSpyClient('botClient')?.hasLogin),directoryAvailable:getGeWeChatDataSource().isInitialized}},
        upload:(name,preference,stream)=>media.save(name,preference,stream),
        media:id=>media.get(id),attachment,
        avatar,
        transcriptAttachment:transcriptDownload,
        sync,
        contacts: list,
        revoke:async(id,requestId,confirmUncertain=false)=>{
            if(!/^[a-zA-Z0-9-]{16,80}$/.test(requestId||''))throw new MessageCenterError('invalidRequest')
            if(!client()?.hasLogin)throw new MessageCenterError('wechatOffline',503)
            const row=await store.byId(id),selfId=(client() as any)?.wxInfo?.wxid||''
            if(!selfId)throw new MessageCenterError('wechatOffline',503)
            if(!row||row.hidden||row.direction!=='outgoing'||row.senderId!==selfId)throw new MessageCenterError('revokeOwnOnly',403)
            const previous=(await store.all('SELECT id FROM inbox WHERE revokeRequestId=?',[requestId]))[0]
            if(previous&&previous.id!==id)throw new MessageCenterError('requestConflict',409)
            if(row.revokeStatus==='revoked')return {id,revokeStatus:'revoked',revokeTelegramStatus:row.revokeTelegramStatus}
            if(row.revokeStatus==='revoking'){if(row.revokeRequestId===requestId&&revoking.has(id))return revoking.get(id);throw new MessageCenterError('revokeInProgress',409)}
            if(row.revokeRequestId===requestId&&row.revokeStatus!=='none')return {id,revokeStatus:row.revokeStatus,revokeTelegramStatus:row.revokeTelegramStatus}
            if(row.revokeStatus==='unknown'&&!confirmUncertain)throw new MessageCenterError('revokeUnknown',409)
            const payload=revokePayload(row,selfId)
            let claimed:boolean
            try{claimed=await store.claimRevoke(id,requestId)}catch(e){if(e?.code==='SQLITE_CONSTRAINT')throw new MessageCenterError('requestConflict',409);throw e}
            if(!claimed)throw new MessageCenterError('revokeInProgress',409)
            const operation=(async()=>{
                try{await revokeWechat(payload);await store.run("UPDATE inbox SET revokeStatus='revoked',revokedAt=? WHERE id=?",[Math.floor(Date.now()/1000),id]);syncRevocation(id)}
                catch(e){await store.run('UPDATE inbox SET revokeStatus=? WHERE id=?',[e?.code==='revokeRejected'?'failed':'unknown',id])}
                const result=await store.byId(id);return {id,revokeStatus:result.revokeStatus,revokeTelegramStatus:result.revokeTelegramStatus}
            })()
            revoking.set(id,operation);try{return await operation}finally{revoking.delete(id)}
        },
        groupMembers:async(wxId,query,offset,refresh=false)=>{
            const target=await recipient(wxId)
            if(target.kind!=='group')throw new MessageCenterError('mentionsGroupOnly')
            let members=await mentionService.members(wxId,refresh)
            if(getGeWeChatDataSource().isInitialized&&members.length){
                const contacts=await getGeWeChatDataSource().getRepository(WxContact).createQueryBuilder('c').select(['c.userName','c.remark','c.nickName']).where('c.userName IN (:...ids)',{ids:members.map(m=>m.wxId)}).getMany()
                const map=new Map(contacts.map(c=>[c.userName,c]))
                members=members.map(m=>({...m,remark:map.get(m.wxId)?.remark||''}))
            }
            const q=query.toLocaleLowerCase(),filtered=members.filter(m=>[m.name,m.nickname,m.wxId,(m as any).remark].some(v=>v?.toLocaleLowerCase().includes(q)))
            return {wxId,members:filtered.slice(offset,offset+100),total:filtered.length,hasMore:filtered.length>offset+100,offset:offset+100}
        },
        conversations:async offset=>{
            await repairOwnership()
            const contacts:any[]=[]
            for(let page=0;page<=10000;page+=60){
                const result=await list('', 'all',page)
                contacts.push(...result.contacts.filter(c=>c.lastActivity>0))
                if(!result.hasMore)break
            }
            return {conversations:contacts.slice(offset,offset+60),hasMore:contacts.length>offset+60,offset:offset+60}
        },
        newMessages:async(cursor,wxId,limit)=>{
            await repairOwnership()
            const maximum=(await store.all("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='inbox'),0) AS cursor"))[0].cursor
            if(cursor===undefined)return {messages:[],cursor:maximum,hasMore:false}
            if(cursor>maximum)throw new MessageCenterError('cursorAhead')
            const rows=await store.all("SELECT * FROM inbox WHERE hidden=0 AND telegramTracked=1 AND direction='incoming' AND id>? AND id<=? AND (? IS NULL OR wxId=?) ORDER BY id LIMIT ?",[cursor,maximum,wxId||null,wxId||null,limit+1])
            const hasMore=rows.length>limit
            const messages=rows.slice(0,limit).map(({source,details,...row})=>({...row,details:details?JSON.parse(details):null}))
            return {messages,cursor:hasMore?messages[messages.length-1].id:maximum,hasMore}
        },
        sendStatus:async requestId=>{
            const row=await store.byRequest(requestId)
            if(!row||row.hidden)throw new MessageCenterError('messageMissing',404)
            const {source,details,...safe}=row
            return {...safe,details:details?JSON.parse(details):null}
        },
        history: async (wxId, before, query) => {
            await repairOwnership()
            await recipient(wxId)
            if (!imported.has(wxId)) {
                const binding = await AppDataSource.getRepository(BindGroup).findOneBy({wxId})
                const qb = AppDataSource.getRepository(Message).createQueryBuilder('m')
                const selfId = (client() as any)?.wxInfo?.wxid
                if(binding)qb.where('m.chatId = :id',{id:binding.chatId})
                else if(selfId)qb.where('((m.wxSenderId=:selfId AND m.toWxid=:wxId) OR (m.wxSenderId=:wxId AND m.toWxid=:selfId)) AND m.chatId NOT IN (SELECT chatId FROM bind_group WHERE type=1)',{selfId,wxId})
                else qb.where('1=0')
                const old=await qb.orderBy('m.id','DESC').take(500).getMany()
                for (const m of old.reverse()) {
                    if(m.type===6)continue // Recall control events are not new chat messages.
                    const outgoing = Boolean(selfId && m.wxSenderId === selfId)
                    const kindMap={image:'image',voice:'voice',video:'video',emoji:'emoji',file:'file',location:'location',contact:'contact',link:'link',quote:'quote',chat_histroy:'chat_histroy'}
                    const type=kindMap[m.source_type]||({3:'image',34:'voice',43:'video',47:'emoji',49:'file',48:'location',42:'contact'}[Number(m.source_type)])||(m.type===0?'text':'file')
                    const typeCodes={image:3,voice:34,video:43,emoji:47,file:49,link:49,quote:49,location:48,contact:42,text:1}
                    const row=await store.insert({wxId,remoteId:m.wxMsgId&&m.wxMsgId!=='0'?m.wxMsgId:`legacy:${m.id}`,senderId:m.wxSenderId||'',senderName:m.sender||'',body:String(m.content||(m.type===0&&type==='text'?m.source_text:'')||'').slice(0,8000),direction:outgoing?'outgoing':'incoming',type,status:outgoing?'submitted':'received',timestamp:m.createTime||0,telegramStatus:m.tgBotMsgId>0?'synced':'pending',source:m.source_text?JSON.stringify({MsgId:Number(m.msgId||0),FromUserName:wxId.endsWith('@chatroom')?wxId:m.wxSenderId,ToUserName:m.toWxid,NewMsgId:m.wxMsgId,CreateTime:m.createTime,MsgType:Number(m.source_type)||typeCodes[type],Content:m.source_text,xml:m.source_text}):null})
                    if(row&&!row.telegramTracked&&['none','pending'].includes(row.telegramStatus))await store.run('UPDATE inbox SET telegramStatus=? WHERE id=?',[m.tgBotMsgId>0?'synced':'unverified',row.id])
                    if(row&&!row.requestId)await store.run("UPDATE inbox SET bodyFormat='telegram_html' WHERE id=?",[row.id])
                    if(row&&!row.requestId&&(!row.source||/^\d+$/.test(row.type||''))){
                        const source=m.source_text?JSON.stringify({MsgId:Number(m.msgId||0),FromUserName:wxId.endsWith('@chatroom')?wxId:m.wxSenderId,ToUserName:m.toWxid,NewMsgId:m.wxMsgId,CreateTime:m.createTime,MsgType:Number(m.source_type)||typeCodes[type],Content:m.source_text,xml:m.source_text}):null
                        await store.run('UPDATE inbox SET type=?,source=COALESCE(source,?) WHERE id=?',[type,source,row.id])
                    }
                }
                imported.add(wxId)
            }
            await reconcile()
            const result=await store.history(wxId,before,query)
            const senderIds=[...new Set(result.messages.map(m=>m.senderId).filter(Boolean))]
            const directory=new Map()
            if(senderIds.length&&getGeWeChatDataSource().isInitialized){
                const rows=await getGeWeChatDataSource().getRepository(WxContact).createQueryBuilder('c').select(['c.userName','c.nickName','c.remark','c.smallHeadImgUrl','c.bigHeadImgUrl']).where('c.userName IN (:...ids)',{ids:senderIds}).getMany()
                for(const c of rows)directory.set(c.userName,c)
            }
            for(const item of result.messages){
                const row=await store.byId(item.id)
                const policy=revokePolicy(row);item.revokeDeadline=policy.deadline;item.revokeWindowSeconds=policy.windowSeconds
                try{revokePayload(row,(client() as any)?.wxInfo?.wxid||'');item.canRevoke=!['revoking','revoked'].includes(row.revokeStatus)}catch(e){item.canRevoke=false;item.revokeUnavailableReason=e?.code||'revokeUnavailable'}
                if(row.source&&(item.type==='chat_histroy'||/\[聊天记录\]/.test(item.body||''))){
                    try{item.transcriptAttachments=publicTranscriptAttachments(await parseTranscript(row.source))}catch{item.transcriptAttachments=[]}
                }
                if(item.type==='chat_histroy'&&!item.body){
                    const row=await store.byId(item.id)
                    try{
                        const source=JSON.parse(row.source),xml=WxMessage.getXmlToJson(source.xml||source.Content)
                        const parsed=WxMessage.getXmlToJson(xml.msg.appmsg.recorditem)
                        const history=await getChatHistory(parsed,{type:()=>WxMessage.Type.ChatHistroy,text:()=>source.Content},WxMessage.Type,WxMessage.getXmlToJson)
                        item.body=history.content.slice(0,50000);item.bodyFormat='telegram_html'
                        await store.run("UPDATE inbox SET body=?,bodyFormat='telegram_html' WHERE id=?",[item.body,item.id])
                    }catch{}
                }
                if((!item.details||item.type==='quote'&&!item.details.replyTo)&&item.type!=='text')item.details=await detailsFor(await store.byId(item.id))
                const sender=directory.get(item.senderId)
                item.senderDisplayName=sender?.remark||sender?.nickName||String(item.senderName||item.senderId||'').replace(/<[^>]*>/g,'').replace(/^👤\s*/,'').trim()
                item.senderHasAvatar=Boolean(sender?.smallHeadImgUrl||sender?.bigHeadImgUrl)
            }
            return {...result,serverTime:Math.floor(Date.now()/1000)}
        },
        send: async (wxId, body, requestId,attachmentId,mentionInput,replyToId) => {
            const mentions=normalizeMentions(mentionInput),hasMentions=mentions.all||mentions.memberIds.length>0
            if(replyToId!==undefined&&(!Number.isSafeInteger(replyToId)||replyToId<1))throw new MessageCenterError('quoteUnavailable')
            if(replyToId&&attachmentId)throw new MessageCenterError('quoteTextOnly')
            if(replyToId&&hasMentions)throw new MessageCenterError('quoteMentionsUnsupported')
            if(hasMentions&&attachmentId)throw new MessageCenterError('mentionsTextOnly')
            if(hasMentions&&!body.trim())throw new MessageCenterError('invalidMentions')
            if(attachmentId&&body.trim())throw new MessageCenterError('attachmentTextSeparate')
            const operation = accepting.then(async () => {
            const previous = await store.byRequest(requestId)
            if (previous) {
                const details=previous.details?JSON.parse(previous.details):{},oldMentions=normalizeMentions(details.mentions?{all:details.mentions.all,memberIds:details.mentions.members.map(m=>m.wxId),inline:details.mentions.inline}:undefined)
                if (previous.wxId !== wxId || (details.mentions?details.text:previous.body) !== body || (previous.attachmentId||'')!==(attachmentId||'')||JSON.stringify(oldMentions)!==JSON.stringify(mentions)||(details.replyTo?.id||0)!==(replyToId||0)) throw new MessageCenterError('requestConflict', 409)
                return previous
            }
            const target = await recipient(wxId)
            if (!client()?.hasLogin) throw new MessageCenterError('wechatOffline', 503)
            if (pending >= 100) throw new MessageCenterError('sendQueueFull', 503)
            const mention=hasMentions?await mentionService.resolve(wxId,body,mentions):null
            const reference=replyToId?quoteReference(await store.byId(replyToId),wxId,(client() as any)?.wxInfo?.wxid||''):null
            const quote=reference?quoteXML(body,reference):null
            if(mention&&mention.text.length>4000)throw new MessageCenterError('mentionTextTooLong')
            const file=attachmentId?await media.get(attachmentId):null
            const publicRef=reference?(({content,...rest})=>rest)(reference):null
            const message = await store.insert({requestId,wxId,body:mention?.text||body,direction:'outgoing',status:'sending',type:file?.kind||'text',attachmentId:attachmentId||null,telegramStatus:'none',details:reference?JSON.stringify({replyTo:publicRef}):mention?JSON.stringify({text:body,mentions:mention.mentions}):file?JSON.stringify({title:file.name,size:file.size,mime:file.mime}):null,source:quote?JSON.stringify({MsgType:49,Content:quote,xml:quote,FromUserName:(client() as any)?.wxInfo?.wxid,ToUserName:wxId}):null,timestamp:Math.floor(Date.now()/1000)})
            pending++
            sendQueue = sendQueue.then(async () => {
                let attempted=false,release=()=>{}
                try {
                    if (!client()?.hasLogin) throw new Error('offline')
                    const api = client().client
                    const destination = target.kind === 'group' ? await api.Room.find({id: wxId}) : await api.Contact.find({id: wxId})
                    if (!destination) throw new Error('missing')
                    const prepared=file?await media.prepare(file):null
                    const payload=prepared?.payload||body
                    release=store.beginSend(wxId)
                    let timer: NodeJS.Timeout
                    attempted=true
                    const result: any = await Promise.race([
                        quote?sendQuote(wxId,(client() as any)?.wxInfo?.wxid||'',quote):mention?mentionService.send(wxId,mention.text,mention.at):target.kind === 'group' ? destination.say(payload, null) : destination.say(payload),
                        new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('timeout')), 180000)}),
                    ]).finally(() => clearTimeout(timer))
                    const candidate=result?.newMsgId||result?.msgId
                    const remoteId=candidate&&!['undefined','null','0'].includes(String(candidate))?String(candidate):null
                    if(remoteId){
                        const current=await store.byRequest(requestId),source=current.source?JSON.parse(current.source):{}
                        let wireType=quote?49:({image:3,emoji:47,video:43,voice:34,audio:49,file:49}[file?.kind]||1)
                        if(file?.kind==='file'&&/\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(prepared.name))wireType=3
                        await store.run('UPDATE inbox SET source=? WHERE requestId=?',[JSON.stringify({...source,MsgType:source.MsgType||wireType,...(wireType===49?{AppType:quote?57:6}:{}),ClientMsgId:String(result.msgId||''),MsgId:String(result.msgId||''),CreateTime:Number(result.createTime)||current.timestamp}),requestId])
                    }
                    if (remoteId) await store.run('DELETE FROM inbox WHERE wxId = ? AND remoteId = ? AND requestId IS NULL', [wxId, String(remoteId)])
                    await store.run('UPDATE inbox SET status=?,remoteId=?,telegramStatus=?,senderId=?,telegramTracked=? WHERE requestId=?',[remoteId?'submitted':'unknown',remoteId,remoteId?'pending':'none',(client() as any)?.wxInfo?.wxid||'',remoteId?1:0,requestId])
                    release()
                    if(remoteId){
                        const mirror=async()=>{try{await sync(message.id);if(file&&synchronization.has(message.id))await synchronization.get(message.id)}catch{await store.run("UPDATE inbox SET telegramStatus='failed' WHERE id=?",[message.id])}}
                        if(file)await mirror();else void mirror()
                    }
                } catch(error) {
                    // Timeout and network errors can occur after delivery. Never retry automatically.
                    await store.run('UPDATE inbox SET status=? WHERE requestId=?',[error?.code==='wechatSendRejected'?'failed':attempted?'unknown':'failed',requestId])
                    if(error?.code==='wechatSendRejected'){
                        const row=await store.byRequest(requestId),details=row.details?JSON.parse(row.details):{}
                        await store.run('UPDATE inbox SET details=? WHERE requestId=?',[JSON.stringify({...details,error:'wechatSendRejected'}),requestId])
                    }
                } finally {release();pending--}
                await new Promise(resolve => setTimeout(resolve, 700))
            }).catch(() => {pending = Math.max(0, pending - 1)})
            return message
            })
            accepting = operation.then(() => undefined, () => undefined)
            return operation.then(row=>{const {source,details,...safe}=row;return {...safe,details:details?JSON.parse(details):null}})
        },
    }
}
