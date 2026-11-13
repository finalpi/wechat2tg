/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata')
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {once} = require('node:events')
const {DataSource} = require('typeorm')
const {Message} = require('../dist/entity/Message')
const {BindGroup} = require('../dist/entity/BindGroup')
const {AppDataSource} = require('../dist/data-sourse')
const {AbstractClient} = require('../dist/base/BaseClient')
const {WebMessageStore} = require('../dist/webui/message-store')
const {createMessageCenter} = require('../dist/webui/messages')
const {createWebUIServer} = require('../dist/webui/server')
const {quoteReplyText} = require('../dist/webui/quote-reply')

const remoteId = '18446744073709551614'
const xml = title => `<msg><appmsg><title><![CDATA[${title}]]></title><type>57</type><refermsg><type>1</type><svrid>${remoteId}</svrid><chatusr>peer</chatusr><displayname>Original sender</displayname><content>Original quoted message</content></refermsg></appmsg></msg>`

test('quote titles retain literal text, leading zeroes, entities and nested quote distinctions',()=>{
  for(const title of ['Reply body', '0', '0007', 'true', '  leading and trailing  ', '回复\n[微笑] <script>literal</script> &']) {
    assert.equal(quoteReplyText(xml(title)),title)
    assert.equal(quoteReplyText(JSON.stringify({xml:xml(title)})),title)
    assert.equal(quoteReplyText(JSON.stringify({Content:xml(title)})),title)
  }
  assert.equal(quoteReplyText('<appmsg><title>回复 &lt;内容&gt; &amp; 符号</title><type>57</type></appmsg>'),'回复 <内容> & 符号')
  assert.equal(quoteReplyText('<msg><appmsg><title>Actual reply</title><type>57</type><refermsg><content><appmsg><title>Nested quoted title</title><type>57</type></appmsg></content></refermsg></appmsg></msg>'),'Actual reply')
  for(const source of [undefined,'','plain text','{invalid}',JSON.stringify({Content:'plain text'}),xml('reply').replace('<type>57</type>','<type>6</type>'),
    '<!DOCTYPE msg [<!ENTITY leak SYSTEM "file:///private">]>'+xml('reply'),xml('x'.repeat(512*1024))]) {
    assert.equal(quoteReplyText(source),undefined)
  }
})

test('native quote capture stores the reply body and makes it searchable with the original reference source intact',async t=>{
  const store = new WebMessageStore(':memory:')
  t.after(()=>store.close())
  const contact = {_wxid:'peer',name:()=> 'Peer'}
  for(const [index,title] of ['收到，我来处理','0','0007'].entries()) {
    const source = xml(title)
    await store.observe({newMsgId:String(index+1),_msgId:String(index+1),_createTime:100+index,_xml:source,fromId:'peer',toId:'self',
      type:()=> 'quote',self:()=>false,room:async()=>null,from:async()=>contact,to:async()=>({_wxid:'self'}),text:()=>title,date:()=>100+index})
    const row = await store.byRemoteId('peer',String(index+1))
    assert.equal(row.body,title)
    assert.equal(row.bodyFormat,'plain')
    assert.equal(JSON.parse(row.source).xml,source)
    assert.equal((await store.history('peer',0,title)).messages.some(message=>message.id===row.id),true)
  }
})

test('old empty quote bodies are restored in HTTP history, updates, location context and MCP events',async t=>{
  const db = new DataSource({type:'sqlite',database:':memory:',entities:[Message,BindGroup],synchronize:true})
  await db.initialize()
  t.after(()=>db.destroy())
  t.mock.method(AppDataSource,'getRepository',entity=>db.getRepository(entity))
  t.mock.method(AbstractClient,'getSpyClient',()=>undefined)
  await db.getRepository(BindGroup).save({wxId:'peer',chatId:-10001,type:0,name:'Peer'})
  const store = new WebMessageStore(':memory:')
  t.after(()=>store.close())
  const original = await store.insert({wxId:'peer',remoteId,body:'Original quoted message',type:'text',direction:'incoming',status:'received',timestamp:99})
  const reply = 'This is the missing reply <literal> [微笑]'
  const cached = {replyTo:{remoteId,name:'Original sender',preview:'Original quoted message',type:1}}
  const row = await store.insert({wxId:'peer',remoteId:'124',body:'',type:'quote',direction:'incoming',status:'received',timestamp:100,telegramTracked:1,
    source:JSON.stringify({MsgType:49,Content:xml(reply),xml:xml(reply),privateValue:'PRIVATE-FIELD'}),details:JSON.stringify(cached)})
  const center = createMessageCenter(store,{})
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'quote-reply-http-'))
  const server = createWebUIServer({environment:{},token:'synthetic-quote-token',file:path.join(directory,'config.json'),messages:center,
    mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true})})
  const base = `http://127.0.0.1:${server.address().port}`
  for(const route of ['/api/messages?wxId=peer&q=&before=0',`/api/messages/updates?wxId=peer&ids=${row.id}`,`/api/messages/locate?wxId=peer&id=${row.id}`]) {
    const response = await fetch(base+route,{headers:{Authorization:'Bearer synthetic-quote-token'}})
    assert.equal(response.status,200)
    const result = await response.json(),actual = result.messages.find(message=>message.id===row.id)
    assert.equal(actual.body,reply)
    assert.equal(actual.bodyFormat,'plain','XML title characters must never become Telegram HTML')
    assert.equal(actual.details.replyTo.remoteId,remoteId)
    assert.equal(actual.details.replyTo.preview,'Original quoted message')
    assert(!JSON.stringify(result).includes('PRIVATE-FIELD'))
  }
  const located = await center.locate('peer',undefined,remoteId)
  assert.equal(located.targetId,original.id)
  assert.equal((await center.newMessages(0,'peer',100)).messages.find(message=>message.id===row.id).body,reply)
  const own = await store.insert({wxId:'peer',remoteId:'125',body:'Existing reply',bodyFormat:'plain',type:'quote',direction:'outgoing',status:'submitted',timestamp:101,source:JSON.stringify({xml:xml('Different title')})})
  assert.equal((await center.updates('peer',[own.id])).messages[0].body,'Existing reply','existing visible replies remain authoritative')
})
