import axios from 'axios'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'

/** Article covers are not an arbitrary-URL proxy. Old HTTP CDN links upgrade to HTTPS. */
export function articleCoverURL(value:unknown):string {
    if(typeof value !== 'string' || value.length > 4096 || Array.from(value).some(char=>char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))return ''
    try {
        const url = new URL(value)
        if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port
            || !['mmbiz.qpic.cn','mmbiz.qlogo.cn'].includes(url.hostname))return ''
        url.protocol = 'https:';url.hash = ''
        return url.href
    } catch {return ''}
}
const missing = ()=>Object.assign(new Error('coverUnavailable'),{code:'coverUnavailable',status:404})
const MAX_BYTES = 3 * 1024 * 1024
interface CoverResponse {status:number;headers:{location?:string};data:unknown}
type Request = (url:string,options:Record<string,unknown>)=>Promise<CoverResponse>

/** Shared by Telegram and the authenticated WebUI: bounded fetches and private JPEG cache. */
export function createArticleCoverLoader(directory = 'storage/webui-article-covers',request:Request = (url,options)=>axios.get(url,options)) {
    const pending = new Map<string,Promise<Buffer>>(),failed = new Map<string,number>()
    const waiting:Array<()=>void> = []
    let active = 0
    const fetchImage = async(url:string):Promise<Buffer>=>{
        const controller = new AbortController(),timer = setTimeout(()=>controller.abort(),8000)
        try {
            for(let hop = 0;hop < 4;hop++){
                const response = await request(url,{responseType:'arraybuffer',timeout:8000,signal:controller.signal,maxContentLength:MAX_BYTES,maxBodyLength:MAX_BYTES,maxRedirects:0,validateStatus:()=>true})
                if(response.status >= 300 && response.status < 400 && response.headers.location){
                    url = articleCoverURL(new URL(response.headers.location,url).href)
                    if(!url)throw missing()
                    continue
                }
                if(response.status !== 200 || !Buffer.isBuffer(response.data) || response.data.length > MAX_BYTES)throw missing()
                const bytes = response.data,head = bytes.subarray(0,16)
                const raster = head[0] === 255 && head[1] === 216 || head.subarray(0,4).equals(Buffer.from([137,80,78,71]))
                    || head.subarray(0,4).toString() === 'GIF8' || head.subarray(0,4).toString() === 'RIFF' && head.subarray(8,12).toString() === 'WEBP'
                if(!raster)throw missing()
                const image = sharp(bytes,{limitInputPixels:8000000})
                const info = await image.metadata()
                if(!info.width || !info.height || Math.max(info.width / info.height,info.height / info.width) > 20)throw missing()
                return await image.rotate().resize(1200,1200,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:84}).toBuffer()
            }
            throw missing()
        } finally {clearTimeout(timer)}
    }
    const load = async(url:string):Promise<Buffer>=>{
        await fs.mkdir(directory,{recursive:true})
        const key = createHash('sha256').update(url).digest('hex'),file = path.join(directory,key + '.jpg')
        try {
            const stat = await fs.stat(file)
            if(stat.size <= MAX_BYTES && Date.now() - stat.mtimeMs < 86400000)return await fs.readFile(file)
        } catch { /* No usable local cache. */ }
        if(active >= 3)await new Promise<void>(resolve=>waiting.push(resolve))
        else active++
        try {
            const image = await fetchImage(url),temporary = file + '.' + randomUUID() + '.tmp'
            try {await fs.writeFile(temporary,image,{mode:0o600});await fs.rename(temporary,file)}
            finally {await fs.unlink(temporary).catch(()=>undefined)}
            const files = (await fs.readdir(directory)).filter(name=>/^[a-f0-9]{64}\.jpg$/.test(name))
            if(files.length > 128){
                const stats = await Promise.all(files.map(async name=>({name,time:(await fs.stat(path.join(directory,name)).catch(()=>null))?.mtimeMs || 0})))
                await Promise.all(stats.sort((a,b)=>a.time - b.time).slice(0,files.length - 128).filter(item=>item.name !== key + '.jpg').map(item=>fs.unlink(path.join(directory,item.name)).catch(()=>undefined)))
            }
            return image
        } finally {const next = waiting.shift();if(next)next();else active--}
    }
    return (value:string):Promise<Buffer>=>{
        const url = articleCoverURL(value)
        if(!url || (failed.get(url) || 0) > Date.now())return Promise.reject(missing())
        const previous = pending.get(url)
        if(previous)return previous
        if(pending.size >= 32)return Promise.reject(missing())
        const operation = load(url).catch(()=>{
            if(failed.size >= 128)failed.delete(failed.keys().next().value)
            failed.set(url,Date.now() + 60000)
            throw missing()
        }).finally(()=>pending.delete(url))
        pending.set(url,operation)
        return operation
    }
}
export const loadArticleCover = createArticleCoverLoader()