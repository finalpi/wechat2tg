import {Message as WxMessage} from 'wx2tg-puppet'

export interface PublicArticle {title:string;description:string;url:string}
export interface LinkDetails extends PublicArticle {articles:PublicArticle[]}
const MAX_SOURCE_BYTES=1024*1024,MAX_XML_BYTES=512*1024,MAX_ARTICLES=20
const text=(value:any,limit:number)=>typeof value==='string'||typeof value==='number'?String(value).trim().slice(0,limit):''
export function articleURL(value:any):string{
    if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/.test(value))return ''
    try{
        const url=new URL(value.trim())
        return ['https:','http:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:''
    }catch{return ''}
}
const article=(item:any,fromSaved=false):PublicArticle=>({title:text(item?.title,500),description:fromSaved?text(item?.description,2000):text(item?.summary,2000)||text(item?.digest,2000),url:articleURL(item?.url)})
const list=(value:any)=>Array.isArray(value)?value:value&&typeof value==='object'?[value]:[]

/** Parse only the public display fields. Never fetch or expose transport payloads. */
export function readLinkDetails(source?:string,saved:any={}):LinkDetails{
    const fallback=():LinkDetails=>{
        const articles=list(saved?.articles).slice(0,MAX_ARTICLES).map(item=>article(item,true)).filter(a=>a.title||a.description||a.url)
        const ordinary={title:text(saved?.title,500),description:text(saved?.description,2000),url:articleURL(saved?.url)}
        return {...(articles[0]||ordinary),articles}
    }
    if(!source||Buffer.byteLength(source,'utf8')>MAX_SOURCE_BYTES)return fallback()
    try{
        const envelope=source.trimStart().startsWith('{')?JSON.parse(source):null
        const raw=envelope?envelope.xml||envelope.Content:source
        if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_XML_BYTES||/<!DOCTYPE|<!ENTITY/i.test(raw))return fallback()
        let depth=0
        for(const token of raw.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]*>/g)||[]){
            if(/^<\?|^<!/.test(token))continue
            if(/^<\//.test(token))depth--
            else if(!/\/>$/.test(token)&&++depth>64)return fallback()
        }
        const xml=WxMessage.getXmlToJson(raw),app=xml.msg?.appmsg||xml.appmsg
        if(!app)return fallback()
        const articles:PublicArticle[]=[]
        let remaining=MAX_ARTICLES
        for(const reader of list(app.mmreader).slice(0,MAX_ARTICLES)){
            for(const category of list(reader.category).slice(0,MAX_ARTICLES)){
                for(const item of list(category.item).slice(0,remaining)){
                    remaining--
                    const visible=article(item)
                    if(visible.title||visible.description||visible.url)articles.push(visible)
                }
                if(!remaining)break
            }
            if(!remaining)break
        }
        const ordinary={title:text(app.title,500),description:text(app.des,2000),url:articleURL(app.url)}
        return {...(articles[0]||ordinary),articles}
    }catch{return fallback()}
}
