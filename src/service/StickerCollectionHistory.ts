import {Api,utils} from 'telegram'
import type {TelegramClient} from 'telegram'
import type {progressCallback} from 'telegram/client/downloads'
import {getTelegramThreadId} from '../util/TelegramTopicUtils'
import {convertCollectedSticker,MAX_STICKER_SOURCE_BYTES} from './StickerCollectionMedia'
import type {PreparedSticker,StickerMedia} from './StickerCollection'

export type HistoricalSticker = {threadId?:number;prepare:()=>Promise<PreparedSticker>}

async function withDeadline<T>(task:()=>Promise<T>,ms:number,cancel?:()=>void):Promise<T> {
    let timer:NodeJS.Timeout
    const timeout = new Promise<never>((_,reject)=>{
        timer = setTimeout(()=>{cancel?.();reject(new Error('读取原表情超时，请回复原消息发送 /collect。'))},ms)
    })
    try {return await Promise.race([task(),timeout])} finally {clearTimeout(timer)}
}

/** A reaction supplies only a chat and message ID. Read that exact message with
 * the Bot's existing MTProto session, never the owner's personal session. */
export async function findHistoricalSticker(client:TelegramClient,chatId:number,messageId:number,botId:number,owner:number):Promise<HistoricalSticker|undefined> {
    if(!client.connected || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId) || messageId <= 0)return
    const message = await withDeadline(async()=>{
        if((await client.getMe(true))?.userId?.toString() !== String(botId))return
        const peer = await client.getInputEntity(chatId)
        return (await client.getMessages(peer,{ids:[messageId]}))[0]
    },7000)
    if(!(message instanceof Api.Message) || message.id !== messageId || utils.getPeerId(message.peerId) !== String(chatId) || message.noforwards)return
    // A reaction is not a general-purpose chat history export. Resolve only the
    // owner's own media or media the configured Bot sent (including forwarded GIFs).
    const senderId = message.senderId?.toString()
    if(senderId ? ![String(botId),String(owner)].includes(senderId) : !message.out || !(message.peerId instanceof Api.PeerUser))return
    const threadId = getTelegramThreadId(message),media = message.media
    let kind:StickerMedia['kind'],size = 0,thumb:Api.TypePhotoSize|undefined
    if(media instanceof Api.MessageMediaPhoto && media.photo instanceof Api.Photo && !media.ttlSeconds) {
        kind = 'static'
        for(const candidate of media.photo.sizes) {
            const bytes = candidate instanceof Api.PhotoSize ? candidate.size
                : candidate instanceof Api.PhotoSizeProgressive ? Math.max(...candidate.sizes)
                    : candidate instanceof Api.PhotoCachedSize ? candidate.bytes.length : 0
            if(bytes > size){thumb = candidate;size = bytes}
        }
    } else if(media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document && !media.ttlSeconds) {
        const document = media.document,mime = document.mimeType
        size = Number(document.size.toString())
        if(mime === 'application/x-tgsticker')kind = 'animated'
        else if(mime === 'image/gif' || mime === 'video/webm' || mime === 'video/mp4' && document.attributes.some(a=>a instanceof Api.DocumentAttributeAnimated))kind = 'video'
        else if(['image/png','image/jpeg','image/webp'].includes(mime))kind = 'static'
    }
    if(!kind || !Number.isSafeInteger(size) || size <= 0)return
    return {threadId,prepare:async()=>{
        if(size > MAX_STICKER_SOURCE_BYTES)throw new Error('原表情超过 20 MB，暂不支持收藏。')
        if(kind === 'animated')throw new Error('暂不支持收藏 TGS 矢量动画。')
        const progress:progressCallback = downloaded=>{
            if(progress.isCanceled || Number(downloaded.toString()) > MAX_STICKER_SOURCE_BYTES)throw new Error('表情下载已停止。')
        }
        const buffer = await withDeadline(()=>message.downloadMedia({thumb,progressCallback:progress}),30000,()=>{progress.isCanceled = true})
        if(!Buffer.isBuffer(buffer) || !buffer.length)throw new Error('无法下载原表情，请回复原消息发送 /collect。')
        return convertCollectedSticker(buffer,kind)
    }}
}