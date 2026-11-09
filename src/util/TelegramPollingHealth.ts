import type {Telegram} from 'telegraf'

export const TELEGRAM_POLL_DEADLINE_MS = 85_000
export const TELEGRAM_POLL_STALE_MS = 90_000
export interface TelegramPollingSnapshot {
    state: 'starting' | 'healthy' | 'retrying' | 'stalled' | 'stopped'
    healthy: boolean
    inFlight: boolean
    lastAttemptAt: number | null
    lastSuccessAt: number | null
    lastFailureAt: number | null
    lastError: string | null
    consecutiveFailures: number
    lastDurationMs: number | null
    requestTimeoutMs: number
}
interface Clock {
    now(): number
    setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
    clearTimeout(timer: ReturnType<typeof setTimeout>): void
}
interface Options {
    logger: {info(message: string): void; warn(message: string): void}
    onChange(): void
    timeoutMs?: number
    staleMs?: number
    clock?: Clock
}

/** Only fixed categories are logged/exposed: never error messages, URLs, payloads or tokens. */
function failureReason(error: unknown): string {
    const value = error && typeof error === 'object' ? error as {code?: unknown; name?: unknown; response?: {error_code?: unknown}} : {}
    const code = value.response?.error_code ?? value.code
    if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) return `HTTP_${code}`
    if (typeof code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return code
    return value.name === 'FetchError' ? 'NETWORK_ERROR' : value.name === 'InvalidPollingResponse' ? 'INVALID_RESPONSE' : 'POLLING_ERROR'
}
const abortError = () => Object.assign(new Error('Telegram polling cancelled'), {name: 'AbortError'})
const deadlineError = () => Object.assign(new Error('Telegram getUpdates request deadline exceeded'), {
    // Telegraf retries FetchError; AbortError alone would terminate its polling loop.
    name: 'FetchError', code: 'ETIMEDOUT', type: 'request-timeout',
})

/** Wrap one bot's transport, not Telegram.prototype or the upload HTTP timeout. */
export function installTelegramPollingHealth(telegram: Pick<Telegram, 'callApi'>, options: Options) {
    const original = telegram.callApi
    const clock: Clock = options.clock || {now: Date.now, setTimeout, clearTimeout}
    const timeoutMs = options.timeoutMs ?? TELEGRAM_POLL_DEADLINE_MS
    const staleMs = options.staleMs ?? TELEGRAM_POLL_STALE_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(staleMs) || staleMs <= 0) throw new RangeError('Invalid polling health deadlines')
    let active = false, startedAt = clock.now(), inFlight = false
    let lastAttemptAt: number | null = null, lastSuccessAt: number | null = null, lastFailureAt: number | null = null
    let lastError: string | null = null, lastDurationMs: number | null = null, failures = 0
    let staleTimer: ReturnType<typeof setTimeout> | undefined
    let lastWarningAt = -Infinity, staleWarning = false
    const requests = new Set<AbortController>()
    const notify = () => {try {options.onChange()} catch { /* Monitoring cannot break polling. */ }}
    const snapshot = (): TelegramPollingSnapshot => {
        const stale = clock.now() - (lastSuccessAt ?? startedAt) >= staleMs
        const state = !active ? 'stopped' : failures ? 'retrying' : stale ? 'stalled' : lastSuccessAt === null ? 'starting' : 'healthy'
        return {state, healthy: state === 'healthy', inFlight, lastAttemptAt, lastSuccessAt, lastFailureAt,
            lastError, consecutiveFailures: failures, lastDurationMs, requestTimeoutMs: timeoutMs}
    }
    const clearStale = () => {if (staleTimer !== undefined) clock.clearTimeout(staleTimer);staleTimer = undefined}
    const watchProgress = () => {
        clearStale()
        if (!active || failures) return
        staleTimer = clock.setTimeout(() => {
            staleTimer = undefined
            if (snapshot().state !== 'stalled') return
            staleWarning = true
            options.logger.warn('Telegram getUpdates 进度停滞：超过 ' + staleMs / 1000 + ' 秒没有成功拉取更新；请检查轮询或消息处理耗时')
            notify()
        }, Math.max(0, (lastSuccessAt ?? startedAt) + staleMs - clock.now()))
        staleTimer.unref?.()
    }
    const start = () => {
        active = true;startedAt = clock.now();staleWarning = false
        watchProgress();notify()
    }
    const stop = () => {active = false;clearStale();notify()}
    const wrapped: typeof telegram.callApi = (async (...args: Parameters<Telegram['callApi']>) => {
        const [method, payload, requestOptions] = args
        if (method !== 'getUpdates') return original.apply(telegram, args)
        const upstream = requestOptions?.signal
        if (upstream?.aborted) throw abortError()
        const controller = new AbortController()
        requests.add(controller)
        const cancel = () => controller.abort()
        upstream?.addEventListener('abort', cancel, {once: true})
        const polling = Number((payload as {timeout?: number}).timeout) > 0
        const began = clock.now()
        if (polling && active) {lastAttemptAt = began;inFlight = true;notify()}
        let expired = false
        const timer = clock.setTimeout(() => {expired = true;controller.abort()}, timeoutMs)
        timer.unref?.()
        try {
            // SAFETY: Native and abort-controller signals implement the same
            // EventTarget API used by node-fetch; Telegraf 4 types name its old shim.
            const result = await original.call(telegram, method, payload, {...requestOptions,
                signal: controller.signal as unknown as NonNullable<NonNullable<Parameters<Telegram['callApi']>[2]>['signal']>})
            if (upstream?.aborted) throw abortError()
            if (expired) throw deadlineError()
            if (polling && !Array.isArray(result)) throw Object.assign(new Error('Invalid getUpdates result'), {name: 'InvalidPollingResponse'})
            if (polling && active) {
                const recovering = failures > 0 || staleWarning
                const first = lastSuccessAt === null
                inFlight = false;lastSuccessAt = clock.now();lastDurationMs = lastSuccessAt - began
                failures = 0;staleWarning = false
                if (recovering || first) options.logger.info(recovering
                    ? 'Telegram getUpdates 已恢复，成功拉取更新' : 'Telegram getUpdates 已就绪，首次成功拉取更新')
                watchProgress();notify()
            }
            return result
        } catch (error) {
            // Explicit stop/shutdown is not a network failure or a recovery event.
            if (upstream?.aborted) {
                if (polling) {inFlight = false;stop()}
                throw abortError()
            }
            const failure = expired ? deadlineError() : error
            if (polling && active) {
                inFlight = false;failures++;lastFailureAt = clock.now();lastError = failureReason(failure)
                lastDurationMs = lastFailureAt - began;clearStale()
                if (failures === 1 || lastFailureAt - lastWarningAt >= 60_000) {
                    lastWarningAt = lastFailureAt
                    options.logger.warn(`Telegram getUpdates 失败：${lastError}；连续失败 ${failures} 次；最近成功 ${lastSuccessAt === null ? '尚无' : new Date(lastSuccessAt).toISOString()}；由轮询器重试`)
                }
                notify()
            }
            throw failure
        } finally {
            clock.clearTimeout(timer)
            upstream?.removeEventListener('abort', cancel)
            requests.delete(controller)
            if (polling) inFlight = false
        }
    }) as typeof telegram.callApi
    telegram.callApi = wrapped
    return {start, stop, snapshot, dispose() {
        stop()
        requests.forEach(controller => controller.abort())
        requests.clear()
        if (telegram.callApi === wrapped) telegram.callApi = original
    }}
}