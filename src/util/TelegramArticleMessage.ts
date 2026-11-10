import {loadArticleCover} from './ArticleCover'
import {PublicArticle,readLinkDetails,linkArticles} from '../webui/articles'

type RichText = string | {type:'url';text:string;url:string} | RichText[]
type Photo = {type:'photo';photo:{type:'photo';media:string};caption:{text:RichText}}
type Paragraph = {type:'paragraph';text:RichText}
type Block = Photo | Paragraph | {type:'collage';blocks:Photo[]}
export interface ArticlePayload {rich_message:string;[key:string]:unknown}

/** One native Telegram message: first cover + linked title, then a compact collage
 * of remaining covers. Missing covers retain text links in their original order. */
export async function prepareTelegramArticles(input:PublicArticle[],sender:string,load = loadArticleCover):Promise<ArticlePayload|undefined> {
    const articles = linkArticles(readLinkDetails(undefined,{articles:input})).slice(0,20)
    const covers = await Promise.all(articles.map((article,index)=>index < 10 && article.coverUrl ? load(article.coverUrl).catch(()=>undefined) : undefined))
    if(!covers.some(Boolean))return undefined
    const blocks:Block[] = []
    if(sender)blocks.push({type:'paragraph',text:sender.slice(0,200)})
    const payload:ArticlePayload = {rich_message:''}
    const title = (article:PublicArticle):RichText=>article.url ? {type:'url',text:article.title || article.url,url:article.url} : article.title
    const photo = (index:number):Photo=>{
        const name = `article_cover_${index}`
        payload[name] = {source:covers[index],filename:`article-${index}.jpg`}
        return {type:'photo',photo:{type:'photo',media:`attach://${name}`},caption:{text:articles[index].description ? [title(articles[index]),'\n',articles[index].description] : title(articles[index])}}
    }
    let collage:Photo[] = []
    const flush = ()=>{
        if(collage.length)blocks.push(collage.length === 1 ? collage[0] : {type:'collage',blocks:collage})
        collage = []
    }
    for(let i = 0;i < articles.length;i++){
        if(i === 0 || !covers[i]){
            flush()
            blocks.push(covers[i] ? photo(i) : {type:'paragraph',text:title(articles[i])})
            if(!covers[i] && articles[i].description)blocks.push({type:'paragraph',text:articles[i].description})
        } else collage.push(photo(i))
    }
    flush()
    // Telegraf 4 requires explicit JSON serialization when files are top-level attachments.
    payload.rich_message = JSON.stringify({blocks,skip_entity_detection:true})
    return payload
}

export function articleMessageRejected(error:unknown):boolean {
    const response = (error as {response?:{error_code?:number;description?:string}})?.response
    if(!response || ![400,404].includes(response.error_code) || typeof response.description !== 'string')return false
    if(response.error_code === 404)return /^(?:Not Found|Bad Request: Not Found)$|(?:sendRichMessage|method).*(?:not found|unsupported)/i.test(response.description)
    return /IMAGE_PROCESS_FAILED|PHOTO_INVALID|MEDIA_INVALID|can't parse input media|wrong file identifier\/HTTP URL specified|(?:message|caption) is too long/i.test(response.description)
        || /rich[ _]?(?:message|block)|InputRichMessage/i.test(response.description) && /not supported|unsupported|invalid|can't parse|cannot parse|too (?:long|large)/i.test(response.description)
}