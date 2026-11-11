import {Parser} from 'htmlparser2'
import {decodeHTML} from 'entities'
import {WECHAT_CUSTOM_EMOJI, WECHAT_EMOJI_IMAGE_NAMES} from './WechatCustomEmojiData'

const CUSTOM_EMOJI_BUDGET = 100
const PROTECTED_TAGS = new Set(['a', 'code', 'pre', 'tg-emoji', 'script', 'style'])
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

type HtmlToken = {kind: 'text' | 'open' | 'close' | 'markup'; raw: string; name?: string}

/** Retain source slices, rather than unparsing (which rewrites tags and escaping). */
function tokenize(html: string): HtmlToken[] {
    const tokens: HtmlToken[] = []
    let consumed = 0
    const append = (kind: HtmlToken['kind'], name?: string) => {
        const start = parser.startIndex
        const end = parser.endIndex + 1
        // htmlparser2 also emits implicit closes for void tags and malformed HTML.
        if (start < consumed || end <= start) return
        const raw = html.slice(start, end)
        if (kind === 'close' && raw.match(/^<\/\s*([^\s>]+)\s*>$/)?.[1].toLowerCase() !== name) return
        if (start > consumed) tokens.push({kind: 'markup', raw: html.slice(consumed, start)})
        tokens.push({kind, raw, name})
        consumed = end
    }
    const parser = new Parser({
        onopentag: name => append('open', name),
        onclosetag: name => append('close', name),
        ontext: () => append('text'),
    }, {decodeEntities: false})
    parser.end(html)
    if (consumed < html.length) tokens.push({kind: 'markup', raw: html.slice(consumed)})
    return tokens
}

function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function updateStack(stack: HtmlToken[], token: HtmlToken): void {
    if (token.kind === 'open' && !VOID_TAGS.has(token.name)) {
        stack.push(token)
    } else if (token.kind === 'close') {
        const index = stack.map(item => item.name).lastIndexOf(token.name)
        if (index >= 0) stack.splice(index)
    }
}

/**
 * Convert literal WeChat bracket aliases in text only. Unicode and escaped source
 * text are otherwise untouched. Reserve space for existing custom entities and
 * emit at most 100 custom entities in total when the input is within that budget.
 * Overflow aliases use the mapping's exact fallback; existing entities are never
 * rewritten (even if the caller supplied more than 100 already).
 */
export function renderWechatCustomEmojiHtml(html: string, enabled: boolean, maxLength?: number): string {
    if (!enabled || !html.includes('[')) return html
    const tokens = tokenize(html)
    let remaining = Math.max(0, CUSTOM_EMOJI_BUDGET - tokens.filter(token => token.kind === 'open' && token.name === 'tg-emoji').length)
    const stack: HtmlToken[] = []
    const rendered = tokens.map(token => {
        if (token.kind === 'text' && !stack.some(item => PROTECTED_TAGS.has(item.name))) {
            return token.raw.replace(/\[[^[\]\r\n]+\]/g, alias => {
                if (!Object.prototype.hasOwnProperty.call(WECHAT_CUSTOM_EMOJI, alias)) return alias
                const custom = WECHAT_CUSTOM_EMOJI[alias]
                const fallback = escapeText(custom.emoji)
                if (remaining <= 0) return fallback
                remaining--
                return `<tg-emoji emoji-id="${custom.id}">${fallback}</tg-emoji>`
            })
        }
        updateStack(stack, token)
        return token.raw
    }).join('')
    // Some exact pack fallbacks are longer UTF-16 sequences than their aliases.
    // Keep an otherwise-valid caption intact instead of exceeding Telegram's limit
    // or silently truncating content. Text messages are split by the caller instead.
    if (maxLength !== undefined) {
        const length = (value: string) => tokenize(value).reduce((sum, token) =>
            sum + (token.kind === 'text' ? decodeHTML(token.raw).length : 0), 0)
        if (length(rendered) > maxLength && length(html) <= maxLength) return html
    }
    return rendered
}

/** Remove custom-emoji wrappers only; retain their fallback and all other bytes. */
export function stripTelegramCustomEmoji(html: string): string {
    return tokenize(html).filter(token => token.name !== 'tg-emoji').map(token => token.raw).join('')
}

/** Compatibility renderer: ordinary HTML links need no Premium entitlement.
 * Preserve original aliases and existing links/code; never replace inside attributes.
 * Existing custom entities from a stored outbox are downgraded too. */
export function renderWechatEmojiFallbackHtml(html:string,links = true):string {
    const byId = new Map(Object.entries(WECHAT_CUSTOM_EMOJI).map(([alias,value])=>[value.id,alias]))
    const tokens = tokenize(html)
    const stack:HtmlToken[] = []
    let remaining = Math.max(0,100 - tokens.filter(token=>token.kind === 'open' && token.name === 'a').length)
    const render = (alias:string):string=>{
        const name = WECHAT_EMOJI_IMAGE_NAMES[alias]
        if(!links || !name || remaining <= 0)return alias
        remaining--
        return `<a href="https://raw.githubusercontent.com/finalpi/wechat-emoji/main/${encodeURIComponent(name)}.webp">${escapeText(alias)}</a>`
    }
    const output:string[] = []
    for(let i = 0;i < tokens.length;i++){
        const token = tokens[i]
        if(token.kind === 'open' && token.name === 'tg-emoji'){
            const id = token.raw.match(/emoji-id\s*=\s*["'](\d+)["']/)?.[1]
            let fallback = ''
            while(i + 1 < tokens.length){const child = tokens[++i];if(child.kind === 'close' && child.name === 'tg-emoji')break;fallback += child.raw}
            const alias = byId.get(id)
            output.push(alias && !stack.some(item=>PROTECTED_TAGS.has(item.name)) ? render(alias) : fallback)
            continue
        }
        output.push(token.kind === 'text' && !stack.some(item=>PROTECTED_TAGS.has(item.name))
            ? token.raw.replace(/\[[^[\]\r\n]+\]/g,render) : token.raw)
        updateStack(stack,token)
    }
    return output.join('')
}

type TextUnit = {raw: string; length: number}

/** Keep character references intact, measuring their decoded UTF-16 length. */
function textUnits(raw: string): TextUnit[] {
    const units: TextUnit[] = []
    const references = /&(?:#x[\da-f]+;?|#\d+;?|[a-z][\da-z]*;?)/gi
    let offset = 0
    const literal = (text: string) => {
        for (const point of text) units.push({raw: point, length: point.length})
    }
    for (const match of raw.matchAll(references)) {
        literal(raw.slice(offset, match.index))
        const decoded = decodeHTML(match[0])
        if (decoded === match[0]) literal(match[0])
        else units.push({raw: match[0], length: decoded.length})
        offset = match.index + match[0].length
    }
    literal(raw.slice(offset))
    return units
}

type SplitToken = HtmlToken & {length?: number}

function splitTokens(tokens: HtmlToken[]): SplitToken[] {
    const result: SplitToken[] = []
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index]
        if (token.kind === 'open' && token.name === 'tg-emoji') {
            // The complete fallback (including ZWJ/VS/modifiers) is indivisible.
            let depth = 1
            let raw = token.raw
            let length = 0
            while (index + 1 < tokens.length && depth > 0) {
                const child = tokens[++index]
                raw += child.raw
                if (child.kind === 'text') length += decodeHTML(child.raw).length
                if (child.name === 'tg-emoji') depth += child.kind === 'open' ? 1 : -1
            }
            result.push({kind: 'text', raw, length})
        } else if (token.kind === 'text') {
            for (const unit of textUnits(token.raw)) result.push({kind: 'text', ...unit})
        } else {
            result.push(token)
        }
    }
    return result
}

/**
 * Split already-formatted Telegram HTML by decoded UTF-16 text length, not HTML
 * source length. Balanced input formatting is closed/reopened verbatim; this is
 * not a sanitizer or malformed-HTML repairer. Fitting input is byte-identical.
 * Empty input yields no chunks. An indivisible custom emoji or Unicode code point
 * larger than maxLength throws RangeError rather than corrupting it or exceeding
 * the caller's limit. Existing entity counts are not changed here; the renderer
 * budgets newly generated custom emojis before this helper is called.
 *
 * Whitespace is retained exactly. GramJS itself trims outer whitespace on parse;
 * callers requiring those boundary spaces must account for that transport rule.
 */
export function splitTelegramHtml(html: string, maxLength = 4096): string[] {
    if (!Number.isSafeInteger(maxLength) || maxLength < 1) throw new RangeError('maxLength must be a positive safe integer')
    if (!html) return []
    const tokens = splitTokens(tokenize(html))
    const totalLength = tokens.reduce((total, token) => total + (token.length || 0), 0)
    if (totalLength <= maxLength) return [html]
    const chunks: string[] = []
    const stack: HtmlToken[] = []
    let current = ''
    let currentLength = 0
    const flush = () => {
        chunks.push(current + [...stack].reverse().map(token => `</${token.name}>`).join(''))
        current = stack.map(token => token.raw).join('')
        currentLength = 0
    }
    const append = (raw: string, length: number) => {
        if (length > maxLength) throw new RangeError('An indivisible emoji or Unicode code point exceeds maxLength')
        if (currentLength + length > maxLength) flush()
        current += raw
        currentLength += length
    }
    for (const token of tokens) {
        if (token.kind === 'text') {
            // Multi-character named/legacy references may be re-escaped only if
            // they alone exceed the limit; never split a custom-emoji wrapper.
            if (token.length > maxLength && token.raw.startsWith('&')) {
                for (const point of decodeHTML(token.raw)) append(escapeText(point), point.length)
            } else {
                append(token.raw, token.length)
            }
        } else {
            current += token.raw
            updateStack(stack, token)
        }
    }
    if (currentLength > 0) chunks.push(current)
    return chunks
}