import {useEffect,useState} from 'react'
import {ChevronRight,ExternalLink} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Dialog,DialogTrigger,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '@/components/ui/collapsible'
import {messagesApi,type Contact,type OfficialMenuButton,type OfficialMenuResult} from '@/lib/messages-api'
import {createRefreshQueue,type MessageEventHub} from '@/lib/message-events'

const reasons = {event:'事件点击未支持，请在微信操作',miniapp:'小程序需在微信打开',wechat:'微信专属 / 授权操作未支持',unknown:'此菜单类型暂未支持'}
function href(value?:string) {
  if(!value || /[\s\\\u0000-\u001f\u007f]/.test(value))return undefined
  try {
    const url=new URL(value)
    if(!['https:','http:'].includes(url.protocol) || url.username || url.password)return undefined
    return value
  } catch {return undefined}
}
function MenuItems({buttons}:{buttons:OfficialMenuButton[]}) {
  return <div className="flex flex-col gap-2">{buttons.map((button,index)=>{
    if(button.kind==='group')return <Collapsible key={index}>
      <CollapsibleTrigger asChild><Button variant="outline" className="w-full justify-start"><ChevronRight data-icon="inline-start" />{button.name}</Button></CollapsibleTrigger>
      <CollapsibleContent className="pl-3 pt-2"><MenuItems buttons={button.children || []} /></CollapsibleContent>
    </Collapsible>
    const url=button.kind==='url'?href(button.url):undefined
    return <div key={index} className="flex flex-col gap-1">
      {url?<Button variant="outline" asChild className="h-auto min-h-10 w-full justify-between whitespace-normal"><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{button.name}<ExternalLink data-icon="inline-end" /></a></Button>
        :<><Button variant="outline" disabled className="h-auto min-h-10 w-full justify-start whitespace-normal">{button.name}</Button><p className="text-xs text-muted-foreground">{reasons[button.reason || 'unknown']}</p></>}
    </div>
  })}</div>
}

export function OfficialAccountMenu({token,contact,events,onAuthError}:{token:string;contact:Contact;events:MessageEventHub;onAuthError:(error:unknown)=>void}) {
  const [result,setResult]=useState<OfficialMenuResult|null>(null)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    setResult(null);setFailed(false)
    if(contact.kind==='group')return
    const controller=new AbortController()
    const queue=createRefreshQueue(async()=>{
      const next=await messagesApi.officialMenu(token,contact.wxId,controller.signal)
      if(!controller.signal.aborted){setResult(next);setFailed(false)}
    },error=>{if(!controller.signal.aborted){setFailed(true);onAuthError(error)}})
    const unsubscribe=events.subscribe(event=>{if(event.event==='ready' || event.data.type==='contacts')queue.schedule()})
    queue.flush()
    return()=>{controller.abort();queue.dispose();unsubscribe()}
  },[token,contact.wxId,contact.kind,events,onAuthError])
  const known=contact.category==='official' || contact.category==='service'
  if(!result?.available || !result.menu?.buttons.length) {
    if(!known || result?.available || result?.reason==='notOfficial')return null
    return <p className="shrink-0 px-3 py-1 text-xs text-muted-foreground">{failed?'公众号菜单暂不可用':result?.reason==='notSynced'?'公众号菜单尚未同步；没有数据不代表没有菜单':'正在读取已缓存菜单…'}</p>
  }
  return <div className="shrink-0 border-t bg-background px-2 py-1" aria-label="公众号菜单">
    <div className="flex items-center justify-between px-1 pb-1 text-xs text-muted-foreground"><span>公众号菜单</span><span>仅普通网页可打开</span></div>
    <div className="flex gap-1">{result.menu.buttons.map((button,index)=>{
      const url=button.kind==='url'?href(button.url):undefined
      if(url)return <Button key={index} variant="ghost" asChild className="min-w-0 flex-1"><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><span className="truncate">{button.name}</span><ExternalLink data-icon="inline-end" /></a></Button>
      if(button.kind!=='group')return <Button key={index} variant="ghost" disabled title={reasons[button.reason || 'unknown']} className="min-w-0 flex-1"><span className="truncate">{button.name}</span><Badge variant="outline">未支持</Badge></Button>
      return <Dialog key={index}><DialogTrigger asChild><Button variant="ghost" className="min-w-0 flex-1"><span className="truncate">{button.name}</span></Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>{contact.name} · {button.name}</DialogTitle><DialogDescription>菜单来自已同步的公众号资料。只打开普通网页，不代为执行事件、授权或小程序操作。</DialogDescription></DialogHeader>
          <div className="max-h-[55dvh] overflow-y-auto"><MenuItems buttons={button.children || []} /></div>
        </DialogContent>
      </Dialog>
    })}</div>
  </div>
}
