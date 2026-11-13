/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const {Message: WxMessage} = require('wx2tg-puppet')
const {MESSAGE_TEMPLATE_DEFAULTS: defaults, formatMessageIdentity, formatMessageText, formatMessageQuote} = require('../dist/util/MessageTemplates')

function historyRenderer(templates = {}) {
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/util/handleMsg.js'),'utf8'), {
    exports, console, Buffer,
    require: name => name === '../config' ? {config:{...defaults,...templates}} : require(path.join(__dirname,'../dist/util',name)),
  })
  return (items, context) => exports.getChatHistory({recordinfo:{datalist:{count:items.length,dataitem:items}}},
    {type:()=>WxMessage.Type.ChatHistroy,text:()=>''},WxMessage.Type,JSON.parse,'',context)
}
const item = (patch = {}) => ({datatype:1,sourcename:'原作者',sourcetime:'2026-11-13 09:10:11',datadesc:'正文 😀 [微笑]',...patch})

test('shared identity rendering honors all six configured prefixes, wrappers, defaults and body order', () => {
  const values = {...defaults, MESSAGE_DISPLAY:'#[body] | #[identity] | #[member_name]'}
  for(const kind of ['contact','official','room'])for(const bound of [false,true]){
    const key = `${kind.toUpperCase()}_MESSAGE${bound ? '_GROUP' : ''}`
    values[key] = `${key}:<b>#[name]#[br]</b>#[alias_first]#[(alias)]#[topic]#[member_name]`
    const identity = {kind,bound,name:'昵称 <&>',alias:'备注',topic:'群',memberName:'群昵称'}
    const prefix = `${key}:<b>昵称 &lt;&amp;&gt;#[br]</b>备注(备注)群群昵称`
    assert.equal(formatMessageIdentity(values,identity),prefix)
    assert.equal(formatMessageText(values,identity,'正文 😀 [微笑]'),`正文 😀 [微笑] | ${prefix} | 群昵称`)
    const blank = {...values,[key]:' \n '}
    assert.equal(formatMessageIdentity(blank,identity),kind === 'room' ? '<b>群昵称: </b>' : kind === 'official' ? '<b>昵称 &lt;&amp;&gt;: </b>' : '<b>备注: </b>')
  }
})

test('quote rendering escapes names once, honors body-only rules and retains user-chosen emoji', () => {
  const identity = {kind:'room',name:'<b>恶意</b> & "名"',memberName:'<群昵称>'}
  assert.equal(formatMessageQuote(defaults,identity,'安全 &lt;内容&gt; 😀 [微笑]'),
    '<blockquote><b>&lt;群昵称&gt;: </b>\n安全 &lt;内容&gt; 😀 [微笑]</blockquote>')
  assert.equal(formatMessageQuote({...defaults,MESSAGE_DISPLAY:'#[body]'},identity,'正文'),'<blockquote>正文</blockquote>')
  assert.equal(formatMessageQuote({...defaults,ROOM_MESSAGE_GROUP:'⭐ #[name]',MESSAGE_DISPLAY:'<blockquote>#[identity]#[br]#[body]</blockquote>'},identity,'正文'),
    '<blockquote>⭐ &lt;b&gt;恶意&lt;/b&gt; &amp; &quot;名&quot;\n正文</blockquote>')
})

test('forwarded quote blocks use shared templates for every nested sender and preserve emoji and timestamps', async () => {
  const render = historyRenderer({ROOM_MESSAGE_GROUP:'<u>#[member_name]</u>',MESSAGE_DISPLAY:'#[body] — #[identity]'})
  const child = {recordinfo:{datalist:{count:1,dataitem:item({sourcename:'内层作者',datadesc:'内层正文 [微笑]'})}}}
  const result = await render([item({sourcename:'<原作者> & 明'}),item({datatype:17,datatitle:'内层 <&>',recordxml:child})],{kind:'room'})
  assert.match(result.content,/正文 😀 \[微笑\] — <u>&lt;原作者&gt; &amp; 明<\/u>/)
  assert.match(result.content,/<i>09:10<\/i>/)
  assert.match(result.content,/内层 &lt;&amp;&gt;/)
  assert(!result.content.includes('👤'))
  assert.equal(result.nestedRecords[0].id,'2')
  assert.match(result.nestedRecords[0].content,/内层正文 \[微笑\] — <u>内层作者<\/u>/)
  assert(!result.nestedRecords[0].content.includes('👤'))
})

test('record source group identity wins over the recipient and default/blank templates never reintroduce decorations', async () => {
  const render = historyRenderer({CONTACT_MESSAGE_GROUP:'contact #[name]',ROOM_MESSAGE_GROUP:' \n '})
  const result = await render([item({sourcename:'来源群昵称',dataitemsource:{realchatname:'source@chatroom'}}),item({sourcename:'私聊作者'})],{kind:'contact'})
  assert.match(result.content,/<b>来源群昵称: <\/b>\n正文/)
  assert.match(result.content,/contact 私聊作者\n正文/)
  assert(!result.content.includes('👤'))
})

test('history HTML is escaped without changing attachment payloads, IDs or links', async () => {
  const render = historyRenderer({MESSAGE_DISPLAY:'<blockquote>#[identity]#[br]#[body]</blockquote>'})
  const rows = [item({datadesc:'<b>not markup</b> & [微笑]'}),item({datatype:5,datatitle:'Link <&>',link:'https://example.com/?a=1&b="2"'}),
    item({datatype:5,datatitle:'unsafe URL',link:'javascript:alert(1)'}),
    item({datatype:2,dataid:'image',cdndataurl:'synthetic-cdn',cdndatakey:'synthetic-key',datasize:32,datafmt:'jpg'}),
    item({datatype:8,datatitle:'file <&>.txt',cdndataurl:'synthetic-file',cdndatakey:'synthetic-key',datasize:32}),
    item({datatype:4,datatitle:'video <&>',cdndataurl:'synthetic-video',cdndatakey:'synthetic-key',datasize:64,sourcetime:'2026-11-14 10:20:00'})]
  const original = JSON.stringify(rows)
  const result = await render(rows)
  assert.match(result.content,/&lt;b&gt;not markup&lt;\/b&gt; &amp; \[微笑\]/)
  assert.match(result.content,/<a href="https:\/\/example.com\/\?a=1&amp;b=&quot;2&quot;">Link &lt;&amp;&gt;<\/a>/)
  assert(!result.content.includes('javascript:'))
  assert.equal((result.content.match(/<blockquote\b/g) || []).length,1)
  assert.match(result.content,/<i>11\/14 10:20<\/i>/)
  assert.deepEqual(Array.from(result.attachments,a=>[a.id,a.type]),[['4','image'],['5','file'],['6','video']])
  assert.equal(result.attachments[0].payload.fileNo,'synthetic-cdn')
  assert.equal(result.attachments[1].fileName,'file <&>.txt')
  assert.equal(result.attachments[2].payload.cdnDataUrl,'synthetic-video')
  assert.equal(JSON.stringify(rows),original)
})