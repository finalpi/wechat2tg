/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')

function fixture({file = false, quote = false} = {}) {
  const slots = [],pendingEffects = [],calls = []
  let cursor = 0,dirty = false,tree,editable = true,resolveSend,rejectSend
  const document = {body:{},visibilityState:'visible',addEventListener(){},removeEventListener(){}}
  document.activeElement = document.body
  const element = {style:{},scrollHeight:44,isConnected:true,getClientRects:()=>[{}]}
  const editor = {element,focus:()=>{assert(editable,'focus waits until editing is enabled');calls.push('focus');document.activeElement=element},setSelectionRange:(start,end)=>calls.push(['caret',start,end])}
  const composer = {contains:active=>active===element || active?.inside}
  const effect = (callback,deps) => {
    const index=cursor++,previous=slots[index]
    if (!previous || deps.some((value,i)=>!Object.is(value,previous.deps[i]))) {
      slots[index]={deps,cleanup:previous?.cleanup}
      pendingEffects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=callback()})
    }
  }
  const react = {
    useId:()=> 'focus-fixture',useEffect:effect,useLayoutEffect:effect,
    useState:initial=>{
      const index=cursor++
      if (!slots[index]) slots[index]={value:initial}
      return [slots[index].value,next=>{
        const value=typeof next==='function'?next(slots[index].value):next
        if (!Object.is(value,slots[index].value)) {slots[index].value=value;dirty=true}
      }]
    },
    useRef:initial=>{const index=cursor++;if(!slots[index])slots[index]={current:initial};return slots[index]},
  }
  const jsx = (type,props)=>({type,props})
  const draft = {body:file?'':'发送测试',...(file?{file:{name:'fixture.txt',size:16}}:{})}
  const quoted = quote?{id:1,body:'引用'}:null
  const dependencies = {
    react,'react/jsx-runtime':{jsx,jsxs:jsx},
    '@/lib/request-id':{createRequestId:()=> 'fixture-request-id'},
    '@/lib/messages-api':{messagesApi:{
      upload:async()=>({id:'fixture-file'}),
      send:async()=>new Promise((resolve,reject)=>{resolveSend=resolve;rejectSend=reject}),
    },messageError:error=>error.message},
    '@/lib/composer-mentions':{composerMentions:body=>({body})},
    './message-editor':{MessageEditor:'MessageEditor'},
    '@/components/ui/button':{Button:'Button'},
  }
  const exports = {},filename = path.join(__dirname,'../webui/src/features/message-composer.tsx')
  const source = ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(source,{exports,document,
    window:{innerHeight:1000,addEventListener(){},removeEventListener(){}},ResizeObserver:class {observe(){} disconnect(){}},
    require:name=>dependencies[name] || {},
  })
  const visit = (node,callback) => {
    if (!node || typeof node!=='object') return
    if (Array.isArray(node)) {node.forEach(item=>visit(item,callback));return}
    callback(node);visit(node.props?.children,callback)
  }
  const render = () => {
    let attempts=0
    do {
      assert(attempts++<15,'render settles')
      dirty=false;cursor=0
      tree=exports.MessageComposer({token:'fixture',contact:{wxId:'fixture-contact',kind:'contact'},online:true,draft,
        quote:quoted,onSent:()=>calls.push('sent'),onClearQuote:()=>{},onAuthError:()=>{}})
      tree.props.ref.current=composer
      visit(tree,node=>{if(node.type==='MessageEditor'){node.props.ref.current=editor;editable=!node.props.disabled}})
      while(pendingEffects.length)pendingEffects.shift()()
    } while(dirty)
  }
  const send = async () => {
    let submit
    visit(tree,node=>{if(node.type==='Button' && node.props['aria-label']==='发送')submit=node.props.onClick})
    const completion=submit()
    for(let turn=0;!resolveSend && turn<5;turn++)await Promise.resolve()
    assert(resolveSend,'send request started')
    return {completion}
  }
  render()
  return {calls,document,element,draft,render,send,
    resolve:()=>resolveSend({id:1}),reject:()=>rejectSend(Error('synthetic failure')),
    unmount:()=>slots.forEach(slot=>slot?.cleanup?.()),
  }
}

for (const options of [{},{file:true},{quote:true}]) {
  test(`successful ${options.file?'attachment':options.quote?'quoted':'text'} sends restore the cleared editor after unlock`,async()=>{
    const f=fixture(options)
    const {completion}=await f.send()
    f.render();assert(!f.calls.includes('focus'))
    f.resolve();await completion;f.render()
    assert.equal(f.document.activeElement,f.element)
    assert.deepEqual(f.calls,['sent','focus',['caret',0,0]])
    f.render();assert.equal(f.calls.filter(value=>value==='focus').length,1)
  })
}

test('a fast response that settles before the busy render still restores editor focus',async()=>{
  const f=fixture(),{completion}=await f.send()
  f.resolve();await completion;f.render()
  assert.equal(f.document.activeElement,f.element)
})

test('failed sends retain the draft and leave retry controls focused',async()=>{
  const f=fixture(),{completion}=await f.send()
  f.render();f.reject();await completion;f.render()
  assert(!f.calls.includes('focus'));assert.equal(f.draft.body,'发送测试')
})

test('switching conversations, opening another input, or hiding the editor during a send preserves the current focus',async()=>{
  for(const state of ['unmounted','other-input','hidden','disconnected']) {
    const f=fixture(),{completion}=await f.send()
    f.render()
    if(state==='unmounted')f.unmount()
    if(state==='other-input')f.document.activeElement={outside:true}
    if(state==='hidden')f.element.getClientRects=()=>[]
    if(state==='disconnected')f.element.isConnected=false
    f.resolve();await completion
    if(state!=='unmounted')f.render()
    assert(!f.calls.includes('focus'),state)
  }
})
