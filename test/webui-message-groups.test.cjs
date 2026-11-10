/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../webui/src/lib/message-groups.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,Date})
const group = (...args)=>JSON.parse(JSON.stringify(exportsObject.groupChatMessages(...args)))
const now = new Date(2026,10,10,12).getTime() / 1000
const row = (id,extra = {})=>({id,wxId:'room@chatroom',senderId:'alice',senderName:'Same nickname',direction:'incoming',timestamp:now + id,body:'Repeated text',type:'text',...extra})
test('adjacent same-author messages group by identity, not text or display name',()=>{
  const groups = group([row(1),row(2,{type:'image',body:''}),row(3,{senderId:'bob'}),row(4)],false,true)
  assert.deepEqual(groups.map(g=>g.messages.map(m=>m.id)),[[1,2],[3],[4]])
  assert.equal(groups[0].id,'group-1')
})
test('time gaps, direction, day, conversation, unknown authors and notices break groups',()=>{
  const breaks = [{timestamp:now + 302},{timestamp:new Date(2026,10,11,12).getTime() / 1000},{timestamp:now - 1},{direction:'outgoing'},{wxId:'other@chatroom'},{senderId:''},{type:'revoke_notice'},{revokeStatus:'revoked'}]
  for(const extra of breaks)assert.equal(group([row(1),row(2,extra)],false,true).length,2,JSON.stringify(extra))
  assert.equal(group([row(1,{senderId:''}),row(2,{senderId:''})],false,true).length,2)
  assert.equal(group([row(1,{direction:'outgoing'}),row(2,{direction:'outgoing'})],false,true).length,1)
  assert.equal(group([row(1),row(2)],true,true).length,2,'publications retain separate article cards')
})
test('prepend/append and status-only updates retain order without changing content or collapsing message IDs',()=>{
  const input = [row(1),row(2,{telegramStatus:'failed'}),row(3,{body:'different'})],snapshot = JSON.stringify(input)
  assert.deepEqual(group(input,false,true).flatMap(g=>g.messages.map(m=>m.id)),[1,2,3])
  assert.equal(JSON.stringify(input),snapshot)
  assert.equal(group([row(1,{senderId:undefined,wxId:'friend'}),row(2,{senderId:undefined,wxId:'friend'})],false,false).length,1)
})