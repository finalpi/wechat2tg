import {z} from 'zod'

const id = z.string().trim().min(1).max(200)
export const scopeSchema = z.object({source:z.enum(['wechat','telegram']),accountId:id,groupId:id,topicId:z.string().max(32).optional()}).strict()
export type AutomationScope = z.infer<typeof scopeSchema>
export const permissions = ['reply','send','solitaire.join','solitaire.create','state'] as const
export type Permission = typeof permissions[number]
export const eventSchema = scopeSchema.extend({
    id:id,type:z.enum(['message.received','solitaire.received']),text:z.string().max(16000),
    sender:z.object({id,name:z.string().max(200)}).strict(),timestamp:z.number().finite(),
    self:z.boolean().default(false),solitaire:z.object({id:id.optional(),title:z.string().max(8000),messageId:id}).strict().optional(),
}).strict()
export type AutomationEvent = z.infer<typeof eventSchema>
export const ruleInputSchema = z.object({
    name:z.string().trim().min(1).max(100),scriptId:id,enabled:z.boolean().default(false),mode:z.enum(['preview','live']).default('preview'),
    scopes:z.array(scopeSchema).min(1).max(30),targets:z.array(scopeSchema).max(30).default([]),
    permissions:z.array(z.enum(permissions)).max(5).default([]),trigger:z.enum(['message.received','solitaire.received','all']).default('all'),
    keyword:z.string().max(200).default(''),senders:z.array(id).max(50).default([]),
    params:z.record(z.unknown()).default({}),cooldownSeconds:z.number().int().min(0).max(86400).default(10),
    maxActionsPerDay:z.number().int().min(1).max(500).default(20),
}).strict()
export type RuleInput = z.infer<typeof ruleInputSchema>
export type AutomationRule = RuleInput & {id:string;version:number;failures:number;lastRun?:number;daily?:{day:string;count:number}}
export interface ScriptVersion {version:number;source:string;createdAt:number}
export interface AutomationScript {id:string;name:string;draft:string;versions:ScriptVersion[]}
export interface AutomationAction {kind:'reply'|'send'|'solitaire.join'|'solitaire.create';text?:string;target?:AutomationScope;solitaireId?:string;title?:string;entry?:string;tail?:string}
export interface SandboxResult {actions:AutomationAction[];logs:string[];state:Record<string,unknown>}
export interface ActionOutcome {status:'success'|'unknown'|'rejected'}
export interface AutomationAdapter {
    scopes():Promise<Array<AutomationScope & {name:string}>>
    execute(action:AutomationAction,event:AutomationEvent,requestId:string):Promise<ActionOutcome>
}
export interface AutomationRun {
    id:string;ruleId:string;ruleName:string;time:number;mode:'preview'|'live';status:'preview'|'success'|'skipped'|'failed'|'unknown';
    event:AutomationEvent;actions:AutomationAction[];logs:string[];error?:string
}
export function scopeKey(scope:AutomationScope):string {return JSON.stringify([scope.source,scope.accountId,scope.groupId,scope.topicId || ''])}
export interface AutomationScopeIssue {path:['scopes'|'targets',number,'accountId'|'groupId'];code:'required'}
export class AutomationError extends Error {
    constructor(public code:string,public status = 400,public issues?:AutomationScopeIssue[]){super(code)}
}
export const TEMPLATE = `export default async function handler(event, api, params) {
  if (event.type !== "solitaire.received") return;
  if (!event.solitaire.title.includes(params.keyword || "接龙")) return;
  if (!event.solitaire.id) { api.log("缺少稳定接龙标识，转人工确认"); return; }
  await api.solitaire.join({ solitaireId: event.solitaire.id, entry: params.entry || "我的报名内容" });
}`
export const REPLY_TEMPLATE = `export default async function handler(event, api, params) {
  if (event.text.trim() === (params.keyword || "帮助")) {
    await api.replyText(params.reply || "收到，稍后处理。");
  }
}`
export const AI_PROMPT = `你正在为 wechat2tg 自动化编写 JavaScript ES Module。只输出代码，不要 Markdown 围栏。
入口必须为 export default async function handler(event, api, params)。
event: {id,source:"wechat"|"telegram",accountId,groupId,topicId?,type:"message.received"|"solitaire.received",text,sender:{id,name},timestamp,self,solitaire?:{id?:稳定轮次标识,title,messageId}}。
params 是规则页面配置的 JSON 参数。不要在代码里写账号密钥。
可用 API（返回值只代表动作已排入预览计划，不能用于判断远端发送成功）：
await api.replyText(text)；await api.sendText({source,accountId,groupId,topicId?},text)；
await api.solitaire.join({solitaireId:event.solitaire.id,entry:"参加内容"})；
await api.solitaire.create({title:"标题",entry:"首条",tail?:"结尾"})；
api.state.get(key)；api.state.set(key,JSON值)；api.log(字符串)。
所有动作都受绑定群、账号、话题、能力授权、冷却和每日限额约束。sendText 只能发到规则授权的目标。
接龙仅支持微信原生卡片，不以纯文字冒充；缺少稳定轮次标识必须停止并记录日志，不得用消息ID/标题猜轮次。每账号/群/轮次的参加尝试由宿主持久化去重，不确定结果不自动重试。
脚本在独立 QuickJS/WASM 工作线程中运行，没有 process、require、fetch、网络、文件系统、定时器或第三方 npm 包。不要 import。仅能生成动作计划；不允许绕过授权。代码不能看到 Token 或原始协议 XML。
执行预算约200ms、QuickJS堆16MiB、最多5个动作/20条日志、状态JSON最多16KiB；不支持长期任务或等待外部事件。
先模拟测试。不得声称动作已经真实发送。新规则默认预览；发布脚本会把引用规则重新切回未启用预览。
请根据下面需求生成代码，并把可配置内容放进 params：\n`