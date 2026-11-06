import {useEffect, useMemo, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Spinner} from '@/components/ui/spinner'
import {api, ApiError, type ConfigSnapshot, type Field} from '@/lib/api'
import {cn} from '@/lib/utils'
import {McpPanel} from '@/features/mcp-panel'
import {AITools} from '@/features/ai-tools'
import {TemplatePreview} from '@/features/template-preview'
import {ArrowLeftRight, Globe, Link2, LogOut, MessageSquare, Moon, Send, SlidersHorizontal, Sparkles, Sun, Type} from 'lucide-react'

type FieldValue = string | number | boolean

const TOKEN_KEY = 'webui-access-token'
const THEME_KEY = 'webui-theme'
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
      await api.getConfig(candidate)
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
    return <Switch checked={Boolean(value)} disabled={disabled} onCheckedChange={onChange} />
  }
  if (field.type === 'textarea') {
    return <Textarea value={String(value ?? '')} disabled={disabled} onChange={e => onChange(e.target.value)} />
  }
  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '')} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(field.options || []).map(option => (
            <SelectItem key={option} value={option}>{option || '直连'}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.type === 'password') {
    return (
      <Input type="password" value={String(value ?? '')} disabled={disabled} autoComplete="off"
        placeholder={field.required ? '必填' : '留空保持不变'}
        onChange={e => onChange(e.target.value)} />
    )
  }
  if (field.type === 'number') {
    return (
      <Input type="number" value={String(value ?? '')} disabled={disabled} min={field.min} max={field.max}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    )
  }
  return <Input value={String(value ?? '')} disabled={disabled} onChange={e => onChange(e.target.value)} />
}

function ConfigPanel({token, theme, onToggleTheme, onLogout}: {
  token: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [active, setActive] = useState('connection')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    api.getConfig(token).then(setSnapshot).catch(e => {
      if (e instanceof ApiError && e.code === 'unauthorized') onLogout()
      else setError(e.message)
    })
  }, [token, onLogout])

  const groups = useMemo(() => {
    if (!snapshot) return []
    const wanted = ['connection', 'forward', 'templates', 'proxy', 'ai', 'mcp', 'advanced']
    return snapshot.groups.filter(group => wanted.includes(group.id))
  }, [snapshot])

  const currentValue = (field: Field): FieldValue => {
    const raw = Object.prototype.hasOwnProperty.call(draft, field.key) ? draft[field.key] : snapshot?.values[field.key]
    return raw === undefined || raw === null ? '' : String(raw)
  }

  const setField = (field: Field, value: FieldValue) => {
    const saved = snapshot?.values[field.key]
    const next = {...draft}
    if (String(value) === String(saved) && field.type !== 'password') delete next[field.key]
    else if (field.type === 'password' && value === '') delete next[field.key]
    else next[field.key] = value
    setDraft(next)
  }

  const save = async () => {
    if (!snapshot || busy || !Object.keys(draft).length) return
    setBusy(true)
    setError('')
    setToast('')
    let data = snapshot
    try {
      for (const source of ['environment', 'runtime'] as const) {
        const values = Object.fromEntries(
          Object.entries(draft).filter(([key]) => data.fields.some(f => f.key === key && f.source === source)),
        )
        if (!Object.keys(values).length) continue
        data = await api.patchConfig(token, source, data.revision, values)
      }
      setSnapshot(data)
      setDraft({})
      setToast(data.restartRequired ? '已保存，重启后生效。' : '已保存。')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        {error ? <Alert variant="destructive" className="max-w-sm"><AlertDescription>{error}</AlertDescription></Alert>
          : <Spinner className="size-6 text-muted-foreground" />}
      </div>
    )
  }

  const activeGroup = groups.find(group => group.id === active)
  const fields = snapshot.fields.filter(field => field.group === active)
  const environment = fields.filter(field => field.source === 'environment')
  const runtime = fields.filter(field => field.source === 'runtime')
  const aiUrlField = snapshot.fields.find(field => field.key === 'AI_API_URL')
  const aiModelField = snapshot.fields.find(field => field.key === 'AI_MODEL')
  const aiUrl = aiUrlField ? String(currentValue(aiUrlField) ?? '') : ''
  const aiModel = aiModelField ? String(currentValue(aiModelField) ?? '') : ''
  const templateValues: Record<string, string> = {}
  for (const key of TEMPLATE_KEYS) {
    const raw = Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : snapshot.values[key]
    templateValues[key] = typeof raw === 'string' && raw.trim() ? raw : snapshot.templateDefaults?.[key] || ''
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowLeftRight className="size-4" />
          </div>
          <span className="font-semibold">wechat2tg</span>
          {snapshot.runtimeAvailable ? <Badge variant="secondary">运行中</Badge> : <Badge variant="outline">离线</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="切换主题" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}><LogOut className="size-4" /> 退出</Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-48 shrink-0 border-r p-2">
          <nav className="flex flex-col gap-1">
            {groups.map(group => {
              const Icon = GROUP_ICONS[group.icon] || MessageSquare
              return (
                <Button key={group.id} variant={group.id === active ? 'secondary' : 'ghost'} size="sm"
                  className="justify-start" onClick={() => setActive(group.id)}>
                  <Icon className="size-4" /> {group.label}
                </Button>
              )
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {active === 'mcp' ? (
            <McpPanel token={token} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{activeGroup?.label}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {environment.length > 0 && (
                  <Section title="环境配置" fields={environment} currentValue={currentValue} setField={setField} busy={busy} />
                )}
                {runtime.length > 0 && (
                  <Section title="机器人偏好" fields={runtime} currentValue={currentValue} setField={setField} busy={busy} />
                )}
                {active === 'ai' && aiModelField && (
                  <AITools token={token} url={aiUrl} model={aiModel} onModel={model => setField(aiModelField, model)} />
                )}
                {active === 'templates' && <TemplatePreview values={templateValues} />}
                {fields.length === 0 && active !== 'mcp' && <p className="text-sm text-muted-foreground">暂无设置。</p>}
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      <footer className="flex h-16 items-center justify-between border-t px-4">
        <div className="flex flex-col">
          {snapshot.restartRequired && <span className="text-sm text-amber-600">保存后需重启应用生效</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          {toast && <span className="text-sm text-muted-foreground">{toast}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy || !Object.keys(draft).length} onClick={() => setDraft({})}>放弃</Button>
          <Button disabled={busy || !Object.keys(draft).length} onClick={save}>
            {busy && <Spinner />} 保存
          </Button>
        </div>
      </footer>
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

export default function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  if (!token) return <Auth onAuthed={setToken} />
  return (
    <ConfigPanel
      token={token}
      theme={theme}
      onToggleTheme={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
      onLogout={() => { localStorage.removeItem(TOKEN_KEY); setToken('') }}
    />
  )
}
