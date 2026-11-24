import {WECHAT_CUSTOM_EMOJI_BY_ID} from './WechatCustomEmojiData'

export type TelegramTextEntity = {type?:string;className?:string;offset:number;length:number;custom_emoji_id?:string;documentId?:unknown}
const withoutStyle = (text:string)=>text.replace(/[\ufe0e\ufe0f]/g,'')
const emojiSpan = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\ufe0e\ufe0f]?\p{Emoji_Modifier}?(?:\u200d(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\ufe0e\ufe0f]?\p{Emoji_Modifier}?)*$/u
const fallbackStarts = new Set(Array.from(WECHAT_CUSTOM_EMOJI_BY_ID.values(),entry=>Array.from(entry.emoji)[0]))
export const hasWechatPackFallback = (text:string)=>Array.from(text).some(char=>fallbackStarts.has(char))

export function normalizeEscapedTelegramCommandText(text: string): string {
    return text.startsWith('\\/') ? text.replace(/^\\\//, '/') : text
}

/** Convert known document IDs, not the Unicode fallbacks shared by many pictures. */
export function inspectTelegramTextForWechat(text:string,entities?:readonly TelegramTextEntity[]) {
    const matches:{start:number;end:number;alias:string}[] = []
    let custom = 0,known = 0,restored = 0
    for(const entity of entities || []){
        if(!entity || entity.type !== 'custom_emoji' && entity.className !== 'MessageEntityCustomEmoji')continue
        custom++
        const {offset,length} = entity
        let id:string
        if(entity.type === 'custom_emoji')id = entity.custom_emoji_id
        else if(entity.className === 'MessageEntityCustomEmoji'){
            // GramJS represents int64 as a BigInteger, never coerce it to Number.
            const value = entity.documentId
            if(typeof value !== 'string' && typeof value !== 'bigint' && !(value && typeof value === 'object'))continue
            try {id = String(value)} catch {continue}
        } else continue
        const match = WECHAT_CUSTOM_EMOJI_BY_ID.get(id)
        if(!match)continue
        known++
        if(!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > text.length - offset)continue
        const end = offset + length,span = text.slice(offset,end)
        // The document ID is authoritative. Accept a different fallback glyph
        // when it is still one emoji; never replace surrounding plain text.
        if(withoutStyle(span) === withoutStyle(match.emoji) || emojiSpan.test(span))matches.push({start:offset,end,alias:match.alias})
    }
    let cursor = 0,converted = ''
    for(const {start,end,alias} of matches.sort((a,b)=>a.start - b.start)){
        if(start < cursor)continue
        converted += text.slice(cursor,start) + alias
        cursor = end
        restored++
    }
    // Unescape only after using the original Telegram entity offsets.
    return {text:normalizeEscapedTelegramCommandText(converted + text.slice(cursor)),custom,known,restored}
}

export function telegramTextForWechat(text:string,entities?:readonly TelegramTextEntity[]):string {
    return inspectTelegramTextForWechat(text,entities).text
}