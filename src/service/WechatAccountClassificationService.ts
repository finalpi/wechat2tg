// Ordinary accounts use server VerifyFlag, never a guessed username prefix.
// The explicit @openim namespace is an enterprise contact, not an official account.
// Keep clients and the SDK database lazy: importing this module must not start either.
import {normalizeContactVerifyFlag, isOfficialAccountVerifyFlag} from 'wx2tg-puppet'
export interface ClassificationSession {
    accountWxid: string
    queryDirectory: (query: {Wxid: string; Kind: 'contact'; Limit: number; Offset: number}, timeoutMs: number) => Promise<unknown>
    findContact: (wxId: string) => Promise<{verifyFlag?: unknown} | null | undefined>
}

export interface AccountClassificationAdapters {
    getSession: () => Promise<ClassificationSession | undefined>
    readFlags: (wxIds: string[]) => Promise<Map<string, unknown>>
    // Must update EXISTING rows only, atomically guarded by verifyFlag IS NULL.
    backfillFlags: (flags: Map<string, number>) => Promise<void>
    now?: () => number
}

export interface AccountClassificationOptions {
    lookupBudget?: number
    concurrency?: number
    foregroundTimeoutMs?: number
    directoryTimeoutMs?: number
    directoryPages?: number
    retryMs?: number
    directoryTtlMs?: number
}

function normalizeFlag(raw: unknown): number | undefined {
    return normalizeContactVerifyFlag(raw) ?? undefined
}

function official(raw: unknown): boolean | undefined {
    return isOfficialAccountVerifyFlag(raw)
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout>
    try {
        return await Promise.race([promise, new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), Math.max(0, milliseconds))
        })])
    } finally {
        clearTimeout(timer)
    }
}

function productionAdapters(): AccountClassificationAdapters {
    let sourceClient: any
    let session: ClassificationSession | undefined
    let sessionAt = 0
    let sessionFlight: Promise<ClassificationSession | undefined> | undefined
    const database = async () => (await import('../data-sourse')).getGeWeChatDataSource()
    return {
        async getSession() {
            const owner = (await import('../base/BaseClient')).AbstractClient.getSpyClient('wxClient')
            if (!owner?.hasLogin) {
                sourceClient = undefined
                session = undefined
                return undefined
            }
            if (sourceClient !== owner.client) {
                sourceClient = owner.client
                session = undefined
                sessionFlight = undefined
            }
            if (session && Date.now() - sessionAt < 30_000) return session
            if (sessionFlight) return sessionFlight
            const client = owner.client
            const flight = (async () => {
                const knownAccount = owner['wxInfo']?.wxid || owner['wxInfo']?.id
                const info = knownAccount ? {id: knownAccount}
                    : await within(Promise.resolve().then(() => client.info()).catch(() => undefined), 1200)
                const id = (info as any)?.id
                // An unavailable self profile disables Directory, not the SDK fallback.
                const accountWxid = typeof id === 'string' ? id : ''
                const resolved: ClassificationSession = {
                    accountWxid,
                    async queryDirectory(query, timeoutMs) {
                        // Use a dedicated request to avoid SDK interceptors logging API payloads.
                        const axios = (await import('axios')).default
                        const baseURL = client.baseUrl || (await import('../config')).config.BASE_API
                        const response = await axios.request({baseURL, url: '/Directory/Query', method: 'POST',
                            data: query, timeout: timeoutMs})
                        return response.data
                    },
                    findContact: wxId => client.Contact.find({id: wxId}),
                }
                if (sourceClient === client) {
                    session = resolved
                    sessionAt = Date.now()
                }
                return resolved
            })().catch(() => undefined)
            sessionFlight = flight
            void flight.finally(() => { if (sessionFlight === flight) sessionFlight = undefined })
            return flight
        },
        async readFlags(ids) {
            const flags = new Map<string, unknown>()
            for (let start = 0; start < ids.length; start += 400) {
                const batch = ids.slice(start, start + 400)
                const rows = await (await database()).createQueryBuilder().select(['userName', 'verifyFlag'])
                    .from('contact', 'contact').where('userName IN (:...ids)', {ids: batch}).getRawMany()
                for (const row of rows) flags.set(row.userName, row.verifyFlag)
            }
            return flags
        },
        async backfillFlags(flags) {
            const db = await database()
            await db.transaction(async manager => {
                for (const [id, flag] of flags) {
                    await manager.createQueryBuilder().update('contact').set({verifyFlag: flag})
                        .where('userName = :id', {id}).andWhere('verifyFlag IS NULL').execute()
                }
            })
        },
    }
}

export class WechatAccountClassificationService {
    private static instance: WechatAccountClassificationService
    private readonly adapters: AccountClassificationAdapters
    private readonly options: Required<AccountClassificationOptions>
    private account = ''
    private directoryFlight?: Promise<void>
    private directoryNext = 0
    private directoryOffset = 0
    private readonly directoryFlags = new Map<string, number>()
    private readonly lookups = new Map<string, Promise<void>>()
    private readonly completed = new Map<string, {flag?: number; at: number}>()
    private cursor = 0

    constructor(adapters: AccountClassificationAdapters = productionAdapters(), options: AccountClassificationOptions = {}) {
        this.adapters = adapters
        this.options = {lookupBudget: 12, concurrency: 3, foregroundTimeoutMs: 3500,
            directoryTimeoutMs: 1000, directoryPages: 4, retryMs: 30_000, directoryTtlMs: 60_000, ...options}
    }

    static getInstance(): WechatAccountClassificationService {
        return this.instance || (this.instance = new WechatAccountClassificationService())
    }

    private now(): number { return this.adapters.now?.() ?? Date.now() }

    private async cached(ids: string[]): Promise<Map<string, unknown>> {
        try { return await this.adapters.readFlags(ids) } catch { return new Map() }
    }

    private backfill(session: ClassificationSession): Promise<void> {
        if (!session.accountWxid) return Promise.resolve()
        if (this.directoryFlight) return this.directoryFlight
        if (this.now() < this.directoryNext) return Promise.resolve()
        const account = this.account
        const flight = (async () => {
            try {
                if (this.directoryOffset === 0) this.directoryFlags.clear()
                for (let page = 0; page < this.options.directoryPages; page++) {
                    const response: any = await within(session.queryDirectory({Wxid: account, Kind: 'contact',
                        Limit: 500, Offset: this.directoryOffset}, this.options.directoryTimeoutMs), this.options.directoryTimeoutMs)
                    const data = response?.Data
                    if (!data || !Array.isArray(data.list) || !Number.isSafeInteger(data.total) || data.total < 0
                        || response.Success === false || (response.Code !== undefined && response.Code !== 0)) throw new Error('Directory unavailable')
                    if (this.account !== account) return
                    const flags = new Map<string, number>()
                    for (const row of data.list) {
                        if (row?.account_wxid !== account || row.kind !== 'contact'
                            || (row.deleted !== false && row.deleted !== 0) || typeof row.wxid !== 'string'
                            || !row.wxid || row.wxid.endsWith('@chatroom')) continue
                        const flag = normalizeFlag(row.profile?.verify_flag)
                        if (flag !== undefined) flags.set(row.wxid, flag)
                    }
                    // A local DB failure must not turn server-authoritative flags into personal accounts.
                    await this.adapters.backfillFlags(flags)
                    if (this.account !== account) return
                    for (const [id, flag] of flags) this.directoryFlags.set(id, flag)
                    this.directoryOffset += data.list.length
                    if (!data.list.length || this.directoryOffset >= data.total) {
                        this.directoryOffset = 0
                        this.directoryNext = this.now() + this.options.directoryTtlMs
                        return
                    }
                }
                // Continue large directories on the next foreground pass instead of freezing /user.
                this.directoryNext = this.now() + 1000
            } catch {
                this.directoryNext = this.now() + this.options.retryMs
            }
        })()
        this.directoryFlight = flight
        void flight.finally(() => { if (this.directoryFlight === flight) this.directoryFlight = undefined })
        return flight
    }

    private lookup(session: ClassificationSession, id: string): Promise<void> {
        const existing = this.lookups.get(id)
        if (existing) return existing
        const prior = this.completed.get(id)
        if (prior && this.now() - prior.at < this.options.retryMs) return Promise.resolve()
        // Keep hung SDK calls in-flight: timing out the caller must not launch duplicate requests.
        if (this.lookups.size >= this.options.concurrency) return Promise.resolve()
        const account = this.account
        const task = Promise.resolve().then(() => session.findContact(id)).then(contact => {
            if (this.account === account) this.completed.set(id, {flag: normalizeFlag(contact?.verifyFlag), at: this.now()})
        }, () => {
            if (this.account === account) this.completed.set(id, {at: this.now()})
        }).finally(() => { if (this.lookups.get(id) === task) this.lookups.delete(id) })
        this.lookups.set(id, task)
        return task
    }

    async isOfficialAccount(wxId: string, hintVerifyFlag?: unknown): Promise<boolean | undefined> {
        if (!wxId || wxId.endsWith('@chatroom')) return undefined
        if (wxId.endsWith('@openim')) return false
        const result = await this.classifyContacts([{userName: wxId, verifyFlag: hintVerifyFlag}])
        return result.official.length ? true : result.contacts.length ? false : undefined
    }

    async classifyContacts<T extends {userName: string; verifyFlag?: unknown}>(rows: T[]): Promise<{contacts: T[]; official: T[]; unknown: T[]}> {
        const unique = new Map<string, T>()
        for (const row of rows) if (row.userName && !row.userName.endsWith('@chatroom')) {
            if (!unique.has(row.userName) || normalizeFlag(row.verifyFlag) !== undefined) unique.set(row.userName, row)
        }
        const ids = [...unique.keys()]
        const cacheIds = ids.filter(id => !id.endsWith('@openim') && normalizeFlag(unique.get(id)?.verifyFlag) === undefined)
        let cache = await this.cached(cacheIds)
        const resolveLocal = (id: string) => id.endsWith('@openim') ? 0 : normalizeFlag(unique.get(id)?.verifyFlag) ?? normalizeFlag(cache.get(id))
        const missing = ids.filter(id => resolveLocal(id) === undefined)
        let memoryAvailable = false
        if (missing.length) {
            const deadline = Date.now() + this.options.foregroundTimeoutMs
            const session = await within(this.adapters.getSession().catch(() => undefined), Math.max(0, deadline - Date.now()))
            if (session) {
                memoryAvailable = true
                if (this.account !== session.accountWxid) {
                    this.account = session.accountWxid
                    this.directoryFlight = undefined
                    this.directoryNext = 0
                    this.directoryOffset = 0
                    this.directoryFlags.clear()
                    this.completed.clear()
                    this.lookups.clear()
                }
                await within(this.backfill(session), Math.max(0, deadline - Date.now()))
                cache = await this.cached(cacheIds)
                const unknown = missing.filter(id => resolveLocal(id) === undefined && !this.directoryFlags.has(id)
                    && !this.completed.has(id))
                // Rotate across the original IDs, not a shrinking unresolved list.
                const candidates = new Set(unknown)
                for (const id of missing) {
                    const prior = this.completed.get(id)
                    if (prior && prior.flag === undefined && this.now() - prior.at >= this.options.retryMs) candidates.add(id)
                }
                const selected: string[] = []
                let scanned = 0
                while (scanned < ids.length && selected.length < this.options.lookupBudget) {
                    const id = ids[this.cursor % ids.length]
                    this.cursor = (this.cursor + 1) % ids.length
                    scanned++
                    if (candidates.has(id)) selected.push(id)
                }
                let next = 0
                await Promise.all(Array.from({length: Math.min(this.options.concurrency, selected.length)}, async () => {
                    while (next < selected.length && Date.now() < deadline) {
                        await within(this.lookup(session, selected[next++]), Math.max(0, deadline - Date.now()))
                    }
                    return undefined
                }))
                cache = await this.cached(cacheIds)
            }
        }
        const result = {contacts: [] as T[], official: [] as T[], unknown: [] as T[]}
        for (const [id, row] of unique) {
            const flag = resolveLocal(id) ?? (memoryAvailable ? this.completed.get(id)?.flag ?? this.directoryFlags.get(id) : undefined)
            const classification = official(flag)
            result[classification === undefined ? 'unknown' : classification ? 'official' : 'contacts'].push(row)
        }
        return result
    }
}