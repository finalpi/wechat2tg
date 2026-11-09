import {useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties} from 'react'
import {createRequestId} from '@/lib/request-id'
import {ArrowLeft, RefreshCw, Search, MessageSquare, Reply, Undo2, MoreHorizontal, PanelLeftClose, PanelLeftOpen} from 'lucide-react'
import {ApiError} from '@/lib/api'
import {messagesApi, mergeMessages, messageError, type Contact, type ChatMessage, type MessageStatus, type MessageUpdates, type ContactCategory, type ContactCounts} from '@/lib/messages-api'
import {cn} from '@/lib/utils'
import {fillMessageGap} from '@/lib/message-history'
import {createMessageEventHub, createRefreshQueue, startMessageEvents, type MessageEventHub, type MessageConnectionState} from '@/lib/message-events'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger} from '@/components/ui/dialog'
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
import {ContactAvatar, MessageBody, useRefreshAvatars} from './message-content'
import {MessageComposer, type ComposerDraft} from './message-composer'
import {ContactDirectory,LetterContacts} from './contact-directory'
import {OfficialAccountMenu} from './official-account-menu'
import {isContactVisible, type ChatPreferences} from '@/lib/chat-preferences'

const sendLabels: Record<string, string> = {received: '已接收', sending: '发送中', submitted: '已提交微信', unknown: '结果未知', failed: '发送失败'}
const syncLabels: Record<string, string> = {pending: '待同步', syncing: '同步中', synced: '已同步', failed: '同步失败', unknown: '同步未知', unverified: '待核实', excluded: '不参与同步'}
const revokeLabels: Record<string, string> = {revoking: '撤回中', revoked: '已撤回', failed: '撤回失败', unknown: '撤回结果未知'}
const time = (timestamp: number) => new Date(timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
const date = (timestamp: number) => new Date(timestamp * 1000).toLocaleDateString()

function Placeholder({title, detail}: {title: string; detail?: string}) {
  return <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquare /></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{detail && <EmptyDescription>{detail}</EmptyDescription>}</EmptyHeader></Empty>
}

const connectionLabels = {connected:'实时连接',connecting:'连接中',reconnecting:'重连中',disconnected:'连接已断开'}
const connectionEmoji = {connected:'🟢',connecting:'🟡',reconnecting:'🟡',disconnected:'🔴'}
function ConnectionBadge({state, className}: {state: MessageConnectionState; className?: string}) {
  return <span role="status" className={className} aria-label={connectionLabels[state]} title={connectionLabels[state]}>{connectionEmoji[state]}</span>
}

function MessageActions({children}:{children:ReactNode}) {
  const [open,setOpen] = useState(false)
  return <div className="message-actions" data-open={open}>
    <Button variant="ghost" size="icon" className="message-actions-toggle size-7" aria-label="消息操作" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><MoreHorizontal /></Button>
    <div className="message-actions-content" onKeyDown={event=>{if(event.key==='Escape')setOpen(false)}}>{children}</div>
  </div>
}

function ConnectionDetails({state, status}: {state: MessageConnectionState; status: MessageStatus}) {
  const healthy = state === 'connected' && status.wechatOnline && status.telegramOnline
  const polling = status.telegramPolling
  const pollingLabel = polling && {starting:'等待首次轮询成功',healthy:'更新拉取正常',retrying:'轮询失败，正在重试',stalled:'轮询进度停滞',stopped:'轮询已停止'}[polling.state]
  const stamp = (value:number|null)=>value === null ? '暂无' : new Date(value).toLocaleString()
  return <Dialog><DialogTrigger asChild>
    <Button variant="ghost" size="icon" aria-label="连接状态" title={status.demo?'演示连接（未连接真实账号）':healthy?'实时连接':state==='connected'?(polling && !polling.healthy?`Telegram：${pollingLabel}`:'服务离线'):connectionLabels[state]}>
      <span aria-hidden="true">{status.demo?'🧪':healthy?'🟢':state==='connected'?'🟠':connectionEmoji[state]}</span>
    </Button>
  </DialogTrigger><DialogContent>
    <DialogHeader><DialogTitle>连接状态</DialogTitle><DialogDescription>{status.demo?'本地演示数据，没有连接微信或 Telegram。':'浏览器实时连接与 Telegram 更新轮询分别检测，连接 WebUI 不代表机器人正在正常收取消息。'}</DialogDescription></DialogHeader>
    <div className="flex flex-wrap gap-2"><ConnectionBadge state={state} />
      <Badge variant={status.wechatOnline ? 'secondary' : 'outline'}>{status.demo ? '模拟微信连接' : status.wechatOnline ? '微信在线' : '微信离线'}</Badge>
      <Badge variant={status.telegramOnline ? 'secondary' : 'outline'}>{status.demo ? '模拟 Telegram 连接' : status.telegramOnline ? 'Telegram 在线' : 'Telegram 离线'}</Badge>
    </div>
    {polling && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" aria-label="Telegram 轮询详情">
      <dt className="text-muted-foreground">轮询状态</dt><dd>{pollingLabel}{polling.inFlight?' · 请求进行中':''}</dd>
      <dt className="text-muted-foreground">最近成功拉取</dt><dd>{polling.lastSuccessAt === null?'尚未成功拉取更新':stamp(polling.lastSuccessAt)}</dd>
      <dt className="text-muted-foreground">最近请求开始</dt><dd>{stamp(polling.lastAttemptAt)}</dd>
      <dt className="text-muted-foreground">最近失败</dt><dd>{stamp(polling.lastFailureAt)}{polling.lastError?` · ${polling.lastError}`:''}</dd>
      <dt className="text-muted-foreground">连续失败</dt><dd>{polling.consecutiveFailures} 次</dd>
      <dt className="text-muted-foreground">最近请求耗时</dt><dd>{polling.lastDurationMs === null?'暂无':`${(polling.lastDurationMs/1000).toFixed(1)} 秒`}</dd>
      <dt className="text-muted-foreground">请求截止时间</dt><dd>{polling.requestTimeoutMs/1000} 秒，仅 getUpdates；文件上传不受影响。</dd>
    </dl>}
  </DialogContent></Dialog>
}

function JumpToMessage({targetId}: {targetId: number | null}) {
  const {scrollToMessage} = useMessageScroller()
  useEffect(() => {if (targetId) scrollToMessage(String(targetId), {align: 'center'})}, [targetId, scrollToMessage])
  return null
}

function Conversation({token, contact, online, draft, events, connection, onBack, onAuthError, focused, onFocus, controls, networkOnline, visible}: {
  token: string; contact: Contact; online: boolean; draft: ComposerDraft; events: MessageEventHub; connection: MessageConnectionState; onBack: () => void; onAuthError: (error: unknown) => void; focused:boolean;onFocus:()=>void;controls?:ReactNode;networkOnline:boolean;visible:boolean
}) {
  const [query, setQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
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
        const requestId = revokeRequests.current.get(row.id) || createRequestId()
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 md:gap-3 md:px-4">
      {focused && <div className="hidden md:block">{controls}</div>}
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="返回会话列表" onClick={onBack}><ArrowLeft /></Button>
      <ContactAvatar token={token} wxId={contact.wxId} name={contact.name} available={contact.hasAvatar} group={contact.kind === 'group'} />
      <div className="min-w-0 flex-1"><h2 className="truncate font-semibold" title={contact.name || contact.wxId}>{contact.name || contact.wxId}</h2></div>
      {connection !== 'connected' && <ConnectionBadge state={connection} className="md:hidden" />}
      <Button variant="ghost" size="icon" aria-label="展开消息搜索" aria-expanded={showSearch || Boolean(query) || located} onClick={() => setShowSearch(value => !value)}><Search /></Button>
      <Button variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={focused?'显示会话列表':'专注当前会话'} aria-pressed={focused} onClick={onFocus}>{focused?<PanelLeftOpen />:<PanelLeftClose />}</Button>
      <Button variant="ghost" size="icon" aria-label="刷新消息" onClick={() => refreshHistory.current()}><RefreshCw /></Button>
    </header>
    <div className={cn('shrink-0 items-center gap-2 border-b p-2 md:p-3', showSearch || query || located ? 'flex' : 'hidden')}>
      <Search className="size-4 shrink-0 text-muted-foreground" /><Input aria-label="搜索消息" placeholder="搜索此会话的消息" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
      {(located || query) && <Button variant="outline" size="sm" onClick={() => {setQuery(''); setReload(value => value + 1)}}>返回最新</Button>}
    </div>
    {error && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : !rows.length ? <Placeholder title={query ? '未找到消息' : '暂无消息'} detail="此处显示已保存的消息记录。" /> : (
      <MessageScrollerProvider key={`${contact.wxId}:${query}:${reload}:${located}`} defaultScrollPosition={located ? 'start' : 'end'} autoScroll={!located && visible}>
        <MessageScroller className="flex-1 bg-muted/40">
          <MessageScrollerViewport aria-label="消息记录"><MessageScrollerContent className="mx-auto w-full max-w-5xl gap-3 px-3 py-4 md:px-6">
            {hasMore && <MessageScrollerItem messageId="load-older"><div className="flex justify-center"><Button variant="outline" size="sm" disabled={moreBusy} onClick={more}>{moreBusy && <Spinner />} 加载更早消息</Button></div></MessageScrollerItem>}
            {rows.map((row, index) => {
              const outgoing = row.direction === 'outgoing'
              const newDay = index === 0 || date(rows[index - 1].timestamp) !== date(row.timestamp)
              const revoked = row.revokeStatus === 'revoked'
              const canQuote = !revoked && ['received', 'submitted'].includes(row.status) && Boolean(row.remoteId)
              const canSync = row.telegramTracked && ['failed', 'unknown', 'unverified', 'pending'].includes(row.telegramStatus) && ['received', 'submitted'].includes(row.status)
              const canRevoke = row.canRevoke && (!row.revokeDeadline || row.revokeDeadline * 1000 > now + clockOffset.current)
              return <MessageScrollerItem key={row.id} messageId={String(row.id)}>
                {newDay && <Marker variant="separator" className="mb-4"><MarkerContent>{date(row.timestamp)}</MarkerContent></Marker>}
                <Message align={outgoing ? 'end' : 'start'}>
                  <ContactAvatar token={token} wxId={row.senderId || (!outgoing?contact.wxId:'')} name={outgoing?'我':row.senderDisplayName || row.senderName || contact.name} available={row.senderHasAvatar || (!outgoing && contact.hasAvatar) || (contact.kind==='group' && Boolean(row.senderId))} roomId={contact.kind==='group'?contact.wxId:undefined} />
                  <MessageContent className="gap-1">
                    {!outgoing && (newDay || !row.senderId || rows[index-1].senderId!==row.senderId || rows[index-1].direction!==row.direction || row.timestamp-rows[index-1].timestamp>120) && <MessageHeader>{row.senderDisplayName || row.senderName || row.senderId || contact.name}</MessageHeader>}
                    <Bubble variant={outgoing ? 'sent' : 'outline'} align={outgoing ? 'end' : 'start'} className={cn(targetId === row.id && 'rounded-xl ring-2 ring-ring')}>
                      <BubbleContent><MessageBody token={token} message={row} onLocate={locate} /></BubbleContent>
                    </Bubble>
                    <MessageFooter className={cn('flex-wrap gap-2', outgoing && 'flex-row-reverse')}>
                      <time dateTime={new Date(row.timestamp * 1000).toISOString()}>{time(row.timestamp)}</time>
                      {outgoing && row.status !== 'submitted' && <span className={cn(['failed', 'unknown'].includes(row.status) && 'text-destructive')}>{sendLabels[row.status] || row.status}</span>}
                      {row.revokeStatus && revokeLabels[row.revokeStatus] && <Badge variant="secondary">{revokeLabels[row.revokeStatus]}</Badge>}
                      {row.telegramTracked && ['failed','unknown'].includes(row.telegramStatus) && <span className="text-destructive">{syncLabels[row.telegramStatus]}</span>}
                      <MessageActions>
                      {row.telegramTracked && syncLabels[row.telegramStatus] && <span>{syncLabels[row.telegramStatus]}</span>}
                      {canQuote && <Button variant="ghost" size="icon" className="size-6" aria-label="引用回复" onClick={() => setQuote(row)}><Reply /></Button>}
                      {canSync && <Button variant="ghost" size="sm" disabled={busyIds.has(row.id)} onClick={() => action(row, 'sync')}><RefreshCw /> 同步 Telegram</Button>}
                      {canRevoke && <Button variant="ghost" size="sm" disabled={busyIds.has(row.id)} onClick={() => action(row, 'revoke')}><Undo2 /> 撤回</Button>}
                      </MessageActions>
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
    <OfficialAccountMenu token={token} contact={contact} events={events} onAuthError={onAuthError} />
    <MessageComposer token={token} contact={contact} online={online && networkOnline} offlineReason={networkOnline?undefined:'网络已断开，草稿已保留；恢复后请手动发送。'} draft={draft} quote={quote} onClearQuote={clearQuote} onSent={sent} onAuthError={onAuthError} />
  </section>
}

export function MessagesPanel({token, drafts, onLogout, visible = true, miniApp = false, controls, preferences={hiddenCategories:[]}}: {token: string; drafts: Map<string, ComposerDraft>; onLogout: () => void; visible?:boolean; miniApp?:boolean; controls?:ReactNode;preferences?:ChatPreferences}) {
  const [status, setStatus] = useState<MessageStatus | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [active, setActive] = useState<Contact | null>(null)
  const [focused,setFocused] = useState(()=>localStorage.getItem('webui-chat-focus')==='true')
  const [listWidth,setListWidth] = useState(()=>Math.min(440,Math.max(260,Number(localStorage.getItem('webui-chat-list-width')) || 320)))
  const [networkOnline,setNetworkOnline] = useState(navigator.onLine)
  const [navigationId] = useState(createRequestId)
  const knownContacts = useRef(new Map<string,Contact>())
  const root = useRef<HTMLDivElement>(null)
  const selectContact = (contact:Contact)=>{
    knownContacts.current.set(contact.wxId,contact)
    const state={...window.history.state,chatSession:navigationId,chatConversation:contact.wxId}
    if(window.history.state?.chatSession===navigationId && window.history.state?.chatConversation)window.history.replaceState(state,'')
    else window.history.pushState(state,'')
    setActive(contact)
  }
  const back = useCallback(()=>{
    if(document.querySelector('[role="dialog"][data-state="open"]')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return}
    if(window.history.state?.chatSession===navigationId && window.history.state?.chatConversation)window.history.back()
    else setActive(null)
  },[navigationId])
  useEffect(()=>{
    const pop=()=>{if(window.location.pathname!=='/manage')setActive(window.history.state?.chatSession===navigationId ? knownContacts.current.get(window.history.state?.chatConversation) || null : null)}
    window.addEventListener('popstate',pop)
    return()=>window.removeEventListener('popstate',pop)
  },[navigationId])
  useEffect(()=>{
    if(!miniApp || !visible)return
    const button=window.Telegram?.WebApp?.BackButton
    if(active)button?.show();else button?.hide()
    button?.onClick(back)
    return()=>{button?.offClick(back);button?.hide()}
  },[miniApp,visible,Boolean(active),back])
  const toggleFocus=()=>setFocused(current=>{localStorage.setItem('webui-chat-focus',String(!current));return !current})
  const resizeList=(width:number)=>{const bounded=Math.min(440,Math.max(260,width));setListWidth(bounded);localStorage.setItem('webui-chat-list-width',String(bounded))}
  const [query, setQuery] = useState('')
  const [view,setView] = useState<'chats'|'directory'>('chats')
  const [category,setCategory] = useState<ContactCategory|null>(null)
  useEffect(()=>{
    if(category && preferences.hiddenCategories.includes(category))setCategory(null)
    if(active && !isContactVisible(active,preferences))setActive(null)
  },[preferences,category,active])
  const [counts,setCounts] = useState<ContactCounts>()
  const directoryCache = useRef(new Map<string, {contacts:Contact[]; offset:number; hasMore:boolean}>())
  const directoryRevision = useRef(0)
  const kind = view==='chats'?'all':category || 'all'
  const order = view==='directory'?'letter':undefined
  const [loading, setLoading] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const refreshAvatars = useRefreshAvatars()
  const [refreshing,setRefreshing] = useState(false)
  const [refreshFeedback,setRefreshFeedback] = useState<{kind:'success'|'error';message:string}|null>(null)
  const refreshInProgress = useRef(false)
  const refreshContacts = useRef<(()=>void)|null>(null)
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
    if (error instanceof ApiError && error.code !== 'demoReadOnly' && (error.status === 401 || error.status === 403)) expire()
  }, [expire])

  useEffect(()=>{
    const resume=()=>{if(visible && document.visibilityState==='visible')events.emit({event:'ready'})}
    const online=()=>{setNetworkOnline(navigator.onLine);if(navigator.onLine)resume()}
    document.addEventListener('visibilitychange',resume)
    window.addEventListener('online',online);window.addEventListener('offline',online)
    return()=>{document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',online);window.removeEventListener('offline',online)}
  },[visible,events])

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
    directoryCache.current.clear()
    directoryRevision.current++
  }, [token, query, reload, status?.available])

  useEffect(() => events.subscribe(event => {
    if (event.event === 'ready' || event.data.type === 'contacts') {
      directoryCache.current.clear()
      directoryRevision.current++
    }
  }), [events])

  // Counts cover every category for the current search, independent of the
  // expanded category, ordering, or page. Keep them visible while rows reload.
  useEffect(() => {
    setCounts(undefined)
  }, [token, query, status?.available])

  useEffect(()=>{
    if(refreshFeedback?.kind!=='success')return
    const timer=window.setTimeout(()=>setRefreshFeedback(null),5000)
    return()=>window.clearTimeout(timer)
  },[refreshFeedback])

  useEffect(() => {
    refreshInProgress.current=false;setRefreshing(false);setRefreshFeedback(null)
    if (!status?.available) return
    const controller = new AbortController()
    contactRequests.current = controller
    const generation = ++contactGeneration.current
    const directory = order === 'letter'
    const cached = directory ? directoryCache.current.get(kind) : undefined
    const collapsed = directory && kind === 'all'
    setLoading(!cached && !collapsed); setContacts(cached?.contacts || []); setError(''); setHasMore(cached?.hasMore || false); setMoreBusy(false)
    setOffset(cached?.offset || 0)
    contactOffset.current = cached?.offset || 0
    let initial = !cached, manualQueued = false
    let inFlight:AbortController|undefined, initialTimer:number|undefined
    const current = ()=>!controller.signal.aborted && generation===contactGeneration.current
    const queue = createRefreshQueue(async () => {
      const manual = manualQueued;manualQueued=false
      const revision = directoryRevision.current, loadedOffset = contactOffset.current
      const request = new AbortController()
      inFlight=request
      const abort = ()=>request.abort()
      controller.signal.addEventListener('abort',abort,{once:true})
      let timedOut = false
      const deadline=window.setTimeout(()=>{timedOut=true;request.abort()},30000)
      try {
        const first = await messagesApi.contacts(token, query, kind, 0, request.signal, order)
        if(timedOut)throw new Error('Contact refresh timed out')
        if (!current() || request.signal.aborted) return
        const refreshed = [...first.contacts]
        let page = first
        // A manual refresh replaces every loaded page, not just the first 60
        // records. Keep the existing rows/counts until the whole window succeeds.
        while (!initial && page.hasMore && page.offset > 0 && page.offset < loadedOffset) {
          const next = await messagesApi.contacts(token, query, kind, page.offset, request.signal, order)
          if(timedOut)throw new Error('Contact refresh timed out')
          if (!current() || request.signal.aborted) return
          refreshed.push(...next.contacts)
          if (next.offset <= page.offset) break
          page = next
        }
        const contacts = [...new Map(refreshed.map(contact=>[contact.wxId,contact])).values()]
        initial=false
        setContacts(contacts);setCounts(first.countsScope==='cached'?first.counts:undefined)
        setOffset(page.offset);contactOffset.current=page.offset;setHasMore(page.hasMore);setLoading(false)
        if (directory && revision === directoryRevision.current) directoryCache.current.set(kind, {contacts, offset:page.offset, hasMore:page.hasMore})
        setError('')
        if(manual){refreshAvatars();setRefreshFeedback({kind:'success',message:`已重新读取服务端缓存（${new Date().toLocaleTimeString()}）`})}
      } catch(e) {
        if(current() && (!request.signal.aborted || timedOut)) {
          const detail=timedOut?'请求超过 30 秒，请稍后重试。':messageError(e)
          if(manual)setRefreshFeedback({kind:'error',message:`刷新失败：${detail} 已保留原列表。`})
          else if(!manualQueued)setError(detail)
          setLoading(false);onAuthError(e)
        }
      } finally {
        window.clearTimeout(deadline);controller.signal.removeEventListener('abort',abort)
        if(inFlight===request)inFlight=undefined
        if(manual && current()){refreshInProgress.current=false;setRefreshing(false)}
      }
    }, e => {if(current()){setError(messageError(e));setLoading(false);onAuthError(e)}})
    const manualRefresh = ()=>{
      if(!current() || refreshInProgress.current)return
      refreshInProgress.current=true;manualQueued=true
      setRefreshing(true);setRefreshFeedback(null)
      directoryCache.current.clear();directoryRevision.current++
      // Supersede a background load rather than report its old response as a
      // successful click. The queue starts one fresh request after cancellation.
      inFlight?.abort();window.clearTimeout(initialTimer);queue.flush()
    }
    refreshContacts.current=manualRefresh
    const unsubscribe = events.subscribe(event => {
      if (event.event === 'ready' || event.data.type === 'contacts' || (!directory && event.data.type === 'messages')) queue.schedule()
    })
    // Collapsing needs no rows; loaded categories restore their entire paged window.
    initialTimer = !cached && (!collapsed || !directoryCache.current.size)
      ? window.setTimeout(queue.flush, query ? 250 : 0) : undefined
    return () => {
      controller.abort();queue.dispose();unsubscribe();window.clearTimeout(initialTimer);contactGeneration.current++
      if(refreshContacts.current===manualRefresh)refreshContacts.current=null
    }
  }, [token, query, kind, order, reload, status?.available, onAuthError, events, refreshAvatars])

  const more = async () => {
    if (moreBusy || refreshInProgress.current) return
    const generation = contactGeneration.current
    const signal = contactRequests.current?.signal
    const revision = directoryRevision.current
    setMoreBusy(true)
    try {
      const page = await messagesApi.contacts(token, query, kind, offset, signal, order)
      if (signal?.aborted || generation !== contactGeneration.current) return
      if (order === 'letter' && revision !== directoryRevision.current) return
      const previous = directoryCache.current.get(kind)?.contacts || contacts
      const merged = [...new Map([...previous, ...page.contacts].map(contact => [contact.wxId, contact])).values()]
      setContacts(current => order === 'letter' ? merged : [...new Map([...current, ...page.contacts].map(contact => [contact.wxId, contact])).values()]); setOffset(page.offset); contactOffset.current = page.offset; setHasMore(page.hasMore)
      if (order === 'letter' && revision === directoryRevision.current) directoryCache.current.set(kind, {contacts:merged, offset:page.offset, hasMore:page.hasMore})
      setCounts(page.countsScope==='cached'?page.counts:undefined)
    } catch (e) {if (!signal?.aborted && generation === contactGeneration.current) {setError(messageError(e)); onAuthError(e)}}
    finally {if (generation === contactGeneration.current) setMoreBusy(false)}
  }

  const renderContact = (contact:Contact)=><Button key={contact.wxId} variant={active?.wxId===contact.wxId?'secondary':'ghost'} aria-pressed={active?.wxId===contact.wxId} aria-label={contact.name || contact.wxId} className="h-auto w-full justify-start gap-3 whitespace-normal px-3 py-2 text-left md:py-3" onClick={()=>selectContact(contact)}>
    <ContactAvatar token={token} wxId={contact.wxId} name={contact.name} available={contact.hasAvatar} group={contact.kind==='group'} />
    <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="flex items-center justify-between gap-2"><span className="truncate">{contact.name || contact.wxId}</span>{view==='chats' && contact.lastActivity>0 && <span className="shrink-0 text-xs text-muted-foreground">{time(contact.lastActivity)}</span>}</span>
      {view==='chats' && <><span className="truncate text-xs text-muted-foreground">{contact.lastBody || contact.nickname || contact.wxId}</span></>}
    </span>
  </Button>
  const visibleContacts = contacts.filter(contact=>isContactVisible(contact,preferences))
  const contactRows = <>{loading?<div className="flex justify-center p-6"><Spinner /></div>:!visibleContacts.length?<Placeholder title={view==='directory'?'暂无匹配的缓存记录':'暂无可见会话'} detail={status?.directoryAvailable?undefined:'联系人目录尚未加载。'} />:view==='directory'?<LetterContacts contacts={visibleContacts} renderContact={renderContact} />:visibleContacts.map(renderContact)}
    {hasMore && <Button variant="ghost" size="sm" disabled={moreBusy || loading || refreshing} onClick={more}>{moreBusy && <Spinner />} 更多会话</Button>}
  </>
  const liveBadge = <ConnectionBadge state={connection} />
  if (!status?.available) return <div className="flex h-full flex-col gap-4 p-4"><div className="flex items-center gap-2">{controls}{liveBadge}</div>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}{!status && !error?<div className="flex flex-1 items-center justify-center"><Spinner /></div>:<Placeholder title="消息服务未连接" detail="机器人启动后可查看和发送消息。" />}<Button variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw /> 刷新</Button></div>

  return <div ref={root} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" style={{'--chat-list-width':`${listWidth}px`} as CSSProperties}>
    {status.demo && <Alert className="shrink-0 rounded-none border-x-0 border-t-0 py-2" aria-label="演示模式"><AlertDescription>🧪 演示模式 · 示例数据；发送、同步与撤回仅在本地模拟，不连接真实账号，重启后重置。</AlertDescription></Alert>}
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <aside aria-label="会话侧栏" className={cn('flex w-full shrink-0 flex-col border-r md:w-[var(--chat-list-width)]', active && (focused?'hidden':'hidden md:flex'))}>
      <div className="flex shrink-0 flex-col gap-2 border-b p-2 md:p-3">
        <h1 className="sr-only">消息</h1>
        <div className="flex items-center gap-2">
          {controls}
          <Input aria-label={view==='chats'?'搜索会话':'搜索通讯录'} placeholder="搜索联系人、群聊" maxLength={100} value={query} onChange={e => setQuery(e.target.value)} />
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={view==='directory'?'刷新通讯录':'刷新会话'} title="重新读取服务端缓存，不触发微信全量同步" aria-busy={refreshing} disabled={refreshing || moreBusy} onClick={()=>refreshContacts.current?.()}>{refreshing?<Spinner />:<RefreshCw />}</Button>
        </div>
        <div className="flex items-center gap-1">
          <Tabs value={view} onValueChange={value=>{if(value==='chats' || value==='directory')setView(value)}} className="min-w-0 flex-1"><TabsList className="w-full" aria-label="聊天与通讯录"><TabsTrigger value="chats" className="flex-1">聊天</TabsTrigger><TabsTrigger value="directory" className="flex-1">通讯录</TabsTrigger></TabsList></Tabs>
          <ConnectionDetails state={connection} status={status} />
        </div>
      </div>
      {(refreshing || refreshFeedback) && <Alert variant={refreshFeedback?.kind==='error'?'destructive':'default'} className="rounded-none border-x-0 py-2" role={refreshFeedback?.kind==='error'?'alert':'status'} aria-label="联系人刷新状态"><AlertDescription>{refreshing?'正在刷新列表与数量…':refreshFeedback?.message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive" className="rounded-none border-x-0"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="会话列表">
        {view==='directory'?<ContactDirectory category={category} onCategory={setCategory} counts={counts} searching={Boolean(query)} hiddenCategories={preferences.hiddenCategories}>{contactRows}</ContactDirectory>:contactRows}
      </div>
    </aside>
    {!(active && focused) && <div role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={440} aria-valuenow={listWidth} tabIndex={0} className="hidden w-1 shrink-0 cursor-col-resize touch-none bg-border/40 focus-visible:bg-primary md:block" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resizeList(e.clientX-(root.current?.getBoundingClientRect().left || 0))}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resizeList(e.key==='Home'?260:e.key==='End'?440:listWidth+(e.key==='ArrowLeft'?-16:16))}}} />}
    {active ? <Conversation key={active.wxId} token={token} events={events} connection={connection} draft={getDraft(active.wxId)} contact={contacts.find(contact => contact.wxId === active.wxId) || active} online={status.wechatOnline} onBack={back} onAuthError={onAuthError} focused={focused} onFocus={toggleFocus} controls={controls} networkOnline={networkOnline} visible={visible} />
      : <div className="hidden flex-1 md:flex"><Placeholder title="选择一个会话" detail="查看消息或开始聊天。" /></div>}
    </div>
  </div>
}
