import path from 'node:path'
import sharp from 'sharp'

export interface TelegramMedia {
    buff:Buffer
    filename:string
    caption?:string
    fileType:'animation'|'document'|'audio'|'photo'|'video'|'voice'
}

// libvips can report APNG as a single PNG page. Inspect chunk boundaries rather
// than searching compressed pixels for "acTL", and fail closed on truncation.
function staticPng(buffer:Buffer):boolean {
    let offset = 8
    while(offset + 12 <= buffer.length){
        const length = buffer.readUInt32BE(offset),type = buffer.toString('ascii',offset + 4,offset + 8)
        if(offset + 12 + length > buffer.length || type === 'acTL')return false
        if(type === 'IEND')return length === 0 && offset + 12 === buffer.length
        offset += length + 12
    }
    return false
}

/** WeChat labels all stickers as animation, even PNG/JPEG and single-frame GIF.
 * Normalize only proven static images, before any Telegram request. Preserve the
 * original archive/outbox bytes, real animations and undecodable/oversized data. */
export async function prepareTelegramMedia(file:TelegramMedia):Promise<TelegramMedia> {
    if(file.fileType !== 'animation' || !Buffer.isBuffer(file.buff) || file.buff.length > 20 * 1024 * 1024)return file
    const buffer = file.buff
    const png = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const gif = ['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))
    const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    const webp = buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP'
    if(!png && !gif && !jpeg && !webp || png && !staticPng(buffer))return file
    try {
        const image = sharp(buffer,{limitInputPixels:40000000,failOn:'error'}).timeout({seconds:5})
        const metadata = await image.metadata()
        if(!['png','jpeg','gif','webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1
            || (metadata.delay?.length ?? 0) > 1 || gif && metadata.pages !== 1)return file
        const animatedWebp = webp && buffer.toString('ascii',12,16) === 'VP8X' && (buffer[20] & 2) !== 0
        if(animatedWebp && metadata.pages !== 1)return file
        const {width,height} = metadata
        // Telegram photos cannot exceed a 20:1 aspect ratio. Do not turn an
        // otherwise deliverable animation into a photo Telegram would reject.
        if(!width || !height || Math.max(width,height) / Math.min(width,height) > 20)return file
        const buff = await image.rotate().resize(1280,1280,{fit:'inside',withoutEnlargement:true})
            .flatten({background:'#ffffff'}).png().toBuffer()
        if(buff.length > 5 * 1024 * 1024)return file
        return {...file,buff,filename:path.parse(file.filename).name + '.png',fileType:'photo'}
    } catch {return file}
}