/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')

function fixture(patch = {}) {
  const exports = {}, timers = new Map(), events = new Map(), states = [], callbacks = []
  let next = 0, adds = 0
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../webui/src/lib/telegram-home-screen.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(source,{exports,setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)})
  const app = {isVersionAtLeast:version=>version === '8.0',onEvent:(name,fn)=>events.set(name,fn),offEvent:name=>events.delete(name),
    checkHomeScreenStatus:callback=>callbacks.push(callback),addToHomeScreen:()=>{adds++},...patch}
  const controller = exports.createTelegramHomeScreen(app,state=>states.push(state))
  return {controller,events,callbacks,states,timers,get adds(){return adds},get state(){return states.at(-1)},
    flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn()}}}
}

test('older and unsupported Mini App clients retain an explanatory disabled state without native calls', () => {
  for(const patch of [{isVersionAtLeast:()=>false},{addToHomeScreen:undefined},{checkHomeScreenStatus:undefined},{isVersionAtLeast:()=>{throw Error('unsupported')}}]){
    const f = fixture(patch)
    assert.equal(f.state.status,'unsupported');assert.equal(f.state.checking,false)
    f.controller.add();f.controller.check()
    assert.equal(f.adds,0);assert.equal(f.callbacks.length,0)
    f.controller.dispose();assert.equal(f.events.size,0)
  }
})

test('checking is read-only; addition requires an explicit click and only native confirmation means added', () => {
  const f = fixture()
  assert.equal(f.state.checking,true);assert.equal(f.adds,0)
  f.controller.add();assert.equal(f.adds,0)
  f.callbacks[0]('missed')
  f.controller.add();f.controller.add()
  assert.equal(f.adds,1);assert.equal(f.state.pending,true);assert.equal(f.state.status,'unknown')
  f.flush();assert.equal(f.state.pending,false);assert.equal(f.state.status,'unknown')
  f.events.get('homeScreenAdded')()
  assert.equal(f.state.status,'added')
  f.events.get('homeScreenChecked')({status:'missed'})
  f.callbacks[0]('missed')
  assert.equal(f.state.status,'added','late status checks cannot undo a positive native event')
  f.controller.add();assert.equal(f.adds,1)
  f.controller.dispose();assert.equal(f.events.size,0);assert.equal(f.timers.size,0)
})

test('unknown installation status remains actionable, while added and unsupported statuses do not', () => {
  for(const [status,count] of [['unknown',1],['missed',1],['added',0],['unsupported',0],['unexpected-client-value',1]]){
    const f = fixture();f.callbacks[0](status);f.controller.add()
    assert.equal(f.adds,count,status)
    f.controller.dispose()
  }
})

test('a status timeout and native exceptions never fabricate an installation success', () => {
  const timeout = fixture();timeout.flush()
  assert.equal(timeout.state.checking,false);assert.equal(timeout.state.status,'unknown')
  timeout.controller.add();assert.equal(timeout.adds,1);timeout.controller.dispose()
  const failure = fixture({checkHomeScreenStatus:()=>{throw Error('SDK failed')},addToHomeScreen:()=>{throw Error('native prompt failed')}})
  assert.equal(failure.state.status,'unknown');failure.controller.add()
  assert.equal(failure.state.pending,false);assert.equal(failure.state.status,'unknown')
  assert.match(failure.state.message,/无法打开/);failure.controller.dispose()
})

test('disposal ignores delayed callbacks/events and cancels pending work', () => {
  const f = fixture(), callback = f.callbacks[0], event = f.events.get('homeScreenAdded')
  const count = f.states.length
  f.controller.dispose();callback('added');event();f.flush();f.controller.add()
  assert.equal(f.states.length,count);assert.equal(f.adds,0);assert.equal(f.timers.size,0)
})

test('superseded status callbacks cannot override the newest check', () => {
  const f = fixture()
  f.controller.check();f.callbacks[0]('unsupported')
  assert.equal(f.state.checking,true)
  f.callbacks[1]('missed');assert.equal(f.state.status,'missed')
  f.controller.dispose()
})