import {Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Download, FileText, ImageIcon, Users, ZoomIn, ZoomOut, RotateCw, Maximize} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Spinner} from '@/components/ui/spinner'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions} from '@/components/ui/attachment'
import {messagesApi, messageError, type ChatMessage, type MediaFile, type Transcript} from '@/lib/messages-api'

export function safeLink(url?: string) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href
  } catch { /* Untrusted message links remain text. */ }
  return undefined
}

/** Telegram's small HTML subset, rendered as React nodes rather than injected markup. */
export function MessageText({body, format}: {body: string; format?: string}) {
  if (format !== 'telegram_html') return <span className="whitespace-pre-wrap break-words">{body}</span>
  const document = new DOMParser().parseFromString(body, 'text/html')
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof Element)) return null
    const children = Array.from(node.childNodes).map(render)
    switch (node.tagName.toLowerCase()) {
      case 'b': case 'strong': return <strong key={key}>{children}</strong>
      case 'i': case 'em': return <em key={key}>{children}</em>
      case 'u': return <u key={key}>{children}</u>
      case 's': case 'del': return <s key={key}>{children}</s>
      case 'code': return <code key={key}>{children}</code>
      case 'pre': return <pre key={key} className="overflow-x-auto whitespace-pre-wrap">{children}</pre>
      case 'blockquote': return <blockquote key={key} className="border-l-2 pl-3">{children}</blockquote>
      case 'br': return <br key={key} />
      case 'img': {
        const src = node.getAttribute('src') || ''
        const alt = node.getAttribute('alt') || ''
        return /^\/assets\/wechat-emoji\/emoji-[a-f0-9]{16}\.(png|webp)$/.test(src)
          ? <img key={key} src={src} alt={alt} className="inline-block size-5 align-text-bottom" /> : alt
      }
      case 'a': {
        const href = safeLink(node.getAttribute('href') || '')
        return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="underline">{children}</a> : <Fragment key={key}>{children}</Fragment>
      }
      case 'script': case 'style': case 'iframe': return null
      default: return <Fragment key={key}>{children}</Fragment>
    }
  }
  return <span className="whitespace-pre-wrap break-words">{Array.from(document.body.childNodes).map(render)}</span>
}

type AvatarEntry = {controller:AbortController; promise:Promise<Blob|null>}
const AvatarCache = createContext<Map<string,AvatarEntry>|null>(null)
export function AvatarCacheProvider({token,children}:{token:string;children:ReactNode}) {
  const cache = useMemo(()=>new Map<string,AvatarEntry>(),[token])
  useEffect(()=>()=>{cache.forEach(entry=>entry.controller.abort());cache.clear()},[cache])
  return <AvatarCache.Provider value={cache}>{children}</AvatarCache.Provider>
}

export function ContactAvatar({token, wxId, name, available, group = false, roomId}: {token: string; wxId: string; name: string; available?: boolean; group?: boolean;roomId?:string}) {
  const cache = useContext(AvatarCache)
  const [url, setUrl] = useState('')
  useEffect(() => {
    setUrl('')
    if (!available || !wxId) return
    const path = `/api/avatar?wxId=${encodeURIComponent(wxId)}${roomId?`&roomId=${encodeURIComponent(roomId)}`:''}`
    let entry = cache?.get(path)
    if (!entry) {
      const controller = new AbortController()
      entry = {controller,promise:messagesApi.blob(token,path,controller.signal).catch(()=>null)}
      if (cache) {if(cache.size>=512)cache.delete(cache.keys().next().value!);cache.set(path,entry)}
    }
    let objectUrl = '', disposed = false
    entry.promise.then(blob => {
      if (disposed || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {disposed=true;if(!cache)entry.controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)}
  }, [token, wxId, available, roomId, cache])
  return <span role="img" aria-label={`${name || '联系人'}的头像`} className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
    {url ? <img src={url} alt="" onError={()=>setUrl('')} className="size-full object-cover" /> : group ? <Users className="size-4" /> : Array.from(name || '?')[0]}
  </span>
}

export function MediaAttachment({token, messageId, title, transcriptPath, attachmentId}: {
  token: string; messageId: number; title?: string; transcriptPath?: string; attachmentId?: string
}) {
  const [media, setMedia] = useState<MediaFile | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => () => {if (url) URL.revokeObjectURL(url)}, [url])
  const load = async () => {
    if (busy || url) return
    setBusy(true); setError('')
    const request = new AbortController()
    controller.current = request
    try {
      const info = transcriptPath && attachmentId
        ? await messagesApi.transcriptMedia(token, messageId, transcriptPath, attachmentId)
        : await messagesApi.media(token, messageId)
      const blob = await messagesApi.blob(token, `/api/media/${encodeURIComponent(info.id)}`, request.signal)
      if (request.signal.aborted) return
      setMedia(info); setUrl(URL.createObjectURL(blob))
    } catch (e) {if (!request.signal.aborted) setError(messageError(e))}
    finally {if (!request.signal.aborted) setBusy(false)}
  }
  return <div className="flex min-w-0 flex-col gap-2">
    <Attachment state={busy ? 'processing' : error ? 'error' : 'done'}>
      <AttachmentMedia><FileText /></AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{media?.name || title || '附件'}</AttachmentTitle>
        <AttachmentDescription>{media ? `${(media.size / 1024 / 1024).toFixed(1)} MB` : '点击查看或下载'}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {url ? <Button variant="ghost" size="icon" asChild><a href={url} download={media?.name || 'attachment'} aria-label="下载附件"><Download /></a></Button>
          : <Button variant="ghost" size="sm" disabled={busy} onClick={load}>{busy ? <Spinner /> : <ImageIcon />} 查看</Button>}
      </AttachmentActions>
    </Attachment>
    {url && media?.mime.startsWith('image/') && media.mime !== 'image/svg+xml' && <ImagePreview url={url} name={media.name} />}
    {url && media?.mime.startsWith('video/') && <video src={url} controls preload="metadata" className="max-h-80 max-w-full rounded-lg" />}
    {url && media?.mime.startsWith('audio/') && <audio src={url} controls preload="metadata" className="max-w-full" />}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>
}

function ImagePreview({url, name}: {url: string; name: string}) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null)
  return <Dialog onOpenChange={open => {if (open) {setZoom(1); setRotation(0)}}}>
    <DialogTrigger asChild><button type="button" className="w-fit rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`预览 ${name}`}><img src={url} alt={name} className="max-h-80 max-w-full rounded-lg object-contain" /></button></DialogTrigger>
    <DialogContent className="flex h-[85dvh] max-w-[95vw] flex-col sm:max-w-[90vw]" aria-describedby={undefined}>
      <DialogHeader><DialogTitle className="truncate pr-8">{name}</DialogTitle></DialogHeader>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="缩小" disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.25))}><ZoomOut /></Button>
        <span className="w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
        <Button variant="outline" size="icon" aria-label="放大" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.25))}><ZoomIn /></Button>
        <Button variant="outline" size="icon" aria-label="旋转" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw /></Button>
        <Button variant="outline" size="icon" aria-label="适应窗口" onClick={() => {setZoom(1); setRotation(0)}}><Maximize /></Button>
      </div>
      <div ref={stage} className="flex min-h-0 flex-1 items-start overflow-auto rounded-lg bg-muted/30" onPointerDown={e => {
        if (zoom <= 1 || !stage.current) return
        drag.current = {x: e.clientX, y: e.clientY, left: stage.current.scrollLeft, top: stage.current.scrollTop}
        e.currentTarget.setPointerCapture(e.pointerId)
      }} onPointerMove={e => {
        if (!drag.current || !stage.current) return
        stage.current.scrollLeft = drag.current.left + drag.current.x - e.clientX
        stage.current.scrollTop = drag.current.top + drag.current.y - e.clientY
      }} onPointerUp={() => {drag.current = null}} onPointerCancel={() => {drag.current = null}}>
        <img src={url} alt={name} draggable={false} className="m-auto max-h-full max-w-full shrink-0 object-contain" style={{transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center'}} />
      </div>
    </DialogContent>
  </Dialog>
}

function TranscriptView({token, messageId, transcript}: {token: string; messageId: number; transcript: Transcript}) {
  const referencedFiles = new Set(transcript.entries?.map(entry => entry.attachmentId).filter(Boolean))
  const referencedChildren = new Set(transcript.entries?.map(entry => entry.nestedId).filter(Boolean))
  return <details className="min-w-0 rounded-md border p-3">
    <summary className="cursor-pointer font-medium">{transcript.title || '聊天记录'}</summary>
    <div className="mt-3 flex flex-col gap-3">
      {transcript.entries?.length ? transcript.entries.map((entry, index) => <div key={`${entry.id}-${index}`} className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-muted-foreground">{entry.sender} {entry.time}</span>
        <span className="whitespace-pre-wrap break-words">{entry.text}</span>
        {safeLink(entry.url) && <a href={safeLink(entry.url)} target="_blank" rel="noreferrer" className="break-all underline">{entry.url}</a>}
        {entry.attachmentId && transcript.attachments?.filter(file => String(file.id) === String(entry.attachmentId)).map(file => <MediaAttachment key={file.id} token={token} messageId={messageId} title={file.title || file.name} transcriptPath={file.path || transcript.path} attachmentId={String(file.id)} />)}
        {entry.nestedId && transcript.children?.filter(child => child.path === entry.nestedId).map(child => <TranscriptView key={child.path} token={token} messageId={messageId} transcript={child} />)}
      </div>) : <span className="whitespace-pre-wrap break-words">{transcript.content}</span>}
      {transcript.attachments?.filter(file => !referencedFiles.has(String(file.id))).map(file => <MediaAttachment key={`${file.path}-${file.id}`} token={token} messageId={messageId} title={file.title || file.name} transcriptPath={file.path || transcript.path} attachmentId={String(file.id)} />)}
      {transcript.children?.filter(child => !referencedChildren.has(child.path)).map(child => <TranscriptView key={child.path} token={token} messageId={messageId} transcript={child} />)}
      {transcript.truncated && <span className="text-xs text-muted-foreground">记录过长，部分内容未显示。</span>}
    </div>
  </details>
}

export function MessageBody({token, message, onLocate}: {token: string; message: ChatMessage; onLocate: (target: {id?: number; remoteId?: string}) => void}) {
  const mediaLabels: Record<string, string> = {image: '图片', emoji: '表情', video: '视频', voice: '语音', audio: '音频', file: '文件'}
  const quote = message.details?.replyTo
  const articles = message.details?.articles || (message.details?.url ? [message.details] : [])
  return <div className="flex min-w-0 flex-col gap-2">
    {quote && <Button variant="outline" size="sm" className="h-auto min-w-0 justify-start whitespace-normal py-2 text-left" onClick={() => onLocate(quote)}>
      <span className="flex min-w-0 flex-col gap-1"><span>{quote.name || '引用消息'}</span><span className="line-clamp-2 break-words">{quote.preview || '查看原消息'}</span></span>
    </Button>}
    {message.body && !message.transcript && <MessageText body={message.body} format={message.bodyFormat} />}
    {articles.map((article, index) => <div key={index} className="flex flex-col gap-1">
      {safeLink(article.url) ? <a href={safeLink(article.url)} target="_blank" rel="noreferrer" className="break-words underline">{article.title || article.url}</a> : article.title}
      {article.description && <span className="text-sm">{article.description}</span>}
    </div>)}
    {message.transcript ? <TranscriptView token={token} messageId={message.id} transcript={message.transcript} />
      : message.type === 'chat_histroy' && <span className="text-xs text-muted-foreground">聊天记录暂不可用。</span>}
    {['image', 'emoji', 'video', 'voice', 'audio', 'file'].includes(message.type) && !message.details?.attachmentUnavailable
      && <MediaAttachment token={token} messageId={message.id} title={message.details?.title || mediaLabels[message.type] || '附件'} />}
    {message.details?.attachmentUnavailable && <span className="text-xs text-muted-foreground">附件暂不可用。</span>}
    {!message.transcript && message.transcriptAttachments?.map(file => <MediaAttachment key={`${file.path}-${file.id}`} token={token} messageId={message.id} transcriptPath={file.path} attachmentId={String(file.id)} title={file.title || file.name} />)}
  </div>
}
