import {config} from '../config'
import {TelegramDisplayPolicy,isDisplayMode,customEmojiRejected} from './TelegramDisplayPolicy'
import {renderWechatCustomEmojiHtml,renderWechatEmojiFallbackHtml,stripTelegramCustomEmoji,splitTelegramHtml} from './WechatCustomEmoji'
import {replyDirectoryText as replyDirectoryTextRaw,DirectoryDeliveryContext,DirectoryDetailAvatar} from './DirectoryPageDelivery'
import type {DirectoryMarkup} from './DirectoryPager'
import type {EmojiTransport} from './TelegramEmojiCapability'
import {setTimeout,clearTimeout} from 'node:timers'

export const telegramDisplay = new TelegramDisplayPolicy('storage/telegram-display.json',isDisplayMode(config.TELEGRAM_DISPLAY_MODE) ? config.TELEGRAM_DISPLAY_MODE : 'auto')

/** One final rendering boundary shared by Bot API, MTProto, quotes and captions. */
export function renderTelegramHtml(html:string,customEnabled:boolean,maxLength?:number,chatId?:string|number,transport:EmojiTransport = 'botApi'):string {
    if(customEnabled && telegramDisplay.allows('customEmoji',chatId,transport))return renderWechatCustomEmojiHtml(html,true,maxLength)
    const fallback = renderWechatEmojiFallbackHtml(html,config.TELEGRAM_EMOJI_FALLBACK !== 'text')
    // Expanding a previously rendered custom emoji back to its alias must not
    // turn a valid caption into an oversized one. Unicode is always readable.
    if(maxLength && splitTelegramHtml(fallback,maxLength).length > 1 && splitTelegramHtml(html,maxLength).length <= 1)return stripTelegramCustomEmoji(html)
    return fallback
}

export async function sendTelegramHtml<T>(chatId:string|number,html:string,customEnabled:boolean,maxLength:number|undefined,
    send:(html:string)=>Promise<T>,active = ()=>true,transport:EmojiTransport = 'botApi',edit?:(message:T,html:string)=>Promise<unknown>):Promise<T> {
    if(customEnabled && transport === 'botApi' && telegramDisplay.mode(chatId) === 'auto'
        && telegramDisplay.emoji.snapshot(chatId).state === 'unknown' && telegramDisplay.prepareEmoji
        && renderWechatCustomEmojiHtml(html,true,maxLength).includes('<tg-emoji')) {
        try {customEnabled = await telegramDisplay.prepareEmoji(chatId)} catch {customEnabled = false}
        if(!active())throw new Error('Telegram emoji preflight cancelled')
    }
    const rendered = renderTelegramHtml(html,customEnabled,maxLength,chatId,transport)
    const generation = telegramDisplay.emoji.generation
    try {
        const result = await send(rendered)
        if(generation === telegramDisplay.emoji.generation){
            telegramDisplay.emoji.observe(chatId,rendered,result,transport)
            if(edit && active() && rendered.includes('<tg-emoji') && telegramDisplay.emoji.snapshot(chatId,transport).reason === 'missingEntities'){
                // The original send succeeded. Editing its receipt must never turn
                // into a second send, even if the edit response is lost.
                let timer:NodeJS.Timeout
                try {
                    await Promise.race([
                        edit(result,renderTelegramHtml(rendered,false,maxLength,chatId,transport)),
                        new Promise<never>((_,reject)=>{timer = setTimeout(()=>reject(new Error('emojiFallbackEditTimeout')),5000)}),
                    ])
                }
                catch {console.warn('[Telegram] Custom emoji fallback edit unconfirmed')}
                finally {clearTimeout(timer)}
            }
        }
        return result
    } catch(error){
        if(generation !== telegramDisplay.emoji.generation)throw error
        if(rendered.includes('<tg-emoji'))telegramDisplay.emoji.record(chatId,'unknown','requestFailed',transport)
        if(!rendered.includes('<tg-emoji') || !customEmojiRejected(error))throw error
        telegramDisplay.reject('customEmoji',chatId,transport)
        // Do not issue a late fallback after an outer timeout/cancellation.
        if(!active())throw error
        return send(renderTelegramHtml(rendered,false,maxLength,chatId,transport))
    }
}

export function useRichDirectory(ctx:DirectoryDeliveryContext):boolean {
    const chatId = ctx.callbackQuery?.message?.chat?.id ?? ctx.chat?.id
    return telegramDisplay.allows('richMessage',chatId) && (!ctx.callbackQuery || ctx.callbackQuery.message?.rich_message != null)
}

export function replyDirectoryText(ctx:DirectoryDeliveryContext,text:string,markup?:DirectoryMarkup,avatar?:DirectoryDetailAvatar):Promise<boolean> {
    const chatId = ctx.callbackQuery?.message?.chat?.id ?? ctx.chat?.id
    return replyDirectoryTextRaw(ctx,text,markup,avatar,!useRichDirectory(ctx),()=>telegramDisplay.reject('richMessage',chatId))
}
