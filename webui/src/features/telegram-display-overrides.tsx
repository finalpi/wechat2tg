import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {ApiError, request} from '@/lib/api'

type Mode = 'inherit' | 'auto' | 'compatible' | 'enhanced'
type Snapshot = {available: false} | {available: true; revision: string; global: Mode; chats: Record<string, Mode>; envOverridden: boolean}
const endpoint = '/api/config/telegram-display'
const modes: Record<Mode, string> = {inherit: '继承', auto: '自动', compatible: '兼容', enhanced: '增强'}

export function TelegramDisplayOverrides({token}: {token: string}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({available: false})
  const [scope, setScope] = useState('')
  const [mode, setMode] = useState<Mode>('inherit')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void request<Snapshot>(endpoint, token, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted) setSnapshot(data)
    }).catch(() => {if (!controller.signal.aborted) setStatus('无法读取 Telegram 展示覆盖。')})
    return () => controller.abort()
  }, [token])

  function choose(value: string) {
    setScope(value)
    setMode(snapshot.available ? (value ? snapshot.chats[value] : snapshot.global) ?? 'inherit' : 'inherit')
    setStatus('')
  }

  async function save() {
    if (!snapshot.available || busy) return
    const value = scope.trim()
    const chatId = value ? Number(value) : undefined
    if (value && (!/^-?[1-9]\d*$/.test(value) || !Number.isSafeInteger(chatId))) {setStatus('请输入有效的 Telegram 聊天 ID。'); return}
    setBusy(true)
    try {
      setSnapshot(await request<Snapshot>(endpoint, token, {method: 'PATCH', body: JSON.stringify({chatId, mode, revision: snapshot.revision})}))
      setStatus('已保存，立即生效。')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {setSnapshot(await request<Snapshot>(endpoint, token))} catch { /* Keep the current form if refresh fails. */ }
        setStatus('配置已变更，请核对后再保存。')
      } else setStatus('保存失败，原设置未变更。')
    } finally {setBusy(false)}
  }

  return <section className="flex flex-col gap-3">
    <h3 className="text-sm font-medium text-muted-foreground">Telegram 展示覆盖</h3>
    {!snapshot.available ? <p className="text-xs text-muted-foreground">绑定并启动 Telegram 机器人后可管理。</p> : <>
      <p className="text-xs text-muted-foreground">留空编辑全局覆盖；填写聊天 ID 编辑单个聊天。「继承」移除该条覆盖。{snapshot.envOverridden && '全局模式当前由 ENV 覆盖；指定聊天的模式仍单独生效。'}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-2"><Label htmlFor="display-chat-id">Telegram 聊天 ID</Label><Input id="display-chat-id" value={scope} maxLength={17} disabled={busy} onChange={e => choose(e.target.value)} /></div>
        <Select value={mode} onValueChange={(value: Mode) => setMode(value)} disabled={busy}>
          <SelectTrigger aria-label="展示覆盖模式"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(modes).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>保存展示覆盖</Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => choose('')}>全局：{modes[snapshot.global]}</Button>
        {Object.entries(snapshot.chats).map(([id, value]) => <Button type="button" key={id} variant="ghost" size="sm" disabled={busy} onClick={() => choose(id)}>{id}：{modes[value]}</Button>)}
      </div>
    </>}
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
  </section>
}
