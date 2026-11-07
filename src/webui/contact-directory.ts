import {isOfficialAccountVerifyFlag} from 'wx2tg-puppet'

export type ContactCategory = 'person' | 'group' | 'official' | 'service' | 'enterprise' | 'unknown'
export const CONTACT_KINDS = ['all', 'contact', 'group', 'person', 'official', 'service', 'enterprise', 'unknown'] as const

export interface CachedContact {
    wxId: string
    name: string
    nickname: string
    kind: 'contact' | 'group'
    hasAvatar: boolean
    verifyFlag?: unknown
    serviceType?: unknown
    indexLetter?: string
}
export interface DirectoryContact {
    wxId: string
    name: string
    nickname: string
    kind: 'contact' | 'group'
    hasAvatar: boolean
    category: ContactCategory
    indexLetter: string
}

export function contactCategory(contact: Pick<CachedContact, 'wxId' | 'kind' | 'verifyFlag' | 'serviceType'>, officialHint = false): ContactCategory {
    if (contact.kind === 'group' || contact.wxId.endsWith('@chatroom')) return 'group'
    if (contact.wxId.endsWith('@openim')) return 'enterprise'
    const official = isOfficialAccountVerifyFlag(contact.verifyFlag)
    if (official === true) return contact.serviceType === 1 ? 'service' : 'official'
    if (official === false) return 'person'
    return officialHint ? 'official' : 'unknown'
}

export function contactIndexLetter(name: string, romanizations: unknown[] = []): string {
    for (const value of [...romanizations, name]) {
        if (typeof value !== 'string') continue
        const initial = value.trim().charAt(0).toUpperCase()
        if (/^[A-Z]$/.test(initial)) return initial
    }
    return '#'
}

// Sources arrive in authority order: SDK rooms/contacts, bindings, then topics.
// Search all cached names, but never let a matching fallback replace SDK metadata.
export function cachedDirectory(sdk: CachedContact[], bindings: CachedContact[], topics: CachedContact[], query: string) {
    const entries = new Map<string, {contact: CachedContact; names: string[]}>()
    const officialHints = new Set(topics.map(row => row.wxId))
    for (const row of [...sdk, ...bindings, ...topics]) {
        const previous = entries.get(row.wxId)
        if (previous) {
            previous.contact.hasAvatar ||= row.hasAvatar
            previous.names.push(row.name, row.nickname)
        } else entries.set(row.wxId, {contact: {...row}, names: [row.wxId, row.name, row.nickname]})
    }
    const counts: Record<ContactCategory, number> = {person: 0, group: 0, official: 0, service: 0, enterprise: 0, unknown: 0}
    const contacts: DirectoryContact[] = []
    const q = query.toLocaleLowerCase()
    for (const {contact, names} of entries.values()) {
        if (!names.some(name => name.toLocaleLowerCase().includes(q))) continue
        const {wxId, name, nickname, kind, hasAvatar} = contact
        const category = contactCategory(contact, officialHints.has(wxId))
        contacts.push({wxId, name, nickname, kind, hasAvatar, category, indexLetter:contact.indexLetter || contactIndexLetter(name)})
        counts[category]++
    }
    return {contacts, counts, total: contacts.length, countsScope: 'cached' as const}
}

export function compareCategoryContacts(a: DirectoryContact, b: DirectoryContact): number {
    const letters = a.indexLetter === b.indexLetter ? 0 : a.indexLetter === '#' ? 1 : b.indexLetter === '#' ? -1 : a.indexLetter.localeCompare(b.indexLetter)
    return letters || a.name.localeCompare(b.name, 'zh-CN') || a.wxId.localeCompare(b.wxId)
}

export function matchesContactKind(contact: DirectoryContact, kind: string): boolean {
    return kind === 'all' || (kind === 'contact' ? contact.kind === 'contact' : contact.category === kind)
}