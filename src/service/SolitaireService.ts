import {axiosInstance} from 'wx2tg-puppet/dist/utils/axiosInstance'

export type SolitaireJoinInput = Readonly<{
    wxid: string
    toWxid: string
    content: string
    msgId?: string
    newMsgId?: string
}>

const UINT = /^\d{1,20}$/

function uint(value: string | undefined, name: string): string {
    const text = String(value ?? '').trim()
    if (!UINT.test(text) || BigInt(text) < 1n) throw new Error(`Invalid solitaire ${name}`)
    return text
}

/**
 * Join mode only: the server rejects Title/Tail/SourceXml, and looks up its own
 * saved copy of the solitaire message by MsgID or NewMsgID. IDs stay raw JSON
 * digits because int64 NewMsgID would lose precision as a JavaScript Number.
 */
export function solitaireJoinBody(input: SolitaireJoinInput): string {
    const wxid = String(input.wxid ?? '').trim()
    const toWxid = String(input.toWxid ?? '').trim()
    const content = String(input.content ?? '').replace(/\r\n?/g, '\n').trim()
    if (!wxid) throw new Error('Invalid solitaire account')
    // Group and one-to-one conversations are both valid targets.
    if (!content) throw new Error('Invalid solitaire content')
    const fields = [`"Wxid":${JSON.stringify(wxid)}`, `"ToWxid":${JSON.stringify(toWxid)}`, `"Content":${JSON.stringify(content)}`]
    if (input.newMsgId) fields.push(`"NewMsgID":${uint(input.newMsgId, 'message id')}`)
    else fields.push(`"MsgID":${uint(input.msgId, 'message id')}`)
    return `{${fields.join(',')}}`
}

export type SolitaireJoinOutcome =
    | {status: 'joined'; title?: string}
    | {status: 'rejected'; reason: string}
    | {status: 'unknown'}

const NAMED_ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: '\''}

function decodeXmlText(value: string): string {
    return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
        if (NAMED_ENTITIES[entity]) return NAMED_ENTITIES[entity]
        const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16)
            : entity.startsWith('#') ? Number(entity.slice(1)) : NaN
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match
    })
}

/** The server returns the appmsg XML it actually sent; its title is the updated list. */
export function solitaireTitleFromXml(xml: unknown): string | undefined {
    if (typeof xml !== 'string' || !xml) return undefined
    const match = /<title>([\s\S]*?)<\/title>/.exec(xml)
    if (!match) return undefined
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(match[1])
    const title = decodeXmlText(cdata ? cdata[1] : match[1]).trim()
    return title || undefined
}

function updatedSolitaireTitle(data: any): string | undefined {
    return solitaireTitleFromXml(data?.Data?.Xml) ?? solitaireTitleFromXml(data?.Data?.SendResult?.Xml)
}

export function classifySolitaireResponse(data: any): SolitaireJoinOutcome {
    if (!data || typeof data !== 'object') return {status: 'unknown'}
    if (data.Success === true && Number(data.Code) === 0) {
        const title = updatedSolitaireTitle(data)
        return title ? {status: 'joined', title} : {status: 'joined'}
    }
    // -8 is the server's explicit validation/prepare rejection; other failures
    // may happen after the request reached WeChat, so they stay uncertain.
    if (Number(data.Code) === -8) {
        const reason = typeof data.Message === 'string' ? data.Message.trim() : ''
        return {status: 'rejected', reason: reason.slice(0, 300) || 'unknown'}
    }
    return {status: 'unknown'}
}

/** Create mode: no MsgID/NewMsgID, Title required, Content is the first entry. */
export function solitaireCreateBody(input: Readonly<{wxid: string, toWxid: string, title: string, content: string, tail?: string}>): string {
    const wxid = String(input.wxid ?? '').trim()
    const toWxid = String(input.toWxid ?? '').trim()
    const normalize = (value: unknown) => String(value ?? '').replace(/\r\n?/g, '\n').trim()
    const title = normalize(input.title)
    const content = normalize(input.content)
    const tail = normalize(input.tail)
    if (!wxid) throw new Error('Invalid solitaire account')
    if (!toWxid) throw new Error('Invalid solitaire target')
    if (!title) throw new Error('Invalid solitaire title')
    if (!content) throw new Error('Invalid solitaire content')
    const fields = [`"Wxid":${JSON.stringify(wxid)}`, `"ToWxid":${JSON.stringify(toWxid)}`, `"Title":${JSON.stringify(title)}`, `"Content":${JSON.stringify(content)}`]
    if (tail) fields.push(`"Tail":${JSON.stringify(tail)}`)
    return `{${fields.join(',')}}`
}

/** Shares the join sender: the server infers create vs join from the IDs. */
export const sendSolitaireCreate = (body: string): Promise<SolitaireJoinOutcome> => sendSolitaireJoin(body)

/** Never retried: an unknown outcome must not create a duplicate entry. */
export async function sendSolitaireJoin(body: string): Promise<SolitaireJoinOutcome> {
    try {
        const response = await axiosInstance.post('/Msg/SendSolitaire', body,
            {headers: {'Content-Type': 'application/json'}, transformRequest: [value => value], timeout: 20000})
        return classifySolitaireResponse(response?.data)
    } catch (error) {
        const status = error?.response?.status
        if (status >= 400 && status < 500 && status !== 408) {
            return {status: 'rejected', reason: `HTTP ${status}`}
        }
        return {status: 'unknown'}
    }
}

export type SolitaireJoinTarget = Readonly<{
    token: string
    ownerId: number
    toWxid: string
    selfId: string
    msgId?: string
    newMsgId?: string
    expiresAt: number
}>

/** Short callback tokens keep the button payload inside Telegram's 64-byte limit. */
export class SolitaireJoinRegistry {
    private readonly targets = new Map<string, SolitaireJoinTarget>()
    private readonly latestByConversation = new Map<string, SolitaireJoinTarget>()
    private readonly pending = new Map<string, SolitaireJoinTarget>()

    constructor(private readonly ttlMs = 30 * 60 * 1000, private readonly capacity = 256, private readonly now = () => Date.now()) {}

    add(target: Omit<SolitaireJoinTarget, 'token' | 'expiresAt'>): string {
        this.prune()
        let token = ''
        do token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
        while (this.targets.has(token))
        while (this.targets.size >= this.capacity) {
            const oldest = this.targets.keys().next().value
            if (oldest === undefined) break
            this.targets.delete(oldest)
        }
        this.targets.set(token, {...target, token, expiresAt: this.now() + this.ttlMs})
        return token
    }

    /** Latest solitaire per owner+conversation, so /join works without a token. */
    remember(target: SolitaireJoinTarget): void {
        this.latestByConversation.set(`${target.ownerId}:${target.toWxid}`, target)
    }

    latest(ownerId: number, toWxid: string): SolitaireJoinTarget | undefined {
        const target = this.latestByConversation.get(`${ownerId}:${toWxid}`)
        return target && target.expiresAt > this.now() ? target : undefined
    }

    /** One pending custom-content request per chat/topic, consumed on the next text. */
    setPending(ownerId: number, chatId: number, threadId: number | undefined, target: SolitaireJoinTarget): void {
        const key = `${ownerId}:${chatId}:${threadId ?? 0}`
        if (this.pending.size >= this.capacity) {
            const oldest = this.pending.keys().next().value
            if (oldest !== undefined) this.pending.delete(oldest)
        }
        this.pending.set(key, {...target, expiresAt: this.now() + this.ttlMs})
    }

    takePending(ownerId: number, chatId: number, threadId: number | undefined): SolitaireJoinTarget | undefined {
        const key = `${ownerId}:${chatId}:${threadId ?? 0}`
        const target = this.pending.get(key)
        this.pending.delete(key)
        return target && target.expiresAt > this.now() ? target : undefined
    }

    /** Drops all state; used by tests and after a full account switch. */
    clear(): void {
        this.targets.clear()
        this.latestByConversation.clear()
        this.pending.clear()
    }

    resolve(token: string, ownerId: number): SolitaireJoinTarget | undefined {
        this.prune()
        const target = this.targets.get(token)
        if (!target || target.ownerId !== ownerId) return undefined
        return target
    }

    private prune(): void {
        const now = this.now()
        for (const [token, target] of this.targets) if (now >= target.expiresAt) this.targets.delete(token)
    }
}

export const solitaireJoins = new SolitaireJoinRegistry()