import type {ValueTransformer} from 'typeorm'

// PostgreSQL returns BIGINT as strings; Telegram IDs fit in JS's safe integer
// range. Do not change pg's global parser (WeChat identifiers may be full int64).
export const safeInteger:ValueTransformer = {
    to: value=>value,
    from: value=>{
        if(value == null)return value
        const number = Number(value)
        if(!Number.isSafeInteger(number))throw new RangeError('Unsafe integer in bot database')
        return number
    },
}