export interface MessageChange {type: 'messages' | 'contacts' | 'status'; wxId?: string; ids?: number[]}
export type MessageEvent = {event: 'ready'} | {event: 'change'; data: MessageChange}
export type MessageConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export interface SSEEvent {event: string; data: string}

/** Incremental SSE framing, including CRLF split across chunks. Never retain an unbounded frame. */
export function createSSEParser(emit: (event: SSEEvent) => void, maxBuffer = 64 * 1024) {
  let line = '', event = '', data = '', size = 0, skipLF = false
  const endLine = () => {
    if (!line) {
      if (data || event === 'auth-expired') emit({event: event || 'message', data: data.slice(0, -1)})
      event = ''; data = ''; size = 0
    } else if (!line.startsWith(':')) {
      size += line.length
      if (size > maxBuffer) throw new Error('SSE frame too large')
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
      if (field === 'event') event = value
      if (field === 'data') data += value + '\n'
    }
    line = ''
  }
  return {push(chunk: string) {
    for (const char of chunk) {
      if (skipLF && char === '\n') {skipLF = false; continue}
      skipLF = char === '\r'
      if (char === '\r' || char === '\n') endLine()
      else {
        line += char
        if (line.length + size > maxBuffer) throw new Error('SSE frame too large')
      }
    }
  }}
}

export function decodeMessageEvent(frame: SSEEvent): MessageEvent | undefined {
  if (frame.event === 'ready') return {event: 'ready'}
  if (frame.event !== 'change') return
  try {
    const value: unknown = JSON.parse(frame.data)
    if (!value || typeof value !== 'object') return
    const change = value as MessageChange
    if (!['messages', 'contacts', 'status'].includes(change.type)) return
    if (change.wxId !== undefined && typeof change.wxId !== 'string') return
    if (change.ids !== undefined && !Array.isArray(change.ids)) return
    return {event: 'change', data: {
      type: change.type, wxId: change.wxId,
      ids: change.ids?.filter(id => Number.isSafeInteger(id) && id > 0),
    }}
  } catch { /* Malformed events must not tear down a healthy stream. */ }
}

export function createMessageEventHub() {
  const listeners = new Set<(event: MessageEvent) => void>()
  return {
    emit(event: MessageEvent) {listeners.forEach(listener => listener(event))},
    subscribe(listener: (event: MessageEvent) => void) {
      listeners.add(listener)
      return () => {listeners.delete(listener)}
    },
  }
}
export type MessageEventHub = ReturnType<typeof createMessageEventHub>

/** At most one refresh in flight. Notifications during it cause exactly one trailing refresh. */
export function createRefreshQueue(refresh: () => Promise<void>, onError: (error: unknown) => void, delay = 150) {
  let dirty = false, running = false, disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    timer = undefined
    if (disposed || running || !dirty) return
    dirty = false; running = true
    try {await refresh()} catch (error) {if (!disposed) onError(error)}
    finally {running = false; if (dirty && !disposed) schedule()}
  }
  const schedule = () => {
    if (disposed) return
    dirty = true
    if (!running && timer === undefined) timer = setTimeout(() => {void run()}, delay)
  }
  return {
    schedule,
    flush() {if (disposed) return; dirty = true; clearTimeout(timer); timer = undefined; void run()},
    dispose() {disposed = true; dirty = false; clearTimeout(timer)},
  }
}

/** One panel-owned, authenticated fetch stream. No query credentials or HTTP polling fallback. */
export function startMessageEvents(token: string, options: {
  onEvent: (event: MessageEvent) => void
  onState: (state: MessageConnectionState) => void
  onAuthExpired: () => void
}) {
  let stopped = false, attempt = 0
  let controller: AbortController | undefined
  let cancelReader: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = () => {
    if (stopped) return
    stopped = true; clearTimeout(timer); controller?.abort(); cancelReader?.()
    options.onState('disconnected'); options.onAuthExpired()
  }
  const connect = async () => {
    if (stopped) return
    const current = new AbortController()
    controller = current
    // A half-open proxy/mobile connection may never reject reader.read().
    // Heartbeats arrive every 15 seconds; missing all traffic for 45s reconnects.
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const alive = () => {clearTimeout(watchdog); watchdog = setTimeout(() => current.abort(), 45_000)}
    alive()
    try {
      const response = await fetch('/api/messages/events', {
        headers: {Authorization: `Bearer ${token}`, Accept: 'text/event-stream'},
        signal: current.signal, cache: 'no-store',
      })
      if (stopped || current.signal.aborted) {await response.body?.cancel(); return}
      if (response.status === 401 || response.status === 403) {expired(); await response.body?.cancel().catch(() => {}); return}
      if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream') || !response.body) {
        await response.body?.cancel()
        throw new Error('SSE unavailable')
      }
      const reader = response.body.getReader()
      cancelReader = () => {void reader.cancel().catch(() => {})}
      const decoder = new TextDecoder()
      const parser = createSSEParser(frame => {
        if (stopped || current.signal.aborted) return
        if (frame.event === 'auth-expired') {expired(); return}
        const event = decodeMessageEvent(frame)
        if (!event) return
        if (event.event === 'ready') {attempt = 0; options.onState('connected')}
        options.onEvent(event)
      })
      try {
        while (!stopped && !current.signal.aborted) {
          const {done, value} = await reader.read()
          if (done) break
          alive()
          parser.push(decoder.decode(value, {stream: true}))
        }
      } finally {cancelReader = undefined; await reader.cancel().catch(() => {}); reader.releaseLock()}
    } catch { /* EOF, malformed framing and network errors all reconnect through the same bounded backoff. */ }
    finally {
      clearTimeout(watchdog)
      current.abort()
      if (!stopped) {
        options.onState(navigator.onLine === false ? 'disconnected' : 'reconnecting')
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5) * (1 + Math.random() * 0.2))
        timer = setTimeout(() => {void connect()}, delay)
      }
    }
  }
  const visible = () => {if (!stopped && !document.hidden) options.onEvent({event: 'ready'})}
  document.addEventListener('visibilitychange', visible)
  options.onState('connecting')
  // Deferral lets React StrictMode's setup/cleanup probe cancel before opening a second stream.
  timer = setTimeout(() => {void connect()}, 0)
  return () => {
    stopped = true; clearTimeout(timer); controller?.abort(); cancelReader?.()
    document.removeEventListener('visibilitychange', visible)
  }
}
