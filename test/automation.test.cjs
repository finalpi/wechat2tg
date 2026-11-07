/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {once} = require('node:events')
const {AutomationEngine} = require('../dist/automation/engine')
const {sandbox} = require('../dist/automation/sandbox')
const {TEMPLATE,AI_PROMPT} = require('../dist/automation/contracts')
const {nativeSolitaire,emitWechatAutomation,emitTelegramAutomation,listenAutomations} = require('../dist/automation/events')
const {createWebUIServer} = require('../dist/webui/server')
const {createAIConnector} = require('../dist/webui/ai-connector')
const scope = {source:'wechat',accountId:'self',groupId:'room@chatroom'}
const event = (extra = {})=>({...scope,id:'9007199254740993123',type:'solitaire.received',text:'午餐',sender:{id:'sender',name:'成员'},timestamp:Date.now(),self:false,solitaire:{id:'round-1',title:'午餐',messageId:'9007199254740993123'},...extra})
async function fixture(t,source = TEMPLATE,outcome = 'success'){
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'automation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const calls = [],adapter = {scopes:async()=>[{...scope,name:'测试群'}],execute:async(...args)=>{calls.push(args);return {status:outcome}}}
 const file = path.join(dir,'automation.json'),engine = new AutomationEngine(file,adapter)
 let meta = await engine.snapshot()
 meta = await engine.command({revision:meta.revision,operation:'saveScript',script:{name:'测试脚本',source}})
 const id = meta.scripts[0].id
 meta = await engine.command({revision:meta.revision,operation:'publishScript',id})
 const rule = {name:'接龙',scriptId:id,enabled:true,mode:'live',scopes:[scope],targets:[],permissions:['solitaire.join'],trigger:'all',keyword:'',senders:[],params:{keyword:'午餐',entry:'报名'},cooldownSeconds:0,maxActionsPerDay:20}
 return {dir,file,engine,calls,adapter,id,rule,save:async(patch = {},extra = {})=>engine.command({revision:(await engine.snapshot()).revision,operation:'saveRule',rule:{...rule,...patch},confirmLive:true,...extra})}
}

test('QuickJS async script produces a plan, with no Node globals or process secrets',async()=>{
 const result = await sandbox('export default async function(e,api){api.log([typeof process,typeof require,typeof fetch,typeof setTimeout].join(",")); await api.replyText(e.text)}',event(),{},['reply'])
 assert.deepEqual(result.logs,['undefined,undefined,undefined,undefined'])
 assert.deepEqual(result.actions,[{kind:'reply',text:'午餐'}])
})
test('QuickJS constructor escape remains inside QuickJS, not Node',async()=>{
 const result = await sandbox('export default function(e,api){api.log(({}).constructor.constructor("return typeof process")())}',event(),{},[])
 assert.deepEqual(result.logs,['undefined'])
})
test('imports, infinite loops, unresolved promises and excessive outputs fail closed',async()=>{
 for(const source of [
  'import fs from "node:fs";export default function(){}',
  'export default function(){while(true){}}',
  'export default async function(){await new Promise(()=>{})}',
  'export default function(e,api){for(let i=0;i<30;i++)api.log("x")}',
  'export default function(e,api){for(let i=0;i<6;i++)api.replyText("x")}',
 ])await assert.rejects(sandbox(source,event(),{},['reply']))
})
test('permission denied in the sandbox, even in simulation',async()=>{
 await assert.rejects(sandbox('export default function(e,api){api.replyText("no")}',event(),{},[]),/permissionDenied/)
})
test('live native join preserves uint64 message ID, persists dedupe across restarts and rules',async t=>{
 const f = await fixture(t);await f.save();await f.engine.receive(event())
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].solitaire.messageId,'9007199254740993123')
 const restarted = new AutomationEngine(f.file,f.adapter)
 await restarted.receive(event({id:'another-message',solitaire:{id:'round-1',title:'午餐',messageId:'9007199254740993124'}}))
 assert.equal(f.calls.length,1)
 await f.save({name:'第二条规则'});await f.engine.receive(event({id:'third-message'}))
 assert.equal(f.calls.length,1)
})
test('test endpoint engine path cannot send, persist state, claim or enable a rule',async t=>{
 const f = await fixture(t);await f.save()
 const before = fs.readFileSync(f.file,'utf8')
 const result = await f.engine.test({rule:f.rule,event:event(),source:TEMPLATE})
 assert.equal(result.actions[0].kind,'solitaire.join');assert.equal(result.mode,'preview')
 assert.equal(f.calls.length,0);assert.equal(fs.readFileSync(f.file,'utf8'),before)
})
test('preview rule records the plan without native calls or state writes',async t=>{
 const f = await fixture(t);await f.save({mode:'preview'});await f.engine.receive(event())
 assert.equal(f.calls.length,0);assert.equal((await f.engine.snapshot()).runs[0].status,'preview')
})
test('self, stale, wrong account/group/topic/sender and keyword do not trigger',async t=>{
 const f = await fixture(t);await f.save({senders:['sender'],keyword:'午餐'})
 for(const change of [{self:true},{timestamp:Date.now() - 600000},{accountId:'other'},{groupId:'other@chatroom'},{topicId:'9'},{sender:{id:'other',name:'X'}},{text:'none',solitaire:{id:'x',title:'none',messageId:'1'}}])await f.engine.receive(event(change))
 assert.equal(f.calls.length,0)
})
test('missing stable round ID cannot join, even when script forges a result',async t=>{
 const source = 'export default function(){globalThis.__result=()=>JSON.stringify({actions:[{kind:"solitaire.join",solitaireId:"invented",entry:"x"}],logs:[],state:{}})}'
 const f = await fixture(t,source);await f.save();await f.engine.receive(event({solitaire:{title:'午餐',messageId:'1'}}))
 assert.equal(f.calls.length,0);assert.equal((await f.engine.snapshot()).runs[0].error,'stableSolitaireIdRequired')
})
test('forged actions cannot bypass host permission or destination checks',async t=>{
 const f = await fixture(t,'export default function(){globalThis.__result=()=>JSON.stringify({actions:[{kind:"send",target:{source:"wechat",accountId:"self",groupId:"other@chatroom"},text:"escape"}],logs:[],state:{}})}')
 await f.save({permissions:['send']});await f.engine.receive(event())
 assert.equal(f.calls.length,0);assert.equal((await f.engine.snapshot()).runs[0].error,'targetNotAuthorized')
})
test('unknown outcome is not retried and immediately pauses the rule',async t=>{
 const f = await fixture(t,TEMPLATE,'unknown');await f.save();await f.engine.receive(event());await f.engine.receive(event({id:'update'}))
 assert.equal(f.calls.length,1)
 const meta = await f.engine.snapshot();assert.equal(meta.rules[0].enabled,false);assert.equal(meta.runs[0].status,'unknown')
})
test('publishing a new version pauses linked live rules and preserves a rollback version',async t=>{
 const f = await fixture(t);await f.save();let meta = await f.engine.snapshot()
 meta = await f.engine.command({revision:meta.revision,operation:'saveScript',script:{id:f.id,name:'测试脚本',source:'export default function(){}'}})
 assert.equal(meta.rules[0].mode,'live')
 meta = await f.engine.command({revision:meta.revision,operation:'publishScript',id:f.id})
 assert.equal(meta.rules[0].mode,'preview');assert.equal(meta.rules[0].enabled,false);assert.equal(meta.scripts[0].versions.length,2)
})
test('live mode needs explicit confirmation and known current scopes',async t=>{
 const f = await fixture(t)
 await assert.rejects(f.save({}, {confirmLive:false}),/liveConfirmationRequired/)
 await assert.rejects(f.save({scopes:[{...scope,groupId:'foreign@chatroom'}]}),/scopeUnavailable/)
})
test('optimistic concurrency rejects stale UI saves',async t=>{
 const f = await fixture(t),revision = (await f.engine.snapshot()).revision;await f.save()
 await assert.rejects(f.engine.command({operation:'deleteScript',id:f.id,revision}),/conflict/)
})
test('cooldown and daily limits constrain real actions',async t=>{
 const f = await fixture(t);await f.save({maxActionsPerDay:1})
 await f.engine.receive(event());await f.engine.receive(event({id:'new',solitaire:{id:'round-2',title:'午餐',messageId:'2'}}))
 assert.equal(f.calls.length,1);assert.equal((await f.engine.snapshot()).runs[0].error,'dailyActionLimit')
})
test('three deterministic script failures pause the rule',async t=>{
 const f = await fixture(t,'export default function(){throw Error("no")}');await f.save()
 for(let i = 0;i < 3;i++)await f.engine.receive(event({id:String(i)}))
 assert.equal((await f.engine.snapshot()).rules[0].enabled,false);assert.equal(f.calls.length,0)
})
test('state is scoped to a rule and simulation never commits it',async t=>{
 const f = await fixture(t,'export default function(e,api){const n=api.state.get("count") || 0;api.state.set("count",n+1);api.log(n)}')
 await f.save({permissions:['state']});await f.engine.receive(event())
 const before = fs.readFileSync(f.file,'utf8'),data = JSON.parse(before);assert.equal(Object.values(data.values)[0].count,1)
 const preview = await f.engine.test({id:(await f.engine.snapshot()).rules[0].id,rule:{...f.rule,permissions:['state']},source:data.scripts[0].draft,event:event()})
 assert.equal(preview.state.count,2);assert.equal(fs.readFileSync(f.file,'utf8'),before)
})
test('state reads require permission and do not expose a retained private state',async()=>{
 await assert.rejects(sandbox('export default function(e,api){api.log(api.state.get("private"))}',event(),{},[],{private:'old-secret'}),/permissionDenied:state/)
 const result = await sandbox('export default function(){globalThis.__result=()=>JSON.stringify({actions:[],logs:[typeof input.state.private],state:{}})}',event(),{},[],{private:'old-secret'})
 assert.deepEqual(result.logs,['undefined'])
})
test('an external action observes an already-persisted pending claim',async t=>{
 const f = await fixture(t);await f.save()
 f.adapter.execute = async()=>{const saved = JSON.parse(fs.readFileSync(f.file,'utf8'));assert(Object.values(saved.claims).some(c=>c.status === 'pending'));return {status:'success'}}
 await f.engine.receive(event())
 assert.equal((await f.engine.snapshot()).runs[0].status,'success')
})
test('native solitaire parser refuses message/title identities and detects own entry',()=>{
 assert.deepEqual(nativeSolitaire('<solitaire_info><![CDATA[<solitaire><id>round-1</id><content><i><u>self</u><c>x</c></i></content></solitaire>]]></solitaire_info>','self'),{id:'round-1',joined:true})
 assert.equal(nativeSolitaire('<appmsg><title>#接龙</title><MsgId>123</MsgId></appmsg>','self').id,undefined)
})
test('live-only event adapters ignore own/bot messages and preserve topic scope',async()=>{
 const events = [],off = listenAutomations(async e=>{events.push(e)})
 try {
  emitTelegramAutomation({chat:{id:-100,type:'supergroup'},from:{id:3,first_name:'member'},message:{message_id:5,message_thread_id:9,date:Math.floor(Date.now() / 1000),text:'hello'},botInfo:{id:7}})
  emitTelegramAutomation({chat:{id:-100,type:'supergroup'},from:{id:7,is_bot:true},message:{message_id:6,text:'echo'},botInfo:{id:7}})
  await emitWechatAutomation({self:()=>false,room:async()=>({chatroomId:'room@chatroom'}),from:async()=>({_wxid:'member',name:()=> 'M'}),newMsgId:'9007199254740993123',type:()=> 'text',text:()=> 'hello',date:()=>Math.floor(Date.now() / 1000)},'self')
  assert.equal(events.length,2);assert.equal(events[0].topicId,'9');assert.equal(events[1].id,'9007199254740993123')
 }finally{off()}
})
test('automation HTTP endpoints use existing auth/origin gates; tests never execute',async t=>{
 const f = await fixture(t)
 const server = createWebUIServer({environment:{},token:'test-token',file:path.join(f.dir,'settings.json'),automation:f.engine})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)))
 const url = 'http://127.0.0.1:' + server.address().port
 assert.equal((await fetch(url + '/api/automation')).status,401)
 const headers = {Authorization:'Bearer test-token','Content-Type':'application/json'}
 assert.equal((await fetch(url + '/api/automation',{headers:{...headers,Origin:'https://evil.invalid'}})).status,403)
 assert.equal((await fetch(url + '/api/automation',{headers})).status,200)
 const response = await fetch(url + '/api/automation/test',{method:'POST',headers,body:JSON.stringify({rule:f.rule,source:TEMPLATE,event:event()})})
 assert.equal(response.status,200);assert.equal(f.calls.length,0)
 assert.equal((await fetch(url + '/api/automation/execute',{method:'POST',headers,body:'{}'})).status,404)
})
test('AI generation sends only capability prompt and requirements, never executes output',async()=>{
 let request
 const ai = createAIConnector(()=>({url:'https://ai.example/v1',key:'private-key',model:'example'}),{post:async(...args)=>{request = args;return {data:{choices:[{message:{content:'export default function(){}'}}]}}}})
 const generated = await ai('script',{requirement:'收到午餐接龙自动参加'})
 assert.equal(generated.source,'export default function(){}');assert.equal(request[1].messages[0].content,AI_PROMPT)
 assert.deepEqual(request[1].messages[1],{role:'user',content:'收到午餐接龙自动参加'})
 assert(!JSON.stringify(request[1]).includes('private-key'))
 await assert.rejects(ai('script',{requirement:'x',url:'https://evil.invalid'}),/invalidRequest/)
})