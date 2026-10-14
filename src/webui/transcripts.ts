import {Message as WxMessage} from 'wx2tg-puppet'
import {getChatHistory,ChatHistoryResult,ChatHistoryAttachment,NestedChatHistory,ChatHistoryEntry} from '../util/handleMsg'

const MAX_SOURCE_BYTES=1024*1024,MAX_XML_BYTES=512*1024,MAX_DEPTH=6,MAX_ITEMS=300
interface ParsedTranscript extends ChatHistoryResult {title:string;truncatedPaths:string[]}

function parseXML(value:string){
    if(Buffer.byteLength(value,'utf8')>MAX_XML_BYTES||/<!DOCTYPE|<!ENTITY/i.test(value))throw new Error('transcriptTooLarge')
    // Bound the parser itself before visiting the resulting tree. CDATA contains
    // escaped child records, so its apparent tags do not count towards XML depth.
    let depth=0
    for(const token of value.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]*>/g)||[]){
        if(/^<\?|^<!/.test(token))continue
        if(/^<\//.test(token))depth--
        else if(!/\/>$/.test(token)&&++depth>64)throw new Error('transcriptTooDeep')
    }
    return WxMessage.getXmlToJson(value)
}

export async function parseTranscript(source:string):Promise<ParsedTranscript> {
    if(Buffer.byteLength(source,'utf8')>MAX_SOURCE_BYTES)throw new Error('transcriptTooLarge')
    const msg=JSON.parse(source),xml=parseXML(String(msg.xml||msg.Content||'')),app=xml.msg?.appmsg||xml.appmsg
    const truncatedPaths=new Set<string>(),state={remaining:MAX_ITEMS}
    const bound=(input:any,depth:number,path:string):any=>{
        const parsed=typeof input==='string'?parseXML(input):input
        const record=parsed?.recordinfo||parsed
        const raw=record?.datalist?.dataitem,items=Array.isArray(raw)?raw:raw?[raw]:[],accepted=[]
        for(const [index,item] of items.entries()){
            if(state.remaining--<=0){truncatedPaths.add(path);break}
            const copy={...item,sourcetime:String(item.sourcetime||'')}
            if(Number(item.datatype)===17&&item.recordxml){
                const nestedPath=path==='root'?String(index+1):`${path}.${index+1}`
                if(depth>=MAX_DEPTH){
                    truncatedPaths.add(nestedPath)
                    copy.recordxml={recordinfo:{datalist:{count:0,dataitem:[]}}}
                }else{
                    try{copy.recordxml=bound(item.recordxml,depth+1,nestedPath)}
                    catch{truncatedPaths.add(nestedPath);copy.recordxml={recordinfo:{datalist:{count:0,dataitem:[]}}}}
                }
            }
            accepted.push(copy)
        }
        return {recordinfo:{...record,datalist:{...record?.datalist,count:record?.datalist?.count??items.length,dataitem:accepted}}}
    }
    const records=bound(app?.recorditem,0,'root')
    const result=await getChatHistory(records,{type:()=>WxMessage.Type.ChatHistroy,text:()=>msg.Content},WxMessage.Type,parseXML)
    // Keep the original item order independently of Telegram's flattened text.
    // Only semantic display fields and stable references cross the WebUI API.
    const annotate=(source:any,target:ChatHistoryResult|NestedChatHistory,path:string)=>{
        const raw=source?.recordinfo?.datalist?.dataitem,items=Array.isArray(raw)?raw:raw?[raw]:[]
        target.entries=items.map((item,index)=>{
            const id=String(index+1),code=Number(item.datatype)
            const type=({1:'text',2:'image',3:'voice',4:'video',5:'link',8:'file',17:'record',19:'mini_app'})[code]||'unknown'
            const entry:ChatHistoryEntry={id,sender:String(item.sourcename??'').slice(0,200),time:String(item.sourcetime??'').slice(0,60),type,text:String(code===1?item.datadesc??'':code===5||code===19?item.datatitle??'':'')}
            if(target.attachments.some(a=>a.id===id))entry.attachmentId=id
            const nestedId=path==='root'?id:`${path}.${id}`,child=target.nestedRecords.find(r=>r.id===nestedId)
            if(child){entry.nestedId=nestedId;annotate(item.recordxml,child,nestedId)}
            if(code===5){try{const url=new URL(String(item.link||''));if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)entry.url=url.href}catch{}}
            return entry
        })
    }
    annotate(records,result,'root')
    return {...result,title:String(app?.title||''),truncatedPaths:[...truncatedPaths]}
}

export function transcriptAttachments(result:ChatHistoryResult) {
    const all:Array<{path:string;attachment:ChatHistoryAttachment}>=result.attachments.map(attachment=>({path:'root',attachment}))
    const visit=(records:NestedChatHistory[])=>{for(const r of records){all.push(...r.attachments.map(attachment=>({path:r.id,attachment})));visit(r.nestedRecords||[])}}
    visit(result.nestedRecords||[])
    return all
}
function publicAttachment(path:string,a:ChatHistoryAttachment){
    return {path,id:a.id,type:a.type,name:String(a.fileName||'').slice(0,512),title:String(a.title||'').slice(0,512),size:Math.max(0,Number(a.payload?.dataLen)||0),sourceName:String(a.sourceName||'').slice(0,200)}
}
export function publicTranscriptAttachments(result:ChatHistoryResult) {
    return transcriptAttachments(result).map(({path,attachment})=>publicAttachment(path,attachment))
}
export function publicTranscript(result:ChatHistoryResult&{title?:string;truncatedPaths?:string[]}){
    const truncated=new Set(result.truncatedPaths||[]),budget={remaining:100000},entryBudget={remaining:100000}
    const plain=(html:string)=>String(html||'').replace(/<\/?blockquote(?:\s+expandable)?\s*>/gi,'').replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi,'$1').replace(/&(lt|gt|amp|quot|apos);/g,(_,entity)=>({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}[entity]))
    const visit=(record:ChatHistoryResult,title:string,path:string):any=>{
        const text=plain(record.content),content=text.slice(0,Math.max(0,budget.remaining));budget.remaining-=content.length
        let entryTruncated=false
        const entries=record.entries?.map(entry=>{
            const text=entry.text.slice(0,Math.max(0,entryBudget.remaining));entryBudget.remaining-=text.length;entryTruncated ||= text.length<entry.text.length
            return {id:entry.id,sender:entry.sender,time:entry.time,type:entry.type,text,...(entry.attachmentId?{attachmentId:entry.attachmentId}:{}),...(entry.nestedId?{nestedId:entry.nestedId}:{}),...(entry.url?{url:entry.url}:{})}
        })
        return {path,title:String(title||'').slice(0,200),content,...(entries?{entries}:{}),truncated:truncated.has(path)||content.length<text.length||entryTruncated,attachments:record.attachments.map(a=>publicAttachment(path,a)),children:(record.nestedRecords||[]).map(child=>visit(child,child.title,child.id))}
    }
    return visit(result,result.title||'','root')
}
