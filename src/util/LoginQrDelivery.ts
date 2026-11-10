type Context = {chatId: number; telegram: {
    sendPhoto: (chat: number, photo: unknown, options: unknown) => Promise<{message_id: number}>;
    editMessageMedia: (chat: number, id: number, inline: undefined, media: unknown) => Promise<unknown>;
    deleteMessage: (chat: number, id: number) => Promise<unknown>;
}}
type Options = {
    context: () => Promise<Context>;
    render: (content: string) => Promise<Buffer>;
    getMessageId: () => number | undefined;
    setMessageId: (id: number | undefined) => void;
    caption: () => string;
    event: (name: string, detail?: Record<string, unknown>) => void;
}
type Job = {generation: number; content: string; expiresAt: number; attempt: number; buffer?: Buffer}

/** One sender, newest QR only, bounded retries, and cancellation after login. */
export class LoginQrDelivery {
    private generation = 0
    private job?: Job
    private running = false
    private timer?: ReturnType<typeof setTimeout>
    constructor(private options: Options) {}

    show(content: string, expiresAt?: number) {
        if (this.job?.content === content) return
        this.cancel()
        const deadline = Math.min(Date.now() + 240000, Number.isFinite(expiresAt) ? expiresAt : Infinity)
        this.job = {generation: this.generation, content, expiresAt: deadline, attempt: 0}
        this.options.event('qr-delivery-queued', {generation: this.generation, expiresAt: deadline})
        void this.pump()
    }
    cancel() {
        this.generation++
        this.job = undefined
        if (this.timer) clearTimeout(this.timer)
        this.timer = undefined
    }
    private current(job: Job) { return this.job === job && job.generation === this.generation }
    private event(name: string, job: Job, extra: Record<string, unknown> = {}) {
        this.options.event(name, {generation: job.generation, attempt: job.attempt, ...extra})
    }
    private async pump() {
        if (this.running || !this.job) return
        const job = this.job
        if (Date.now() >= job.expiresAt) {
            this.job = undefined; this.event('qr-delivery-expired', job); return
        }
        this.running = true
        job.attempt++
        try {
            job.buffer ||= await this.options.render(job.content)
            const context = await this.options.context()
            if (!this.current(job)) return
            if (Date.now() >= job.expiresAt) {this.job = undefined; this.event('qr-delivery-expired', job); return}
            const previous = this.options.getMessageId()
            let delivered = previous, created = false
            if (previous) {
                try {
                    await context.telegram.editMessageMedia(context.chatId, previous, undefined,
                        {type: 'photo', media: {source: job.buffer}, caption: this.options.caption()})
                } catch (error) {
                    const description = String(error?.response?.description || '')
                    if (error?.response?.error_code === 400 && /message is not modified/i.test(description)) {
                        // This QR is already present in the existing message.
                    } else if (error?.response?.error_code === 400 && /message to edit not found|message can't be edited|message_id_invalid/i.test(description)) {
                        if (!this.current(job)) return
                        this.options.setMessageId(undefined)
                        delivered = undefined
                    } else throw error
                }
            }
            if (!delivered) {
                if (!this.current(job)) return
                const sent = await context.telegram.sendPhoto(context.chatId, {source: job.buffer}, {caption: this.options.caption()})
                delivered = sent.message_id; created = true
            }
            if (!this.current(job) || Date.now() >= job.expiresAt) {
                // Only remove the message created by this stale attempt.
                if (created) await context.telegram.deleteMessage(context.chatId, delivered).catch(() => undefined)
                if (this.current(job)) {this.job = undefined; this.event('qr-delivery-expired', job)}
                return
            }
            this.options.setMessageId(delivered)
            this.job = undefined
            this.event('qr-delivery-succeeded', job)
        } catch (error) {
            if (!this.current(job)) return
            const code = error?.response?.error_code
            const permanent = typeof code === 'number' && code >= 400 && code < 500 && code !== 429
            const retryAfter = Number(error?.response?.parameters?.retry_after)
            const delay = code === 429 && retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1000 * 2 ** Math.max(0, job.attempt - 1))
            this.event('qr-delivery-failed', job, {code: typeof code === 'number' ? code : undefined})
            if (!permanent && job.attempt < 8 && Date.now() + delay < job.expiresAt) {
                this.event('qr-delivery-retry', job, {retryInMs: delay})
                this.timer = setTimeout(() => {this.timer = undefined; void this.pump()}, delay)
                this.timer.unref?.()
            } else this.job = undefined
        } finally {
            this.running = false
            if (this.job && this.job !== job && !this.timer) void this.pump()
        }
    }
}
