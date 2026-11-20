import path from 'node:path'
import {Telegraf} from 'telegraf'
import {StickerCollection,stickerMedia} from './StickerCollection'
import {prepareCollectedSticker} from './StickerCollectionMedia'

export const STICKER_COLLECTION_UPDATES = [
    'message','edited_message','channel_post','edited_channel_post','inline_query','chosen_inline_result',
    'callback_query','shipping_query','pre_checkout_query','poll','poll_answer','my_chat_member','chat_join_request',
    'chat_boost','removed_chat_boost','message_reaction',
] as const

export function installStickerCollection(bot:Telegraf,options:{
    owner:()=>Promise<number>
    allowed:(chatId:number,threadId?:number)=>Promise<boolean>
    directory?:string
    now?:()=>number
    warn?:()=>void
}) {
    let collection:StickerCollection
    const started = Math.floor((options.now?.() ?? Date.now()) / 1000)
    const service = ()=>collection ||= new StickerCollection(path.join(options.directory || 'storage','telegram-sticker-collection.json'),{
        call:(method,payload)=>bot.telegram.callApi(method as any,payload as any),
        prepare:media=>prepareCollectedSticker(bot.telegram,media),
    })
    const remember = (message:any)=>{
        if(!bot.botInfo?.id || !stickerMedia(message))return
        try {service().remember(bot.botInfo.id,message)} catch {options.warn?.()}
    }
    const call = bot.telegram.callApi.bind(bot.telegram)
    bot.telegram.callApi = (async(method:any,payload:any,extra:any)=>{
        const result = await call(method,payload,extra)
        // Only confirmed send/edit receipts are indexed. Never fail or retry a
        // successful message delivery because the optional collection index failed.
        if(/^(send|editMessage)/.test(method)) {
            for(const message of Array.isArray(result) ? result : [result])remember(message)
        }
        return result
    }) as typeof bot.telegram.callApi

    bot.use(async(ctx,next)=>{
        const reaction = ctx.update['message_reaction'] as any
        const text = ctx.message?.['text']?.trim() || ''
        const command = /^\/collect(?:@([a-zA-Z0-9_]+))?$/.exec(text)
        const target = ctx.message?.['reply_to_message']
        const requested = (text === '收藏' && Boolean(target)) || text === '/收藏表情' || Boolean(command && (!command[1] || command[1].toLowerCase() === ctx.botInfo.username.toLowerCase()))
        if(!reaction && !requested) {
            if(stickerMedia(ctx.message) && ctx.from?.id === await options.owner())remember(ctx.message)
            return next()
        }
        const owner = await options.owner()
        const actor = reaction?.user?.id ?? ctx.from?.id
        if(!owner || actor !== owner || reaction?.actor_chat)return
        if((reaction?.date ?? ctx.message?.date ?? 0) < started)return
        if(reaction) {
            const thumbs = (values:any[])=>values?.some(value=>value.type === 'emoji' && value.emoji === '👍')
            if(!thumbs(reaction.new_reaction) || thumbs(reaction.old_reaction))return
        }
        const chatId = reaction?.chat.id ?? ctx.chat?.id
        if(!chatId)return
        const messageId = reaction?.message_id ?? target?.message_id ?? ctx.message?.message_id
        let threadId = ctx.message?.['message_thread_id'] as number|undefined
        let response = ''
        try {
            const media = reaction ? service().lookup(ctx.botInfo.id,chatId,messageId) : stickerMedia(target)
            threadId ??= media?.threadId
            if(!await options.allowed(chatId,threadId))return
            if(!media) {
                response = reaction ? '未找到可收藏的表情记录（仅保留最近 5000 条媒体）。请回复原表情发送“收藏”。'
                    : '请回复图片、GIF 或视频贴纸发送“收藏”或 /collect。暂不支持 TGS 矢量动画。'
            } else {
                const result = await service().collect(ctx.botInfo,owner,media)
                response = `${result.duplicate ? '已收藏过，不会重复添加。' : '已加入微信收藏贴纸包。'}${result.trimmed ? '\n动图最多保留前 3 秒，已按 TG 限制压缩。' : ''}\n${result.url}\n首次使用请打开链接添加贴纸包。有链接的人可能访问包内表情，请勿收藏私密图片。`
            }
        } catch(error) {
            // Only our own user-facing messages are safe; API/library errors may contain secrets.
            const detail = error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message) ? error.message : '收藏失败，请确认已私聊启动 Bot，再稍后重试。'
            response = detail
        }
        if(response)await bot.telegram.sendMessage(chatId,response,{
            message_thread_id:threadId,
            reply_parameters:{message_id:messageId,allow_sending_without_reply:true},
            link_preview_options:{is_disabled:true},
        }).catch(()=>undefined) // Failure to post the receipt does not repeat collection.
        // Deliberately consume collection commands; do not forward them to WeChat.
    })
}