import type {Context} from 'telegraf'
import type {DirectoryMarkup, DirectoryRichMessage, DirectoryRichText, DirectoryView} from './DirectoryPager'

export type DirectoryReplyOptions = {
    parse_mode?: 'HTML';
    reply_markup?: DirectoryMarkup;
    message_thread_id?: number;
};
type TopicMessage = {message_id?: number; message_thread_id?: number; chat?: {id: number}; rich_message?: unknown};
export type DirectoryDeliveryContext = {
    reply(text: string, extra?: DirectoryReplyOptions): Promise<unknown>;
    editMessageText?(text: string, extra?: Omit<DirectoryReplyOptions, 'message_thread_id'>): Promise<unknown>;
    telegram?: Pick<Context['telegram'], 'callApi'>;
    chat?: {id: number};
    message?: TopicMessage;
    callbackQuery?: {message?: TopicMessage};
};
export type DirectoryCallbackContext = {
    answerCbQuery(text?: string): Promise<unknown>;
};
export type DirectoryDeliveryResult = 'sent' | 'edited' | 'unchanged' | 'failed';

export type DirectoryDetailAvatar = {image: Buffer; label: string};
type RichPayload = {chat_id: number; rich_message: DirectoryRichMessage | string; reply_markup?: DirectoryMarkup; profile_avatar?: {source: Buffer; filename: string}};
type DirectoryApiPayloads = {
    sendRichMessage: RichPayload & {message_thread_id?: number};
    sendMessage: {chat_id: number; text: string} & DirectoryReplyOptions;
    editMessageText: (RichPayload | ({chat_id: number; text: string} & Omit<DirectoryReplyOptions, 'message_thread_id'>)) & {message_id: number};
};

/**
 * Telegraf 4's types predate sendRichMessage / editMessageText.rich_message.
 * Keep the assertion at this raw API boundary; all callers use our typed subset
 * of the official Bot API schema, not an untyped Context or an SDK upgrade.
 */
function callDirectoryApi<M extends keyof DirectoryApiPayloads>(
    ctx: DirectoryDeliveryContext, method: M, payload: DirectoryApiPayloads[M],
): Promise<unknown> {
    if (!ctx.telegram) throw new Error('Telegram API unavailable')
    // SAFETY: callApi forwards named Bot API methods unchanged. The payload map
    // above follows the official rich schema missing from Telegraf 4's typings.
    const callApi = ctx.telegram.callApi as unknown as
        <K extends keyof DirectoryApiPayloads>(method: K, payload: DirectoryApiPayloads[K]) => Promise<unknown>
    return callApi.call(ctx.telegram, method, payload)
}

function sourceMessage(ctx: DirectoryDeliveryContext): TopicMessage | undefined {
    return ctx.callbackQuery ? ctx.callbackQuery.message : ctx.message
}

/** Message.rich_message is not yet declared by the installed Telegraf types. */
export function isRichDirectoryMessage(ctx: DirectoryDeliveryContext): boolean {
    return sourceMessage(ctx)?.rich_message != null
}

/** Callback acknowledgement is best-effort, including already-expired queries. */
export async function answerDirectoryCallback(ctx: DirectoryCallbackContext, text?: string): Promise<void> {
    try {
        await ctx.answerCbQuery(text)
    } catch {
        // A stale callback must not reject the surrounding update handler.
    }
}

function topicOptions(threadId?: number): {message_thread_id?: number} {
    return typeof threadId === 'number' && Number.isSafeInteger(threadId) && threadId > 1 ? {message_thread_id: threadId} : {}
}

/** Transport errors and nonnumeric status codes are deliberately not classified. */
function apiRejection(error: unknown): {code: number; description: string} | undefined {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as {response?: unknown; error_code?: unknown; description?: unknown}
    const response = candidate.response ?? candidate
    if (!response || typeof response !== 'object') return undefined
    const apiError = response as {error_code?: unknown; description?: unknown}
    return (apiError.error_code === 400 || apiError.error_code === 404) && typeof apiError.description === 'string'
        ? {code: apiError.error_code, description: apiError.description} : undefined
}

function formattingRejected(description: string): boolean {
    return /can't parse (?:entities|message text)|can't find end of (?:an? )?entity|unsupported (?:start|end) tag/i.test(description)
}

function richRejected(error: unknown): boolean {
    const rejection = apiRejection(error)
    if (!rejection) return false
    const {code, description} = rejection
    if (code === 404) {
        return /^(?:Not Found|(?:Error|Bad Request): Not Found)$/i.test(description)
            || /(?:method|sendRichMessage).*(?:not found|not available|unavailable|unsupported|unknown)|(?:unknown|unsupported) method/i.test(description)
    }
    return formattingRejected(description)
        // Older Bot API servers can ignore rich_message and demand legacy text.
        || /(?:message )?text is empty|text (?:is required|must be non-empty)/i.test(description)
        || (/(?:rich[ _-]?(?:message|text|block)|InputRichMessage)/i.test(description)
            && /invalid|unsupported|not supported|can't parse|cannot parse|failed to parse|expected|required|not allowed|must be|too (?:long|large)/i.test(description))
}

/**
 * At most four attempts: native -> HTML -> plain, with at most one transition
 * from edit to send after an explicit missing/uneditable message rejection.
 * Never retry an ambiguous transport error, 5xx, 429, or generic 403.
 */
export async function deliverDirectoryPage(
    ctx: DirectoryDeliveryContext, view: DirectoryView, edit = false, compatibility = false, onRichRejected?:()=>void,
): Promise<DirectoryDeliveryResult> {
    const message = sourceMessage(ctx)
    const {chatId, threadId} = view.state.scope
    // A legacy ctx.reply cannot choose a chat. Fail closed rather than route a
    // saved view elsewhere; raw calls always address the saved scope explicitly.
    if ((ctx.chat && ctx.chat.id !== chatId) || (message?.chat && message.chat.id !== chatId)) return 'failed'
    const raw = typeof ctx.telegram?.callApi === 'function'
    let editing = edit
    let format: 'rich' | 'html' | 'plain' = !compatibility && raw ? 'rich' : 'html'
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            if (raw) {
                const payload: RichPayload | DirectoryApiPayloads['sendMessage'] = format === 'rich'
                    ? {chat_id: chatId, rich_message: view.rich_message, reply_markup: view.rich_reply_markup}
                    : {
                        chat_id: chatId, text: format === 'html' ? view.html : view.plain,
                        reply_markup: view.reply_markup,
                        ...(format === 'html' ? {parse_mode: 'HTML' as const} : {}),
                    }
                if (editing) {
                    const messageId = message?.message_id
                    if (messageId === undefined || !Number.isSafeInteger(messageId) || messageId <= 0) return 'failed'
                    await callDirectoryApi(ctx, 'editMessageText', {...payload, message_id: messageId})
                } else if ('rich_message' in payload) {
                    await callDirectoryApi(ctx, 'sendRichMessage', {...payload, ...topicOptions(threadId)})
                } else {
                    await callDirectoryApi(ctx, 'sendMessage', {...payload, ...topicOptions(threadId)})
                }
            } else {
                const text = format === 'html' ? view.html : view.plain
                const options: DirectoryReplyOptions = {
                    reply_markup: view.reply_markup,
                    ...(format === 'html' ? {parse_mode: 'HTML' as const} : {}),
                }
                if (editing) {
                    if (!ctx.editMessageText) return 'failed'
                    await ctx.editMessageText(text, options)
                } else {
                    const topic = topicOptions(threadId)
                    // A legacy reply helper may inherit its source topic. Without
                    // an explicit saved topic to override it, do not drift there.
                    if (!topic.message_thread_id && topicOptions(message?.message_thread_id).message_thread_id) return 'failed'
                    await ctx.reply(text, {...options, ...topic})
                }
            }
            return editing ? 'edited' : 'sent'
        } catch (error) {
            const rejection = apiRejection(error)
            if (!rejection) return 'failed'
            if (rejection.code === 400 && editing) {
                if (/message is not modified/i.test(rejection.description)) return 'unchanged'
                if (/message to edit not found|message (?:can't|cannot|can not) be edited|message was deleted|there is no text in the message to edit/i.test(rejection.description)) {
                    editing = false
                    continue
                }
            }
            if (format === 'rich' && richRejected(error)) {
                onRichRejected?.()
                format = 'html'
                continue
            }
            if (format === 'html' && rejection.code === 400 && formattingRejected(rejection.description)) {
                format = 'plain'
                continue
            }
            return 'failed'
        }
    }
    return 'failed'
}

/**
 * Native result/back links stay inside the rich body. Only an explicit native
 * rejection permits one plain reply with the original keyboard; no network retry.
 * Callers without rich source messages or markup retain the plain reply behavior.
 */
export async function replyDirectoryText(
    ctx: DirectoryDeliveryContext, text: string, reply_markup?: DirectoryMarkup, avatar?: DirectoryDetailAvatar,
    compatibility = false, onRichRejected?:()=>void,
): Promise<boolean> {
    const message = sourceMessage(ctx)
    const topic = topicOptions(message?.message_thread_id)
    if (!compatibility && reply_markup && (avatar || ctx.callbackQuery && isRichDirectoryMessage(ctx)) && typeof ctx.telegram?.callApi === 'function') {
        const chatId = message?.chat?.id ?? ctx.chat?.id
        if (chatId === undefined || (ctx.chat && ctx.chat.id !== chatId)) return false
        const content: DirectoryRichText = /^https?:\/\/[^\s<>]+$/i.test(text)
            ? {type: 'url', text, url: text} : text
        const rich_message: DirectoryRichMessage = {blocks: [{type: 'paragraph', text: content}], skip_entity_detection: true}
        if (avatar) rich_message.blocks.push({type: 'details', summary: avatar.label,
            blocks: [{type: 'photo', photo: {type: 'photo', media: 'attach://profile_avatar'}}]})
        for (const row of reply_markup.inline_keyboard) {
            if (!row.length) continue
            const links: DirectoryRichText[] = []
            for (const button of row) {
                if (links.length) links.push('    ')
                links.push('url' in button
                    ? {type: 'url', text: button.text, url: button.url}
                    : {type: 'button', button: {...button, style: 'link'}})
            }
            rich_message.blocks.push({type: 'paragraph', text: links})
        }
        try {
            // Telegraf 4 does not know rich_message is a JSON form field. Serialize
            // it explicitly when uploading the collapsed avatar as an attachment.
            await callDirectoryApi(ctx, 'sendRichMessage', {chat_id: chatId, rich_message: avatar ? JSON.stringify(rich_message) : rich_message,
                ...(avatar ? {profile_avatar: {source: avatar.image, filename: 'profile-avatar.png'}} : {}), ...topic})
            return true
        } catch (error) {
            const rejection = apiRejection(error)
            const avatarRejected = avatar && rejection?.code === 400
                && /wrong file identifier\/HTTP URL specified|IMAGE_PROCESS_FAILED|PHOTO_INVALID|can't parse (?:input media|file)|failed to (?:process|decode) (?:image|photo)/i.test(rejection.description)
            if (!richRejected(error) && !avatarRejected) return false
            if(richRejected(error))onRichRejected?.()
        }
        try {
            await callDirectoryApi(ctx, 'sendMessage', {chat_id: chatId, text, reply_markup, ...topic})
            return true
        } catch {
            return false
        }
    }
    try {
        const legacyTopic = topicOptions(ctx.callbackQuery?.message?.message_thread_id ?? ctx.message?.message_thread_id)
        await ctx.reply(text, {...legacyTopic, ...(reply_markup ? {reply_markup} : {})})
        return true
    } catch {
        return false
    }
}