/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture({binding, legacy, autoCreate = false, routeError, rowPatch = {}, queued = false,
  templates = {}, contacts, roomInfo, groupName, original, mediaFile} = {}) {
  const sent = [], created = [], memberLookups = []
  const configuration = {...require('../dist/util/MessageTemplates').MESSAGE_TEMPLATE_DEFAULTS, AUTO_CREATE_GROUPS: autoCreate, ...templates}
  let finished
  const completion = new Promise(resolve => {finished = resolve})
  const row = {id: 1, wxId: 'gh_test', remoteId: '101', status: 'received', telegramStatus: 'pending', direction: 'incoming', senderId: 'gh_test', senderName: 'Publisher', type: 'text', body: 'synthetic', timestamp: 1}
  Object.assign(row, rowPatch)
  const store = {
    byId: async () => row,
    all: async () => [],
    claimSync: async () => true,
    run: async (sql, args = []) => {
      if (sql === 'UPDATE inbox SET telegramStatus=? WHERE id=?') finished(args[0])
    },
  }
  const wx = {hasLogin: true, wxInfo: {wxid: 'self', nickName: '自己的昵称'}, client: {Contact: {find: async () => ({name: () => 'Publisher'})}}}
  const bot = {hasLogin: true, isWebUISyncActive: async () => queued, mirrorWebUI: async message => {sent.push(message); return {success: true}}}
  const bindings = {getByWxId: async () => legacy, resolveWechat: async () => {
    if (routeError) throw new Error('forum provisioning failed')
    return binding
  }}
  const historyExports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/util/handleMsg.js'),'utf8'), {
    exports:historyExports, console, Buffer,
    require:name=>name === '../config' ? {config:configuration} : require(path.join(__dirname,'../dist/util',name)),
  })
  const dependencies = {
    entities:require('entities'),
    '../util/handleMsg':historyExports,
    '../data-sourse': {AppDataSource: {getRepository: () => ({findOneBy: async () => original})},
      getGeWeChatDataSource: () => ({isInitialized: Boolean(contacts), getRepository: () => ({findOneBy: async query => query.chatroomId ? roomInfo : contacts?.[query.userName]})})},
    'wx2tg-puppet': require('wx2tg-puppet'),
    '../util/MessageTemplates': require('../dist/util/MessageTemplates'),
    '../util/TelegramTopicUtils': require('../dist/util/TelegramTopicUtils'),
    '../service/GroupMemberNameService': {createGroupMemberNameResolver: () => async (room, sender, fallback) => {
      memberLookups.push({room,sender}); return groupName?.[sender] || fallback
    }},
    '../base/BaseClient': {AbstractClient: {getSpyClient: key => key === 'wxClient' ? wx : key === 'botClient' ? bot : {hasLogin: true, client: {}}}},
    '../entity/BindGroup': {BindGroup: class {}},
    '../service/BindGroupService': {BindGroupService: {getInstance: () => bindings}},
    '../service/ConfigurationService': {ConfigurationService: {getInstance: () => ({getConfig: async () => ({language: 'zh-CN'})})}},
    '../service/TelegramGroupOperateService': {TelegramGroupOperateService: class {
      async createGroup(value) {created.push(value); return {...value, chatId: -200, isReceive: true}}
    }},
    '../config': {config: configuration},
    './mentions': {createGroupMentionService: () => ({})},
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/webui/messages.js'), 'utf8'), {exports, require: name => dependencies[name] || {}})
  const media = {get: async () => mediaFile, prepare: async () => ({buffer:Buffer.from('synthetic'),name:'photo.jpg',sendType:3})}
  return {center: exports.createMessageCenter(store, media), sent, created, completion, memberLookups, configuration}
}

test('WebUI/MCP mirroring uses the topic even for a previously bound official account', {timeout: 2000}, async () => {
  const f = fixture({legacy: {chatId: -10, wxId: 'gh_test'}, binding: {chatId: -100123, threadId: 20, wxId: 'gh_test', isReceive: true}})
  await f.center.sync(1)
  assert.equal(await f.completion, 'synced')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent[0].chatId, -100123)
  assert.equal(f.sent[0].threadId, 20)
  assert.equal(f.sent[0].conversationWxId, 'gh_test')
})

test('durable queued deliveries block manual mirroring after an asynchronous lookup', async()=>{
  const f = fixture({queued:true})
  await assert.rejects(f.center.sync(1),error=>error.code === 'telegramQueued')
  assert.equal(f.sent.length,0)
})

test('solitaire mirroring keeps readable text and the raw source without degrading to a type label', {timeout: 2000}, async () => {
  const xml = '<msg><appmsg><type>53</type><title>0007 &amp; Test</title></appmsg></msg>'
  const f = fixture({binding: {chatId: -10, wxId: 'room@chatroom', isReceive: true},
    rowPatch: {wxId: 'room@chatroom', type: 'solitaire', body: '0007 & Test', source: JSON.stringify({MsgType: 49, Content: xml, xml})}})
  await f.center.sync(1)
  assert.equal(await f.completion, 'synced')
  assert.equal(f.sent[0].content, '0007 &amp; Test')
  assert.equal(f.sent[0].source_type, 'solitaire')
  assert.equal(f.sent[0].source_text, xml)
  assert.equal(f.created.length, 0)
})

test('WebUI/MCP cannot bypass disabled automatic group creation', {timeout: 2000}, async () => {
  const f = fixture()
  await f.center.sync(1)
  assert.equal(await f.completion, 'failed')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent.length, 0)
})

test('forum setup failure never falls back to the old group or creates a replacement', {timeout: 2000}, async () => {
  const f = fixture({legacy: {chatId: -10, wxId: 'gh_test'}, autoCreate: true, routeError: true})
  await f.center.sync(1)
  assert.equal(await f.completion, 'failed')
  assert.equal(f.created.length, 0)
  assert.equal(f.sent.length, 0)
})

test('muted topic is excluded and ordinary legacy auto-create remains available when enabled', {timeout: 2000}, async () => {
  const muted = fixture({binding: {chatId: -100123, threadId: 20, wxId: 'gh_test', isReceive: false}})
  await muted.center.sync(1)
  assert.equal(await muted.completion, 'excluded')
  assert.equal(muted.sent.length, 0)
  const ordinary = fixture({autoCreate: true})
  await ordinary.center.sync(1)
  assert.equal(await ordinary.completion, 'synced')
  assert.equal(ordinary.created.length, 1)
  assert.equal(ordinary.sent[0].chatId, -200)
  assert.equal(ordinary.sent[0].threadId, undefined)
})

test('WebUI outgoing groups use the shared member nickname rules without a hardcoded emoji or origin suffix', async () => {
  const f = fixture({binding:{chatId:-10,wxId:'room@chatroom',name:'Bound room',isReceive:true},
    rowPatch:{wxId:'room@chatroom',senderId:'self',direction:'outgoing',requestId:'web-request',body:'正文 😀 [微笑]'},
    contacts:{self:{nickName:'Directory self',remark:'不应作为群昵称'}},roomInfo:{nickName:'实际群'},groupName:{self:'<群内名字> & 明'}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.equal(f.sent[0].sender,'<b>&lt;群内名字&gt; &amp; 明: </b>')
  assert.equal(f.sent[0].memberName,'<群内名字> & 明')
  assert.equal(f.sent[0].content,'正文 😀 [微笑]')
  assert.equal(f.sent[0].senderId,'self')
  assert(!f.sent[0].sender.includes('👤'));assert(!f.sent[0].sender.includes('WebUI'))
  assert.deepEqual(f.memberLookups,[{room:'room@chatroom',sender:'self'}])
})

test('custom WebUI prefixes use sender fields, escaped topic and MESSAGE_DISPLAY member names', async () => {
  const f = fixture({binding:{chatId:-10,wxId:'room@chatroom',name:'Wrong fallback',isReceive:true},
    rowPatch:{wxId:'room@chatroom',senderId:'member'},contacts:{member:{nickName:'Nick <&>',remark:'Remark <&>'}},
    roomInfo:{nickName:'Topic <&>'},groupName:{member:'群名 <&>'},
    templates:{ROOM_MESSAGE_GROUP:'<u>#[alias_first]|#[name]|#[topic]</u>',MESSAGE_DISPLAY:'#[member_name]#[br]#[body]'}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.equal(f.sent[0].sender,'<u>Remark &lt;&amp;&gt;|Nick &lt;&amp;&gt;|Topic &lt;&amp;&gt;</u>')
  assert.equal(f.sent[0].memberName,'群名 <&>')
  assert.equal(f.memberLookups.length,1)
  const {FormatUtils} = require('../dist/util/FormatUtils')
  assert.equal(FormatUtils.transformIdentityBodyStr(f.configuration.MESSAGE_DISPLAY,f.sent[0].sender,f.sent[0].content,f.sent[0].memberName),'群名 &lt;&amp;&gt;\nsynthetic')
})

test('WebUI prefixes without member_name avoid member lookups and fall back to saved plain names', async () => {
  const f = fixture({binding:{chatId:-10,wxId:'room@chatroom',isReceive:true},
    rowPatch:{wxId:'room@chatroom',senderId:'member',senderName:'离线昵称'},
    templates:{ROOM_MESSAGE_GROUP:'<u>#[name]</u>'}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.equal(f.sent[0].sender,'<u>离线昵称</u>')
  assert.equal(f.memberLookups.length,0)
})

test('WebUI contact, enterprise and official/topic routing choose their configured prefixes', async () => {
  for(const [wxId,verifyFlag,threadId,prefix] of [['friend',0,undefined,'contact'],['worker@openim',24,undefined,'contact'],['brand',24,undefined,'official'],['brand',undefined,77,'official']]){
    const f = fixture({binding:{chatId:-10,wxId,threadId,isReceive:true},rowPatch:{wxId,senderId:wxId},
      contacts:{[wxId]:{nickName:'昵称',remark:'备注',verifyFlag}},
      templates:{CONTACT_MESSAGE_GROUP:'contact #[alias_first]',OFFICIAL_MESSAGE_GROUP:'official #[name]'}})
    await f.center.sync(1)
    assert.equal(await f.completion,'synced')
    assert.equal(f.sent[0].sender,`${prefix} ${prefix === 'contact' ? '备注' : '昵称'}`)
    assert.equal(f.sent[0].threadId,threadId)
  }
})

test('WebUI quote fallback uses prefix and body templates without replacing the reply text with its quote title', async () => {
  for(const original of [undefined,{chatId:-10,threadId:88,tgBotMsgId:4},{chatId:-10,threadId:77,tgBotMsgId:0}]){
    const f = fixture({binding:{chatId:-10,threadId:77,wxId:'brand',isReceive:true},original,
      rowPatch:{wxId:'brand',type:'quote',direction:'outgoing',senderId:'self',body:'我的答复 😀',
        details:JSON.stringify({title:'不能覆盖答复',replyTo:{remoteId:'9007199254740993123',name:'原作者 <&>',preview:'原文 <&> [微笑]'}})},
      templates:{OFFICIAL_MESSAGE_GROUP:'<b>#[name]</b>',MESSAGE_DISPLAY:'#[body] — #[identity]'}})
    await f.center.sync(1)
    assert.equal(await f.completion,'synced')
    assert.equal(f.sent[0].content,'<blockquote>原文 &lt;&amp;&gt; [微笑] — <b>原作者 &lt;&amp;&gt;</b></blockquote>\n我的答复 😀')
    assert.equal(f.sent[0].param?.reply_id,undefined)
    assert.equal(f.sent[0].source_type,'quote')
    assert(!f.sent[0].content.includes('不能覆盖答复'))
  }
})

test('WebUI quotes with confirmed same-topic originals keep native Telegram replies', async () => {
  const f = fixture({binding:{chatId:-10,threadId:77,wxId:'brand',isReceive:true},original:{chatId:-10,threadId:77,tgBotMsgId:4},
    rowPatch:{wxId:'brand',type:'quote',body:'答复 😀',details:JSON.stringify({replyTo:{remoteId:'102',name:'作者',preview:'原文'}})}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.equal(f.sent[0].content,'答复 😀')
  assert.equal(f.sent[0].param.reply_id,4)
})

test('WebUI file captions use the same configured body/identity order as text', async () => {
  const f = fixture({binding:{chatId:-10,wxId:'friend',isReceive:true},mediaFile:{id:'file'},
    rowPatch:{wxId:'friend',senderId:'self',direction:'outgoing',requestId:'file-request',type:'image',attachmentId:'file',body:'caption <&> 😀'},
    templates:{CONTACT_MESSAGE_GROUP:'<b>#[name]</b>',MESSAGE_DISPLAY:'#[body] / #[identity]'}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.equal(f.sent[0].sender,'caption &lt;&amp;&gt; 😀 / <b>自己的昵称</b>')
  assert.equal(f.sent[0].file.fileName,'photo.jpg')
  assert.equal(f.sent[0].type,1)
})

test('WebUI manual history sync keeps nested navigation and uses the same templates as live history', async () => {
  const record = '<recordinfo><datalist count="1"><dataitem datatype="1"><sourcename>来源人</sourcename><sourcetime>2026-11-13 09:10:11</sourcetime><datadesc>正文 [微笑]</datadesc></dataitem></datalist></recordinfo>'
  // The SDK parser represents attributes as @_datatype; the wire records use child elements.
  const xml = `<msg><appmsg><type>19</type><recorditem><![CDATA[${record.replace(' datatype="1"','').replace('<dataitem>','<dataitem><datatype>1</datatype>')}]]></recorditem></appmsg></msg>`
  const f = fixture({binding:{chatId:-10,wxId:'room@chatroom',name:'群',isReceive:true},
    rowPatch:{wxId:'room@chatroom',type:'chat_histroy',source:JSON.stringify({xml})},
    templates:{ROOM_MESSAGE_GROUP:'<u>#[member_name]</u>',MESSAGE_DISPLAY:'#[body] / #[identity]'}})
  await f.center.sync(1)
  assert.equal(await f.completion,'synced')
  assert.match(f.sent[0].content,/正文 \[微笑\] \/ <u>来源人<\/u>/)
  assert.equal(f.sent[0].source_type,'chat_histroy')
  assert.equal(f.sent[0].source_text,xml)
  assert.equal(f.sent[0].param.nestedChatHistories.length,0)
  assert.equal(f.sent[0].param.chatHistoryAttachments.length,0)
})

test('legacy prefix cleanup is limited to HTML imports, not ordinary names containing angle brackets', async () => {
  for(const legacy of [false,true]){
    const f = fixture({binding:{chatId:-10,wxId:'friend',isReceive:true},rowPatch:{wxId:'friend',senderId:'friend',
      senderName:legacy ? '<b>👤Name &amp; Friend · WebUI</b>' : 'Name <&>',bodyFormat:legacy ? 'telegram_html' : 'plain'}})
    await f.center.sync(1)
    assert.equal(await f.completion,'synced')
    assert.equal(f.sent[0].sender,legacy ? '<b>Name &amp; Friend: </b>' : '<b>Name &lt;&amp;&gt;: </b>')
  }
})