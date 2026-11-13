import {FormatUtils} from './FormatUtils'

export const MESSAGE_TEMPLATE_DEFAULTS = Object.freeze({
    CONTACT_MESSAGE: '<b>#[alias_first]: </b>',
    CONTACT_MESSAGE_GROUP: '<b>#[alias_first]: </b>',
    OFFICIAL_MESSAGE: '<b>#[name]: </b>',
    OFFICIAL_MESSAGE_GROUP: '<b>#[name]: </b>',
    ROOM_MESSAGE: '<b>#[member_name]: </b>',
    ROOM_MESSAGE_GROUP: '<b>#[member_name]: </b>',
    MESSAGE_DISPLAY: '#[identity]#[br]#[body]',
})

export type MessageTemplateKey = keyof typeof MESSAGE_TEMPLATE_DEFAULTS
export type MessageIdentityKind = 'contact' | 'official' | 'room'
export interface MessageIdentity {
    kind: MessageIdentityKind
    name: string
    alias?: string
    topic?: string
    memberName?: string
    bound?: boolean
}

export function messageIdentityKind(wxId: string, official = false, threadId?: number): MessageIdentityKind {
    if (wxId.endsWith('@chatroom')) return 'room'
    if (wxId.endsWith('@openim')) return 'contact'
    return wxId === 'app' || official || threadId ? 'official' : 'contact'
}

/** All send paths use the same configured prefix; names are plain, untrusted text. */
export function messageIdentityTemplate(values: Record<string, unknown>, kind: MessageIdentityKind, bound = true): string {
    const key = `${kind.toUpperCase()}_MESSAGE${bound ? '_GROUP' : ''}` as MessageTemplateKey
    return resolveMessageTemplates(values)[key]
}

export function formatMessageIdentity(values: Record<string, unknown>, identity: MessageIdentity): string {
    const html = (value = '') => FormatUtils.escapeHtml(value)
    return FormatUtils.transformTitleStr(messageIdentityTemplate(values, identity.kind, identity.bound),
        html(identity.alias), html(identity.name), html(identity.topic), html(identity.memberName || identity.name))
}

/** Body is already Telegram HTML. Do not convert emoji here: the final send boundary owns it. */
export function formatMessageText(values: Record<string, unknown>, identity: MessageIdentity, body: string): string {
    return FormatUtils.transformIdentityBodyStr(resolveMessageTemplates(values).MESSAGE_DISPLAY,
        formatMessageIdentity(values, identity), body, identity.memberName || identity.name)
}

export function formatMessageQuote(values: Record<string, unknown>, identity: MessageIdentity, body: string): string {
    // Telegram does not allow nested blockquotes, including ones supplied by templates.
    const html = formatMessageText(values, identity, body).replace(/<\/?blockquote\b[^>]*>/gi, '')
    return `<blockquote>${html}</blockquote>`
}

export function resolveMessageTemplates(values: Record<string, unknown>): Record<MessageTemplateKey, string> {
    const result = {} as Record<MessageTemplateKey, string>
    for (const key of Object.keys(MESSAGE_TEMPLATE_DEFAULTS) as MessageTemplateKey[]) {
        const value = values[key]
        result[key] = typeof value === 'string' && value.trim() ? value : MESSAGE_TEMPLATE_DEFAULTS[key]
    }
    return result
}