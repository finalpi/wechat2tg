import {Message as WxMessage} from 'wx2tg-puppet'
import {articleCoverURL} from '../util/ArticleCover'

export interface PublicArticle {title:string;description:string;url:string;coverUrl?:string}
export interface LinkDetails extends PublicArticle {articles:PublicArticle[];articleLayoutVersion:2}
const MAX_SOURCE_BYTES = 1024 * 1024,MAX_XML_BYTES = 512 * 1024,MAX_ARTICLES = 20
const text = (value:any,limit:number)=>typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0,limit) : ''
export function articleURL(value:any):string{
    if(typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))return ''
    try{
        const url = new URL(value.trim())
        return ['https:','http:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : ''
    }catch{return ''}
}
const article = (item:any,fromSaved = false):PublicArticle=>{
    const coverUrl = [item?.coverUrl,item?.cover,item?.coverurl,item?.cover_url,item?.thumburl,item?.thumb_url,item?.picurl].map(articleCoverURL).find(Boolean)
    return {title:text(item?.title,500),description:fromSaved ? text(item?.description,2000) : text(item?.summary,2000) || text(item?.digest,2000) || text(item?.des,2000),url:articleURL(item?.url),...(coverUrl ? {coverUrl} : {})}
}
const list = (value:any)=>Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []

/** Parse only the public display fields. Never fetch or expose transport payloads. */
export function readLinkDetails(source?:string,saved:any = {}):LinkDetails{
    const fallback = ():LinkDetails=>{
        const articles = list(saved?.articles).slice(0,MAX_ARTICLES).map(item=>article(item,true)).filter(a=>a.title || a.description || a.url)
        const ordinary = article(saved,true)
        if(articles.length && !articles[0].coverUrl && ordinary.coverUrl)articles[0].coverUrl = ordinary.coverUrl
        return {...(articles[0] || ordinary),articles,articleLayoutVersion:2}
    }
    if(!source || Buffer.byteLength(source,'utf8') > MAX_SOURCE_BYTES)return fallback()
    try{
        const envelope = source.trimStart().startsWith('{') ? JSON.parse(source) : null
        const raw = envelope ? envelope.xml || envelope.Content : source
        if(typeof raw !== 'string' || Buffer.byteLength(raw,'utf8') > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/i.test(raw))return fallback()
        let depth = 0
        for(const token of raw.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]*>/g) || []){
            if(/^<\?|^<!/.test(token))continue
            if(/^<\//.test(token))depth--
            else if(!/\/>$/.test(token) && ++depth > 64)return fallback()
        }
        const xml = WxMessage.getXmlToJson(raw),app = xml.msg?.appmsg || xml.appmsg
        if(!app)return fallback()
        const articles:PublicArticle[] = []
        let remaining = MAX_ARTICLES
        for(const reader of list(app.mmreader).slice(0,MAX_ARTICLES)){
            for(const category of list(reader.category).slice(0,MAX_ARTICLES)){
                for(const item of list(category.item).slice(0,remaining)){
                    remaining--
                    const visible = article(item)
                    if(visible.title || visible.description || visible.url)articles.push(visible)
                }
                if(!remaining)break
            }
            if(!remaining)break
        }
        const ordinary = article(app)
        if(articles.length && !articles[0].coverUrl && ordinary.coverUrl)articles[0].coverUrl = ordinary.coverUrl
        return {...(articles[0] || ordinary),articles,articleLayoutVersion:2}
    }catch{return fallback()}
}

export function linkArticles(details:LinkDetails):PublicArticle[] {
    return details.articles.length ? details.articles : details.title || details.url ? [details] : []
}
/** Never give a browser a remote image URL or a proxy endpoint accepting one. */
export function publicLinkDetails(details:LinkDetails,messageId:number) {
    const display = (value:PublicArticle,index:number)=>({title:value.title,description:value.description,url:value.url,
        ...(value.coverUrl && Number.isSafeInteger(messageId) && messageId > 0 ? {coverPath:`/api/media/article/${messageId}/${index}`} : {})})
    return {...display(details,0),articles:details.articles.map(display)}
}
export function articleText(articles:PublicArticle[]):string {
    const escape = (value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    return articles.map(a=>[(a.url ? `<a href="${escape(a.url)}">${escape(a.title || a.url)}</a>` : escape(a.title)),a.description ? `<blockquote>${escape(a.description)}</blockquote>` : ''].filter(Boolean).join('\n')).join('\n\n')
}