import {randomBytes} from 'node:crypto'
import {allowedAvatarURL} from './AvatarURL'

export type DirectoryKind = 'us' | 'of' | 'ro' | 'ct' | 'gr' | 'gm';
export type DirectoryScope = Readonly<{
    chatId: number;
    userId: number;
    threadId?: number;
    accountId?: string;
}>;
export type DirectoryItem = Readonly<{remark: string; action: string; avatarUrl?: string}>;
export type DirectoryState = Readonly<{
    token: string;
    scope: DirectoryScope;
    kind: DirectoryKind;
    query: string;
    page: number;
    roomId?: string;
    parentToken?: string;
    items: readonly DirectoryItem[];
}>;
export type DirectoryButton = {text: string; callback_data: string};
export type DirectoryMarkup = {inline_keyboard: Array<Array<DirectoryButton | {text: string; url: string}>>};
export type DirectoryTranslate = (key: string, values?: Record<string, string | number>) => string;
/** Lists use text only; an individual profile can include one photo. */
export type DirectoryRichText = string | DirectoryRichText[]
    | {type: 'bold' | 'code'; text: DirectoryRichText}
    | {type: 'url'; text: DirectoryRichText; url: string}
    | {type: 'button'; button: {text: string; callback_data: string; style: 'link'}};
export type DirectoryRichParagraph = {type: 'paragraph'; text: DirectoryRichText};
export type DirectoryRichPhoto = {type: 'photo'; photo: {type: 'photo'; media: string}; caption: {text: DirectoryRichText}};
export type DirectoryRichMessage = {blocks: (DirectoryRichParagraph | DirectoryRichPhoto)[]; skip_entity_detection: true};
export type DirectoryView = {
    rich_message: DirectoryRichMessage;
    /** Only the escape hatch for clients that cannot display rich messages. */
    rich_reply_markup: DirectoryMarkup;
    html: string;
    plain: string;
    reply_markup: DirectoryMarkup;
    state: DirectoryState;
    pageCount: number;
    total: number;
};
export type DirectoryResolution =
    | {type: 'page'; state: DirectoryState; page: number}
    | {type: 'select'; state: DirectoryState; item: DirectoryItem}
    | {type: 'back' | 'home' | 'all' | 'compat'; state: DirectoryState};
export type DirectoryRenderInput = {
    scope: DirectoryScope;
    kind: DirectoryKind;
    query: string;
    page: number;
    /** Read-only member lists retain their room and the originating group page. */
    roomId?: string;
    parentToken?: string;
    /** Complete, already-filtered results. Only the visible page is retained. */
    items: readonly DirectoryItem[];
    prompt: string;
    notice?: string;
    emptyText: string;
};
export type DirectoryPagerOptions = {
    ttlMs?: number;
    maxStates?: number;
    now?: () => number;
    /** ASCII token seed (1–24 characters); a non-reused suffix is added. */
    token?: () => string;
};

const PAGE_SIZE = 30
const MAX_VISIBLE_LENGTH = 4096
const TOKEN = /^[A-Za-z0-9_-]{1,36}$/
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
}[char] ?? char))
const truncate = (text: string, limit: number): string => {
    const points = Array.from(text)
    return points.length > limit ? points.slice(0, limit - 1).join('') + '…' : text
}
const truncateUnits = (text: string, limit: number): string => {
    if (text.length <= limit) return text
    let result = ''
    for (const point of text) {
        if (result.length + point.length > limit - 1) break
        result += point
    }
    return result + '…'
}
const sameScope = (a: DirectoryScope, b: DirectoryScope): boolean =>
    a.chatId === b.chatId && a.userId === b.userId && a.threadId === b.threadId && a.accountId === b.accountId

/** One-based pages; zero-based selection indices belong to a single immutable view. */
export class DirectoryPager {
    private readonly states = new Map<string, {state: DirectoryState; expiresAt: number}>()
    private readonly ttlMs: number
    private readonly maxStates: number
    private readonly now: () => number
    private readonly token: () => string
    private sequence = 0

    constructor(options: DirectoryPagerOptions = {}) {
        this.ttlMs = options.ttlMs ?? 30 * 60 * 1000
        this.maxStates = options.maxStates ?? 512
        if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0
            || !Number.isSafeInteger(this.maxStates) || this.maxStates < 1) {
            throw new RangeError('Directory TTL and capacity must be positive finite values')
        }
        this.now = options.now ?? Date.now
        this.token = options.token ?? (() => randomBytes(12).toString('hex'))
    }

    render(input: DirectoryRenderInput, translate: DirectoryTranslate): DirectoryView {
        this.prune()
        const total = input.items.length
        const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
        const page = Number.isFinite(input.page)
            ? Math.min(pageCount, Math.max(1, Math.floor(input.page))) : 1
        const seed = this.token()
        if (!/^[A-Za-z0-9_-]{1,24}$/.test(seed) || this.sequence >= Number.MAX_SAFE_INTEGER) {
            throw new Error('Invalid directory token seed or exhausted sequence')
        }
        // Even a repeated injected seed cannot reuse an evicted/expired callback token.
        const token = `${seed}_${(++this.sequence).toString(36)}`
        const start = (page - 1) * PAGE_SIZE
        const state: DirectoryState = Object.freeze({
            token,
            scope: Object.freeze({...input.scope}),
            kind: input.kind,
            query: input.query,
            page,
            ...(input.roomId ? {roomId: input.roomId} : {}),
            ...(input.parentToken ? {parentToken: input.parentToken} : {}),
            items: Object.freeze(input.items.slice(start, start + PAGE_SIZE)
                .map(item => Object.freeze({remark: item.remark, action: item.action,
                    ...(input.kind === 'gm' && item.avatarUrl && allowedAvatarURL(item.avatarUrl) ? {avatarUrl: item.avatarUrl} : {}),
                }))),
        })
        const title = truncate(translate(`pagination.title_${input.kind}`), 80)
        const metadata = [
            translate('pagination.page', {page, pages: pageCount}),
            translate('pagination.total', {count: total}),
        ].map(text => truncate(text, 100))
        const plain = [title, ...metadata]
        const html = [`<b>${escapeHtml(title)}</b>`, ...metadata.map(escapeHtml)]
        const blocks: DirectoryRichParagraph[] = [title, ...metadata]
            .map(text => ({type: 'paragraph', text: {type: 'bold', text}}))
        if (input.query) {
            const query = truncate(input.query, 200)
            const label = truncate(translate('pagination.search'), 40)
            plain.push(`${label} ${query}`)
            html.push(`${escapeHtml(label)} <code>${escapeHtml(query)}</code>`)
            blocks.push({type: 'paragraph', text: [label + ' ', {type: 'code', text: query}]})
        }
        for (const text of [input.notice, input.prompt]) {
            if (text) {
                const display = truncate(text, 200)
                plain.push(display)
                html.push(escapeHtml(display))
                blocks.push({type: 'paragraph', text: display})
            }
        }
        // Avatar metadata stays in the scoped snapshot for details, never in a list.
        const buttons: DirectoryButton[] = []
        // Bound labels, not identities or page slices. Legacy bodies contain only
        // metadata; names are rendered exactly once in either presentation.
        const numbering = state.items.reduce((sum, _item, index) => sum + String(start + index + 1).length + 4, 0)
        const labelBudget = Math.max(1, Math.floor((MAX_VISIBLE_LENGTH - plain.join('\n').length - numbering) / Math.max(1, state.items.length)))
        state.items.forEach((item, index) => {
            const label = item.remark || item.action
            const callback_data = `dl:${token}:s:${index}`
            const name: DirectoryRichText = {type: 'button', button: {
                text: truncateUnits(truncate(label, 140), labelBudget), callback_data, style: 'link',
            }}
            if (index % 2 === 0) {
                blocks.push({type: 'paragraph', text: [`${start + index + 1}. `, name]})
            } else {
                const row = blocks[blocks.length - 1].text as DirectoryRichText[]
                row.push(`    ${start + index + 1}. `, name)
            }
            buttons.push({text: truncate(label, 48), callback_data})
        })
        if (!state.items.length && input.emptyText) {
            const empty = truncate(input.emptyText, 200)
            plain.push(empty)
            html.push(escapeHtml(empty))
            blocks.push({type: 'paragraph', text: empty})
        }
        const rows: DirectoryButton[][] = []
        for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
        const navigation: DirectoryButton[] = []
        if (page > 1) navigation.push({text: translate('pagination.previous'), callback_data: `dl:${token}:p:${page - 1}`})
        if (page < pageCount) navigation.push({text: translate('pagination.next'), callback_data: `dl:${token}:p:${page + 1}`})
        if (navigation.length) rows.push(navigation)
        const shortcuts: DirectoryButton[] = []
        if (page > 1) shortcuts.push({text: translate('pagination.home'), callback_data: `dl:${token}:h`})
        if (input.query) shortcuts.push({text: translate('pagination.clear_search'), callback_data: `dl:${token}:a`})
        if (shortcuts.length) rows.push(shortcuts)
        const parent = input.parentToken
            ? [{...backButton(input.parentToken, translate), text: translate('directory.back_groups')}]
            : []
        if (parent.length) rows.push(parent)
        for (const row of [navigation, shortcuts, parent]) {
            if (!row.length) continue
            const text: DirectoryRichText[] = []
            for (const button of row) {
                if (text.length) text.push('    ')
                text.push({type: 'button', button: {...button, style: 'link'}})
            }
            blocks.push({type: 'paragraph', text})
        }
        while (this.states.size >= this.maxStates) {
            const oldest = this.states.keys().next().value
            if (oldest === undefined) break
            this.states.delete(oldest)
        }
        this.states.set(token, {state, expiresAt: this.now() + this.ttlMs})
        return {
            rich_message: {blocks, skip_entity_detection: true},
            rich_reply_markup: {inline_keyboard: [[{
                text: translate('pagination.compatibility'), callback_data: `dl:${token}:c`,
            }]]},
            html: html.join('\n'), plain: plain.join('\n'),
            reply_markup: {inline_keyboard: rows}, state, pageCount, total,
        }
    }

    resolve(scope: DirectoryScope, callback: string): DirectoryResolution | undefined {
        this.prune()
        if (typeof callback !== 'string' || callback.length > 64) return undefined
        const match = /^dl:([A-Za-z0-9_-]{1,36}):(?:([ps]):(0|[1-9]\d*)|([bhac]))$/.exec(callback)
        if (!match) return undefined
        const state = this.states.get(match[1])?.state
        if (!state || !sameScope(state.scope, scope)) return undefined
        if (match[2]) {
            const number = Number(match[3])
            if (!Number.isSafeInteger(number)) return undefined
            if (match[2] === 'p') return number >= 1 ? {type: 'page', state, page: number} : undefined
            const item = state.items[number]
            return item ? {type: 'select', state, item} : undefined
        }
        const type = {b: 'back', h: 'home', a: 'all', c: 'compat'}[match[4]] as 'back' | 'home' | 'all' | 'compat'
        return {type, state}
    }

    backButton(token: string, translate: DirectoryTranslate): DirectoryButton {
        return backButton(token, translate)
    }

    private prune(): void {
        const now = this.now()
        for (const [token, entry] of this.states) {
            if (now >= entry.expiresAt) this.states.delete(token)
        }
    }
}

/** Plain callback button, never a custom-emoji button. */
export function backButton(token: string, translate: DirectoryTranslate): DirectoryButton {
    if (!TOKEN.test(token)) throw new Error('Invalid directory token')
    return {text: translate('pagination.back'), callback_data: `dl:${token}:b`}
}