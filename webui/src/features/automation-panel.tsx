import {useEffect,useState} from 'react'
import {Button} from '@/components/ui/button'
import {Card,CardHeader,CardTitle,CardDescription,CardContent,CardFooter} from '@/components/ui/card'
import {Field,FieldGroup,FieldLabel,FieldDescription,FieldSet,FieldLegend} from '@/components/ui/field'
import {Input} from '@/components/ui/input'
import {Textarea} from '@/components/ui/textarea'
import {Switch} from '@/components/ui/switch'
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs'
import {Select,SelectContent,SelectGroup,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select'
import {Alert,AlertDescription} from '@/components/ui/alert'
import {Badge} from '@/components/ui/badge'
import {Spinner} from '@/components/ui/spinner'
import {request} from '@/lib/api'
import type {AutomationEvent,AutomationRule,AutomationRun,AutomationScope,AutomationScript,Permission,RuleInput} from '../../../src/automation/contracts'

type Scope = AutomationScope & {name?:string}
interface Metadata {revision:string;scripts:AutomationScript[];rules:AutomationRule[];runs:AutomationRun[];samples:AutomationEvent[];scopes:Scope[];available:boolean;prompt:string;templates:{solitaire:string;reply:string}}
const key = (scope:AutomationScope)=>JSON.stringify([scope.source,scope.accountId,scope.groupId,scope.topicId || ''])
const cleanScope = ({source,accountId,groupId,topicId}:Scope):AutomationScope=>({source,accountId,groupId,...(topicId?{topicId}:{})})
const permissionNames:Record<Permission,string> = {reply:'回复当前群',send:'发送到授权目标群','solitaire.join':'参加微信接龙','solitaire.create':'创建微信接龙',state:'读写本规则持久状态'}
const emptyRule:RuleInput = {name:'新应用规则',scriptId:'',enabled:false,mode:'preview',scopes:[],targets:[],permissions:[],trigger:'all',keyword:'',senders:[],params:{keyword:'午餐',entry:'我的报名内容'},cooldownSeconds:10,maxActionsPerDay:20}
function Dropdown({label,value,items,onChange}:{label:string;value:string;items:Array<{value:string;label:string}>;onChange:(value:string)=>void}) {
  return <Field><FieldLabel>{label}</FieldLabel><Select value={value || '__none__'} onValueChange={value=>onChange(value==='__none__'?'':value)}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="__none__">请选择</SelectItem>{items.map(item=><SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
}
function ScopePicker({label,scopes,value,onChange}:{label:string;scopes:Scope[];value:AutomationScope[];onChange:(scopes:AutomationScope[])=>void}) {
  const [query,setQuery] = useState('')
  const candidates = [...new Map<string,Scope>([...value,...scopes].map(s=>[key(s),s])).values()]
  return <FieldSet><FieldLegend variant="label">{label}</FieldLegend><FieldDescription>精确绑定账号、群和话题；不选择任何群时无法保存。离线或不在目录中的范围不能启用实际执行。</FieldDescription>
    <Input aria-label={'搜索'+label} placeholder="搜索群名、账号或 ID" value={query} onChange={e=>setQuery(e.target.value)} />
    <div className="flex max-h-52 flex-col gap-2 overflow-y-auto">{candidates.filter(s=>JSON.stringify(s).toLowerCase().includes(query.toLowerCase())).map(s=><Field orientation="horizontal" key={key(s)}><FieldLabel className="min-w-0 break-all">{s.source==='wechat'?'微信':'Telegram'} · {s.name || s.groupId}{s.topicId?` / 话题 ${s.topicId}`:''}<span className="text-xs text-muted-foreground">{s.accountId}</span></FieldLabel><Switch aria-label={`${label} ${s.name || s.groupId}`} checked={value.some(v=>key(v)===key(s))} onCheckedChange={checked=>onChange(checked?[...value,cleanScope(s)]:value.filter(v=>key(v)!==key(s)))} /></Field>)}</div>
  </FieldSet>
}
export function AutomationPanel({token}:{token:string}) {
  const [meta,setMeta] = useState<Metadata|null>(null)
  const [tab,setTab] = useState('scripts')
  const [scriptId,setScriptId] = useState(''),[name,setName] = useState('新函数'),[source,setSource] = useState('')
  const [ruleId,setRuleId] = useState(''),[rule,setRule] = useState<RuleInput>({...emptyRule}),[params,setParams] = useState(JSON.stringify(emptyRule.params,null,2))
  const [event,setEvent] = useState(''),[result,setResult] = useState('')
  const [requirement,setRequirement] = useState(''),[showPrompt,setShowPrompt] = useState(false)
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[notice,setNotice] = useState('')
  const current = meta?.scripts.find(s=>s.id===scriptId)
  const dirty = !!source && (source!==current?.draft || name!==current?.name)
  const perform = async <T,>(action:()=>Promise<T>,message='')=>{
    setBusy(true);setError('');setNotice('')
    try {const result=await action();if(message)setNotice(message);return result}
    catch(e){setError(e instanceof Error?e.message:'操作失败')}
    finally {setBusy(false)}
  }
  const reload = ()=>perform(async()=>{const next=await request<Metadata>('/api/automation',token);setMeta(next);return next})
  useEffect(()=>{void request<Metadata>('/api/automation',token).then(next=>{setMeta(next);if(next.scripts[0]){setScriptId(next.scripts[0].id);setName(next.scripts[0].name);setSource(next.scripts[0].draft)}else setSource(next.templates.solitaire)}).catch(e=>setError(e.message))},[token])
  useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
  const mutate = async (body:Record<string,unknown>)=>{
    if(!meta)throw Error('请先加载配置')
    const next=await request<Metadata>('/api/automation',token,{method:'POST',body:JSON.stringify({...body,revision:meta.revision})});setMeta(next);return next
  }
  const chooseScript = (id:string)=>{
    if(dirty && !window.confirm('放弃未保存的函数草稿？'))return
    const script=meta?.scripts.find(s=>s.id===id);setScriptId(id);setName(script?.name || '新函数');setSource(script?.draft || meta?.templates.solitaire || '')
  }
  const chooseRule = (id:string)=>{
    const saved=meta?.rules.find(r=>r.id===id)
    setRuleId(id)
    if(saved){const {id:ignored,version,failures,lastRun,daily,...input}=saved;void ignored;void version;void failures;void lastRun;void daily;setRule(input);setParams(JSON.stringify(saved.params,null,2))}
    else{setRule({...emptyRule,scriptId:scriptId || meta?.scripts[0]?.id || ''});setParams(JSON.stringify(emptyRule.params,null,2))}
  }
  const prepareRule = ():RuleInput=>{
    let values:unknown
    try {values=JSON.parse(params)}catch{throw Error('函数参数必须是 JSON 对象')}
    if(!values || typeof values!=='object' || Array.isArray(values))throw Error('函数参数必须是 JSON 对象')
    return {...rule,params:values as Record<string,unknown>}
  }
  const makeSample = ()=>{
    const scope=rule.scopes[0] || meta?.scopes[0] || {source:'wechat',accountId:'sample-account',groupId:'sample@chatroom'}
    const solitaire=scope.source==='wechat' && rule.trigger!=='message.received' && (rule.trigger==='solitaire.received' || meta?.scripts.find(s=>s.id===rule.scriptId)?.draft.includes('api.solitaire'))
    setEvent(JSON.stringify({...cleanScope(scope),id:'sample-message',type:solitaire?'solitaire.received':'message.received',text:solitaire?'#接龙 午餐':'帮助',sender:{id:'sample-user',name:'测试成员'},timestamp:Date.now(),self:false,...(solitaire?{solitaire:{id:'sample-round',title:'#接龙 午餐',messageId:'9007199254740993123'}}:{})},null,2))
  }
  if(!meta)return <div className="flex flex-col gap-3">{error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>:<Spinner />}</div>
  return <Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>脚本自动化 <Badge variant="outline">开发版</Badge></CardTitle><Button variant="outline" disabled={busy} onClick={()=>void reload()}>刷新配置与记录</Button></div><CardDescription>函数定义逻辑，应用规则定义账号、群、参数和权限。默认模拟；只有明确授权的规则才能真实发送。</CardDescription></CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">
      {!meta.available && <Alert><AlertDescription>当前为离线编辑：可以编写、发布函数和模拟，不能启用实际执行。请在 Bot 登录后刷新目录。</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error==='conflict'?'配置已被另一页面修改，请刷新后核对；当前输入保留。':error}</AlertDescription></Alert>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap"><TabsTrigger value="scripts">函数库</TabsTrigger><TabsTrigger value="rules">应用规则</TabsTrigger><TabsTrigger value="test">模拟测试</TabsTrigger><TabsTrigger value="runs">运行记录</TabsTrigger></TabsList>
        <TabsContent value="scripts">
          <FieldSet disabled={busy}><FieldGroup>
            <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Dropdown label="选择函数" value={scriptId} onChange={chooseScript} items={meta.scripts.map(s=>({value:s.id,label:s.name}))} /></div><Button variant="outline" onClick={()=>chooseScript('')}>新建函数</Button></div>
            <Field><FieldLabel htmlFor="automation-name">函数名称</FieldLabel><Input id="automation-name" value={name} onChange={e=>setName(e.target.value)} maxLength={100} /></Field>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>setSource(meta.templates.solitaire)}>插入自动接龙模板</Button><Button variant="outline" onClick={()=>setSource(meta.templates.reply)}>插入关键词回复模板</Button>{current && current.versions.length>1 && <Button variant="outline" onClick={()=>{if(current)setSource(current.versions[current.versions.length-2].source)}}>上一版恢复为草稿</Button>}</div>
            <Field><FieldLabel htmlFor="automation-source">JavaScript 函数 {dirty && '· 未保存'}</FieldLabel><Textarea id="automation-source" spellCheck={false} className="min-h-72 font-mono" value={source} onChange={e=>setSource(e.target.value)} /><FieldDescription>ES Module：export default async function handler(event, api, params)。无文件、网络、Token、系统命令和 npm 包访问；只有经过授权的接口。</FieldDescription></Field>
            <div className="flex flex-wrap gap-2"><Button onClick={()=>void perform(async()=>{const old=new Set(meta.scripts.map(s=>s.id));const next=await mutate({operation:'saveScript',script:{...(scriptId?{id:scriptId}:{}),name,source}});if(!scriptId)setScriptId(next.scripts.find(s=>!old.has(s.id))?.id || '')},'草稿已保存；线上版本未改变。')}>保存草稿</Button><Button variant="secondary" disabled={!scriptId || dirty} onClick={()=>{if(window.confirm('发布这个函数版本？引用它的规则会被暂停并切回预览，需要重新授权启用。'))void perform(()=>mutate({operation:'publishScript',id:scriptId}),'已发布新版本，关联规则已暂停。')}}>发布函数版本</Button><Button variant="outline" disabled={!scriptId} onClick={()=>{if(window.confirm('删除此函数？被规则引用的函数不能删除。'))void perform(async()=>{await mutate({operation:'deleteScript',id:scriptId});setScriptId('')})}}>删除函数</Button></div>
            <FieldSet><FieldLegend>AI 辅助编写</FieldLegend><FieldDescription>复制完整接口提示词给任意 AI；或使用「AI 配置」里保存的模型生成草稿。生成时只发送你的需求和接口文档，不附带聊天记录、账号令牌或已有脚本，也不会自动发布。</FieldDescription><Field><FieldLabel htmlFor="automation-requirement">我要实现的操作</FieldLabel><Textarea id="automation-requirement" value={requirement} maxLength={4000} placeholder="例如：收到标题含午餐的微信接龙时，按 params.entry 参加；没有稳定标识则停止。" onChange={e=>setRequirement(e.target.value)} /></Field><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>void perform(async()=>{setShowPrompt(true);if(navigator.clipboard)await navigator.clipboard.writeText(meta.prompt+requirement)},'提示词已展开，可复制给 AI。')}>复制 AI 提示词</Button><Button variant="outline" disabled={!requirement.trim()} onClick={()=>void perform(async()=>{const generated=await request<{source:string}>('/api/automation/generate',token,{method:'POST',body:JSON.stringify({requirement})});setSource(generated.source)},'AI 已生成未保存草稿，请检查并模拟测试；尚未发布或启用。')}>用配置的 AI 生成草稿</Button></div>{showPrompt && <Textarea aria-label="完整 AI 提示词" readOnly className="min-h-48 font-mono" value={meta.prompt+requirement} />}</FieldSet>
          </FieldGroup></FieldSet>
        </TabsContent>
        <TabsContent value="rules"><FieldSet disabled={busy}><FieldGroup>
          <div className="flex flex-wrap items-end gap-3"><div className="min-w-48 flex-1"><Dropdown label="选择应用规则" value={ruleId} onChange={chooseRule} items={meta.rules.map(r=>({value:r.id,label:`${r.enabled?'●':'○'} ${r.name} · ${r.mode==='live'?'实际执行':'预览'}`}))} /></div><Button variant="outline" onClick={()=>chooseRule('')}>新建规则</Button></div>
          <Field><FieldLabel htmlFor="automation-rule-name">规则名称</FieldLabel><Input id="automation-rule-name" value={rule.name} onChange={e=>setRule({...rule,name:e.target.value})} /></Field>
          <Dropdown label="使用已发布函数" value={rule.scriptId} onChange={scriptId=>setRule({...rule,scriptId})} items={meta.scripts.filter(s=>s.versions.length).map(s=>({value:s.id,label:s.name}))} />
          <ScopePicker label="监听群组" scopes={meta.available?meta.scopes:[{source:'wechat',accountId:'sample-account',groupId:'sample@chatroom',name:'离线模拟群（不会真实发送）'}]} value={rule.scopes} onChange={scopes=>setRule({...rule,scopes})} />
          <Dropdown label="触发事件" value={rule.trigger} onChange={trigger=>setRule({...rule,trigger:trigger as RuleInput['trigger']})} items={[{value:'all',label:'所有支持的新事件'},{value:'message.received',label:'新文本消息'},{value:'solitaire.received',label:'收到微信原生接龙'}]} />
          <Field><FieldLabel htmlFor="automation-keyword">消息或接龙标题包含</FieldLabel><Input id="automation-keyword" value={rule.keyword} onChange={e=>setRule({...rule,keyword:e.target.value})} placeholder="留空不过滤" /></Field>
          <Field><FieldLabel htmlFor="automation-senders">指定发送者 ID（可选，逗号分隔）</FieldLabel><Input id="automation-senders" value={rule.senders.join(',')} onChange={e=>setRule({...rule,senders:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)})} /></Field>
          <Field><FieldLabel htmlFor="automation-params">此规则的函数参数（JSON）</FieldLabel><Textarea id="automation-params" className="font-mono" value={params} onChange={e=>setParams(e.target.value)} /></Field>
          <FieldSet><FieldLegend variant="label">能力授权</FieldLegend><FieldDescription>代码里的调用不能绕过这里的授权。原生接龙缺少稳定标识时停止，不以文字模拟接龙。</FieldDescription>{(Object.keys(permissionNames) as Permission[]).map(p=><Field orientation="horizontal" key={p}><FieldLabel htmlFor={'automation-permission-'+p}>{permissionNames[p]}</FieldLabel><Switch id={'automation-permission-'+p} checked={rule.permissions.includes(p)} onCheckedChange={checked=>setRule({...rule,permissions:checked?[...rule.permissions,p]:rule.permissions.filter(v=>v!==p)})} /></Field>)}</FieldSet>
          {rule.permissions.includes('send') && <ScopePicker label="允许发送的目标群" scopes={meta.scopes} value={rule.targets} onChange={targets=>setRule({...rule,targets})} />}
          <Field><FieldLabel htmlFor="automation-cooldown">冷却秒数</FieldLabel><Input id="automation-cooldown" type="number" min={0} max={86400} value={rule.cooldownSeconds} onChange={e=>setRule({...rule,cooldownSeconds:Number(e.target.value)})} /></Field>
          <Field><FieldLabel htmlFor="automation-quota">每日最多动作数</FieldLabel><Input id="automation-quota" type="number" min={1} max={500} value={rule.maxActionsPerDay} onChange={e=>setRule({...rule,maxActionsPerDay:Number(e.target.value)})} /></Field>
          <Dropdown label="运行模式" value={rule.mode} onChange={mode=>setRule({...rule,mode:mode as RuleInput['mode']})} items={[{value:'preview',label:'预览：只记录动作，不真正发送'},{value:'live',label:'实际执行：可能发送消息或参加接龙'}]} />
          <Field orientation="horizontal"><FieldLabel htmlFor="automation-enabled">启用此规则</FieldLabel><Switch id="automation-enabled" checked={rule.enabled} onCheckedChange={enabled=>setRule({...rule,enabled})} /></Field>
          <div className="flex flex-wrap gap-2"><Button onClick={()=>void perform(async()=>{const input=prepareRule();const confirmLive=input.enabled && input.mode==='live'?window.confirm('确认允许此规则在所选群内真实发送/接龙？请先完成模拟测试。'):false;if(input.enabled && input.mode==='live' && !confirmLive)return;const old=new Set(meta.rules.map(r=>r.id));const next=await mutate({operation:'saveRule',...(ruleId?{id:ruleId}:{}),rule:input,confirmLive});if(!ruleId)setRuleId(next.rules.find(r=>!old.has(r.id))?.id || '')},'应用规则已保存。')}>保存应用规则</Button><Button variant="outline" onClick={()=>{makeSample();setTab('test')}}>模拟这条规则</Button>{ruleId && <Button variant="outline" onClick={()=>{if(window.confirm('删除这条应用规则？历史去重记录会保留，避免重复报名。'))void perform(async()=>{await mutate({operation:'deleteRule',id:ruleId});chooseRule('')})}}>删除规则</Button>}</div>
        </FieldGroup></FieldSet></TabsContent>
        <TabsContent value="test"><FieldSet disabled={busy}><FieldGroup>
          <Alert><AlertDescription>始终为模拟：不会发消息、参加接龙或更改持久状态。测试使用「应用规则」中当前输入，以及它所选函数的已保存草稿；未保存代码需先保存草稿。</AlertDescription></Alert>
          <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={makeSample}>生成模拟事件</Button></div>
          <Dropdown label="选择最近的真实事件" value="" onChange={id=>{const sample=meta.samples.find((_sample,i)=>String(i)===id);if(sample)setEvent(JSON.stringify(sample,null,2))}} items={meta.samples.map((s,i)=>({value:String(i),label:`${s.source} · ${s.groupId} · ${s.text.slice(0,40)}`}))} />
          <Field><FieldLabel htmlFor="automation-event">测试事件 JSON（可编辑）</FieldLabel><Textarea id="automation-event" spellCheck={false} className="min-h-64 font-mono" value={event} onChange={e=>setEvent(e.target.value)} /></Field>
          <Button onClick={()=>void perform(async()=>{const script=meta.scripts.find(s=>s.id===rule.scriptId);if(!script)throw Error('请先在应用规则选择函数');let input:unknown;try{input=JSON.parse(event)}catch{throw Error('测试事件不是合法 JSON')};const response=await request('/api/automation/test',token,{method:'POST',body:JSON.stringify({...(ruleId?{id:ruleId}:{}),rule:prepareRule(),source:script.draft,event:input})});setResult(JSON.stringify(response,null,2))})}>模拟运行（不会发送）</Button>
          {result && <Field><FieldLabel htmlFor="automation-test-result">动作预览与日志</FieldLabel><Textarea id="automation-test-result" readOnly className="min-h-48 font-mono" value={result} /></Field>}
        </FieldGroup></FieldSet></TabsContent>
        <TabsContent value="runs"><div className="flex flex-col gap-3">{!meta.runs.length && <Alert><AlertDescription>尚无运行记录。保存并启用预览规则后，新消息会在这里显示动作计划；历史消息不会补跑。</AlertDescription></Alert>}{meta.runs.map(run=><Card key={run.id}><CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{run.ruleName}<Badge variant={run.status==='failed' || run.status==='unknown'?'destructive':'secondary'}>{run.status}</Badge></CardTitle><CardDescription>{new Date(run.time).toLocaleString()} · {run.event.source} · {run.event.groupId} · {run.mode}</CardDescription></CardHeader><CardContent><p className="break-all text-sm">{run.error || run.logs.join(' / ') || '执行完成'}</p><Textarea aria-label="运行详情" readOnly className="mt-3 font-mono" value={JSON.stringify({event:run.event,actions:run.actions,logs:run.logs},null,2)} /></CardContent><CardFooter><Button variant="outline" onClick={()=>{setEvent(JSON.stringify(run.event,null,2));chooseRule(run.ruleId);setTab('test')}}>作为模拟输入（不重发）</Button></CardFooter></Card>)}</div></TabsContent>
      </Tabs>
    </CardContent><CardFooter><p className="text-xs text-muted-foreground">接龙按账号/群/轮次持久去重；结果不确定不自动重试。连续失败三次自动暂停。此开发版不支持定时任务、任意 HTTP、文件和系统命令。</p></CardFooter>
  </Card>
}
