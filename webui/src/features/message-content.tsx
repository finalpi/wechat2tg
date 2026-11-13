import {Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Users} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {messagesApi, type ChatMessage, type Transcript} from '@/lib/messages-api'
import {ArticleCards} from './article-cards'
import {MediaAttachment} from './media-attachment'
import {RedPacket} from './red-packet'
import {wechatEmojiByText} from '@/lib/wechat-emoji'

function emojiText(text: string): ReactNode {
  return text.split(/(\[[^\[\]\r\n]{1,30}\])/u).map((part, index) => {
    const emoji = wechatEmojiByText.get(part)
    return emoji ? <img key={index} src={emoji.url} alt={part} title={emoji.name} className="inline-block size-6 align-text-bottom object-contain" /> : part
  })
}

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
  if (format !== 'telegram_html') return <span className="whitespace-pre-wrap break-words">{emojiText(body)}</span>
  const document = new DOMParser().parseFromString(body, 'text/html')
  const render = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return emojiText(node.textContent || '')
    if (!(node instanceof Element)) return null
    const children = Array.from(node.childNodes).map(render)
    switch (node.tagName.toLowerCase()) {
      case 'b': case 'strong': return <strong key={key}>{children}</strong>
      case 'i': case 'em': return <em key={key}>{children}</em>
      case 'u': return <u key={key}>{children}</u>
      case 's': case 'del': return <s key={key}>{children}</s>
      case 'code': return <code key={key}>{node.textContent}</code>
      case 'pre': return <pre key={key} className="overflow-x-auto whitespace-pre-wrap">{node.textContent}</pre>
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
const AvatarRefresh = createContext<()=>void>(()=>undefined)
export const useRefreshAvatars = ()=>useContext(AvatarRefresh)
export function AvatarCacheProvider({token,children}:{token:string;children:ReactNode}) {
  const [revision,setRevision] = useState(0)
  const refresh = useCallback(()=>setRevision(value=>value+1),[])
  const cache = useMemo(()=>new Map<string,AvatarEntry>(),[token,revision])
  useEffect(()=>()=>{cache.forEach(entry=>entry.controller.abort());cache.clear()},[cache])
  return <AvatarRefresh.Provider value={refresh}><AvatarCache.Provider value={cache}>{children}</AvatarCache.Provider></AvatarRefresh.Provider>
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
        {entry.attachmentId && transcript.attachments?.filter(file => String(file.id) === String(entry.attachmentId)).map(file => <MediaAttachment key={file.id} token={token} messageId={messageId} kind={file.type} title={file.title || file.name} transcriptPath={file.path || transcript.path} attachmentId={String(file.id)} />)}
        {entry.nestedId && transcript.children?.filter(child => child.path === entry.nestedId).map(child => <TranscriptView key={child.path} token={token} messageId={messageId} transcript={child} />)}
      </div>) : <span className="whitespace-pre-wrap break-words">{transcript.content}</span>}
      {transcript.attachments?.filter(file => !referencedFiles.has(String(file.id))).map(file => <MediaAttachment key={`${file.path}-${file.id}`} token={token} messageId={messageId} kind={file.type} title={file.title || file.name} transcriptPath={file.path || transcript.path} attachmentId={String(file.id)} />)}
      {transcript.children?.filter(child => !referencedChildren.has(child.path)).map(child => <TranscriptView key={child.path} token={token} messageId={messageId} transcript={child} />)}
      {transcript.truncated && <span className="text-xs text-muted-foreground">记录过长，部分内容未显示。</span>}
    </div>
  </details>
}

export function MessageBody({token, message, onLocate}: {token: string; message: ChatMessage; onLocate: (target: {id?: number; remoteId?: string}) => void}) {
  const mediaLabels: Record<string, string> = {image: '图片', emoji: '表情', video: '视频', voice: '语音', audio: '音频', file: '文件'}
  const quote = message.details?.replyTo
  const articles = message.details?.articles?.length ? message.details.articles : (message.details?.url || message.type==='link' && message.details?.title ? [message.details!] : [])
  return <div className="flex min-w-0 flex-col gap-2">
    {quote && <Button variant="outline" size="sm" className="h-auto min-w-0 justify-start whitespace-normal py-2 text-left" onClick={() => onLocate(quote)}>
      <span className="flex min-w-0 flex-col gap-1"><span>{quote.name || '引用消息'}</span><span className="line-clamp-2 break-words">{quote.preview || '查看原消息'}</span></span>
    </Button>}
    {message.type === 'red_packet' && <RedPacket key={message.id} token={token} message={message} />}
    {message.body && message.type !== 'red_packet' && !message.transcript && !(message.type==='link' && articles.length) && <MessageText body={message.body} format={message.bodyFormat} />}
    {articles.length > 0 && <ArticleCards token={token} articles={articles} />}
    {message.transcript ? <TranscriptView token={token} messageId={message.id} transcript={message.transcript} />
      : message.type === 'chat_histroy' && <span className="text-xs text-muted-foreground">聊天记录暂不可用。</span>}
    {['image', 'emoji', 'video', 'voice', 'audio', 'file'].includes(message.type) && !message.details?.attachmentUnavailable
      && <MediaAttachment token={token} messageId={message.id} kind={message.type} title={message.details?.title || mediaLabels[message.type] || '附件'} />}
    {message.details?.attachmentUnavailable && <span className="text-xs text-muted-foreground">附件暂不可用。</span>}
    {!message.transcript && message.transcriptAttachments?.map(file => <MediaAttachment key={`${file.path}-${file.id}`} token={token} messageId={message.id} kind={file.type} transcriptPath={file.path} attachmentId={String(file.id)} title={file.title || file.name} />)}
  </div>
}
