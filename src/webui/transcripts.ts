import {Message as WxMessage} from 'wx2tg-puppet'
import {getChatHistory,ChatHistoryResult,ChatHistoryAttachment,NestedChatHistory} from '../util/handleMsg'

export async function parseTranscript(source:string):Promise<ChatHistoryResult> {
    const msg=JSON.parse(source)
    const xml=WxMessage.getXmlToJson(msg.xml||msg.Content)
    const records=WxMessage.getXmlToJson(xml.msg.appmsg.recorditem)
    return getChatHistory(records,{type:()=>WxMessage.Type.ChatHistroy,text:()=>msg.Content},WxMessage.Type,WxMessage.getXmlToJson)
}
export function transcriptAttachments(result:ChatHistoryResult) {
    const all:Array<{path:string;attachment:ChatHistoryAttachment}>=result.attachments.map(attachment=>({path:'root',attachment}))
    const visit=(records:NestedChatHistory[])=>{for(const r of records){all.push(...r.attachments.map(attachment=>({path:r.id,attachment})));visit(r.nestedRecords||[])}}
    visit(result.nestedRecords||[])
    return all
}
export function publicTranscriptAttachments(result:ChatHistoryResult) {
    return transcriptAttachments(result).map(({path,attachment:a})=>({path,id:a.id,type:a.type,name:a.fileName,title:a.title,size:Number(a.payload?.dataLen)||0,sourceName:a.sourceName}))
}
