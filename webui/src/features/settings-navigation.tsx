import {useEffect, useState} from 'react'
import {ChevronDown, MessageSquare, Network, Puzzle, Settings, SlidersHorizontal} from 'lucide-react'
import {Button} from '@/components/ui/button'
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@/components/ui/collapsible'
import {Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import type {Group} from '@/lib/api'

const categories = [
  {id:'connection', label:'连接与网络', icon:Network, pages:['connection','proxy']},
  {id:'messages', label:'消息与显示', icon:MessageSquare, pages:['forward','templates','chat-appearance']},
  {id:'extensions', label:'扩展功能', icon:Puzzle, pages:['ai','mcp','automation']},
  {id:'system', label:'系统', icon:SlidersHorizontal, pages:['advanced']},
]
const localPages:Group[] = [
  {id:'chat-appearance',label:'聊天界面',caption:'预览与显示偏好',icon:'message'},
  {id:'automation',label:'自动化',caption:'脚本函数与应用规则',icon:'spark'},
]

export function groupSettingsPages(groups:Group[]) {
  const pagesById = new Map([...groups,...localPages].map(page=>[page.id,page]))
  return categories.map(({pages,...category})=>({...category,pages:pages.flatMap(id=>{
    const page = pagesById.get(id)
    return page ? [page] : []
  })})).filter(category=>category.pages.length)
}

type Category = ReturnType<typeof groupSettingsPages>[number]
type NavigationProps = {categories:Category[]; active:string; onSelect:(page:string)=>void}

function CategoryList({categories,active,onSelect,activeCategory}:NavigationProps & {activeCategory?:string}) {
  const [expanded,setExpanded] = useState(activeCategory)
  useEffect(()=>setExpanded(activeCategory),[activeCategory])
  return <ul className="ml-3 flex flex-col gap-1 border-l pl-2">
    {categories.map(({id,label,icon:Icon,pages})=><li key={id}>
      <Collapsible open={expanded === id} onOpenChange={open=>setExpanded(open ? id : undefined)}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group w-full justify-start">
            <Icon data-icon="inline-start" /> {label}
            <ChevronDown data-icon="inline-end" className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-3 flex flex-col gap-1 border-l pl-2">
            {pages.map(page=><li key={page.id}>
              <Button type="button" size="sm" variant={active === page.id ? 'secondary' : 'ghost'} className="w-full justify-start"
                aria-current={active === page.id ? 'page' : undefined} onClick={()=>onSelect(page.id)}>{page.label}</Button>
            </li>)}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>)}
  </ul>
}

export function DesktopSettingsNavigation({onChat,...props}:NavigationProps & {onChat:()=>void}) {
  const activeCategory = props.categories.find(category=>category.pages.some(page=>page.id === props.active))?.id
  return <nav aria-label="主导航" className="flex flex-col gap-1">
    <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onChat}>
      <MessageSquare data-icon="inline-start" /> 消息管理
    </Button>
    {props.categories.length > 0 && <Collapsible defaultOpen>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="group w-full justify-start">
          <Settings data-icon="inline-start" /> 设置
          <ChevronDown data-icon="inline-end" className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1">
        <CategoryList {...props} activeCategory={activeCategory} />
      </CollapsibleContent>
    </Collapsible>}
  </nav>
}

export function MobileSettingsNavigation({categories,active,onSelect}:NavigationProps) {
  const current = categories.find(category=>category.pages.some(page=>page.id === active))
  if(!current)return null
  return <nav aria-label="设置导航" className="mb-4 grid grid-cols-2 gap-2 md:hidden">
    <Select value={current.id} onValueChange={id=>{
      const category = categories.find(item=>item.id === id)
      if(category)onSelect(category.pages[0].id)
    }}>
      <SelectTrigger aria-label="设置分类" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{categories.map(category=><SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
    <Select value={active} onValueChange={onSelect}>
      <SelectTrigger aria-label="设置页面" className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{current.pages.map(page=><SelectItem key={page.id} value={page.id}>{page.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  </nav>
}
