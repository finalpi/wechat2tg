import {useEffect, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Spinner} from '@/components/ui/spinner'
import {api, type McpMetadata} from '@/lib/api'

function TokenRow({role, configured, onAction}: {
  role: 'read' | 'write'
  configured: boolean
  onAction: (action: 'reveal' | 'rotate') => void
}) {
  const label = role === 'write' ? '读写 Token' : '只读 Token'
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {configured ? <Badge variant="secondary">已配置</Badge> : <Badge variant="outline">未配置</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onAction('reveal')}>显示</Button>
        <Button variant="outline" size="sm" onClick={() => onAction('rotate')}>重新生成</Button>
      </div>
    </div>
  )
}

export function McpPanel({token}: {token: string}) {
  const [meta, setMeta] = useState<McpMetadata | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [scriptPath, setScriptPath] = useState('')
  const [revealed, setRevealed] = useState<{role: string; token: string} | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    api.mcpSettings(token).then(data => {
      setMeta(data)
      setEnabled(data.enabled)
      setEndpoint(data.endpoint)
      setScriptPath(data.scriptPath)
    }).catch(e => setError(e.message))
  }, [token])

  const dirty = meta && (enabled !== meta.enabled || endpoint !== meta.endpoint || scriptPath !== meta.scriptPath)
  useEffect(() => {
    if(!dirty && !busy)return
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return()=>window.removeEventListener('beforeunload',warn)
  },[dirty,busy])

  const save = async () => {
    if (!meta || busy) return
    setBusy(true)
    setError('')
    setToast('')
    try {
      const next = await api.mcpUpdate(token, {revision: meta.revision, enabled, endpoint, scriptPath})
      setMeta(next)
      setEnabled(next.enabled)
      setEndpoint(next.endpoint)
      setScriptPath(next.scriptPath)
      setToast('已保存。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。')
    } finally {
      setBusy(false)
    }
  }

  const tokenAction = async (role: 'read' | 'write', action: 'reveal' | 'rotate') => {
    if (!meta || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api.mcpToken(token, {revision: meta.revision, role, action})
      setMeta(result)
      setRevealed({role, token: result.token})
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败。')
    } finally {
      setBusy(false)
    }
  }

  if (!meta) {
    return <div className="flex justify-center p-8">{error ? <Alert variant="destructive" className="max-w-sm"><AlertDescription>{error}</AlertDescription></Alert> : <Spinner />}</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP 接入</CardTitle>
        <CardDescription>供 AI 客户端调用微信功能的接口。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <Label>启用 MCP</Label>
            <p className="text-xs text-muted-foreground">关闭后客户端无法连接。</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy} />
        </div>

        <div className="flex flex-col gap-2">
          <Label>访问地址</Label>
          <Input value={endpoint} placeholder="例如 https://example.com/mcp" onChange={e => setEndpoint(e.target.value)} />
          <p className="text-xs text-muted-foreground">远程访问需 HTTPS 结尾为 /mcp。</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>本地桥接脚本路径</Label>
          <Input value={scriptPath} onChange={e => setScriptPath(e.target.value)} />
        </div>

        <TokenRow role="write" configured={meta.writeConfigured} onAction={action => tokenAction('write', action)} />
        <TokenRow role="read" configured={meta.readConfigured} onAction={action => tokenAction('read', action)} />

        {revealed && (
          <Alert>
            <AlertDescription className="break-all">
              {revealed.role === 'write' ? '读写' : '只读'} Token：<span className="font-mono">{revealed.token}</span>
            </AlertDescription>
          </Alert>
        )}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {toast && <p className="text-sm text-muted-foreground">{toast}</p>}

        <div className="flex justify-end">
          <Button onClick={save} disabled={busy || !dirty}>{busy && <Spinner />} 保存</Button>
        </div>
      </CardContent>
    </Card>
  )
}
