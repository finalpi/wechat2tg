import {useCallback, useEffect, useRef, useState} from 'react'
import {Download, FileText, Film, ImageIcon, Play, RefreshCw} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Spinner} from '@/components/ui/spinner'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Attachment, AttachmentMedia, AttachmentContent, AttachmentTitle, AttachmentDescription, AttachmentActions} from '@/components/ui/attachment'
import {messagesApi, messageError, type MediaFile} from '@/lib/messages-api'
import {createMediaQueue} from '@/lib/media-queue'
import {ImagePreview} from './image-preview'

const scheduleMedia = createMediaQueue()

export function MediaAttachment({token, messageId, title, kind, transcriptPath, attachmentId}: {
  token: string; messageId: number; title?: string; kind?: string; transcriptPath?: string; attachmentId?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const info = useRef<MediaFile | null>(null)
  const urls = useRef({file: '', poster: ''})
  const [media, setMedia] = useState<MediaFile | null>(null)
  const [url, setUrl] = useState('')
  const [poster, setPoster] = useState('')
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [previewFailed, setPreviewFailed] = useState(false)
  const visual = ['image', 'emoji', 'video'].includes(kind || '')
  const image = media ? media.mime.startsWith('image/') && media.mime !== 'image/svg+xml' : kind === 'image' || kind === 'emoji'
  const video = media ? media.mime.startsWith('video/') : kind === 'video'

  const load = useCallback(async (action: 'preview' | 'open' | 'download') => {
    if (controller.current) return
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError('')
    try {
      await scheduleMedia(async () => {
        if (request.signal.aborted) return
        const file = info.current || (transcriptPath && attachmentId
          ? await messagesApi.transcriptMedia(token, messageId, transcriptPath, attachmentId, request.signal)
          : await messagesApi.media(token, messageId, request.signal))
        if (request.signal.aborted) return
        info.current = file; setMedia(file)
        const videoPreview = action === 'preview' && file.mime.startsWith('video/')
        const imagePreview = file.mime.startsWith('image/') && file.mime !== 'image/svg+xml'
        if (action === 'preview' && !videoPreview && !imagePreview) return
        const target = videoPreview ? 'poster' : 'file'
        if (!urls.current[target]) {
          const path = `/api/media/${encodeURIComponent(file.id)}${videoPreview ? '/thumbnail' : ''}`
          const blob = await messagesApi.blob(token, path, request.signal)
          if (request.signal.aborted) return
          const objectUrl = URL.createObjectURL(blob)
          urls.current[target] = objectUrl
          if (videoPreview) {setPoster(objectUrl); setPreviewFailed(false)} else setUrl(objectUrl)
        }
        if (action === 'open') setPlaying(true)
        if (action === 'download') {
          const link = document.createElement('a')
          link.href = urls.current.file; link.download = file.name
          document.body.append(link); link.click(); link.remove()
        }
      }, request.signal)
    } catch (e) {
      if (!request.signal.aborted) {
        if (action === 'preview' && info.current?.mime.startsWith('video/')) setPreviewFailed(true)
        else setError(messageError(e))
      }
    } finally {
      if (controller.current === request) {controller.current = null; setBusy(false)}
    }
  }, [token, messageId, transcriptPath, attachmentId])

  useEffect(() => {
    info.current = null; setMedia(null); setUrl(''); setPoster(''); setPlaying(false); setError(''); setBusy(false); setPreviewFailed(false)
    let observer: IntersectionObserver | undefined
    if (visual && host.current) {
      if (!('IntersectionObserver' in window)) void load('preview')
      else {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {observer?.disconnect(); void load('preview')}
        }, {rootMargin: '160px'})
        observer.observe(host.current)
      }
    }
    return () => {
      observer?.disconnect(); controller.current?.abort(); controller.current = null
      Object.values(urls.current).forEach(value => {if (value) URL.revokeObjectURL(value)})
      urls.current = {file: '', poster: ''}
    }
  }, [load, visual])

  const download = <Button variant="ghost" size="icon" disabled={busy} aria-label="下载附件" onClick={() => void load('download')}><Download /></Button>
  return <div ref={host} data-slot="media-attachment" data-kind={kind} className="flex min-w-0 max-w-full flex-col gap-2">
    {image && url && !error ? <ImagePreview url={url} name={media?.name || title || '图片'} emoji={kind === 'emoji'} onError={() => setError('图片加载失败，请重试。')} />
      : video ? <div className="w-80 max-w-full overflow-hidden rounded-xl border bg-muted/40">
        {playing && url ? <video src={url} poster={poster || undefined} controls autoPlay playsInline preload="metadata" className="max-h-80 w-full bg-black" onError={() => setError('浏览器无法播放此视频，请下载后查看。')} />
          : <button type="button" aria-label={`播放 ${title || '视频'}`} disabled={busy} onClick={() => void load('open')}
            className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-zinc-900 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            {poster && <img src={poster} alt={title || '视频缩略图'} className="absolute inset-0 size-full object-contain" onError={() => {setPoster(''); setPreviewFailed(true)}} />}
            <span className="relative flex size-12 items-center justify-center rounded-full bg-black/50 ring-1 ring-white/30">{busy ? <Spinner /> : <Play className="ml-0.5 size-5 fill-current" />}</span>
          </button>}
        <div className="flex items-center gap-2 px-3 py-1">
          <Film className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{media?.name || title || '视频'}</span>{download}
        </div>
        {previewFailed && !playing && <p className="px-3 pb-2 text-xs text-muted-foreground">缩略图暂不可用，可点击播放或下载。</p>}
      </div>
      : image && !error ? <div role="status" aria-label="正在加载图片" className="flex h-40 w-48 max-w-full items-center justify-center rounded-xl bg-muted/50"><Spinner /></div>
      : <Attachment state={busy ? 'processing' : error ? 'error' : 'done'}>
        <AttachmentMedia><FileText /></AttachmentMedia>
        <AttachmentContent><AttachmentTitle>{media?.name || title || '附件'}</AttachmentTitle>
          <AttachmentDescription>{media ? `${(media.size / 1024 / 1024).toFixed(1)} MB` : '点击查看或下载'}</AttachmentDescription></AttachmentContent>
        <AttachmentActions>{download}{!url && !error && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load('open')}>{busy ? <Spinner /> : <ImageIcon />} 查看</Button>}</AttachmentActions>
      </Attachment>}
    {url && media?.mime.startsWith('audio/') && <audio src={url} controls preload="metadata" className="max-w-full" />}
    {error && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-2"><span>{error}</span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => {if (image && urls.current.file) {URL.revokeObjectURL(urls.current.file); urls.current.file = ''; setUrl('')} void load(visual ? 'preview' : 'open')}}><RefreshCw className="size-3" />重试</Button>
    </AlertDescription></Alert>}
  </div>
}
