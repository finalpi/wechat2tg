import {useState} from 'react'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {Badge} from '@/components/ui/badge'
import {Switch} from '@/components/ui/switch'
import {Label} from '@/components/ui/label'
import {Separator} from '@/components/ui/separator'

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function title(template: string, alias: string, name: string, topic: string, memberName: string): string {
  return String(template || '').replace(/#\[(.*?)\]/g, (match, part: string) => {
    const values: Record<string, string> = {
      member_name: memberName || name,
      alias_first: alias || name || topic,
      alias, name, topic,
    }
    for (const key of ['member_name', 'alias_first', 'alias', 'name', 'topic']) {
      if (part.includes(key)) return values[key] ? part.replaceAll(key, values[key]) : ''
    }
    return match
  })
}

function message(template: string, identity: string, body: string, memberName: string): string {
  return String(template || '').replace(/#\[(.*?)\]/g, (match, part: string) => {
    if (part.includes('member_name')) return memberName ? part.replaceAll('member_name', escapeHtml(memberName)) : ''
    if (part.includes('identity')) return identity ? part.replaceAll('identity', identity) : ''
    if (part.includes('body')) return body ? part.replaceAll('body', body) : ''
    if (part.includes('br')) return part.replaceAll('br', '\n')
    return match
  })
}

type Scenario = 'contact' | 'group' | 'official'

const SCENARIOS: {id: Scenario; label: string}[] = [
  {id: 'contact', label: '联系人'},
  {id: 'group', label: '群聊'},
  {id: 'official', label: '公众号'},
]

export function TemplatePreview({values}: {values: Record<string, string>}) {
  const [scenario, setScenario] = useState<Scenario>('group')
  const [noAlias, setNoAlias] = useState(false)

  const sample = {
    alias: noAlias ? '' : '小林 · 设计',
    name: '林晓',
    memberName: noAlias ? '' : '小林（出行协调）',
    topic: '周末出行计划',
    official: '每日服务通知',
    body: '早上好！明天上午 10 点一起出发吧 ☀️',
  }

  const prefixKey = {contact: 'CONTACT_MESSAGE_GROUP', group: 'ROOM_MESSAGE_GROUP', official: 'OFFICIAL_MESSAGE_GROUP'}[scenario]
  const kind = prefixKey.startsWith('ROOM_') ? 'group' : prefixKey.startsWith('OFFICIAL_') ? 'official' : 'contact'
  const alias = kind === 'official' ? '' : sample.alias
  const name = kind === 'official' ? sample.official : sample.name
  const topic = kind === 'group' ? sample.topic : ''
  const identity = title(values[prefixKey] || '', alias, name, topic, sample.memberName)
  const text = message(values.MESSAGE_DISPLAY || '', identity, sample.body, sample.memberName)
  const preview = text.replace(/<[^>]*>/g, '')

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">实时预览</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {SCENARIOS.map(item => (
            <Badge key={item.id} variant={item.id === scenario ? 'default' : 'outline'} className="cursor-pointer"
              onClick={() => setScenario(item.id)}>
              {item.label}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={noAlias} onCheckedChange={setNoAlias} />
          <Label>测试没有备注 / 群昵称的情况</Label>
        </div>
        <Separator />
        <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{preview || '此模板结果为空。'}</div>
      </CardContent>
    </Card>
  )
}
