import {WECHAT_CUSTOM_EMOJI_BY_ID} from './WechatCustomEmojiData'

type TelegramTextEntity = {type?:string;className?:string;offset:number;length:number;custom_emoji_id?:string;documentId?:unknown}
const withoutStyle = (text:string)=>text.replace(/[\ufe0e\ufe0f]/g,'')

export function normalizeEscapedTelegramCommandText(text: string): string {
    return text.startsWith('\\/') ? text.replace(/^\\\//, '/') : text
}

/** Convert known document IDs, not the Unicode fallbacks shared by many pictures. */
export function telegramTextForWechat(text:string,entities?:readonly TelegramTextEntity[]):string {
    const matches:{start:number;end:number;alias:string}[] = []
    for(const entity of entities || []){
        if(!entity)continue
        const {offset,length} = entity
        if(!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > text.length - offset)continue
        let id:string
        if(entity.type === 'custom_emoji')id = entity.custom_emoji_id
        else if(entity.className === 'MessageEntityCustomEmoji'){
            // GramJS represents int64 as a BigInteger, never coerce it to Number.
            const value = entity.documentId
            if(typeof value !== 'string' && typeof value !== 'bigint' && !(value && typeof value === 'object'))continue
            try {id = String(value)} catch {continue}
        } else continue
        const match = WECHAT_CUSTOM_EMOJI_BY_ID.get(id),end = offset + length
        // Both APIs give UTF-16 offsets. Checking the expected fallback also
        // rejects a malformed span through a surrogate pair or surrounding text.
        if(match && withoutStyle(text.slice(offset,end)) === withoutStyle(match.emoji))matches.push({start:offset,end,alias:match.alias})
    }
    let cursor = 0,converted = ''
    for(const {start,end,alias} of matches.sort((a,b)=>a.start - b.start)){
        if(start < cursor)continue
        converted += text.slice(cursor,start) + alias
        cursor = end
    }
    // Unescape only after using the original Telegram entity offsets.
    return normalizeEscapedTelegramCommandText(converted + text.slice(cursor))
}