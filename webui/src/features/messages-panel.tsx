import {useCallback, useEffect, useRef, useState} from 'react'
import {ArrowLeft, RefreshCw, Search, MessageSquare, Reply, Undo2} from 'lucide-react'
import {ApiError} from '@/lib/api'
import {messagesApi, mergeMessages, messageError, type Contact, type ChatMessage, type MessageStatus, type MessageUpdates} from '@/lib/messages-api'
import {cn} from '@/lib/utils'
import {fillMessageGap} from '@/lib/message-history'
import {createMessageEventHub, createRefreshQueue, startMessageEvents, type MessageEventHub, type MessageConnectionState} from '@/lib/message-events'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Spinner} from '@/components/ui/spinner'
import {Tabs, TabsList, TabsTrigger} from '@/components/ui/tabs'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription} from '@/components/ui/empty'
import {Message, MessageContent, MessageHeader, MessageFooter} from '@/components/ui/message'
import {Bubble, BubbleContent} from '@/components/ui/bubble'
import {Marker, MarkerContent} from '@/components/ui/marker'
import {MessageScrollerProvider, MessageScroller, MessageScrollerViewport, MessageScrollerContent, MessageScrollerItem, MessageScrollerButton, useMessageScroller} from '@/components/ui/message-scroller'
import {ContactAvatar, MessageBody} from './message-content'
import {MessageComposer, type ComposerDraft} from './message-composer'

const sendLabels: Record<string, string> = {received: '已接收', sending: '发送中', submitted: '微信已接收', unknown: '结果未知', failed: '发送失败'}
const syncLabels: Record<string, string> = {pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', unknown: '同步未知', unverified: '待核实', excluded: '不参与同步'}
const revokeLabels: Record<string, string> = {revoking: '撤回中', revoked: '已撤回', failed: '撤回失败', unknown: '撤回结果未知'}
const time = (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString()

function Placeholder({title, detail}: {title: string; detail?: string}) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquare /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{detail && <EmptyDescription>{detail}</EmptyDescription>}</EmptyHeader></Empty>
}

function ConnectionBadge({state, className}: {state: MessageConnectionState; className?: string}) {
  return <Badge variant="outline" role="status" className={className}>{{connected: '实时连接', connecting: '连接中', reconnecting: '重连中', disconnected: '连接已断开'}[state]}</Badge>
}

function JumpToMessage({targetId}: {targetId: number | null}) {
  const {scrollToMessage} = useMessageScroller()
  useEffect(() => {if (targetId) scrollToMessage(String(targetId), {align: 'center'})}, [targetId, scrollToMessage])
  return null
}

function Conversation({token, contact, online, draft, events, connection, onBack, onAuthError}: {
  token: string; contact: Contact; online: boolean; draft: ComposerDraft; events: MessageEventHub; connection: MessageConnectionState; onBack: () => void; onAuthError: (error: unknown) => void
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [before, setBefore] = useState(0)
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<ChatMessage | null>(draft.quote || null)
  useEffect(() => {draft.quote = quote}, [draft, quote])
  const [located, setLocated] = useState(false)
  const [targetId, setTargetId] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [now, setNow] = useState(Date.now())
  const clockOffset = useRef(0)
  const generation = useRef(0)
  const contextGeneration = useRef(0)
  const liveRows = useRef<ChatMessage[]>([])
  const actionIds = useRef(new Set<number>())
  const revokeRequests = useRef(new Map<number, string>())
  const locating = useRef(false)
  const locatePending = useRef(false)
  const mounted = useRef(true)
  const requests = useRef<AbortController | null>(null)
  const refreshHistory = useRef(() => {})
  useEffect(() => {mounted.current = true; return () => {mounted.current = false}}, [])
  useEffect(() => {const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id)}, [])

  const updateRows = useCallback((update: (current: ChatMessage[]) => ChatMessage[]) => {
    liveRows.current = update(liveRows.current)
    setRows(liveRows.current)
  }, [])

  const applyPage = useCallback((page: MessageUpdates, replace: boolean, baseline: ChatMessage[]) => {
    clockOffset.current = page.serverTime * 1000 - Date.now()
    // A GET started before a send/action must not roll its result back.
    const snapshot = new Map(baseline.map(row => [row.id, row]))
    updateRows(current => {
      const protectedRows = current.filter(row => snapshot.get(row.id) !== row || actionIds.current.has(row.id))
      const protectedIds = new Set(protectedRows.map(row => row.id))
      return mergeMessages(replace ? protectedRows : current, page.messages.filter(row => !protectedIds.has(row.id)))
    })
  }, [updateRows])

  useEffect(() => {
    const controller = new AbortController()
    requests.current = controller
    const currentGeneration = ++generation.current
    contextGeneration.current++
    updateRows(() => [])
    setLoading(true); setError(''); setLocated(false); setTargetId(null); setBefore(0); setHasMore(false); setMoreBusy(false)
    locating.current = false; locatePending.current = false
    let initial = true, all = false
    const ids = new Set<number>()
    const valid = (context: number) => !controller.signal.aborted && generation.current === currentGeneration && contextGeneration.current === context
    const queue = createRefreshQueue(async () => {
      // locate() schedules a catch-up after its context has arrived.
      if (locatePending.current) return
      const context = contextGeneration.current
      const baseline = liveRows.current
      const loaded = new Set(baseline.map(row => row.id))
      const refreshAll = all
      const selected = [...new Set([...(all ? loaded : []), ...ids])]
      all = false; ids.clear()
      if (initial) {
        const page = await messagesApi.history(token, contact.wxId, query, 0, controller.signal)
        if (!valid(context)) return
        initial = false
        applyPage(page, true, baseline); setBefore(page.before); setHasMore(page.hasMore); setLoading(false); setError('')
        return
      }
      let update: MessageUpdates = {messages: [], serverTime: (Date.now() + clockOffset.current) / 1000}
      if (!locating.current) {
        const latest = await messagesApi.history(token, contact.wxId, query, 0, controller.signal)
        if (!valid(context)) return
        update = await fillMessageGap(latest, refreshAll && baseline.length ? [baseline[0]] : baseline, before => messagesApi.history(token, contact.wxId, query, before, controller.signal))
        if (!valid(context)) return
        if (!baseline.length) {setBefore(latest.before); setHasMore(latest.hasMore)}
      }
      const removed = new Set<number>()
      for (let start = 0; start < selected.length; start += 100) {
        const requested = selected.slice(start, start + 100)
        const page = await messagesApi.updates(token, contact.wxId, requested, controller.signal, locating.current ? '' : query)
        if (!valid(context)) return
        const returned = new Set(page.messages.map(row => row.id))
        requested.forEach(id => {if (!returned.has(id)) removed.add(id)})
        const visible = page.messages.filter(row => loaded.has(row.id) || !baseline.length || (row.timestamp >= baseline[0].timestamp && (!locating.current || row.timestamp <= baseline[baseline.length - 1].timestamp)))
        update = {messages: mergeMessages(update.messages, visible), serverTime: page.serverTime}
      }
      if (valid(context)) {
        applyPage({...update, messages: update.messages.filter(row => !removed.has(row.id))}, false, baseline)
        if (removed.size) {
          const original = new Map(baseline.map(row => [row.id, row]))
          updateRows(current => current.filter(row => !removed.has(row.id) || row !== original.get(row.id) || actionIds.current.has(row.id)))
        }
        setError('')
      }
    }, e => {if (!controller.signal.aborted) {all = true; setError(messageError(e)); setLoading(false); onAuthError(e)}})
    const catchUp = () => {all = true; queue.schedule()}
    refreshHistory.current = catchUp
    const unsubscribe = events.subscribe(event => {
      if (event.event === 'ready') {catchUp(); return}
      const change = event.data
      if (change.type !== 'messages' || (change.wxId && change.wxId !== contact.wxId)) return
      if (!change.ids?.length) all = true
      else {
        change.ids.forEach(id => ids.add(id))
        if (ids.size > 1000) {ids.clear(); all = true}
      }
      queue.schedule()
    })
    const timer = window.setTimeout(queue.flush, query ? 250 : 0)
    return () => {controller.abort(); queue.dispose(); unsubscribe(); window.clearTimeout(timer); generation.current++; refreshHistory.current = () => {}}
  }, [token, contact.wxId, query, reload, applyPage, updateRows, onAuthError, events])

  const more = async () => {
    if (moreBusy || !hasMore || locatePending.current) return
    const currentGeneration = generation.current
    const currentContext = contextGeneration.current
    const baseline = liveRows.current
    const signal = requests.current?.signal
    setMoreBusy(true); setError('')
    try {
      const page = await messagesApi.history(token, contact.wxId, located ? '' : query, before, signal)
      if (!mounted.current || signal?.aborted || generation.current !== currentGeneration || contextGeneration.current !== currentContext) return
      applyPage(page, false, baseline); setBefore(page.before); setHasMore(page.hasMore)
      refreshHistory.current()
    } catch (e) {if (!signal?.aborted && generation.current === currentGeneration && contextGeneration.current === currentContext) {setError(messageError(e)); onAuthError(e)}}
    finally {if (mounted.current && generation.current === currentGeneration) setMoreBusy(false)}
  }

  const locate = async (target: {id?: number; remoteId?: string}) => {
    if (locatePending.current) return
    const currentGeneration = generation.current
    const currentContext = ++contextGeneration.current
    const baseline = liveRows.current
    const signal = requests.current?.signal
    locating.current = true; locatePending.current = true; setError('')
    try {
      const page = await messagesApi.locate(token, contact.wxId, target, signal)
      if (!mounted.current || signal?.aborted || generation.current !== currentGeneration || contextGeneration.current !== currentContext) return
      applyPage(page, true, baseline); setBefore(page.before); setHasMore(page.hasMore); setLocated(true); setTargetId(page.targetId)
      locatePending.current = false; refreshHistory.current()
    } catch (e) {if (!signal?.aborted && mounted.current && generation.current === currentGeneration && contextGeneration.current === currentContext) {locating.current = located; locatePending.current = false; setError(messageError(e)); onAuthError(e); refreshHistory.current()}}
  }

  const action = async (row: ChatMessage, kind: 'sync' | 'revoke') => {
    if (actionIds.current.has(row.id)) return
    const uncertain = ['unknown', 'unverified'].includes(row.telegramStatus)
    const uncertainRecall = row.revokeStatus === 'unknown'
    if (kind === 'revoke' && !window.confirm(uncertainRecall ? '上次撤回结果未知，确认再次尝试撤回？' : '撤回这条微信消息？')) return
    if (kind === 'sync' && uncertain && !window.confirm('上次同步结果未知，重试可能产生重复消息。继续？')) return
    actionIds.current.add(row.id); setBusyIds(new Set(actionIds.current)); setError('')
    try {
      if (kind === 'revoke') {
        const requestId = revokeRequests.current.get(row.id) || crypto.randomUUID()
        revokeRequests.current.set(row.id, requestId)
        const result = await messagesApi.revoke(token, row.id, requestId, uncertainRecall)
        if (result.revokeStatus !== 'revoking') revokeRequests.current.delete(row.id)
        if (mounted.current) updateRows(current => current.map(item => item.id === row.id ? {...item, ...result, canRevoke: !['revoked', 'revoking'].includes(result.revokeStatus) && item.canRevoke} : item))
      } else {
        const result = await messagesApi.sync(token, row.id, uncertain)
        if (mounted.current) updateRows(current => current.map(item => item.id === row.id ? {...item, ...result} : item))
      }
    } catch (e) {if (mounted.current) {setError(messageError(e)); onAuthError(e)}}
    finally {
      actionIds.current.delete(row.id)
      if (mounted.current) {
        setBusyIds(new Set(actionIds.current))
        events.emit({event: 'change', data: {type: 'messages', wxId: contact.wxId, ids: [row.id]}})
      }
    }
  }

  const sent = (row: ChatMessage) => {
    if (!mounted.current) return
    if (query || locating.current) {setQuery(''); setReload(value => value + 1)}
    else updateRows(current => mergeMessages(current, [row]))
    events.emit({event: 'change', data: {type: 'messages', wxId: contact.wxId, ids: [row.id]}})
  }
  const clearQuote = useCallback(() => setQuote(null), [])

  return <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col" aria-label={`与 ${contact.name} 的会话`}>
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-background p-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="返回会话列表" onClick={onBack}><ArrowLeft /></Button>
      <ContactAvatar token={token} wxId={contact.wxId} name={contact.name} available={contact.hasAvatar} group={contact.kind === 'group'} />
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{contact.name || contact.wxId}</h2><p className="truncate text-xs text-muted-foreground">{contact.wxId}</p></div>
      <ConnectionBadge state={connection} className="md:hidden" />
      <Button variant="ghost" size="icon" aria-label="刷新消息" onClick={() => refreshHistory.current()}><RefreshCw /></Button>
    </header>
    <div className="flex shrink-0 items-center gap-2 border-b p-3">
      <Search className="size-4 shrink-0 text-muted-foreground" /><Input aria-label="搜索消息" placeholder="搜索此会话的消息" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
      {(located || query) && <Button variant="outline" size="sm" onClick={() => {setQuery(''); setReload(value => value + 1)}}>返回最新</Button>}
    </div>
    {error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : !rows.length ? <Placeholder title={query ? '未找到消息' : '暂无消息'} detail="此处显示已保存的消息记录。" /> : (
      <MessageScrollerProvider key={`${contact.wxId}:${query}:${reload}:${located}`} defaultScrollPosition={located ? 'start' : 'end'} autoScroll={!located}>
        <MessageScroller className="flex-1 bg-muted/20">
          <MessageScrollerViewport aria-label="消息记录"><MessageScrollerContent className="gap-5 p-4 md:p-6">
            {hasMore && <MessageScrollerItem messageId="load-older"><div className="flex justify-center"><Button variant="outline" size="sm" disabled={moreBusy} onClick={more}>{moreBusy && <Spinner />} 加载更早消息</Button></div></MessageScrollerItem>}
            {rows.map((row, index) => {
              const outgoing = row.direction === 'outgoing'
              const revoked = row.revokeStatus === 'revoked'
              const canQuote = !revoked && ['received', 'submitted'].includes(row.status) && Boolean(row.remoteId)
              const canSync = row.telegramTracked && ['failed', 'unknown', 'unverified', 'pending'].includes(row.telegramStatus) && ['received', 'submitted'].includes(row.status)
              const canRevoke = row.canRevoke && (!row.revokeDeadline || row.revokeDeadline * 1000 > now + clockOffset.current)
              return <MessageScrollerItem key={row.id} messageId={String(row.id)}>
                {(index === 0 || date(rows[index - 1].timestamp) !== date(row.timestamp)) && <Marker variant="separator" className="mb-4"><MarkerContent>{date(row.timestamp)}</MarkerContent></Marker>}
                <Message align={outgoing ? 'end' : 'start'}>
                  <MessageContent>
                    <MessageHeader>{outgoing ? '我' : row.senderDisplayName || row.senderName || row.senderId || contact.name}</MessageHeader>
                    <Bubble variant={outgoing ? 'default' : 'outline'} align={outgoing ? 'end' : 'start'} className={cn(targetId === row.id && 'rounded-xl ring-2 ring-ring')}>
                      <BubbleContent><MessageBody token={token} message={row} onLocate={locate} /></BubbleContent>
                    </Bubble>
                    <MessageFooter className="flex-wrap gap-2">
                      <time dateTime={new Date(row.timestamp * 1000).toISOString()}>{time(row.timestamp)}</time>
                      {outgoing && <span className={cn(['failed', 'unknown'].includes(row.status) && 'text-destructive')}>{sendLabels[row.status] || row.status}</span>}
                      {row.telegramTracked && syncLabels[row.telegramStatus] && <span>{syncLabels[row.telegramStatus]}</span>}
                      {row.revokeStatus && revokeLabels[row.revokeStatus] && <Badge variant="secondary">{revokeLabels[row.revokeStatus]}</Badge>}
                      {canQuote && <Button variant="ghost" size="sm" aria-label="引用回复" onClick={() => setQuote(row)}><Reply /></Button>}
                      {canSync && <Button variant="ghost" size="sm" disabled={busyIds.has(row.id)} onClick={() => action(row, 'sync')}><RefreshCw /> 同步 Telegram</Button>}
                      {canRevoke && <Button variant="ghost" size="sm" disabled={busyIds.has(row.id)} onClick={() => action(row, 'revoke')}><Undo2 /> 撤回</Button>}
                    </MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            })}
          </MessageScrollerContent></MessageScrollerViewport>
          <MessageScrollerButton />{located && <JumpToMessage targetId={targetId} />}
        </MessageScroller>
      </MessageScrollerProvider>
    )}
    <MessageComposer token={token} contact={contact} online={online} draft={draft} quote={quote} onClearQuote={clearQuote} onSent={sent} onAuthError={onAuthError} />
  </section>
}

export function MessagesPanel({token, drafts, onLogout}: {token: string; drafts: Map<string, ComposerDraft>; onLogout: () => void}) {
  const [status, setStatus] = useState<MessageStatus | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [active, setActive] = useState<Contact | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [loading, setLoading] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const contactGeneration = useRef(0)
  const contactRequests = useRef<AbortController | null>(null)
  const contactOffset = useRef(0)
  const [events] = useState(createMessageEventHub)
  const [connection, setConnection] = useState<MessageConnectionState>('connecting')
  const logout = useRef(onLogout)
  logout.current = onLogout
  const logoutStarted = useRef(false)
  const expire = useCallback(() => {
    if (!logoutStarted.current) {logoutStarted.current = true; logout.current()}
  }, [])
  const getDraft = (wxId: string) => {
    if (!drafts.has(wxId)) drafts.set(wxId, {})
    return drafts.get(wxId)!
  }
  const onAuthError = useCallback((error: unknown) => {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) expire()
  }, [expire])

  useEffect(() => {
    logoutStarted.current = false
    return startMessageEvents(token, {onEvent: events.emit, onState: setConnection, onAuthExpired: expire})
  }, [token, events, expire])

  useEffect(() => {
    const controller = new AbortController()
    const queue = createRefreshQueue(async () => {
      const result = await messagesApi.status(token, controller.signal)
      if (!controller.signal.aborted) {setStatus(result); setError('')}
    }, e => {if (!controller.signal.aborted) {setError(messageError(e)); onAuthError(e)}})
    const unsubscribe = events.subscribe(event => {
      if (event.event === 'ready' || event.data.type === 'status') queue.schedule()
    })
    queue.flush()
    return () => {controller.abort(); queue.dispose(); unsubscribe()}
  }, [token, reload, onAuthError, events])

  useEffect(() => {
    if (!status?.available) return
    const controller = new AbortController()
    contactRequests.current = controller
    const generation = ++contactGeneration.current
    setLoading(true); setContacts([]); setError(''); setHasMore(false); setMoreBusy(false)
    contactOffset.current = 0
    let initial = true
    const queue = createRefreshQueue(async () => {
      const first = await messagesApi.contacts(token, query, kind, 0, controller.signal)
      if (controller.signal.aborted || generation !== contactGeneration.current) return
      if (initial) {
        initial = false
        setContacts(first.contacts); setOffset(first.offset); contactOffset.current = first.offset
        setHasMore(first.hasMore); setLoading(false)
      } else {
        const refreshed = [...first.contacts]
        let page = first
        // Refresh summaries on loaded directory pages too, without dropping their pagination state.
        while (page.hasMore && page.offset > 0 && page.offset < contactOffset.current) {
          const next = await messagesApi.contacts(token, query, kind, page.offset, controller.signal)
          if (controller.signal.aborted || generation !== contactGeneration.current) return
          refreshed.push(...next.contacts)
          if (next.offset <= page.offset) break
          page = next
        }
        setContacts(current => {
          const merged = new Map(current.map(contact => [contact.wxId, contact]))
          refreshed.forEach(contact => merged.set(contact.wxId, contact))
          return [...merged.values()].sort((a, b) => kind === 'all' ? b.lastActivity - a.lastActivity || b.lastSequence - a.lastSequence || a.name.localeCompare(b.name) : a.name.localeCompare(b.name))
        })
        if (!contactOffset.current) {setOffset(first.offset); contactOffset.current = first.offset; setHasMore(first.hasMore)}
      }
      setError('')
    }, e => {if (!controller.signal.aborted) {setError(messageError(e)); setLoading(false); onAuthError(e)}})
    const unsubscribe = events.subscribe(event => {
      if (event.event === 'ready' || event.data.type === 'messages' || event.data.type === 'contacts') queue.schedule()
    })
    const timer = window.setTimeout(queue.flush, query ? 250 : 0)
    return () => {controller.abort(); queue.dispose(); unsubscribe(); window.clearTimeout(timer); contactGeneration.current++}
  }, [token, query, kind, reload, status?.available, onAuthError, events])

  const more = async () => {
    if (moreBusy) return
    const generation = contactGeneration.current
    const signal = contactRequests.current?.signal
    setMoreBusy(true)
    try {
      const page = await messagesApi.contacts(token, query, kind, offset, signal)
      if (signal?.aborted || generation !== contactGeneration.current) return
      setContacts(current => [...new Map([...current, ...page.contacts].map(contact => [contact.wxId, contact])).values()]); setOffset(page.offset); contactOffset.current = page.offset; setHasMore(page.hasMore)
    } catch (e) {if (!signal?.aborted && generation === contactGeneration.current) {setError(messageError(e)); onAuthError(e)}}
    finally {if (generation === contactGeneration.current) setMoreBusy(false)}
  }

  const liveBadge = <ConnectionBadge state={connection} />
  if (!status && !error) return <div className="flex h-full flex-col items-center justify-center gap-3">{liveBadge}<Spinner /></div>
  if (!status?.available) return <div className="flex h-full flex-col gap-4 p-4"><div>{liveBadge}</div>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Placeholder title="消息服务未连接" detail="机器人启动后可查看和发送消息。" /><Button variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw /> 刷新</Button></div>

  return <div className="flex h-full min-h-0 min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
    <aside className={cn('flex w-full shrink-0 flex-col border-r md:w-72 xl:w-80', active && 'hidden md:flex')}>
      <div className="flex flex-col gap-3 border-b p-4">
        <div className="flex items-center justify-between gap-2"><h1 className="font-semibold">消息</h1>{liveBadge}<Button variant="ghost" size="icon" aria-label="刷新会话" onClick={() => setReload(value => value + 1)}><RefreshCw /></Button></div>
        <div className="flex items-center gap-2"><Badge variant={status.wechatOnline ? 'secondary' : 'outline'}>{status.wechatOnline ? '微信在线' : '微信离线'}</Badge><Badge variant={status.telegramOnline ? 'secondary' : 'outline'}>{status.telegramOnline ? 'Telegram 在线' : 'Telegram 离线'}</Badge></div>
        <Input aria-label="搜索会话" placeholder="搜索联系人、群聊" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
        <Tabs value={kind} onValueChange={setKind}><TabsList className="w-full"><TabsTrigger value="all" className="flex-1">最近</TabsTrigger><TabsTrigger value="contact" className="flex-1">联系人</TabsTrigger><TabsTrigger value="group" className="flex-1">群聊</TabsTrigger></TabsList></Tabs>
      </div>
      {error && <Alert variant="destructive" className="rounded-none border-x-0"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="会话列表">
        {loading ? <div className="flex justify-center p-6"><Spinner /></div> : !contacts.length ? <Placeholder title="未找到会话" detail={status.directoryAvailable ? undefined : '联系人目录尚未加载。'} /> : contacts.map(contact => <Button key={contact.wxId} variant={active?.wxId === contact.wxId ? 'secondary' : 'ghost'} aria-pressed={active?.wxId === contact.wxId} className="h-auto w-full justify-start gap-3 whitespace-normal px-3 py-3 text-left" onClick={() => setActive(contact)}>
          <ContactAvatar token={token} wxId={contact.wxId} name={contact.name} available={contact.hasAvatar} group={contact.kind === 'group'} />
          <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="flex items-center justify-between gap-2"><span className="truncate">{contact.name || contact.wxId}</span>{contact.lastActivity > 0 && <span className="shrink-0 text-xs text-muted-foreground">{time(contact.lastActivity)}</span>}</span><span className="truncate text-xs text-muted-foreground">{contact.lastBody || contact.nickname || contact.wxId}</span>{contact.unsyncedCount > 0 && <span className="text-xs text-muted-foreground">{contact.unsyncedCount} 条待同步</span>}</span>
        </Button>)}
        {hasMore && <Button variant="ghost" size="sm" disabled={moreBusy || loading} onClick={more}>{moreBusy && <Spinner />} 更多会话</Button>}
      </div>
    </aside>
    {active ? <Conversation key={active.wxId} token={token} events={events} connection={connection} draft={getDraft(active.wxId)} contact={contacts.find(contact => contact.wxId === active.wxId) || active} online={status.wechatOnline} onBack={() => setActive(null)} onAuthError={onAuthError} />
      : <div className="hidden flex-1 md:flex"><Placeholder title="选择一个会话" detail="查看消息或开始聊天。" /></div>}
  </div>
}
