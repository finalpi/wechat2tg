import fs from 'node:fs'
import path from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {AI_PROMPT,SandboxResult,AutomationAdapter,AutomationError,AutomationEvent,AutomationRule,AutomationRun,AutomationScript,eventSchema,permissions,REPLY_TEMPLATE,ruleInputSchema,scopeKey,scopeSchema,TEMPLATE} from './contracts'
import {sandbox} from './sandbox'

const clone = <T>(value:T):T => {
    try {return JSON.parse(JSON.stringify(value))} catch {throw new AutomationError('invalidJsonValue')}
}
const validateRule = (input:unknown) => {
    try {return ruleInputSchema.parse(input)} catch (error) {
        if (error instanceof z.ZodError) {
            for (const field of ['scopes','scriptId']) {
                const required = error.issues.some(issue => issue.path.length === 1 && issue.path[0] === field
                    && (issue.code === 'too_small' || (issue.code === 'invalid_type' && issue.received === 'undefined')))
                if (required) throw new AutomationError(field === 'scopes' ? 'scopeRequired' : 'scriptRequired')
            }
        }
        throw error
    }
}
const redact = (value:string) => value.replace(/(?:bot)?\d{6,}:[A-Za-z0-9_-]{20,}/g,'[TOKEN REDACTED]').slice(0,500)
const text = z.string().trim().min(1).max(4000)
const actionSchema = z.discriminatedUnion('kind',[
    z.object({kind:z.literal('reply'),text}).strict(),
    z.object({kind:z.literal('send'),target:scopeSchema,text}).strict(),
    z.object({kind:z.literal('solitaire.join'),solitaireId:z.string().min(1).max(200),entry:text}).strict(),
    z.object({kind:z.literal('solitaire.create'),title:z.string().trim().min(1).max(500),entry:text,tail:z.string().max(500).optional()}).strict(),
])
const resultSchema = z.object({actions:z.array(actionSchema).max(5),logs:z.array(z.string().max(500)).max(20),state:z.record(z.unknown())}).strict()
interface State {
    format:1;scripts:AutomationScript[];rules:AutomationRule[];runs:AutomationRun[];samples:AutomationEvent[];
    claims:Record<string,{status:string;time:number}>;values:Record<string,Record<string,unknown>>
}
const SAMPLE:AutomationEvent = {id:'sample-message',source:'wechat',accountId:'sample-account',groupId:'sample@chatroom',type:'solitaire.received',text:'#接龙 午餐',sender:{id:'sample-user',name:'测试成员'},timestamp:Date.now(),self:false,solitaire:{id:'sample-round',title:'#接龙 午餐',messageId:'9007199254740993123'}}

export class AutomationEngine {
    private data:State
    private queue:Promise<unknown> = Promise.resolve()
    private pending = 0
    constructor(private file:string,private adapter?:AutomationAdapter,private now = () => Date.now()) {
        if (fs.existsSync(file)) {
            if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 16 * 1024 * 1024) throw new AutomationError('automationStorageInvalid',503)
            try {this.data = JSON.parse(fs.readFileSync(file,'utf8'))} catch {throw new AutomationError('automationStorageInvalid',503)}
            if (this.data.format !== 1 || !Array.isArray(this.data.scripts) || !Array.isArray(this.data.rules) || !this.data.claims || !this.data.values || !Array.isArray(this.data.runs) || !Array.isArray(this.data.samples)) throw new AutomationError('automationStorageInvalid',503)
            // An attempt claimed before a crash is not safe to replay.
            for (const claim of Object.values(this.data.claims)) if (claim.status === 'pending') claim.status = 'unknown'
        } else this.data = {format:1,scripts:[],rules:[],runs:[],samples:[],claims:{},values:{}}
    }
    private save() {
        const raw = JSON.stringify(this.data)
        if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw new AutomationError('automationStorageFull',503)
        fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700})
        const temp = this.file + '.' + randomUUID() + '.tmp'
        try {
            const fd = fs.openSync(temp,'wx',0o600)
            try {fs.writeFileSync(fd,raw);fs.fsyncSync(fd)} finally {fs.closeSync(fd)}
            fs.renameSync(temp,this.file)
            const directory = fs.openSync(path.dirname(this.file),'r')
            try {fs.fsyncSync(directory)} finally {fs.closeSync(directory)}
        } finally {if (fs.existsSync(temp)) fs.unlinkSync(temp)}
    }
    private serial<T>(fn:()=>Promise<T>):Promise<T> {
        if (this.pending >= 50) return Promise.reject(new AutomationError('automationBusy',429))
        this.pending++
        const operation = this.queue.then(fn)
        this.queue = operation.then(()=>undefined,()=>undefined)
        return operation.finally(()=>{this.pending--})
    }
    private revision() {
        const rules = this.data.rules.map(value => {
            const rule = {...value}
            delete rule.lastRun;delete rule.daily;delete rule.failures
            return rule
        })
        return createHash('sha256').update(JSON.stringify({scripts:this.data.scripts,rules})).digest('hex')
    }
    private checkRevision(revision:unknown) {if (revision !== this.revision()) throw new AutomationError('conflict',409)}
    async snapshot() {
        let scopes = []
        try {scopes = await this.adapter?.scopes() || []} catch { /* Offline directory is not permission to accept arbitrary destinations. */ }
        return clone({revision:this.revision(),scripts:this.data.scripts,rules:this.data.rules,runs:this.data.runs.slice(-100).reverse(),samples:[...this.data.samples].reverse(),scopes,available:Boolean(this.adapter),permissions,prompt:AI_PROMPT,templates:{solitaire:TEMPLATE,reply:REPLY_TEMPLATE}})
    }
    async command(body:any) {
        return this.serial(async()=>{
            this.checkRevision(body?.revision)
            const previous = clone(this.data)
            try {
                if (body.operation === 'saveScript') {
                    const {id,name,source} = z.object({id:z.string().optional(),name:z.string().trim().min(1).max(100),source:z.string().min(1).max(20000)}).parse(body.script)
                    let script = this.data.scripts.find(s=>s.id === id)
                    if (id && !script) throw new AutomationError('scriptNotFound',404)
                    if (!script) {
                        if (this.data.scripts.length >= 30) throw new AutomationError('tooManyScripts')
                        script = {id:randomUUID(),name,draft:source,versions:[]};this.data.scripts.push(script)
                    } else {script.name = name;script.draft = source}
                } else if (body.operation === 'publishScript') {
                    const script = this.script(body.id)
                    await sandbox(script.draft,SAMPLE,{},[],{},true)
                    const version = (script.versions[script.versions.length - 1]?.version || 0) + 1
                    script.versions.push({version,source:script.draft,createdAt:this.now()})
                    script.versions = script.versions.slice(-5)
                    // Publishing never silently changes already-authorized live behavior.
                    for (const rule of this.data.rules.filter(r=>r.scriptId === script.id)) {rule.enabled = false;rule.mode = 'preview';rule.version = version;rule.failures = 0}
                } else if (body.operation === 'deleteScript') {
                    if (this.data.rules.some(r=>r.scriptId === body.id)) throw new AutomationError('scriptInUse',409)
                    this.data.scripts = this.data.scripts.filter(s=>s.id !== body.id)
                } else if (body.operation === 'saveRule') {
                    const input = validateRule(body.rule)
                    if (Buffer.byteLength(JSON.stringify(input.params)) > 8000) throw new AutomationError('paramsTooLarge')
                    const script = this.script(input.scriptId),version = script.versions[script.versions.length - 1]?.version
                    if (!version) throw new AutomationError('scriptNotPublished')
                    const existing = this.data.rules.find(r=>r.id === body.id)
                    if (body.id && !existing) throw new AutomationError('ruleNotFound',404)
                    if (!existing && this.data.rules.length >= 100) throw new AutomationError('tooManyRules')
                    if (input.enabled && input.mode === 'live') {
                        if (body.confirmLive !== true) throw new AutomationError('liveConfirmationRequired')
                        await this.verifyScopes([...input.scopes,...input.targets])
                    }
                    const rule:AutomationRule = {...input,id:existing?.id || randomUUID(),version,failures:0,lastRun:existing?.lastRun,daily:existing?.daily}
                    if (existing) this.data.rules[this.data.rules.indexOf(existing)] = rule
                    else this.data.rules.push(rule)
                } else if (body.operation === 'deleteRule') {
                    this.data.rules = this.data.rules.filter(r=>r.id !== body.id)
                    delete this.data.values[body.id]
                } else throw new AutomationError('invalidOperation')
                this.save()
            } catch (error) {this.data = previous;throw error}
            return this.snapshot()
        })
    }
    private script(id:string) {
        const script = this.data.scripts.find(s=>s.id === id)
        if (!script) throw new AutomationError('scriptNotFound',404)
        return script
    }
    private async verifyScopes(scopes:Array<z.infer<typeof scopeSchema>>) {
        if (!this.adapter) throw new AutomationError('automationRuntimeUnavailable',503)
        const current = new Set((await this.adapter.scopes()).map(scopeKey))
        if (scopes.some(s=>!current.has(scopeKey(s)))) throw new AutomationError('scopeUnavailable',409)
    }
    private matches(rule:AutomationRule,event:AutomationEvent) {
        return !event.self && rule.scopes.some(s=>scopeKey(s) === scopeKey(event))
            && (rule.trigger === 'all' || rule.trigger === event.type)
            && (!rule.keyword || event.text.includes(rule.keyword) || event.solitaire?.title.includes(rule.keyword))
            && (!rule.senders.length || rule.senders.includes(event.sender.id))
    }
    private validatePlan(rule:AutomationRule,event:AutomationEvent,raw:unknown) {
        // strictNullChecks is disabled in the existing project; Zod still enforces
        // required discriminants at runtime, unlike its inferred optional TS shape.
        const plan = resultSchema.parse(raw) as SandboxResult
        if (Buffer.byteLength(JSON.stringify(plan.state)) > 16000) throw new AutomationError('stateTooLarge')
        const previous = this.data.values[rule.id] || {}
        if (!rule.permissions.includes('state')) {
            if (Object.keys(plan.state).length) throw new AutomationError('permissionDenied:state')
            // Revoking state permission hides it from the worker, without deleting it.
            plan.state = clone(previous)
        }
        for (const action of plan.actions) {
            if (!rule.permissions.includes(action.kind)) throw new AutomationError('permissionDenied:' + action.kind)
            if (action.kind === 'send' && !rule.targets.some(s=>scopeKey(s) === scopeKey(action.target))) throw new AutomationError('targetNotAuthorized')
            if (action.kind.startsWith('solitaire.') && event.source !== 'wechat') throw new AutomationError('solitaireWechatOnly')
            if (action.kind === 'solitaire.join' && (!event.solitaire?.id || event.type !== 'solitaire.received' || action.solitaireId !== event.solitaire.id)) throw new AutomationError('stableSolitaireIdRequired')
        }
        return plan
    }
    async test(body:any) {
        return this.serial(async()=>{
            const event = eventSchema.parse(body.event)
            const rule = validateRule(body.rule)
            const mock = {...rule,id:body.id || 'simulation',version:0,failures:0} as AutomationRule
            const source = z.string().min(1).max(20000).parse(body.source)
            if (!this.matches(mock,event)) return {matched:false,actions:[],logs:['事件未匹配绑定范围、关键词或发送者；没有执行脚本。']}
            const plan = this.validatePlan(mock,event,await sandbox(source,event,rule.params,rule.permissions,clone(this.data.values[mock.id] || {})))
            // No persistence, claims or adapter calls. Manual payloads can NEVER send.
            return {matched:true,...plan,mode:'preview'}
        })
    }
    receive(input:AutomationEvent):Promise<void> {
        return this.serial(async()=>{
            const event = eventSchema.parse(input),time = this.now()
            if (event.self || event.timestamp < time - 5 * 60 * 1000 || event.timestamp > time + 60000) return
            if (!this.data.samples.some(e=>e.id === event.id && scopeKey(e) === scopeKey(event))) {
                this.data.samples.push(clone(event));this.data.samples = this.data.samples.slice(-20)
            }
            for (const rule of this.data.rules.filter(r=>r.enabled && this.matches(r,event))) await this.run(rule,event)
            this.save()
        })
    }
    private async run(rule:AutomationRule,event:AutomationEvent) {
        const time = this.now(),eventKey = createHash('sha256').update(JSON.stringify([rule.id,event.source,event.accountId,event.groupId,event.topicId,event.id])).digest('hex')
        if (this.data.claims['event:' + eventKey]) return
        if (rule.lastRun && time - rule.lastRun < rule.cooldownSeconds * 1000) return
        const record:AutomationRun = {id:randomUUID(),ruleId:rule.id,ruleName:rule.name,time,mode:rule.mode,status:rule.mode === 'preview' ? 'preview' : 'success',event:clone(event),actions:[],logs:[]}
        try {
            const script = this.script(rule.scriptId),source = script.versions.find(v=>v.version === rule.version)?.source
            if (!source) throw new AutomationError('scriptVersionUnavailable')
            const plan = this.validatePlan(rule,event,await sandbox(source,event,rule.params,rule.permissions,clone(this.data.values[rule.id] || {})))
            record.actions = plan.actions;record.logs = plan.logs.map(redact)
            const day = new Date(time).toISOString().slice(0,10)
            if (rule.daily?.day !== day) rule.daily = {day,count:0}
            if (rule.daily.count + plan.actions.length > rule.maxActionsPerDay) throw new AutomationError('dailyActionLimit')
            if (Object.keys(this.data.claims).length >= 20000) throw new AutomationError('claimStoreFull')
            this.data.claims['event:' + eventKey] = {status:'pending',time};rule.lastRun = time
            // Flush BEFORE invoking any external action. A crash may lose a send,
            // but must not silently replay it and duplicate a registration.
            this.save()
            if (rule.mode === 'live') {
                await this.verifyScopes([event,...rule.targets])
                for (let i = 0;i < plan.actions.length;i++) {
                    const action = plan.actions[i]
                    const joinKey = action.kind === 'solitaire.join' ? 'join:' + createHash('sha256').update(JSON.stringify([event.source,event.accountId,event.groupId,event.solitaire.id])).digest('hex') : null
                    if (joinKey && this.data.claims[joinKey]) {record.logs.push('该账号/群/轮次已有参加尝试，已跳过；不确定结果需人工确认。');continue}
                    if (joinKey) this.data.claims[joinKey] = {status:'pending',time}
                    rule.daily.count++;this.save()
                    let outcome
                    try {outcome = await this.adapter.execute(action,event,'automation-' + eventKey + '-' + i)} catch {outcome = {status:'unknown'}}
                    if (joinKey) this.data.claims[joinKey] = {status:outcome.status,time}
                    if (outcome.status !== 'success') {
                        record.status = outcome.status === 'unknown' ? 'unknown' : 'failed'
                        throw new AutomationError(outcome.status === 'unknown' ? 'actionOutcomeUnknown:noAutomaticRetry' : 'actionRejected')
                    }
                }
                this.data.values[rule.id] = plan.state
            } else if (rule.mode === 'preview') record.logs.push('模拟模式：动作与状态均未写入真实账号。')
            rule.failures = 0
            this.data.claims['event:' + eventKey] = {status:record.status,time}
        } catch (error) {
            if (record.status !== 'unknown') record.status = 'failed'
            record.error = redact(error instanceof AutomationError ? error.code : 'scriptOrValidationFailed')
            if (++rule.failures >= 3 || record.status === 'unknown') {rule.enabled = false;record.logs.push('规则已自动暂停，请检查后手动启用。')}
            this.data.claims['event:' + eventKey] = {status:record.status,time}
        }
        // Bound retained message content; no source XML, keys or process env here.
        record.event.text = record.event.text.slice(0,1000)
        this.data.runs.push(record);this.data.runs = this.data.runs.slice(-200)
        this.save()
    }
}