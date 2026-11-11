import {useState} from 'react'
import {Search, X} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {wechatEmoji} from '@/lib/wechat-emoji'

export function EmojiPicker({onPick, onClose}: {onPick: (text: string) => void; onClose: () => void}) {
  const [query, setQuery] = useState('')
  const filtered = wechatEmoji.filter(emoji => emoji.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section aria-label="微信表情选择器" className="absolute bottom-full left-2 z-20 mb-2 flex w-80 max-w-[calc(100%-1rem)] flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl md:left-4"
    onKeyDown={event => {if (event.key === 'Escape') {event.preventDefault(); onClose()}}}>
    <header className="flex items-center gap-2"><span className="flex-1 text-sm font-medium">微信表情</span><Button variant="ghost" size="icon" aria-label="关闭表情" onClick={onClose}><X /></Button></header>
    <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input autoFocus aria-label="搜索微信表情" placeholder="搜索表情" value={query} maxLength={50} className="pl-9" onChange={event => setQuery(event.target.value)} /></div>
    <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto overscroll-contain">
      {filtered.map(emoji => <button key={emoji.text} type="button" title={emoji.name} aria-label={`插入${emoji.text}`} className="flex aspect-square items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onPick(emoji.text)}>
        <img src={emoji.url} alt={emoji.name} loading="lazy" className="size-8 object-contain" />
      </button>)}
    </div>
    {!filtered.length && <p className="py-4 text-center text-sm text-muted-foreground">未找到表情。</p>}
  </section>
}
