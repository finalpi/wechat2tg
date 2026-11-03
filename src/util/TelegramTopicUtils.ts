// Bot API and GramJS encode forum context differently. Never infer a destination
// from the quoted message: cross-topic quotes must not change the recipient.
export function getTelegramThreadId(message: any): number | undefined {
    const value = message?.message_thread_id
        ?? (message?.replyTo?.forumTopic ? message.replyTo.replyToTopId ?? message.replyTo.replyToMsgId : undefined)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function isSameTelegramDestination(
    message: {chatId: number; threadId?: number | null} | undefined,
    chatId: number,
    threadId?: number
): boolean {
    return !!message && message.chatId === chatId && (message.threadId ?? undefined) === threadId
}