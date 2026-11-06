import type {IncomingMessage, ServerResponse} from 'node:http'
import type {MessageChange} from './message-events'

type Subscribe = (listener: (change: MessageChange) => void) => () => void

/** Invalidation only: no message bodies, credentials or database sources cross this stream. */
export function createMessageStreamHandler({heartbeatMs = 15000, flushMs = 150, maxConnections = 32} = {}) {
    let connections = 0
    return (req: IncomingMessage, res: ServerResponse, subscribe: Subscribe | undefined, authorized: () => Promise<boolean>) => {
        if (res.destroyed || res.writableEnded || req.socket.destroyed) return
        if (connections >= maxConnections) {
            res.writeHead(429, {'Content-Type': 'application/json', 'Retry-After': '30'})
            res.end(JSON.stringify({error: 'streamLimit'}))
            return
        }
        connections++
        let closed = false
        let checking = false
        let timer: NodeJS.Timeout | undefined
        let heartbeat: NodeJS.Timeout | undefined
        let unsubscribe = () => undefined
        const changes = new Map<string, MessageChange>()
        const cleanup = () => {
            if (closed) return
            closed = true
            connections--
            clearTimeout(timer)
            clearInterval(heartbeat)
            changes.clear()
            unsubscribe()
            res.off('close', cleanup)
            res.off('error', cleanup)
        }
        const write = (frame: string) => {
            if (closed) return
            if (res.destroyed || res.writableEnded) {cleanup(); return}
            if (res.writableLength > 65536) {cleanup(); res.destroy(); return}
            res.write(frame)
        }
        const verify = async () => {
            try {return await authorized()} catch {return false}
        }
        const expire = () => {
            write('event: auth-expired\ndata: {}\n\n')
            cleanup()
            res.end()
        }
        const flush = async () => {
            timer = undefined
            if (closed) return
            if (checking) {timer = setTimeout(flush, flushMs); return}
            checking = true
            const ok = await verify()
            checking = false
            if (closed) return
            if (!ok) {expire(); return}
            for (const change of changes.values()) write(`event: change\ndata: ${JSON.stringify(change)}\n\n`)
            changes.clear()
        }
        res.on('close', cleanup)
        res.on('error', cleanup)
        try {
            // Subscribe before ready: the client refreshes current state on every connection,
            // so changes during initial load/reconnect cannot be silently missed.
            unsubscribe = subscribe?.(change => {
                if (closed || !['messages', 'contacts', 'status'].includes(change.type)) return
                const wxId = typeof change.wxId === 'string' && change.wxId.length <= 256 ? change.wxId : undefined
                const key = `${change.type}:${wxId || ''}`
                const prior = changes.get(key)
                const ids = change.ids?.filter(id => Number.isSafeInteger(id) && id > 0)
                const merged = prior && !prior.ids || !ids ? undefined : [...new Set([...(prior?.ids || []), ...ids])]
                changes.set(key, {type: change.type, ...(wxId ? {wxId} : {}), ...(merged && merged.length <= 100 ? {ids: merged} : {})})
                if (changes.size > 100) {changes.clear(); changes.set('messages:', {type: 'messages'}); changes.set('status:', {type: 'status'})}
                if (!timer) timer = setTimeout(flush, flushMs)
            }) || (() => undefined)
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            })
            res.flushHeaders()
            write('event: ready\ndata: {}\n\n')
            heartbeat = setInterval(async () => {
                if (closed || checking) return
                checking = true
                const ok = await verify()
                checking = false
                if (closed) return
                if (!ok) {expire(); return}
                write(': heartbeat\n\n')
            }, heartbeatMs)
            heartbeat.unref()
            req.socket.setTimeout(0)
        } catch {
            cleanup()
            if (res.headersSent) res.destroy()
            else {res.writeHead(503, {'Content-Type': 'application/json'}); res.end(JSON.stringify({error: 'streamUnavailable'}))}
        }
    }
}