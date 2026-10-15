import fs from 'node:fs'
import path from 'node:path'
import {randomUUID, createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import {FileBox} from 'file-box'
import {Emoji, Voice, WeVideo} from 'wx2tg-puppet'
import {WebMessageStore} from './message-store'

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
export type MediaKind = 'image' | 'emoji' | 'video' | 'audio' | 'voice' | 'file'
export interface MediaFile {id: string; name: string; kind: MediaKind; mime: string; size: number; digest: string; path?: string}
const error = (code: string, status = 400) => Object.assign(new Error(code), {code, status})
export const safeFileName = (name: string) => path.basename(name.replace(/\\/g, '/')).replace(/[<>:&'"\x00-\x1f]/g, '_').slice(0, 180) || 'attachment.bin'
const classify = (name: string, head: Buffer): {kind: MediaKind; mime: string} => {
    if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {kind:'image',mime:'image/png'}
    if (head[0] === 255 && head[1] === 216 && head[2] === 255) return {kind:'image',mime:'image/jpeg'}
    if (head.subarray(0, 4).toString() === 'GIF8') return {kind:'emoji',mime:'image/gif'}
    if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') return {kind:'image',mime:'image/webp'}
    if (head.subarray(4, 8).toString() === 'ftyp') return /\.m4a$/i.test(name) ? {kind:'audio',mime:'audio/mp4'} : {kind:'video',mime:'video/mp4'}
    if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return {kind:'audio',mime:/\.ogg$/i.test(name)?'audio/ogg':/\.wav$/i.test(name)?'audio/wav':'audio/mpeg'}
    return {kind:'file',mime:'application/octet-stream'}
}
const ffmpeg = (args: string[]) => new Promise<void>((resolve,reject)=>execFile(ffmpegPath || 'ffmpeg', ['-hide_banner','-loglevel','error','-y',...args], {timeout:90000,maxBuffer:1024*1024}, error=>error?reject(Object.assign(new Error('mediaConversionFailed'),{code:'mediaConversionFailed',status:400})):resolve()))

export class WebMediaStore {
    constructor(private store: WebMessageStore, private directory = 'storage/webui-media') {fs.mkdirSync(directory,{recursive:true})}
    async save(name: string, preference: string, stream: AsyncIterable<Uint8Array>, source: 'upload' | 'download' = 'upload'): Promise<MediaFile> {
        if (!['auto','voice'].includes(preference)) throw error('invalidMediaType')
        name=safeFileName(name)
        const id=randomUUID(), file=path.resolve(this.directory,id), hash=createHash('sha256')
        const handle=await fs.promises.open(file,'wx',0o600)
        let size=0,head=Buffer.alloc(0)
        try {
            for await(const value of stream) {
                const chunk=Buffer.from(value);size+=chunk.length
                if(size>(source==='download'?MAX_DOWNLOAD_BYTES:MAX_MEDIA_BYTES)) throw error(source==='download'?'downloadTooLarge':'mediaTooLarge',413)
                if(head.length<32)head=Buffer.concat([head,chunk]).subarray(0,32)
                hash.update(chunk)
                let written=0
                while(written<chunk.length)written+=(await handle.write(chunk,written,chunk.length-written)).bytesWritten
            }
            if(!size)throw error('emptyMedia')
            const detected=classify(name,head)
            if(preference==='voice'&&!/\.(mp3|wav|ogg|webm|m4a|aac|flac)$/i.test(name))throw error('invalidVoiceFormat')
            const media: MediaFile={id,name,kind:preference==='voice'?'voice':detected.kind,mime:detected.mime,size,digest:hash.digest('hex')}
            await this.store.run('INSERT INTO media(id,name,kind,mime,size,digest) VALUES(?,?,?,?,?,?)',[id,name,media.kind,media.mime,size,media.digest])
            return media
        } catch(e) {await handle.close();await fs.promises.unlink(file).catch(()=>{});throw e}
        finally {await handle.close().catch(()=>{})}
    }
    async get(id: string): Promise<MediaFile> {
        if(!/^[a-f0-9-]{36}$/.test(id))throw error('mediaMissing',404)
        const media=(await this.store.all('SELECT * FROM media WHERE id=?',[id]))[0]
        const file=path.resolve(this.directory,id)
        if(!media||!fs.existsSync(file))throw error('mediaMissing',404)
        return {...media,path:file}
    }
    async prepare(media: MediaFile) {
        const file=(await this.get(media.id)).path
        let buffer:Buffer=await fs.promises.readFile(file),name=media.name,duration=0,payload: any
        const temporary=path.resolve(this.directory,`${randomUUID()}.mp3`),thumbnail=path.resolve(this.directory,`${randomUUID()}.jpg`)
        try {
            if(media.kind==='image') {
                buffer=await sharp(buffer,{limitInputPixels:40000000}).png().toBuffer()
                name=path.parse(name).name+'.png';payload=FileBox.fromBuffer(buffer,name)
            } else if(media.kind==='emoji')payload=new Emoji({emojiBase64:buffer.toString('base64')})
            else if(media.kind==='video') {
                await ffmpeg(['-i',file,'-frames:v','1','-vf','scale=320:-2',thumbnail])
                duration=await new Promise<number>((resolve,reject)=>execFile('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{timeout:15000},(e,out)=>e?reject(e):resolve(Number(out.trim())||1)))
                payload=new WeVideo({videoBase64:buffer.toString('base64'),thumbBase64:(await fs.promises.readFile(thumbnail)).toString('base64'),videoDuration:Math.ceil(duration)})
            } else if(media.kind==='voice'||media.kind==='audio') {
                await ffmpeg(['-i',file,'-vn','-ac','1','-ar','24000','-f','mp3',temporary])
                buffer=await fs.promises.readFile(temporary);name=path.parse(name).name+'.mp3'
                duration=await new Promise<number>((resolve,reject)=>execFile('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',temporary],{timeout:15000},(e,out)=>e?reject(e):resolve(Number(out.trim())||1)))
                payload=media.kind==='voice'?new Voice({voiceBase64:buffer.toString('base64'),voiceDuration:Math.ceil(duration*1000),type:2}):FileBox.fromBuffer(buffer,name)
            } else payload=FileBox.fromBuffer(buffer,name)
            if(buffer.length>MAX_MEDIA_BYTES)throw error('mediaTooLarge',413)
            return {payload,buffer,name,duration,sendType:({image:'photo',emoji:'animation',video:'video',voice:'voice',audio:'audio',file:'document'} as const)[media.kind]}
        } finally {await Promise.all([temporary,thumbnail].map(f=>fs.promises.unlink(f).catch(()=>{})))}
    }
}
