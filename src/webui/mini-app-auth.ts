import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto'

const MAX_INIT_DATA_BYTES = 16 * 1024
const MAX_INIT_DATA_AGE_MS = 5 * 60 * 1000
const FUTURE_SKEW_MS = 30 * 1000
const SESSION_TTL_MS = 60 * 60 * 1000
const MAX_SESSIONS = 128
const TOKEN_PATTERN = /^miniapp_[a-f0-9]{64}$/

type AuthErrorCode = 'miniAppUnauthorized' | 'miniAppForbidden' | 'miniAppUnavailable'

function authError(code: AuthErrorCode) {
    const status = {miniAppUnauthorized: 401, miniAppForbidden: 403, miniAppUnavailable: 503}[code]
    // Never attach the input, configuration, or original exception as a cause.
    return Object.assign(new Error(code), {code, status})
}

function positiveId(value: unknown): number | undefined {
    if (typeof value === 'string' && /^[1-9]/.test(value) && !/\D/.test(value)) value = Number(value)
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export interface MiniAppAuthOptions {
    botToken: string
    /** Supply the current trusted Configuration.chatId, never a client-provided identity. */
    ownerId: () => Promise<unknown>
    /** Milliseconds since the Unix epoch. */
    now?: () => number
    /** Positive milliseconds; capped at one hour. */
    ttlMs?: number
}

/**
 * Owner-only Telegram bot-token validation, not third-party Ed25519 validation.
 * Valid initData may be exchanged repeatedly during its five-minute validity window.
 * Each exchange issues a new session; at most 128 survive, evicting the oldest first.
 * Only token digests are retained in memory; restarting the process revokes everything.
 */
export function createMiniAppAuth({botToken, ownerId, now = Date.now, ttlMs = SESSION_TTL_MS}: MiniAppAuthOptions) {
    const sessions = new Map<string, {owner: number; expiresAt: number}>()
    const configured = typeof botToken === 'string' && botToken.trim().length > 0
        && typeof ownerId === 'function' && typeof now === 'function'
        && Number.isSafeInteger(ttlMs) && ttlMs > 0
    const secret = configured ? createHmac('sha256', 'WebAppData').update(botToken).digest() : undefined
    const ttl = Math.min(ttlMs, SESSION_TTL_MS)

    function clock(): number {
        let value: number
        try { value = now() } catch { throw authError('miniAppUnavailable') }
        if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(value + ttl)) {
            throw authError('miniAppUnavailable')
        }
        return value
    }

    async function currentOwner(): Promise<number> {
        let value: unknown
        try { value = await ownerId() } catch { throw authError('miniAppUnavailable') }
        const owner = positiveId(value)
        if (owner === undefined) throw authError('miniAppUnavailable')
        return owner
    }

    function checkDate(authDate: number, time: number) {
        const age = time - authDate
        if (age < -FUTURE_SKEW_MS || age > MAX_INIT_DATA_AGE_MS) throw authError('miniAppUnauthorized')
    }

    function validate(initData: string): {userId: number; authDate: number} {
        if (typeof initData !== 'string' || !initData || initData.length > MAX_INIT_DATA_BYTES
            || Buffer.byteLength(initData, 'utf8') > MAX_INIT_DATA_BYTES) throw authError('miniAppUnauthorized')
        const fields = new Map<string, string>()
        try {
            // Decode exactly once, preserving the original decoded JSON for the HMAC.
            // Unlike URLSearchParams, decodeURIComponent rejects malformed escapes/UTF-8.
            for (const part of initData.split('&')) {
                const separator = part.indexOf('=')
                if (separator < 1) throw authError('miniAppUnauthorized')
                const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '))
                const key = decode(part.slice(0, separator))
                const value = decode(part.slice(separator + 1))
                if (!key || fields.has(key)) throw authError('miniAppUnauthorized')
                fields.set(key, value)
            }
        } catch { throw authError('miniAppUnauthorized') }
        const hash = fields.get('hash')
        const date = fields.get('auth_date')
        const rawUser = fields.get('user')
        if (!hash || hash.length !== 64 || /[^a-fA-F0-9]/.test(hash) || !date || /\D/.test(date) || !rawUser) {
            throw authError('miniAppUnauthorized')
        }
        const authDate = Number(date) * 1000
        if (!Number.isSafeInteger(authDate)) throw authError('miniAppUnauthorized')
        checkDate(authDate, clock())
        // Telegram's bot-token HMAC includes signature, when present; only hash is omitted.
        const dataCheckString = [...fields.keys()].filter(key => key !== 'hash').sort()
            .map(key => `${key}=${fields.get(key)}`).join('\n')
        const expected = createHmac('sha256', secret).update(dataCheckString).digest()
        if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw authError('miniAppUnauthorized')
        let user: unknown
        try { user = JSON.parse(rawUser) } catch { throw authError('miniAppUnauthorized') }
        const id = user && typeof user === 'object' && !Array.isArray(user) ? (user as {id?: unknown}).id : undefined
        // Telegram user.id must itself be a JSON number: no coercion or fallback to chat/receiver.
        if (typeof id !== 'number' || positiveId(id) === undefined) throw authError('miniAppUnauthorized')
        return {userId: id, authDate}
    }

    function digest(token: string): string | undefined {
        return typeof token === 'string' && token.length === 72 && TOKEN_PATTERN.test(token)
            ? createHash('sha256').update(token).digest('hex') : undefined
    }

    return {
        async exchange(initData: string): Promise<{token: string; expiresAt: number}> {
            if (!configured) throw authError('miniAppUnavailable')
            const {userId, authDate} = validate(initData)
            const owner = await currentOwner()
            if (userId !== owner) throw authError('miniAppForbidden')
            const time = clock()
            checkDate(authDate, time) // Owner lookup may have crossed the freshness boundary.
            for (const [key, session] of sessions) {
                if (session.expiresAt <= time || session.owner !== owner) sessions.delete(key)
            }
            let token: string
            try { token = `miniapp_${randomBytes(32).toString('hex')}` } catch { throw authError('miniAppUnavailable') }
            while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
            const expiresAt = time + ttl
            sessions.set(digest(token), {owner, expiresAt})
            return {token, expiresAt}
        },
        async authorize(token: string): Promise<boolean> {
            const key = digest(token)
            const session = key && sessions.get(key)
            if (!session) return false
            try {
                if (session.expiresAt <= clock()) {
                    sessions.delete(key)
                    return false
                }
                const owner = await currentOwner()
                // Re-check after the await, including concurrent revoke/eviction and expiration.
                if (sessions.get(key) !== session || session.expiresAt <= clock() || session.owner !== owner) {
                    sessions.delete(key)
                    return false
                }
                return true
            } catch {
                sessions.delete(key)
                return false // Owner-store/clock failures always fail closed.
            }
        },
        revoke(token: string): void {
            const key = digest(token)
            if (key) sessions.delete(key)
        }
    }
}

/** Canonical root URL for the existing UI. Invalid configured values throw, blanks disable it. */
export function normalizeMiniAppUrl(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') throw authError('miniAppUnavailable')
    const input = value.trim()
    if (!input) return undefined
    // Check the raw path too: URL parsing otherwise silently normalizes /x/.. or backslashes.
    if (!/^https:\/\/[^\s/?#\\@]+\/?$/i.test(input)) throw authError('miniAppUnavailable')
    let url: URL
    try { url = new URL(input) } catch { throw authError('miniAppUnavailable') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw authError('miniAppUnavailable')
    }
    return `${url.origin}/`
}