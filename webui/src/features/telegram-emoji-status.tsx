import {useEffect, useRef, useState} from 'react'
import {CheckCircle2, HelpCircle, RefreshCw, ShieldAlert} from 'lucide-react'
import {api, ApiError, type EmojiCapabilityStatus} from '@/lib/api'
import {Badge} from '@/components/ui/badge'
import {Button} from '@/components/ui/button'
import {Spinner} from '@/components/ui/spinner'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'

const reasons = {
  notChecked:'开启原生表情后，首次发送前会自动预检测资格。',
  confirmed:'Telegram 返回了有效的原生自定义表情实体。',
  buttonConfirmed:'按钮图标预检测已确认当前机器人具备自定义表情发送资格。',
  buttonMissing:'按钮图标预检测未保留自定义表情，当前使用兼容展示。',
  missingEntities:'消息已送达，Telegram 返回的消息未完整保留自定义表情。',
  rejected:'Telegram 明确拒绝了原生自定义表情。',
  requestFailed:'请求结果尚未确认，可稍后重新检测。',
  expired:'上次检测已过期，下次发送前将重新检测。',
}

export function TelegramEmojiStatus({token}: {token: string}) {
  const [status, setStatus] = useState<EmojiCapabilityStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    api.emojiCapability(token,controller.signal).then(setStatus).catch(e=>{
      if(!controller.signal.aborted)setError(e instanceof ApiError && e.code === 'telegramOffline' ? 'Telegram 尚未连接。' : '读取检测状态失败。')
    })
    return () => {mounted.current = false;controller.abort()}
  },[token])
  const refresh = async () => {
    setBusy(true);setError('')
    try {const value = await api.emojiCapability(token);if(mounted.current)setStatus(value)}
    catch {if(mounted.current)setError('读取检测状态失败。')}
    finally {if(mounted.current)setBusy(false)}
  }
  const probe = async () => {
    setOpen(false);setBusy(true);setError('')
    try {
      const value = await api.probeEmojiCapability(token)
      if(mounted.current)setStatus(value)
    } catch(e) {
      if(mounted.current)setError(e instanceof ApiError && e.code === 'emojiProbeRateLimited' ? '每分钟可检测一次，请稍后重试。' : '检测请求未确认，请先查看机器人私聊中的消息，再刷新状态。')
    } finally {if(mounted.current)setBusy(false)}
  }
  const Icon = status?.state === 'supported' ? CheckCircle2 : status?.state === 'unsupported' ? ShieldAlert : HelpCircle
  return <section aria-label="Telegram 原生表情能力" className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4">
    <header className="flex flex-wrap items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h3 className="flex-1 text-sm font-medium">原生表情能力</h3>
      <Badge variant="secondary">{status ? {supported:'已确认支持',unsupported:'当前不支持',unknown:'尚未确认'}[status.state] : '未读取'}</Badge>
    </header>
    {status && <>
      <p className="text-sm">{reasons[status.reason]}</p>
      <p className="text-xs text-muted-foreground">{status.checkedAt ? `检测时间 ${new Date(status.checkedAt).toLocaleString()}` : '尚无实际发送记录'} · 按钮预检测在已绑定使用者的机器人私聊完成，正式消息回执继续校验实际能力。</p>
      <p className="text-xs text-muted-foreground">{!status.enabled ? '运行中的原生表情总开关已关闭。' : status.mode === 'compatible' ? '当前私聊使用手动兼容模式。' : status.effective ? '运行中的配置允许自动使用原生表情。' : '当前按兼容方式展示。'} 修改上方配置后需保存并重启。</p>
      {status.lastProbeFailed && <Alert><AlertDescription>本次检测未确认，保留最近仍有效的检测结果。请先查看私聊中的消息。</AlertDescription></Alert>}
    </>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={refresh}><RefreshCw className="size-3" />刷新状态</Button>
      <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" size="sm" disabled={busy || status?.probing || !status?.available}>{busy && <Spinner />}重新检测</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>检测原生表情发送能力</DialogTitle><DialogDescription>将检查当前机器人的自定义表情按钮图标。优先编辑已绑定使用者私聊中的检测控制消息；首次检测会创建一条静音控制消息。每分钟最多一次。</DialogDescription></DialogHeader>
          <DialogFooter><DialogClose asChild><Button variant="outline">取消</Button></DialogClose><Button onClick={probe}>开始预检测</Button></DialogFooter>
        </DialogContent></Dialog>
    </div>
  </section>
}
