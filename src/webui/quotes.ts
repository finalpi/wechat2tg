import {msgApi} from 'wx2tg-puppet/dist/api/MsgApi'
import {ResponseMsg} from 'wx2tg-puppet/dist/core/Message'
const error=(code:string,status=400)=>Object.assign(new Error(code),{code,status})
const escape=(s:any)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
export function quoteReference(row:any,wxId:string,selfId:string){
    if(!row||row.hidden||row.wxId!==wxId)throw error('quoteWrongConversation')
    if(row.type==='revoke_notice'||row.revokeStatus==='revoked'||!/^\d{1,30}$/.test(row.remoteId||'')||/^0+$/.test(row.remoteId)||!['received','submitted'].includes(row.status))throw error('quoteUnavailable')
    let source:any={};try{source=JSON.parse(row.source||'{}')}catch{}
    const senderId=row.senderId||(row.direction==='outgoing'?selfId:wxId.endsWith('@chatroom')?'':wxId)
    if(!senderId)throw error('quoteUnavailable')
    const types={text:1,image:3,voice:34,video:43,emoji:47,file:49,link:49,quote:49,chat_histroy:49,location:48,contact:42}
    const type=Number(source.MsgType)||types[row.type]||1
    let content=String(source.Content||source.xml||row.body||'')
    if(content.startsWith(senderId+':\n'))content=content.slice(senderId.length+2)
    const details=row.details?JSON.parse(row.details):{}
    let preview=String(row.body||details.title||'['+(row.type||'message')+']')
    if(row.bodyFormat==='telegram_html')preview=preview.replace(/<[^>]*>/g,'')
    preview=preview.slice(0,500)
    const name=String(row.senderName||senderId).replace(/<[^>]*>/g,'').replace(/^👤\s*/,'').trim()
    if(!content)content=preview
    return {id:row.id,remoteId:row.remoteId,wxId,senderId,name,type,preview,content}
}
export function quoteXML(text:string,ref:ReturnType<typeof quoteReference>){
    return `<appmsg appid="" sdkver="0"><title>${escape(text)}</title><des/><action/><type>57</type><showtype>0</showtype><content/><url/><appattach><totallen>0</totallen><attachid/></appattach><refermsg><type>${ref.type}</type><svrid>${escape(ref.remoteId)}</svrid><chatusr>${escape(ref.senderId)}</chatusr><fromusr>${escape(ref.wxId)}</fromusr><displayname>${escape(ref.name)}</displayname><content>${escape(ref.content)}</content></refermsg></appmsg>`
}
export async function sendQuote(wxId:string,selfId:string,xml:string){
    const result=await msgApi.SendApp({Wxid:selfId,ToWxid:wxId,Type:49,Xml:xml})
    if(result.data.Code!==0)throw error('wechatSendRejected')
    const data=result.data.Data
    if(!data)return null
    const receipt=data.List?.[0]||data,response=new ResponseMsg(receipt)
    // App-message client IDs are strings; recall needs the numeric server ID.
    const nativeId=receipt.MsgId??receipt.Msgid??receipt.msgId
    if(nativeId!==undefined&&/^-?\d+$/.test(String(nativeId)))response.msgId=String(Number(nativeId)<0?Number(nativeId)>>>0:nativeId)
    return response
}
