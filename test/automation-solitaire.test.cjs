/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {encodeXML} = require('entities')
const {nativeSolitaire} = require('../dist/automation/solitaire')
const {AutomationEngine} = require('../dist/automation/engine')
const {emitWechatAutomation,listenAutomations} = require('../dist/automation/events')
const script = fs.readFileSync(path.join(__dirname,'../docs/examples/solitaire-position.js'),'utf8')
const scope = {source:'wechat',accountId:'self',groupId:'synthetic@chatroom'}
const item = (user,time,extra = '')=>`<i><u>${user}</u><t>${time}</t><r>0-1</r>${extra}</i>`
const envelope = (items,extra = '<au>author</au>',escaped = false)=>{
  const inner = `<solitaire>${extra}<tt>0-1</tt><content><s>99</s>${items.join('')}</content></solitaire>`
  return `<msg><appmsg><type>53</type><extinfo><solitaire_info>${escaped ? encodeXML(inner) : '<![CDATA[' + inner + ']]>'}</solitaire_info></extinfo></appmsg></msg>`
}
const card = (count,time = 1700000000)=>envelope(Array.from({length:count},(_,i)=>item(i ? `member-${i}` : 'author',time + i)))
const event = (count,id,time = Date.now(),origin = 1700000000)=>{
  const native = nativeSolitaire(card(count,origin),'self')
  return {...scope,id,type:'solitaire.received',text:'用餐接龙',sender:{id:'member',name:'Member'},timestamp:time,self:false,
    solitaire:{id:native.id,entryCount:native.entryCount,title:'用餐接龙',messageId:id}}
}
async function fixture(t,outcome = 'success'){
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'solitaire-position-')),file = path.join(directory,'automation.json')
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  let now = Date.now()
  const calls = [],adapter = {scopes:async()=>[scope],execute:async(...args)=>{calls.push(args);return {status:outcome}}}
  const engine = new AutomationEngine(file,adapter,()=>now)
  let snapshot = await engine.snapshot()
  snapshot = await engine.command({operation:'saveScript',revision:snapshot.revision,script:{name:'Position',source:script}})
  snapshot = await engine.command({operation:'publishScript',revision:snapshot.revision,id:snapshot.scripts[0].id})
  const rule = {name:'Fifth entry',scriptId:snapshot.scripts[0].id,enabled:true,mode:'live',scopes:[scope],targets:[],permissions:['solitaire.join'],trigger:'solitaire.received',params:{targetPosition:5},cooldownSeconds:10,maxActionsPerDay:20}
  await engine.command({operation:'saveRule',revision:snapshot.revision,rule,confirmLive:true})
  return {engine,adapter,calls,file,rule,get now(){return now},advance(ms){now += ms}}
}

test('native author creation identity survives new messages, entry order, CDATA/entities and count changes',()=>{
  const initial = nativeSolitaire(card(1),'self'),four = nativeSolitaire(card(4),'self')
  assert.match(initial.id,/^author-time-v1:[a-f0-9]{64}$/)
  assert.equal(initial.id,four.id);assert.equal(four.entryCount,4)
  const reordered = envelope([item('other',1700000001),item('author',1700000000)],'<au>author</au>',true)
  assert.equal(nativeSolitaire(reordered,'self').id,initial.id)
  assert.notEqual(nativeSolitaire(card(1,1700086400),'self').id,initial.id)
  assert.equal(nativeSolitaire(card(4),'member-2').joined,true)
  assert.equal(nativeSolitaire(envelope([item('author',1700000000,'<c>&lt;u&gt;self&lt;/u&gt;</c>')]),'self').joined,false)
})

test('explicit IDs remain authoritative; absent/duplicate/invalid author data cannot become guessed identities',()=>{
  assert.equal(nativeSolitaire(envelope([item('a',1700000000)],'<id>original-round</id>'),'self').id,'original-round')
  for(const xml of [envelope([item('a',1700000000)],''),envelope([item('other',1700000000)]),
    envelope([item('author',1700000000),item('author',1700000001)]),
    envelope([item('author',1700000002),item('other',1700000001)]),
    envelope([item('author','not-a-time')]),envelope([item('author',1700000000)],'<au>author</au><id>invalid id</id>'),
    envelope([item('author',1700000000)],'<au>author</au><id>a</id><id>b</id>'),
    '<!DOCTYPE msg>' + card(1),card(1).replace('</solitaire_info>',''),
    '<msg><appmsg><title>用餐接龙</title><MsgId>123</MsgId></appmsg></msg>'])assert.equal(nativeSolitaire(xml,'self').id,undefined)
})

test('live event exposes structured count and stable identity, while an own participation remains excluded',async()=>{
  const events = [],off = listenAutomations(async value=>{events.push(value)})
  const message = {newMsgId:'9007199254740993123',_xml:card(4),self:()=>false,room:async()=>({chatroomId:scope.groupId}),
    from:async()=>({_wxid:'member',name:()=> 'Member'}),type:()=> 'solitaire',text:()=> '用餐接龙',date:()=>Math.floor(Date.now() / 1000)}
  try {
    await emitWechatAutomation(message,'self')
    assert.equal(events.length,1);assert.equal(events[0].solitaire.entryCount,4)
    assert.equal(events[0].solitaire.id,nativeSolitaire(card(4),'self').id)
    await emitWechatAutomation({...message,newMsgId:'9007199254740993124',_xml:envelope([item('author',1700000000),item('self',1700000001)])},'self')
    assert.equal(events.length,1)
  } finally {off()}
})

test('no-op third entry does not consume cooldown; fourth entry joins once across updates and restart',async t=>{
  const f = await fixture(t)
  await f.engine.receive(event(3,'message-3',f.now))
  let snapshot = await f.engine.snapshot()
  assert.equal(snapshot.runs[0].status,'skipped');assert.equal(snapshot.rules[0].lastRun,undefined);assert.equal(f.calls.length,0)
  f.advance(1000);await f.engine.receive(event(4,'message-4',f.now))
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0].entry,undefined,'omitted entry requests the live self group nickname')
  assert.equal(f.calls[0][0].solitaireId,event(4,'other').solitaire.id)
  assert.equal(f.calls[0][1].solitaire.messageId,'message-4')
  f.advance(20000)
  const restarted = new AutomationEngine(f.file,f.adapter,()=>f.now)
  await restarted.receive(event(4,'duplicate-round',f.now))
  assert.equal(f.calls.length,1)
  f.advance(86400000);await restarted.receive(event(4,'next-day',f.now,1700086400))
  assert.equal(f.calls.length,2)
})

test('position script does not guess a count or ID, change its target, or send past the requested position',async t=>{
  const f = await fixture(t)
  for(const count of [1,2,3,5,6]){
    const result = await f.engine.test({rule:f.rule,source:script,event:event(count,`count-${count}`,f.now)})
    assert.equal(result.actions.length,0)
  }
  const missing = event(4,'missing',f.now);delete missing.solitaire.id
  assert.equal((await f.engine.test({rule:f.rule,source:script,event:missing})).actions.length,0)
  missing.solitaire.id = 'known';delete missing.solitaire.entryCount
  assert.equal((await f.engine.test({rule:f.rule,source:script,event:missing})).actions.length,0)
  assert.equal(f.calls.length,0)
})

test('unknown joining result still pauses the rule and cannot repeat after restart',async t=>{
  const f = await fixture(t,'unknown');await f.engine.receive(event(4,'first',f.now))
  const snapshot = await f.engine.snapshot();assert.equal(snapshot.rules[0].enabled,false);assert.equal(snapshot.runs[0].status,'unknown')
  f.advance(20000);await new AutomationEngine(f.file,f.adapter,()=>f.now).receive(event(4,'second',f.now))
  assert.equal(f.calls.length,1)
})