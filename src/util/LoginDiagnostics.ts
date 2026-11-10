import fs from 'node:fs'
import path from 'node:path'

// This allowlist deliberately excludes messages, account IDs, QR URLs and keys.
function safeRecord(event: string, detail: Record<string, unknown>, now: number) {
    const token = (value: unknown) => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value) ? value : undefined
    const record: Record<string, unknown> = {time: new Date(now).toISOString(), event: token(event) || 'unknown', version: require('../../package.json').version}
    if (typeof detail.sdkVersion === 'string' && /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(detail.sdkVersion) && detail.sdkVersion.length < 40) record.sdkVersion = detail.sdkVersion
    for (const key of ['source', 'stage', 'reason']) {
        const value = token(detail[key]); if (value) record[key] = value
    }
    for (const key of ['code', 'attempt', 'retryInMs', 'generation', 'expiresAt']) {
        const value = detail[key]; if (typeof value === 'number' && Number.isFinite(value)) record[key] = value
    }
    return record
}

/** Calendar-day retention, independent of application log level or Docker rotation. */
export function createLoginEventLog(directory = 'logs/login-events', now = Date.now, maxBytes = 5 * 1024 * 1024) {
    const recent = new Map<string, number>()
    return (event: string, detail: Record<string, unknown> = {}) => {
        const time = now(), record = safeRecord(event, detail, time)
        const key = `${record.event}:${record.stage || ''}:${record.code ?? ''}`
        if (recent.has(key) && time - recent.get(key) < 60000 && record.attempt !== 1) return
        try {
            fs.mkdirSync(directory, {recursive: true, mode: 0o700})
            const cutoff = time - 30 * 86400000
            for (const name of fs.readdirSync(directory)) {
                const match = /^login-events-(\d{4}-\d{2}-\d{2})\.jsonl(?:\.[1-4])?$/.exec(name)
                const file = path.join(directory, name)
                if (match && fs.lstatSync(file).isFile() && Date.parse(match[1] + 'T00:00:00Z') + 86400000 <= cutoff) fs.unlinkSync(file)
            }
            const file = path.join(directory, `login-events-${new Date(time).toISOString().slice(0, 10)}.jsonl`)
            if (fs.existsSync(file) && fs.statSync(file).size >= maxBytes) {
                for (let i = 3; i >= 0; i--) {
                    const from = i ? `${file}.${i}` : file, to = `${file}.${i + 1}`
                    if (!fs.existsSync(from)) continue
                    if (fs.existsSync(to)) fs.unlinkSync(to)
                    fs.renameSync(from, to)
                }
            }
            fs.appendFileSync(file, JSON.stringify(record) + '\n', {mode: 0o600})
            if (recent.size >= 128) recent.clear()
            recent.set(key, time)
        } catch { console.error('Login event log could not be written') }
    }
}

export const loginEvent = createLoginEventLog()
