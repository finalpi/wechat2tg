/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')
function load(name,dependencies = {},globals = {}) {
  const exports = {},file = path.join(__dirname,'../webui/src',name)
  const source = ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
  vm.runInNewContext(source,{exports,...globals,require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:require(name)})
  return exports
}
const mentions = load('lib/composer-mentions.ts')
const plain = value=>JSON.parse(JSON.stringify(value))
const member = {wxId:'wxid-fixture',name:'undefined',displayName:'',nickname:'undefined',hasAvatar:false}

test('typing @ searches at the caret, including Chinese/fullwidth input, without treating email as a mention',()=>{
  for(const body of ['@','你好@张','请联系 ＠wxid']) {
    const target = mentions.mentionQuery(body,body.length)
    assert(target);assert.equal(target.end,body.length)
  }
  assert.equal(mentions.mentionQuery('mail@example.com',16),null)
  assert.equal(mentions.mentionQuery('https://example.com/@name',24),null)
  assert.equal(mentions.mentionQuery('@张 三',4),null)
  assert.equal(mentions.mentionQuery('@张',0,2),null)
  assert.equal(mentions.mentionQuery('@张 后面的文字',2).query,'张')
})

test('rich editor serializes image atoms and native multiline blocks to the original WeChat text',()=>{
  class Element {
    constructor(tag,children = [],attributes = {}) {
      this.tagName = tag;this.childNodes = children;this.attributes = attributes
      children.forEach(child=>{child.parentNode = this})
    }
    getAttribute(name) {return this.attributes[name] ?? null}
    hasAttribute(name) {return Object.hasOwn(this.attributes,name)}
  }
  const text = value=>({nodeType:3,textContent:value,childNodes:[]})
  const emoji = {wechatEmojiByText:new Map([['[微笑]',{name:'微笑',text:'[微笑]',url:'/synthetic.webp'}]])}
  const {editorText,editorHasPlainEmoji} = load('lib/rich-editor.ts',{'./wechat-emoji':emoji},{Element})
  const root = new Element('DIV',[text('你好'),new Element('IMG',[],{'data-wechat-emoji':'[微笑]'}),text(' @undefined\u2005')])
  assert.equal(editorText(root),'你好[微笑] @undefined\u2005')
  assert.equal(editorText(new Element('DIV',[new Element('BR')])),'')
  assert.equal(editorText(new Element('DIV',[text('第一行'),new Element('DIV',[text('第二行')]),new Element('DIV',[new Element('BR')])])),'第一行\n第二行\n')
  assert.equal(editorText(new Element('DIV',[text('第一行'),new Element('BR'),new Element('BR',[],{'data-editor-placeholder':''})])),'第一行\n')
  assert.equal(editorHasPlainEmoji(new Element('DIV',[text('[微笑]')])),true)
  assert.equal(editorHasPlainEmoji(new Element('DIV',[text('[未知表情]')])),false)
  assert.equal(editorHasPlainEmoji(root),false,'image atoms are already rendered')
})

test('choosing a member replaces only the active query and preserves the real wxId even when named undefined',()=>{
  const body = '😀 你好 @und 后面的文字',start = body.indexOf('@'),end = body.indexOf(' 后')
  const result = mentions.insertMention(body,{start,end,query:'und'},member,[])
  assert.equal(result.body,'😀 你好 @undefined\u2005 后面的文字')
  assert.equal(result.mentions[0].wxId,member.wxId)
  assert.equal(result.body.slice(result.mentions[0].start,result.mentions[0].end),'@undefined')
  assert.equal(mentions.mentionQuery(result.body,result.caret,result.caret,result.mentions),null)
  assert.equal(mentions.mentionQuery(result.body,result.mentions[0].end,result.mentions[0].end,result.mentions),null)
})

test('editing before/after mentions adjusts offsets and editing or deleting the actual label removes its notification ID',()=>{
  const first = mentions.insertMention('@',{start:0,end:1,query:''},member,[])
  const prefixed = '😀 '+first.body
  const shifted = mentions.editMentions(first.body,prefixed,first.mentions)
  assert.equal(shifted[0].start,3)
  assert.equal(shifted[0].wxId,member.wxId)
  assert.equal(mentions.editMentions(prefixed,prefixed+'后文',shifted).length,1)
  assert.equal(mentions.editMentions(prefixed,prefixed.replace('undefined','changed'),shifted).length,0)
  assert.equal(mentions.editMentions(prefixed,'',shifted).length,0)
  const inserted = mentions.replaceMentionRange(first.mentions,0,0,1)
  assert.equal(inserted[0].start,1,'inserting another @ at the same offset preserves the original member')
})

test('inline sends deduplicate wxIds, respect all-member exclusivity and preserve old checkbox drafts',()=>{
  const first = mentions.insertMention('@',{start:0,end:1,query:''},member,[])
  const body = first.body+'@'
  const twice = mentions.insertMention(body,{start:body.length-1,end:body.length,query:''},member,first.mentions)
  assert.deepEqual(plain(mentions.composerMentions(twice.body,[],false,twice.mentions)),{body:twice.body,mentions:{memberIds:[member.wxId],inline:true}})
  const everyone = mentions.insertMention('@',{start:0,end:1,query:''},{wxId:'notify@all',name:'所有人',displayName:''},[])
  assert.deepEqual(plain(mentions.composerMentions(everyone.body,[member],false,everyone.mentions).mentions),{all:true,inline:true})
  assert.deepEqual(plain(mentions.composerMentions('旧草稿',[member],false,[])),{body:'旧草稿',mentions:{memberIds:[member.wxId]}})
  assert.equal(mentions.composerMentions('已删除',[],false,first.mentions).mentions,undefined)
})

test('WeChat emoji picker uses the existing local WebP catalog and sends supported bracket aliases',()=>{
  const manifest = require('../src/webui/public/emoji/manifest.json')
  const emoji = load('lib/wechat-emoji.ts',{'../../../src/webui/public/emoji/manifest.json':manifest})
  const aliases = require('../src/webui/public/wechat-emoji')
  assert.equal(emoji.wechatEmoji.length,110)
  for(const item of emoji.wechatEmoji) {
    assert.equal(item.url,aliases[item.text])
    assert.match(item.url,/^\/assets\/wechat-emoji\/emoji-[a-f0-9]{16}\.webp$/)
    assert(fs.existsSync(path.join(__dirname,'../src/webui/public/emoji',path.basename(item.url))))
  }
  assert(emoji.wechatEmojiByText.get('[微笑]'))
  const {MessageText} = load('features/message-content.tsx',{
    '@/lib/wechat-emoji':emoji,'@/lib/messages-api':{},'@/components/ui/button':{},'./article-cards':{},'./media-attachment':{},
  })
  const html = require('react-dom/server').renderToStaticMarkup(require('react').createElement(MessageText,{body:'你好[微笑][不存在的表情]<script>plain</script>'}))
  assert(html.includes(`src="${emoji.wechatEmojiByText.get('[微笑]').url}"`))
  assert(html.includes('[不存在的表情]'))
  assert(html.includes('&lt;script&gt;plain&lt;/script&gt;'))
})
