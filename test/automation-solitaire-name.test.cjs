/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),vm = require('node:vm')
const {solitaireJoinBody,solitaireCreateBody} = require('../dist/service/SolitaireService')
const {AutomationEngine} = require('../dist/automation/engine')
const scope = {source:'wechat',accountId:'self',groupId:'room@chatroom'}
const event = {...scope,id:'123',type:'solitaire.received',text:'用餐接龙',sender:{id:'other',name:'Not my name'},timestamp:Date.now(),self:false,
  solitaire:{id:'round',entryCount:4,title:'用餐接龙',messageId:'9007199254740993123'}}
const action = {kind:'solitaire.join',solitaireId:'round'}
function fixture(resolve = async()=> '我的群昵称'){
  const wx = {hasLogin:true,wxInfo:{wxid:'self',nickName:'我的微信昵称'}},lookups = [],sent = [],exports = {}
  const dependencies = {
    'node:path':path,
    '../base/BaseClient':{AbstractClient:class {static getSpyClient(name){return name === 'wxClient' ? wx : undefined}}},
    '../service/GroupMemberNameService':{createGroupMemberNameResolver:getSelf=>async(...args)=>{lookups.push(args);return resolve(wx,getSelf,...args)}},
    '../service/SolitaireService':{solitaireJoinBody,solitaireCreateBody,sendSolitaireJoin:async body=>{sent.push(body);return {status:'joined'}},sendSolitaireCreate:async body=>{sent.push(body);return {status:'joined'}}},
    './contracts':require('../dist/automation/contracts'),
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/automation/live.js'),'utf8'),{exports,require:name=>dependencies[name] || {}})
  return {wx,lookups,sent,adapter:exports.createAutomationAdapter({send:async()=>assert.fail('unexpected text send')})}
}

test('omitting entry resolves the current account in the current group and preserves the uint64 message ID',async()=>{
  const f = fixture()
  assert.equal((await f.adapter.execute(action,event,'test')).status,'success')
  assert.deepEqual(f.lookups,[['room@chatroom','self','我的微信昵称']])
  assert.equal(JSON.parse(f.sent[0]).Content,'我的群昵称')
  assert(f.sent[0].includes('"NewMsgID":9007199254740993123'))
  assert(!f.sent[0].includes('Not my name'))
  assert.equal(action.entry,undefined)
})

test('the existing resolver may fall back to the WeChat nickname, while explicit content bypasses lookup',async()=>{
  const f = fixture(async(_wx,_self,_room,_user,fallback)=>fallback)
  await f.adapter.execute(action,event,'test')
  assert.equal(JSON.parse(f.sent[0]).Content,'我的微信昵称')
  await f.adapter.execute({...action,entry:'自定义报名内容'},event,'test2')
  assert.equal(f.lookups.length,1);assert.equal(JSON.parse(f.sent[1]).Content,'自定义报名内容')
})

test('missing names, logout or account switches during lookup cannot send',async()=>{
  for(const resolve of [async()=> '',async wx=>{wx.hasLogin = false;return '旧名字'},async wx=>{wx.wxInfo.wxid = 'other';return '旧名字'}]){
    const f = fixture(resolve)
    assert.equal((await f.adapter.execute(action,event,'test')).status,'rejected')
    assert.equal(f.sent.length,0)
  }
  const f = fixture();f.wx.wxInfo.wxid = 'other'
  assert.equal((await f.adapter.execute(action,event,'test')).status,'rejected');assert.equal(f.lookups.length,0)
})

test('literal nickname undefined remains valid, and create keeps its explicit entry',async()=>{
  const f = fixture(async()=> 'undefined')
  await f.adapter.execute(action,event,'test')
  assert.equal(JSON.parse(f.sent[0]).Content,'undefined')
  await f.adapter.execute({kind:'solitaire.create',title:'New',entry:'First'},event,'test2')
  assert.equal(f.lookups.length,1);assert.equal(JSON.parse(f.sent[1]).Content,'First')
})

test('preview accepts omitted join entry without nickname lookup; explicit invalid entry and missing create entry fail',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'solitaire-name-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const engine = new AutomationEngine(path.join(directory,'automation.json'))
  const rule = {name:'test',scriptId:'synthetic',scopes:[scope],permissions:['solitaire.join'],params:{targetPosition:5}}
  const source = fs.readFileSync(path.join(__dirname,'../docs/examples/solitaire-position.js'),'utf8')
  const result = await engine.test({rule,event,source})
  assert.deepEqual(result.actions,[action])
  assert.equal(fs.existsSync(path.join(directory,'automation.json')),false)
  const custom = await engine.test({rule:{...rule,params:{targetPosition:5,myEntry:'指定内容'}},event,source})
  assert.equal(custom.actions[0].entry,'指定内容')
  for(const entry of ['','   ',null,123]){
    await assert.rejects(engine.test({rule,event,source:`export default async function(e,api){await api.solitaire.join({solitaireId:e.solitaire.id,entry:${JSON.stringify(entry)}})}`}))
  }
  await assert.rejects(engine.test({rule:{...rule,permissions:['solitaire.create']},event,source:'export default async function(e,api){await api.solitaire.create({title:"New"})}'}))
  await assert.rejects(engine.test({rule:{...rule,permissions:[]},event,source}),/permissionDenied/)
})