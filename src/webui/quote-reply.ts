import {Parser} from 'htmlparser2'

/** Read only the outer type-57 reply title, preserving literal text and numeric strings. */
export function quoteReplyText(source?: string): string | undefined {
    if (typeof source !== 'string' || !source || Buffer.byteLength(source, 'utf8') > 1024 * 1024) return undefined
    let raw = source
    if (source.trimStart().startsWith('{')) {
        try {
            const envelope = JSON.parse(source)
            raw = envelope.xml || envelope.Content
        } catch {return undefined}
    }
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 512 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) return undefined
    const stack: string[] = []
    let title = '', subtype = '', found = false, closed = false, invalid = false
    const field = (name: string) => stack.join('/') === `msg/appmsg/${name}` || stack.join('/') === `appmsg/${name}`
    const parser = new Parser({
        onopentag: name => {
            stack.push(name.toLowerCase())
            if (stack.length > 64) invalid = true
            if (!invalid && field('title')) found = true
        },
        ontext: text => {
            if (invalid) return
            if (field('title')) title += text
            if (field('type')) subtype += text
        },
        onclosetag: name => {
            if (stack.length <= 2 && name.toLowerCase() === 'appmsg') closed = true
            if (stack.pop() !== name.toLowerCase()) invalid = true
        },
        onerror: () => {invalid = true},
    }, {xmlMode: true, decodeEntities: true})
    parser.end(raw)
    return !invalid && found && closed && subtype.trim() === '57' ? title : undefined
}
