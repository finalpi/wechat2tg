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

export function resolveMessageTemplates(values: Record<string, unknown>): Record<MessageTemplateKey, string> {
    const result = {} as Record<MessageTemplateKey, string>
    for (const key of Object.keys(MESSAGE_TEMPLATE_DEFAULTS) as MessageTemplateKey[]) {
        const value = values[key]
        result[key] = typeof value === 'string' && value.trim() ? value : MESSAGE_TEMPLATE_DEFAULTS[key]
    }
    return result
}