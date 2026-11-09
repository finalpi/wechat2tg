import {useState} from 'react'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Button} from '@/components/ui/button'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Message, MessageContent, MessageHeader} from '@/components/ui/message'
import {Bubble, BubbleContent} from '@/components/ui/bubble'
import {ContactDirectory} from './contact-directory'
import {directoryCategories, type ChatPreferences} from '@/lib/chat-preferences'
import type {ContactCategory} from '@/lib/messages-api'

export function ChatAppearance({preferences,onChange,error}:{preferences:ChatPreferences;onChange:(value:ChatPreferences)=>void;error:string}) {
  const [category,setCategory] = useState<ContactCategory|null>('person')
  const toggle = (id:ContactCategory)=>onChange({hiddenCategories:preferences.hiddenCategories.includes(id)
    ? preferences.hiddenCategories.filter(value=>value!==id) : [...preferences.hiddenCategories,id]})
  return <Card>
    <CardHeader><CardTitle>聊天界面</CardTitle><CardDescription>直接在预览中点击眼睛，选择显示或隐藏分类。即时生效，保存在当前浏览器；不删除联系人，也不影响消息接收和 Telegram 转发。</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-4">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="grid overflow-hidden rounded-lg border md:grid-cols-[minmax(220px,300px)_1fr]" aria-label="聊天界面预览">
        <div className="border-b p-2 md:border-b-0 md:border-r">
          <p className="px-3 py-2 text-sm font-medium">通讯录 · 点击眼睛调整</p>
          <ContactDirectory category={category} onCategory={setCategory} counts={Object.fromEntries(directoryCategories.map(c=>[c.id,3]))} searching={false} hiddenCategories={preferences.hiddenCategories} onVisibilityChange={toggle}>
            <p className="px-8 py-3 text-sm text-muted-foreground">{directoryCategories.find(c=>c.id===category)?.label}示例</p>
          </ContactDirectory>
        </div>
        <div className="flex min-w-0 flex-col gap-5 p-4">
          <p className="text-sm text-muted-foreground">效果预览 · 示例消息，不是真实聊天</p>
          <Message><MessageContent><MessageHeader>小林</MessageHeader><Bubble variant="outline"><BubbleContent>让聊天回归聊天。</BubbleContent></Bubble></MessageContent></Message>
          <Message align="end"><MessageContent><Bubble variant="sent" align="end"><BubbleContent>只留下头像、名字和消息。</BubbleContent></Bubble></MessageContent></Message>
          <p className="text-xs text-muted-foreground">隐藏同时作用于聊天列表和通讯录。回复、同步、撤回等操作在悬停或键盘聚焦时出现；触屏可点击消息操作按钮。排序功能后续再加入。</p>
        </div>
      </div>
      <Button variant="outline" className="self-start" disabled={!preferences.hiddenCategories.length} onClick={()=>onChange({hiddenCategories:[]})}>显示全部分类</Button>
    </CardContent>
  </Card>
}
