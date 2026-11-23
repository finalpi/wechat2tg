import axios from 'axios'
import {DomUtils,parseDocument} from 'htmlparser2'
import {XMLValidator} from 'fast-xml-parser'
import sharp from 'sharp'

export type MomentsSession = {owner:number;account:string;baseURL:string}
export type MomentPhoto = {original?:string;thumbnail?:string}
export type Moment = {id:string;target:string;name:string;time:number;text:string;likes:number;comments:number;photos:MomentPhoto[];otherMedia:boolean}
export type MomentsPage = {posts:Moment[];next?:string;md5:string;tip:string}
export class MomentsReadError extends Error {}
const protocolCode = (value:unknown)=>typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
const maxID = (1n << 64n) - 1n
export const momentsContactId = (value:unknown):value is string=>typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value)
const postId = (value:unknown):value is string=>typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= maxID
const text = (value:unknown,limit:number)=>typeof value === 'string' ? value.trim().slice(0,limit).split('').filter(char=>char >= ' ' || '\n\r\t'.includes(char)).join('') : ''
const count = (value:unknown)=>typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0

// Only known WeChat Moments image endpoints; never fetch arbitrary XML URLs.
export function momentsPhotoURL(value:unknown):string|undefined {
    if(typeof value !== 'string' || !value || value.length > 1024)return
    try {
        const url = new URL(value.trim())
        if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash
            || !/^(?:[a-z0-9-]*mmsns|mmbiz)\.qpic\.cn$/.test(url.hostname)
            || !/^\/mmsns\/[a-zA-Z0-9_-]{1,512}\/\d{1,5}$/.test(url.pathname))return
        url.protocol = 'https:'
        return url.href
    } catch {return undefined}
}

function parseMoment(raw:any,target:string):Moment|undefined {
    const xml = raw?.ObjectDesc?.buffer
    if(raw?.Username !== target || Number(raw.DeleteFlag || 0) !== 0 || typeof xml !== 'string'
        || xml.length > 131072 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)return
    const document = parseDocument(xml,{xmlMode:true,decodeEntities:true})
    const children = (node:any,name:string)=>node?.children?.filter((child:any)=>child.type === 'tag' && child.name === name) || []
    const one = (node:any,name:string)=>{const nodes = children(node,name);return nodes.length === 1 ? nodes[0] : undefined}
    const value = (node:any,name:string)=>{const child = one(node,name);return child ? DomUtils.textContent(child).trim() : ''}
    const root = one(document,'TimelineObject'),id = value(root,'id')
    // Go emits uint64 as a JSON number. The XML mirror preserves all digits.
    if(!postId(id) || value(root,'username') !== target || (typeof raw.Id === 'string' && raw.Id !== id)
        || (typeof raw.Id === 'number' && raw.Id !== Number(id)))return
    const time = Number(value(root,'createTime'))
    if(!Number.isSafeInteger(time) || time <= 0 || time > 4102444800)return
    const content = one(root,'ContentObject'),media = children(one(content,'mediaList'),'media')
    const photos:MomentPhoto[] = []
    let otherMedia = false
    for(const item of media.slice(0,9)) {
        if(value(item,'type') !== '2'){otherMedia = true;continue}
        const original = momentsPhotoURL(value(item,'url')),thumbnail = momentsPhotoURL(value(item,'thumb'))
        if(original || thumbnail)photos.push({original,thumbnail})
        else otherMedia = true
    }
    return {id,target,name:text(raw.Nickname,100) || target,time,text:text(value(root,'contentDesc') || value(content,'title'),2600),
        likes:count(raw.LikeCount),comments:count(raw.CommentCount),photos,otherMedia:otherMedia || media.length > 9}
}

export function parseMomentsPage(body:unknown,target:string,cursor?:string):MomentsPage {
    const response = body as any,data = response?.Data,ret = data?.BaseResponse?.ret
    if(response?.Code !== 0 || response.Success !== true || !data || (ret !== undefined && ret !== 0 && ret !== 2004)) {
        const code = protocolCode(response?.Code),wechatRet = protocolCode(ret)
        const status = [code === undefined ? '' : `Code=${code}`,wechatRet === undefined ? '' : `ret=${wechatRet}`].filter(Boolean).join('，')
        throw new MomentsReadError(`朋友圈读取失败：上游 GetDetail 返回异常${status ? `（${status}）` : ''}。请检查微信登录状态和协议服务。`)
    }
    const tip = text(Array.isArray(data.RetTips) ? data.RetTips[0] : data.RetTips,240)
    const md5 = typeof data.FristPageMd5 === 'string' && /^[a-f0-9]{8,64}$/i.test(data.FristPageMd5) ? data.FristPageMd5 : ''
    const posts:Moment[] = [], seen = new Set<string>()
    for(const raw of (Array.isArray(data.ObjectList) ? data.ObjectList : []).slice(0,50)) {
        const post = parseMoment(raw,target)
        if(!post || seen.has(post.id) || (cursor && BigInt(post.id) >= BigInt(cursor)))continue
        seen.add(post.id);posts.push(post)
    }
    // A visibility-limited response may contain no posts and no RetTips.
    // The UI must treat that as an empty view, not a request to start a private chat.
    const next = posts.reduce<string|undefined>((lowest,post)=>!lowest || BigInt(post.id) < BigInt(lowest) ? post.id : lowest,undefined)
    return {posts,next,md5,tip}
}

export async function fetchMomentsPage(session:MomentsSession,target:string,cursor?:string,md5 = ''):Promise<MomentsPage> {
    if(!momentsContactId(session.account) || !momentsContactId(target) || (cursor !== undefined && !postId(cursor)))throw new MomentsReadError('朋友圈读取失败：联系人或翻页位置无效。')
    const header = JSON.stringify({Wxid:session.account,Towxid:target,Fristpagemd5:cursor && /^[a-f0-9]{8,64}$/i.test(md5) ? md5 : ''})
    // Do not round the uint64, or send a JSON string to a Go uint64 field.
    const payload = `${header.slice(0,-1)},"Maxid":${cursor ?? '0'}}`
    try {
        const result = await axios.post(session.baseURL.replace(/\/+$/,'') + '/FriendCircle/GetDetail',payload,{
            headers:{'Content-Type':'application/json'},timeout:12000,maxRedirects:0,maxContentLength:2 * 1024 * 1024,
        })
        return parseMomentsPage(result.data,target,cursor)
    } catch(error) {
        if(axios.isAxiosError(error)) {
            const status = protocolCode(error.response?.status)
            if(status === 404 || status === 405)throw new MomentsReadError(`朋友圈读取失败：上游 GetDetail 接口不可用（HTTP ${status}），请检查协议版本和 API 地址。`)
            if(status !== undefined)throw new MomentsReadError(`朋友圈读取失败：上游 GetDetail 返回 HTTP ${status}。`)
            if(error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')throw new MomentsReadError('朋友圈读取失败：请求上游 GetDetail 超时。')
            throw new MomentsReadError('朋友圈读取失败：无法连接上游 GetDetail，请检查协议服务。')
        }
        throw error
    }
}

export async function downloadMomentPhotos(post:Moment,active:()=>Promise<boolean>):Promise<Buffer[]> {
    const fetch = async(photo:MomentPhoto)=>{
        for(const url of [photo.original,photo.thumbnail]) {
            if(!url || momentsPhotoURL(url) !== url)continue
            try {
                const response = await axios.get<ArrayBuffer>(url,{responseType:'arraybuffer',timeout:4500,maxRedirects:0,
                    maxContentLength:4 * 1024 * 1024,proxy:false})
                const image = sharp(Buffer.from(response.data),{limitInputPixels:20000000})
                if(!['jpeg','png','webp','gif'].includes((await image.metadata()).format))continue
                return await image.rotate().resize(1400,1400,{fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:80}).toBuffer()
            } catch { /* Expired or unavailable media must not prevent viewing text. */ }
        }
        return undefined
    }
    const pictures:Buffer[] = []
    let bytes = 0
    for(let start = 0;start < post.photos.length;start += 3) {
        if(!await active())return []
        const batch = await Promise.all(post.photos.slice(start,start + 3).map(fetch))
        for(const image of batch)if(image && bytes + image.length <= 8 * 1024 * 1024){pictures.push(image);bytes += image.length}
    }
    return pictures
}