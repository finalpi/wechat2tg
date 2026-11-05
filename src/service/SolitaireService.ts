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
    | {status: 'joined'}
    | {status: 'rejected'; reason: string}
    | {status: 'unknown'}

export function classifySolitaireResponse(data: any): SolitaireJoinOutcome {
    if (!data || typeof data !== 'object') return {status: 'unknown'}
    if (data.Success === true && Number(data.Code) === 0) return {status: 'joined'}
    // -8 is the server's explicit validation/prepare rejection; other failures
    // may happen after the request reached WeChat, so they stay uncertain.
    if (Number(data.Code) === -8) {
        const reason = typeof data.Message === 'string' ? data.Message.trim() : ''
        return {status: 'rejected', reason: reason.slice(0, 300) || 'unknown'}
    }
    return {status: 'unknown'}
}

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