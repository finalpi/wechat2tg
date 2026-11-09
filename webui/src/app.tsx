import {useCallback, useEffect, useMemo, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Spinner} from '@/components/ui/spinner'
import {api, request, ApiError, type ConfigSnapshot, type Field} from '@/lib/api'
import {cn} from '@/lib/utils'
import {McpPanel} from '@/features/mcp-panel'
import {AutomationPanel} from '@/features/automation-panel'
import {AITools} from '@/features/ai-tools'
import {TemplatePreview} from '@/features/template-preview'
import {MessagesPanel} from '@/features/messages-panel'
import {ChatMenu} from '@/features/chat-menu'
import {ChatAppearance} from '@/features/chat-appearance'
import {AvatarCacheProvider} from '@/features/message-content'
import {useChatPreferences} from '@/lib/chat-preferences'
import {usePwa} from '@/lib/use-pwa'
import {useWorkspaceRoute,useWorkspaceViewport,editorsAllowReload} from '@/lib/workspace'
import {telegramLaunch, loadTelegramSDK, connectTelegramAppearance} from '@/lib/telegram-mini-app'
import type {ComposerDraft} from '@/features/message-composer'
import {ArrowLeftRight, Globe, Link2, LogOut, MessageSquare, Moon, Send, SlidersHorizontal, Sparkles, Sun, Type} from 'lucide-react'

type FieldValue = string | number | boolean

const TOKEN_KEY = 'webui-access-token'
const THEME_KEY = 'webui-theme'
const launch = telegramLaunch()
const GROUP_ICONS: Record<string, typeof MessageSquare> = {
  message: MessageSquare,
  link: Link2,
  send: Send,
  type: Type,
  globe: Globe,
  spark: Sparkles,
  sliders: SlidersHorizontal,
}
const TEMPLATE_KEYS = ['CONTACT_MESSAGE', 'OFFICIAL_MESSAGE', 'ROOM_MESSAGE', 'CONTACT_MESSAGE_GROUP', 'OFFICIAL_MESSAGE_GROUP', 'ROOM_MESSAGE_GROUP', 'CREATE_ROOM_NAME', 'CREATE_CONTACT_NAME', 'MESSAGE_DISPLAY']

function Auth({onAuthed}: {onAuthed: (token: string) => void}) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const candidate = token.trim()
    if (!candidate) return
    setBusy(true)
    setError('')
    try {
      await request('/api/messages/status',candidate)
      localStorage.setItem(TOKEN_KEY, candidate)
      onAuthed(candidate)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '登录失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>wechat2tg</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">访问令牌</Label>
              <Input id="token" type="password" value={token} autoFocus autoComplete="current-password"
                placeholder="输入访问令牌" onChange={e => setToken(e.target.value)} />
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" disabled={busy || !token.trim()}>
              {busy && <Spinner />} 进入控制台
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function FieldControl({field, value, onChange, disabled}: {
  field: Field
  value: FieldValue
  onChange: (value: FieldValue) => void
  disabled: boolean
}) {
  if (field.type === 'boolean') {
    return <Switch id={field.key} checked={value === true || value === 'true'} disabled={disabled} onCheckedChange={onChange} />
  }
  if (field.type === 'textarea') {
    return <Textarea id={field.key} value={String(value ?? '')} disabled={disabled} onChange={e => onChange(e.target.value)} />
  }
  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '') || '__direct__'} disabled={disabled} onValueChange={value => onChange(value === '__direct__' ? '' : value)}>
        <SelectTrigger id={field.key} className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>
          {(field.options || []).map(option => (
            <SelectItem key={option} value={option || '__direct__'}>{option || '直连'}</SelectItem>
          ))}
        </SelectGroup></SelectContent>
      </Select>
    )
  }
  if (field.type === 'password') {
    return (
      <Input id={field.key} type="password" value={String(value ?? '')} disabled={disabled} autoComplete="off"
        placeholder={field.required ? '必填' : '留空保持不变'}
        onChange={e => onChange(e.target.value)} />
    )
  }
  if (field.type === 'number') {
    return (
      <Input id={field.key} type="number" value={String(value ?? '')} disabled={disabled} min={field.min} max={field.max}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    )
  }
  return <Input id={field.key} value={String(value ?? '')} disabled={disabled} onChange={e => onChange(e.target.value)} />
}

function Workspace({token, theme, onToggleTheme, onLogout, miniApp = false}: {
  token: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
  miniApp?: boolean
}) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [active, setActive] = useState('connection')
  const {chatOnly,navigate} = useWorkspaceRoute()
  useWorkspaceViewport()
  const [chatMounted,setChatMounted] = useState(chatOnly)
  useEffect(()=>{if(chatOnly)setChatMounted(true)},[chatOnly])
  const selectPage = (page:string)=>{if(page==='messages')navigate(true);else setActive(page)}
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [conflict, setConflict] = useState(false)
  const [messageDrafts] = useState(() => new Map<string, ComposerDraft>())
  const chatPreferences = useChatPreferences()

  const pwa = usePwa({enabled:!miniApp,canReload:()=>!busy && !Object.keys(draft).length && editorsAllowReload()})
  useEffect(() => {
    if (!miniApp || chatOnly) return
    const back = window.Telegram?.WebApp?.BackButton
    const onBack = () => navigate(true)
    back?.show();back?.onClick(onBack)
    return () => {back?.offClick(onBack); back?.hide()}
  }, [miniApp, chatOnly])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy || Object.keys(draft).length || [...messageDrafts.values()].some(draft => draft.body?.trim() || draft.file || draft.attempt || draft.inFlight || draft.quote || draft.selected?.length || draft.all || draft.voice)) {event.preventDefault(); event.returnValue = ''}
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [messageDrafts,draft,busy])

  useEffect(() => {
    if(chatOnly || snapshot)return
    const controller = new AbortController()
    request<ConfigSnapshot>('/api/config',token,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setSnapshot(value);setError('')}}).catch(e => {
      if(controller.signal.aborted)return
      if (e instanceof ApiError && e.code === 'unauthorized') onLogout()
      else setError(e.message)
    })
    return ()=>controller.abort()
  }, [token, onLogout, chatOnly, Boolean(snapshot)])

  const groups = useMemo(() => {
    if (!snapshot) return []
    const wanted = ['messages', 'connection', 'forward', 'templates', 'proxy', 'ai', 'mcp', 'advanced']
    return [...snapshot.groups.filter(group => wanted.includes(group.id)), {id:'chat-appearance',label:'聊天界面',caption:'预览与显示偏好',icon:'message'}, {id:'automation',label:'自动化',caption:'脚本函数与应用规则',icon:'spark'}]
  }, [snapshot])

  const currentValue = (field: Field): FieldValue => {
    const raw = Object.prototype.hasOwnProperty.call(draft, field.key) ? draft[field.key] : snapshot?.values[field.key]
    return typeof raw === 'boolean' || typeof raw === 'number' ? raw : raw === undefined || raw === null ? '' : String(raw)
  }

  const setField = (field: Field, value: FieldValue) => {
    if (busy) return
    const saved = snapshot?.values[field.key]
    const next = {...draft}
    if (String(value) === String(saved) && field.type !== 'password') delete next[field.key]
    else if (field.type === 'password' && value === '') delete next[field.key]
    else next[field.key] = value
    setDraft(next)
  }

  const reloadConfig = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const latest = await api.getConfig(token)
      setSnapshot(latest)
      setConflict(false)
      setToast('已加载最新配置，保留了未保存的输入。请核对后再次保存。')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout()
      setError('重新加载失败，输入已保留，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!snapshot || busy || conflict || !Object.keys(draft).length) return
    setBusy(true)
    setError('')
    setToast('')
    let data = snapshot
    const remaining = {...draft}
    let savedParts = 0
    try {
      for (const source of ['environment', 'runtime'] as const) {
        const values = Object.fromEntries(
          Object.entries(remaining).filter(([key]) => data.fields.some(f => f.key === key && f.source === source)),
        )
        if (!Object.keys(values).length) continue
        // PATCH has no fields/groups. Preserve the GET schema and immediately
        // advance the revision so a later failure cannot replay a saved batch.
        data = {...data, ...await api.patchConfig(token, source, data.revision, values)}
        for (const key of Object.keys(values)) delete remaining[key]
        savedParts++
        setSnapshot(data)
        setDraft({...remaining})
      }
      setConflict(false)
      setToast(data.restartRequired ? '已保存，重启后生效。' : '已保存。')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout()
      const isConflict = e instanceof ApiError && e.code === 'conflict'
      setConflict(isConflict)
      if (savedParts) setToast('部分配置已保存，其余输入已保留。')
      setError(isConflict
        ? '配置已更新，请重新加载配置后核对并保存。未保存的输入已保留。'
        : e instanceof ApiError ? `保存失败（${e.message}），未保存的输入已保留。` : '保存失败，未保存的输入已保留，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const activeGroup = groups.find(group => group.id === active)
  const fields = snapshot?.fields.filter(field => field.group === active) || []
  const environment = fields.filter(field => field.source === 'environment')
  const runtime = fields.filter(field => field.source === 'runtime')
  const aiUrlField = snapshot?.fields.find(field => field.key === 'AI_API_URL')
  const aiModelField = snapshot?.fields.find(field => field.key === 'AI_MODEL')
  const aiUrl = aiUrlField ? String(currentValue(aiUrlField) ?? '') : ''
  const aiModel = aiModelField ? String(currentValue(aiModelField) ?? '') : ''
  const templateValues: Record<string, string> = {}
  for (const key of TEMPLATE_KEYS) {
    const raw = Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : snapshot?.values[key]
    templateValues[key] = typeof raw === 'string' && raw.trim() ? raw : snapshot?.templateDefaults?.[key] || ''
  }

  return (
    <div className={cn('workspace-shell flex min-h-0 flex-col overflow-hidden', miniApp && 'mini-app-shell')} data-workspace={chatOnly?'chat':'manage'}>
      {!chatOnly && <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2 md:h-14 md:px-4">
        <div className="hidden items-center gap-3 md:flex">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowLeftRight className="size-4" />
          </div>
          <span className="font-semibold">wechat2tg</span>
          {snapshot?.runtimeAvailable ? <Badge variant="secondary">运行中</Badge> : <Badge variant="outline">离线</Badge>}
        </div>
        <div className="min-w-0 flex-1 md:hidden">
          <Select value={active} onValueChange={selectPage}>
            <SelectTrigger aria-label="切换页面" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{groups.map(group => {
              const Icon = GROUP_ICONS[group.icon] || MessageSquare
              return <SelectItem key={group.id} value={group.id}><span className="flex items-center gap-2"><Icon className="size-4" />{group.label}</span></SelectItem>
            })}</SelectGroup></SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="返回聊天" title="聊天全屏" onClick={()=>navigate(true)}><MessageSquare /></Button>
          <Button variant="ghost" size="icon" aria-label="切换主题" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" aria-label="退出" onClick={onLogout}><LogOut data-icon="inline-start" /><span className="hidden md:inline">退出</span></Button>
        </div>
      </header>}
      {!chatOnly && snapshot?.demo && <Alert className="shrink-0 rounded-none border-x-0 py-2"><AlertDescription>🧪 演示预览：服务配置只读，不调用真实服务；「聊天界面」显示偏好仍可调整。</AlertDescription></Alert>}
      {!miniApp && pwa.updateReady && <div role="status" className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b bg-background px-3 py-1 text-sm"><span>{pwa.error || '新版本已就绪，当前页面不会自动刷新。'}</span><Button size="sm" variant="outline" onClick={()=>void pwa.applyUpdate()}>更新应用</Button></div>}
      <div className="flex min-h-0 flex-1">
        {!chatOnly && <aside className="hidden w-44 shrink-0 overflow-y-auto border-r p-2 md:block">
          <nav className="flex flex-col gap-1" aria-label="主导航">
            {groups.map(group => {
              const Icon = GROUP_ICONS[group.icon] || MessageSquare
              return (
                <Button key={group.id} variant={group.id === active ? 'secondary' : 'ghost'} size="sm"
                  className="justify-start" onClick={() => selectPage(group.id)}>
                  <Icon className="size-4" /> {group.label}
                </Button>
              )
            })}
          </nav>
        </aside>}

        <main className={cn('min-h-0 min-w-0 flex-1', chatOnly ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6')}>
          <div hidden={!chatOnly} className="h-full min-h-0">
            {chatMounted && <AvatarCacheProvider key={token} token={token}><MessagesPanel preferences={chatPreferences.preferences} token={token} drafts={messageDrafts} onLogout={onLogout} visible={chatOnly} miniApp={miniApp} controls={<ChatMenu theme={theme} onToggleTheme={onToggleTheme} onManage={()=>navigate(false)} onLogout={onLogout} miniApp={miniApp} pwa={pwa} />} /></AvatarCacheProvider>}
          </div>
          <div hidden={chatOnly}>
          {!snapshot ? <div className="flex flex-col items-center gap-3">{error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>:<Spinner />}<Button variant="outline" onClick={()=>void reloadConfig()}>重新加载配置</Button></div> : active === 'chat-appearance' ? <ChatAppearance preferences={chatPreferences.preferences} onChange={chatPreferences.update} error={chatPreferences.error} /> : snapshot.demo && ['automation','mcp'].includes(active) ? <Alert><AlertDescription>演示模式未连接外部服务，此功能暂不可用。</AlertDescription></Alert> : active === 'automation' ? <AutomationPanel token={token} /> : active === 'mcp' ? (
            <McpPanel token={token} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{activeGroup?.label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {environment.length > 0 && (
                  <Section title="环境配置" fields={environment} currentValue={currentValue} setField={setField} busy={busy || Boolean(snapshot.demo)} />
                )}
                {runtime.length > 0 && (
                  <Section title="机器人偏好" fields={runtime} currentValue={currentValue} setField={setField} busy={busy || Boolean(snapshot.demo)} />
                )}
                {active === 'ai' && aiModelField && !snapshot.demo && (
                  <AITools token={token} url={aiUrl} model={aiModel} onModel={model => setField(aiModelField, model)} />
                )}
                {active === 'templates' && <TemplatePreview values={templateValues} />}
                {fields.length === 0 && active !== 'mcp' && <p className="text-sm text-muted-foreground">暂无设置。</p>}
              </CardContent>
            </Card>
          )}
          </div>
        </main>
      </div>

      {!chatOnly && snapshot && !snapshot.demo && active !== 'messages' && active !== 'automation' && active !== 'chat-appearance' && <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex flex-col">
          {snapshot.restartRequired && <span className="text-sm text-amber-600">保存后需重启应用生效</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          {toast && <span className="text-sm text-muted-foreground">{toast}</span>}
        </div>
        <div className="flex items-center gap-2">
          {conflict && <Button variant="outline" disabled={busy} onClick={reloadConfig}>重新加载配置</Button>}
          <Button variant="outline" disabled={busy || !Object.keys(draft).length} onClick={() => {setDraft({}); setToast('')}}>放弃</Button>
          <Button disabled={busy || conflict || !Object.keys(draft).length} onClick={save}>
            {busy && <Spinner />} 保存
          </Button>
        </div>
      </footer>}
    </div>
  )
}

function Section({title, fields, currentValue, setField, busy}: {
  title: string
  fields: Field[]
  currentValue: (field: Field) => FieldValue
  setField: (field: Field, value: FieldValue) => void
  busy: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {fields.map(field => (
        <div key={field.key} className={cn('grid gap-2', field.type === 'boolean' ? 'grid-cols-[1fr_auto] items-center' : '')}>
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.key}>
              {field.label}{field.required && <span className="text-destructive"> *</span>}
            </Label>
            {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
          </div>
          <FieldControl field={field} value={currentValue(field)} disabled={busy}
            onChange={value => setField(field, value)} />
        </div>
      ))}
    </div>
  )
}

function MiniAppLogin({blocked, onAuthed}: {blocked: boolean; onAuthed: (token: string, expiresAt: number) => void}) {
  const [error, setError] = useState('')
  useEffect(() => {
    if (blocked) return
    const controller = new AbortController()
    if (!launch.initData) {setError('请从 Telegram 机器人菜单重新打开控制台。'); return}
    request<{token: string; expiresAt: number}>('/api/auth/telegram', '', {
      method: 'POST', body: JSON.stringify({initData: launch.initData}), signal: controller.signal,
    }).then(session => {if (!controller.signal.aborted) onAuthed(session.token, session.expiresAt)})
      .catch(e => {if (!controller.signal.aborted) setError(e instanceof ApiError && e.status === 403
        ? '仅机器人主人可访问。' : e instanceof ApiError && e.status === 503
          ? 'Mini App 未启用或尚未设置机器人主人，请先完成配置。'
          : 'Telegram 登录校验失败，请关闭后从机器人菜单重新打开。')})
    return () => controller.abort()
  }, [blocked, onAuthed])
  return <div className="mini-app-shell flex items-center justify-center p-4"><Card className="w-full max-w-sm">
    <CardHeader><CardTitle>wechat2tg 控制台</CardTitle></CardHeader>
    <CardContent>{blocked || error
      ? <Alert><AlertDescription>{blocked ? '已退出或登录已失效，请关闭后从机器人菜单重新打开。' : error}</AlertDescription></Alert>
      : <div className="flex items-center gap-2"><Spinner /> 正在验证 Telegram 身份</div>}
    </CardContent>
  </Card></div>
}

export default function App() {
  // Never fall back to a saved browser admin token inside Telegram.
  const [token, setToken] = useState<string>(() => launch.isMiniApp ? '' : localStorage.getItem(TOKEN_KEY) || '')
  const [miniBlocked, setMiniBlocked] = useState(false)
  const [expiresAt, setExpiresAt] = useState(0)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#09090b':'#ffffff')
    if (!launch.isMiniApp) localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    if (!launch.isMiniApp) return
    let disposed = false
    let cleanup: (() => void) | undefined
    loadTelegramSDK().then(app => {if (!disposed) cleanup = connectTelegramAppearance(app, setTheme)}).catch(() => undefined)
    return () => {disposed = true; cleanup?.()}
  }, [])

  const clearSession = useCallback(()=>{
    const state={...window.history.state}
    delete state.chatSession;delete state.chatConversation
    window.history.replaceState(state,'')
    setToken('')
  },[])
  useEffect(()=>{
    if(launch.isMiniApp)return
    const check=()=>{if(token && localStorage.getItem(TOKEN_KEY)!==token)clearSession()}
    window.addEventListener('storage',check);window.addEventListener('pageshow',check)
    return()=>{window.removeEventListener('storage',check);window.removeEventListener('pageshow',check)}
  },[token,clearSession])

  const logout = useCallback(() => {
    if (launch.isMiniApp) {
      setMiniBlocked(true)
      if (token) void request('/api/auth/logout', token, {method: 'POST', body: '{}'}).catch(() => undefined)
    } else localStorage.removeItem(TOKEN_KEY)
    clearSession()
  }, [token,clearSession])
  const miniAuthed = useCallback((value: string, expiry: number) => {setExpiresAt(expiry); setToken(value)}, [])
  useEffect(() => {
    if (!launch.isMiniApp || !token || !expiresAt) return
    const timer = window.setTimeout(logout, Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [token, expiresAt, logout])

  if (!token) return launch.isMiniApp ? <MiniAppLogin blocked={miniBlocked} onAuthed={miniAuthed} /> : <Auth onAuthed={setToken} />
  return (
    <Workspace
      miniApp={launch.isMiniApp}
      token={token}
      theme={theme}
      onToggleTheme={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
      onLogout={logout}
    />
  )
}
