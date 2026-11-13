import {useEffect,useRef,useState} from 'react'
import {Gift} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Alert,AlertDescription} from '@/components/ui/alert'
import {Attachment,AttachmentContent,AttachmentTitle} from '@/components/ui/attachment'
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {messagesApi,messageError,type ChatMessage,type RedPacketResult} from '@/lib/messages-api'

function resultText(result:RedPacketResult) {
  if(result.state === 'received')return `已确认领取 ¥${((result.amountFen || 0) / 100).toFixed(2)}`
  if(result.state === 'opening')return '正在处理，请勿重复打开。'
  if(result.state === 'unknown')return '领取结果未知，请到微信核实；不会自动重复请求。'
  if(result.state === 'unavailable')return result.reason === 'routeUnavailable' ? '当前协议未提供可用的红包领取路由，请在微信打开。' : '微信未确认领取成功，红包可能已领完或过期，请在微信查看。'
  return '打开前需要确认，领取到当前微信账号。'
}

export function RedPacket({token,message}:{token:string;message:ChatMessage}) {
  const packet = message.details?.redPacket
  const [image,setImage] = useState(''),[error,setError] = useState(''),[busy,setBusy] = useState(false),[open,setOpen] = useState(false)
  const [result,setResult] = useState<RedPacketResult|null>(null)
  const target = useRef<HTMLDivElement>(null),active = useRef(true),inFlight = useRef(false),consent = useRef('')
  useEffect(()=>{active.current = true;return()=>{active.current = false}},[])
  useEffect(()=>{
    const controller = new AbortController()
    let objectUrl = '',started = false
    setImage('')
    const load = ()=>{
      if(started || !packet?.coverPath)return
      started = true
      messagesApi.blob(token,`/api/media/red-packet/${message.id}`,controller.signal).then(blob=>{
        if(controller.signal.aborted)return
        objectUrl = URL.createObjectURL(blob);setImage(objectUrl)
      }).catch(()=>undefined)
    }
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))load()},{rootMargin:'200px'})
    if(observer && target.current)observer.observe(target.current);else load()
    return()=>{observer?.disconnect();controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[token,message.id,packet?.coverPath])
  const inspect = async(showConfirmation:boolean)=>{
    if(inFlight.current)return
    inFlight.current = true;setBusy(true);setError('')
    try {
      const value = await messagesApi.redPacket(token,message.id)
      if(active.current){setResult(value);if(showConfirmation && value.canOpen && value.confirmation){consent.current = value.confirmation;setOpen(true)}}
    } catch(e){if(active.current)setError(messageError(e))}
    finally{inFlight.current = false;if(active.current)setBusy(false)}
  }
  const claim = async()=>{
    if(inFlight.current || !consent.current)return
    const confirmation = consent.current
    consent.current = '';inFlight.current = true;setOpen(false);setBusy(true);setError('');setResult({state:'opening',canOpen:false})
    try {const value = await messagesApi.openRedPacket(token,message.id,confirmation);if(active.current)setResult(value)}
    catch(e){if(active.current){setResult({state:'unknown',canOpen:false});setError(messageError(e))}}
    finally{inFlight.current = false;if(active.current)setBusy(false)}
  }
  return <Attachment ref={target} className="w-64 flex-col items-stretch" aria-label="微信红包">
    {image ? <img src={image} alt="红包封面" className="max-h-64 w-full rounded-lg object-contain" onError={()=>setImage('')} /> : <Gift className="size-10 self-center text-muted-foreground" aria-label="红包" />}
    <AttachmentContent><AttachmentTitle>{packet?.title || '微信红包'}</AttachmentTitle></AttachmentContent>
    {result && <p className="text-sm" aria-live="polite">{resultText(result)}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button variant="outline" disabled={busy || !packet?.canOpen || result?.canOpen === false} onClick={()=>void inspect(true)}>打开红包</Button>
    {result && <Button variant="ghost" disabled={busy} onClick={()=>void inspect(false)}>刷新领取状态</Button>}
    {!packet?.canOpen && <p className="text-xs text-muted-foreground">请在微信客户端查看此红包。</p>}
    <Dialog open={open} onOpenChange={value=>{setOpen(value);if(!value)consent.current = ''}}>
      <DialogContent><DialogHeader><DialogTitle>确认打开红包</DialogTitle><DialogDescription>将尝试领取“{packet?.title || '微信红包'}”到当前登录的微信账号。这不是仅查看封面；结果未知时不会重复请求。确认两分钟内有效。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={()=>{consent.current = '';setOpen(false)}}>取消</Button><Button disabled={busy} onClick={()=>void claim()}>确认打开并领取</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Attachment>
}
