import {config} from '../config'
import {TelegramDisplayPolicy,isDisplayMode,customEmojiRejected} from './TelegramDisplayPolicy'
import {renderWechatCustomEmojiHtml,renderWechatEmojiFallbackHtml,stripTelegramCustomEmoji,splitTelegramHtml} from './WechatCustomEmoji'
import {replyDirectoryText as replyDirectoryTextRaw,DirectoryDeliveryContext,DirectoryDetailAvatar} from './DirectoryPageDelivery'
import type {DirectoryMarkup} from './DirectoryPager'

export const telegramDisplay = new TelegramDisplayPolicy('storage/telegram-display.json',isDisplayMode(config.TELEGRAM_DISPLAY_MODE) ? config.TELEGRAM_DISPLAY_MODE : 'auto')

/** One final rendering boundary shared by Bot API, MTProto, quotes and captions. */
export function renderTelegramHtml(html:string,customEnabled:boolean,maxLength?:number,chatId?:string|number):string {
    if(customEnabled && telegramDisplay.allows('customEmoji',chatId))return renderWechatCustomEmojiHtml(html,true,maxLength)
    const fallback = renderWechatEmojiFallbackHtml(html,config.TELEGRAM_EMOJI_FALLBACK !== 'text')
    // Expanding a previously rendered custom emoji back to its alias must not
    // turn a valid caption into an oversized one. Unicode is always readable.
    if(maxLength && splitTelegramHtml(fallback,maxLength).length > 1 && splitTelegramHtml(html,maxLength).length <= 1)return stripTelegramCustomEmoji(html)
    return fallback
}

export async function sendTelegramHtml<T>(chatId:string|number,html:string,customEnabled:boolean,maxLength:number|undefined,
    send:(html:string)=>Promise<T>,active = ()=>true):Promise<T> {
    const rendered = renderTelegramHtml(html,customEnabled,maxLength,chatId)
    try {return await send(rendered)} catch(error){
        if(!rendered.includes('<tg-emoji') || !customEmojiRejected(error))throw error
        telegramDisplay.reject('customEmoji',chatId)
        // Do not issue a late fallback after an outer timeout/cancellation.
        if(!active())throw error
        return send(renderTelegramHtml(rendered,false,maxLength,chatId))
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