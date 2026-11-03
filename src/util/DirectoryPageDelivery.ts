import type {DirectoryMarkup, DirectoryView} from './DirectoryPager'

export type DirectoryReplyOptions = {
    parse_mode?: 'HTML';
    reply_markup?: DirectoryMarkup;
    message_thread_id?: number;
};
type TopicMessage = {message_id?: number; message_thread_id?: number};
export type DirectoryDeliveryContext = {
    reply(text: string, extra?: DirectoryReplyOptions): Promise<unknown>;
    editMessageText?(text: string, extra?: Omit<DirectoryReplyOptions, 'message_thread_id'>): Promise<unknown>;
    message?: TopicMessage;
    callbackQuery?: {message?: TopicMessage};
};
export type DirectoryCallbackContext = {
    answerCbQuery(text?: string): Promise<unknown>;
};
export type DirectoryDeliveryResult = 'sent' | 'edited' | 'unchanged' | 'failed';

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

/** Only a structured, explicit Bot API 400 is safe to classify for a retry. */
function badRequestDescription(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as {response?: unknown; error_code?: unknown; description?: unknown}
    const response = candidate.response ?? candidate
    if (!response || typeof response !== 'object') return undefined
    const apiError = response as {error_code?: unknown; description?: unknown}
    return apiError.error_code === 400 && typeof apiError.description === 'string'
        ? apiError.description : undefined
}

/**
 * At most three attempts: HTML edit -> HTML send -> plain send, or HTML -> plain.
 * Never send a new message after an ambiguous transport failure or rate limit.
 */
export async function deliverDirectoryPage(
    ctx: DirectoryDeliveryContext, view: DirectoryView, edit = false,
): Promise<DirectoryDeliveryResult> {
    let editing = edit
    let html = true
    for (let attempt = 0; attempt < 3; attempt++) {
        const options: DirectoryReplyOptions = {
            reply_markup: view.reply_markup,
            ...(html ? {parse_mode: 'HTML' as const} : {}),
        }
        try {
            const text = html ? view.html : view.plain
            if (editing) {
                if (!ctx.editMessageText) return 'failed'
                await ctx.editMessageText(text, options)
            } else {
                await ctx.reply(text, {...options, ...topicOptions(view.state.scope.threadId)})
            }
            return editing ? 'edited' : 'sent'
        } catch (error) {
            const description = badRequestDescription(error)
            if (!description) return 'failed'
            if (editing && /message is not modified/i.test(description)) return 'unchanged'
            if (html && /can't parse (?:entities|message text)|can't find end of (?:an? )?entity|unsupported (?:start|end) tag/i.test(description)) {
                html = false
                continue
            }
            if (editing && /message to edit not found|message (?:can't|cannot|can not) be edited|message was deleted/i.test(description)) {
                editing = false
                // If HTML was already rejected, keep using the proven plain fallback.
                continue
            }
            return 'failed'
        }
    }
    return 'failed'
}

/** Plain result/error reply; no retries and no rejection leaks. */
export async function replyDirectoryText(
    ctx: DirectoryDeliveryContext, text: string, reply_markup?: DirectoryMarkup,
): Promise<boolean> {
    try {
        const threadId = ctx.callbackQuery?.message?.message_thread_id ?? ctx.message?.message_thread_id
        await ctx.reply(text, {
            ...topicOptions(threadId),
            ...(reply_markup ? {reply_markup} : {}),
        })
        return true
    } catch {
        return false
    }
}