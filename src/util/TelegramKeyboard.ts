export interface TelegramCallbackButton {text:string;callback_data:string}

/** One normalization boundary for text, media and their caption edits.
 * Legacy flat/query buttons and nested rows remain accepted; invalid entries
 * must never make the underlying message fail. */
export function telegramCallbackButtons(value:unknown):TelegramCallbackButton[] {
    if(!Array.isArray(value))return []
    return value.flat().flatMap(button=>{
        const data = button?.callback_data || button?.query
        return typeof button?.text === 'string' && button.text.trim() && typeof data === 'string'
            && Buffer.byteLength(data,'utf8') > 0 && Buffer.byteLength(data,'utf8') <= 64
            ? [{text:button.text,callback_data:data}] : []
    })
}