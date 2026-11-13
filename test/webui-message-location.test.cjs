/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')

function fixture({reducedMotion = false, animations = true} = {}) {
  const frames = new Map(),timers = new Map(),listeners = new Map(),scrolls = [],effects = [],classes = new Set()
  let nextId = 0,scrollTop = 900
  const bubble = {
    dataset:{},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
    removeAttribute:name=>{if(name==='data-locate-active')delete bubble.dataset.locateActive},
    animate:animations ? (keyframes,options)=>{
      let finish,reject
      const animation = {keyframes,options,finished:new Promise((resolve,fail)=>{finish=resolve;reject=fail}),
        finish:()=>finish(),cancel:()=>{animation.cancelled=true;reject(Error('cancelled'))}}
      effects.push(animation)
      return animation
    } : undefined,
  }
  const viewport = {
    querySelector:selector=>selector==='[data-message-id="18"]'?{querySelector:()=>bubble}:null,
    addEventListener:(name,callback)=>listeners.set(name,callback),
    removeEventListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name)},
  }
  const exports = {},source=fs.readFileSync(path.join(__dirname,'../webui/src/lib/message-location.ts'),'utf8')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,{
    exports,window:{matchMedia:()=>({matches:reducedMotion}),setTimeout:(callback,delay)=>{const id=++nextId;timers.set(id,{callback,delay});return id},clearTimeout:id=>timers.delete(id)},
    requestAnimationFrame:callback=>{const id=++nextId;frames.set(id,callback);return id},cancelAnimationFrame:id=>frames.delete(id),
  })
  return {...exports,viewport,bubble,scrolls,effects,classes,frames,timers,listeners,
    scroll:(id,options)=>{scrolls.push({id,options,from:scrollTop});scrollTop=300},
    moveAway:()=>{scrollTop=1200},
    flushFrames:()=>{for(const [id,callback] of frames){frames.delete(id);callback()}},
    arrive:()=>listeners.get('scrollend')?.(),
    flushTimers:()=>{for(const [id,timer] of [...timers]){timers.delete(id);timer.callback()}},
  }
}

test('cached quote resolution honors native IDs and cannot match a conflicting local ID',()=>{
  const {findLoadedMessage}=fixture()
  const first={id:18,remoteId:'18446744073709551614'},second={id:19,remoteId:'18446744073709551613'}
  assert.equal(findLoadedMessage([first,second],{id:18,remoteId:first.remoteId}),first)
  assert.equal(findLoadedMessage([first,second],{remoteId:second.remoteId}),second)
  assert.equal(findLoadedMessage([first,second],{id:18,remoteId:second.remoteId}),undefined)
  assert.equal(findLoadedMessage([first,second],{}),undefined)
  assert.equal(findLoadedMessage([first,second],{id:0,remoteId:first.remoteId}),undefined)
})

test('each click smoothly scrolls to the same message again and highlights only after arrival',async()=>{
  const f=fixture()
  const first=f.revealMessage({id:18},f.viewport,f.scroll)
  f.flushFrames()
  assert.equal(f.scrolls.length,1);assert.equal(f.scrolls[0].options.behavior,'smooth')
  assert.equal(f.effects.length,0,'the glow follows the scrolling transition')
  f.arrive();assert.equal(f.bubble.dataset.locateActive,'true');assert.equal(f.effects.length,1)
  f.effects[0].finish();await Promise.resolve()
  assert.equal(f.bubble.dataset.locateActive,undefined,'the highlight fades instead of becoming a permanent border')
  first();f.moveAway()
  const second=f.revealMessage({id:18},f.viewport,f.scroll)
  f.flushFrames();f.arrive()
  assert.equal(f.scrolls.length,2);assert.equal(f.scrolls[1].from,1200)
  assert.equal(f.effects.length,2);assert.equal(f.bubble.dataset.locateActive,'true')
  second();await Promise.resolve()
  assert.equal(f.bubble.dataset.locateActive,undefined)
  assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0)
})

test('an already centered message highlights via the bounded fallback and cancellation prevents stale work',()=>{
  const f=fixture()
  const stop=f.revealMessage({id:18},f.viewport,f.scroll)
  stop();f.flushFrames();f.flushTimers()
  assert.equal(f.scrolls.length,0)
  const next=f.revealMessage({id:18},f.viewport,f.scroll)
  f.flushFrames();assert.equal(f.effects.length,0)
  f.flushTimers();assert.equal(f.effects.length,1)
  next();assert.equal(f.bubble.dataset.locateActive,undefined)
})

for(const options of [{reducedMotion:true},{animations:false}]) {
  test(`reduced-motion/static highlight is removed automatically ${JSON.stringify(options)}`,()=>{
    const f=fixture(options),stop=f.revealMessage({id:18},f.viewport,f.scroll)
    f.flushFrames();f.arrive()
    assert.equal(f.scrolls[0].options.behavior,options.reducedMotion?'auto':'smooth')
    assert.equal(f.effects.length,0);assert(f.classes.has('message-location-highlight'))
    f.flushTimers();assert.equal(f.classes.size,0);assert.equal(f.bubble.dataset.locateActive,undefined)
    stop()
  })
}

test('immediate arrival keeps the highlight timer cancellable on the next click',()=>{
  const f=fixture({reducedMotion:true})
  const stop=f.revealMessage({id:18},f.viewport,(...args)=>{f.scroll(...args);f.arrive()})
  f.flushFrames()
  assert.equal(f.timers.size,1,'only the highlight expiry remains after immediate arrival')
  stop();assert.equal(f.timers.size,0);assert.equal(f.bubble.dataset.locateActive,undefined)
})
