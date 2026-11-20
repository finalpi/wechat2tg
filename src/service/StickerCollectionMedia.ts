import fs from 'node:fs/promises'
import {existsSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import axios from 'axios'
import {Telegram} from 'telegraf'
import {StickerMedia} from './StickerCollection'

export const MAX_STICKER_SOURCE_BYTES = 20 * 1024 * 1024
const MAX_SOURCE = MAX_STICKER_SOURCE_BYTES
const run = (args:string[])=>new Promise<void>((resolve,reject)=>{
    execFile(ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : 'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],{timeout:45000,maxBuffer:1024 * 1024},error=>error ? reject(new Error('表情转换失败或超时，未添加到贴纸包。')) : resolve())
})

export async function convertCollectedSticker(buffer:Buffer,kind:StickerMedia['kind']) {
    if(buffer.length > MAX_SOURCE)throw new Error('原表情超过 20 MB，暂不支持收藏。')
    if(kind === 'animated')throw new Error('暂不支持收藏 TGS 矢量动画；微信 GIF 和 TG 视频贴纸可以收藏。')
    const digest = createHash('sha256').update(buffer).digest('hex')
    const gif = ['GIF87a','GIF89a'].includes(buffer.subarray(0,6).toString())
    const webp = buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP'
    let pages = 1
    if(kind === 'static') {
        const png = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        const jpeg = buffer.subarray(0,3).equals(Buffer.from([255,216,255]))
        if(!png && !jpeg && !gif && !webp)throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片。')
        // Inspect the frames so animated WebP/GIF are never silently flattened.
        pages = (await sharp(buffer,{limitInputPixels:40000000}).metadata()).pages || 1
    }
    if(kind === 'static' && pages === 1) {
        const source = await sharp(buffer,{limitInputPixels:40000000}).rotate()
            .resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({palette:true,quality:90}).toBuffer()
        if(source.length > 512 * 1024)throw new Error('静态表情压缩后仍超过 512 KB，未添加。')
        return {source,format:'static' as const,digest,trimmed:false}
    }
    const format = gif ? 'gif'
        : buffer.subarray(4,8).toString() === 'ftyp' ? 'mov'
        : buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) ? 'matroska'
        : webp ? 'webp_pipe' : undefined
    if(!format)throw new Error('不支持此动图格式，未添加；不会按静态图片保存。')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'wechat-sticker-'))
    try {
        const input = path.join(directory,'input'),output = path.join(directory,'sticker.webm')
        await fs.writeFile(input,buffer,{mode:0o600})
        // Disable network protocols and external playlists while decoding untrusted input.
        // Cap to 3 seconds; tell the user that only this segment is retained.
        for(const [fps,quality] of [[24,36],[15,46],[10,55]]) {
            await run(['-protocol_whitelist','file,pipe','-f',format,'-i',input,'-t','3','-map','0:v:0','-an','-sn','-dn',
                '-vf',`fps=${fps},scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1`,
                '-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf',String(quality),'-deadline','realtime','-cpu-used','6','-threads','2',output])
            const source = await fs.readFile(output)
            if(source.length <= 256 * 1024)return {source,format:'video' as const,digest,trimmed:true}
        }
        throw new Error('动图压缩后仍超过 256 KB，未添加；请使用更短、更简单的动图或保存为 TG GIF。')
    } finally {await fs.rm(directory,{recursive:true,force:true})}
}

export async function prepareCollectedSticker(telegram:Telegram,media:StickerMedia) {
    if(media.size > MAX_SOURCE)throw new Error('原表情超过 20 MB，暂不支持收藏。')
    if(media.kind === 'animated')throw new Error('暂不支持收藏 TGS 矢量动画。')
    try {
        const link = await telegram.getFileLink(media.fileId)
        const response = await axios.get<ArrayBuffer>(link.href,{responseType:'arraybuffer',timeout:30000,
            maxContentLength:MAX_SOURCE,maxBodyLength:MAX_SOURCE,maxRedirects:0,
            httpsAgent:telegram.options.agent,proxy:false})
        return await convertCollectedSticker(Buffer.from(response.data),media.kind)
    } catch(error) {
        // Axios errors contain the Bot token in the URL; never expose or log them.
        if(axios.isAxiosError(error))throw new Error('表情下载失败、超时或超过 20 MB，请稍后再试。')
        throw error
    }
}