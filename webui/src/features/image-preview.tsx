import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Download, Maximize, RotateCw, X, ZoomIn, ZoomOut} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {clampImagePan, imageLayout} from '@/lib/image-viewer'
import {cn} from '@/lib/utils'

export function ImagePreview({url, name, emoji = false, onError}: {url: string; name: string; emoji?: boolean; onError?: () => void}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({x: 0, y: 0})
  const [size, setSize] = useState({width: 1, height: 1})
  const [viewport, setViewport] = useState({width: 1, height: 1})
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const drag = useRef<{x: number; y: number; left: number; top: number} | null>(null)
  useEffect(() => {
    if (!stage) return
    const element = stage
    const measure = () => setViewport({width: element.clientWidth, height: element.clientHeight})
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [stage])
  const layout = imageLayout(size.width, size.height, viewport.width, viewport.height, zoom, rotation)
  useLayoutEffect(() => {
    setPan(value => {
      const next = clampImagePan(value.x, value.y, layout.boundsWidth, layout.boundsHeight, viewport.width, viewport.height)
      return next.x === value.x && next.y === value.y ? value : next
    })
  }, [layout.boundsWidth, layout.boundsHeight, viewport])
  const canPan = layout.boundsWidth > viewport.width || layout.boundsHeight > viewport.height
  const reset = () => {setZoom(1); setRotation(0); setPan({x: 0, y: 0})}
  return <Dialog open={open} onOpenChange={value => {setOpen(value); if (value) reset()}}>
    <DialogTrigger asChild>
      <button type="button" className="block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`预览 ${name}`}>
        <img src={url} alt={name} onError={onError} onLoad={event => setSize({width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight})}
          className={cn('block h-auto max-h-80 max-w-full object-contain', emoji ? 'max-h-40 max-w-40' : 'max-w-[min(100%,24rem)]')} />
      </button>
    </DialogTrigger>
    <DialogContent showCloseButton={false} aria-describedby={undefined} data-slot="image-viewer"
      className="flex h-[92dvh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-white/10 bg-zinc-950 p-0 text-zinc-100 sm:max-w-[94vw]">
      <header className="flex min-w-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <DialogTitle className="min-w-0 flex-1 truncate text-sm">{name}</DialogTitle>
        <Button variant="ghost" size="icon" asChild className="shrink-0 hover:bg-white/10 hover:text-white"><a href={url} download={name} aria-label="下载图片"><Download /></a></Button>
        <DialogClose asChild><Button variant="ghost" size="icon" aria-label="关闭预览" className="shrink-0 rounded-full hover:bg-white/10 hover:text-white"><X /></Button></DialogClose>
      </header>
      <div ref={setStage} data-slot="image-viewer-stage" className="relative min-h-0 flex-1 overflow-hidden" style={{touchAction: 'none', cursor: canPan ? 'grab' : 'default'}}
        onDoubleClick={() => setZoom(value => value === 1 ? 2 : 1)}
        onPointerDown={event => {
          if (!canPan || event.button !== 0) return
          drag.current = {x: event.clientX, y: event.clientY, left: pan.x, top: pan.y}
          event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={event => {
          if (!drag.current) return
          setPan(clampImagePan(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y,
            layout.boundsWidth, layout.boundsHeight, viewport.width, viewport.height))
        }} onPointerUp={() => {drag.current = null}} onPointerCancel={() => {drag.current = null}}>
        <div className="pointer-events-none absolute inset-0">
          <img src={url} alt={name} draggable={false} className="absolute left-1/2 top-1/2 max-w-none select-none object-contain"
            style={{width: layout.width, height: layout.height, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg)`}} />
        </div>
      </div>
      <footer className="flex shrink-0 items-center justify-center gap-1 border-t border-white/10 px-2 py-3">
        <Button variant="ghost" size="icon" aria-label="缩小" disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.25))}><ZoomOut /></Button>
        <span className="w-16 text-center text-xs tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" aria-label="放大" disabled={zoom >= 4} onClick={() => setZoom(value => Math.min(4, value + 0.25))}><ZoomIn /></Button>
        <span className="mx-2 h-5 w-px bg-white/15" />
        <Button variant="ghost" size="icon" aria-label="旋转" onClick={() => {setRotation(value => (value + 90) % 360); setPan({x: 0, y: 0})}}><RotateCw /></Button>
        <Button variant="ghost" size="icon" aria-label="适应窗口" onClick={reset}><Maximize /></Button>
      </footer>
    </DialogContent>
  </Dialog>
}
