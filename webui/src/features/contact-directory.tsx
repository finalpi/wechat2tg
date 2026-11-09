import {Fragment, type ReactNode} from 'react'
import {BookUser, ChevronRight, Eye, EyeOff} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible'
import {Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription} from '@/components/ui/dialog'
import {cn} from '@/lib/utils'
import type {Contact, ContactCategory, ContactCounts} from '@/lib/messages-api'

import {directoryCategories} from '@/lib/chat-preferences'

export function ContactDirectory({category,onCategory,counts,searching,children,hiddenCategories=[],onVisibilityChange}:{
  category:ContactCategory|null; onCategory:(value:ContactCategory|null)=>void; counts?:ContactCounts; searching:boolean; children:ReactNode
  hiddenCategories?:ContactCategory[]; onVisibilityChange?:(category:ContactCategory)=>void
}) {
  return <div className="flex flex-col gap-1" aria-label="通讯录分类">
    <Dialog><DialogTrigger asChild><Button variant="ghost" size="icon" className="self-end" aria-label="通讯录说明" title="通讯录说明"><BookUser /></Button></DialogTrigger>
      <DialogContent><DialogHeader><DialogTitle>通讯录说明</DialogTitle><DialogDescription>这里展示当前账号已缓存的通讯录，不是微信客户端的实时完整目录。</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p>服务号仅根据明确的协议字段识别。其余已识别公众号放在「公众号」，不将缺失字段当作已确认的订阅号类型。</p>
          <p>群聊包含已缓存的群，不等同于「保存到通讯录的群聊」。新的朋友和我的企业尚未接入，不能在这里添加、删除或审批联系人。</p>
          <p>后台同步完成后列表会更新；数量是{searching?'当前搜索匹配的':'当前'}已缓存记录，不能把尚未同步的数据当作不存在。</p>
        </div>
      </DialogContent>
    </Dialog>
    {directoryCategories.filter(item=>onVisibilityChange || !hiddenCategories.includes(item.id)).map(item=><Collapsible key={item.id} open={category===item.id && !hiddenCategories.includes(item.id)} onOpenChange={open=>onCategory(open?item.id:null)}>
      <div className="flex items-center gap-1">
      <div className={cn('min-w-0 flex-1',hiddenCategories.includes(item.id) && 'opacity-40')}>
      <CollapsibleTrigger asChild><Button variant="ghost" className="h-11 w-full justify-start" aria-label={`分类：${item.label}`}>
        <ChevronRight data-icon="inline-start" className={cn('shrink-0 transition-transform',category===item.id && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        <span className="text-muted-foreground" aria-label={`${item.label}已缓存数量`}>{counts?.[item.id] ?? '—'}</span>
      </Button></CollapsibleTrigger>
      </div>
      {onVisibilityChange && <Button variant="ghost" size="icon" aria-label={`${hiddenCategories.includes(item.id)?'显示':'隐藏'}${item.label}`} aria-pressed={!hiddenCategories.includes(item.id)} onClick={()=>onVisibilityChange(item.id)}>{hiddenCategories.includes(item.id)?<EyeOff />:<Eye />}</Button>}
      </div>
      <CollapsibleContent>{category===item.id && children}</CollapsibleContent>
    </Collapsible>)}
    {!onVisibilityChange && hiddenCategories.length===directoryCategories.length && <p className="p-3 text-sm text-muted-foreground">所有分类已隐藏，可在配置的「聊天界面」中恢复。</p>}
    {searching && <p className="px-3 py-2 text-xs text-muted-foreground">当前搜索结果</p>}
  </div>
}

export function LetterContacts({contacts,renderContact}:{contacts:Contact[];renderContact:(contact:Contact)=>ReactNode}) {
  const groups = new Map<string,Contact[]>()
  for(const contact of contacts) {
    const initial=contact.indexLetter || contact.name.charAt(0).toUpperCase()
    const letter=/^[A-Z]$/.test(initial)?initial:'#'
    const rows=groups.get(letter) || []; rows.push(contact); groups.set(letter,rows)
  }
  return <>{[...groups].sort(([a],[b])=>a===b?0:a==='#'?1:b==='#'?-1:a.localeCompare(b)).map(([letter,rows])=><section key={letter} aria-label={`通讯录字母 ${letter}`}>
    <h3 className="px-3 py-2 text-xs text-muted-foreground">{letter}</h3>
    <div className="flex flex-col gap-1">{rows.map(contact=><Fragment key={contact.wxId}>{renderContact(contact)}</Fragment>)}</div>
  </section>)}</>
}
