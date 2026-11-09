/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm')
const {EventEmitter} = require('node:events')

function launch(env = {},args = []) {
  const calls = [],logs = [],signals = []
  const child = new EventEmitter()
  child.kill = signal=>signals.push(signal)
  const process = Object.assign(new EventEmitter(),{env:{WEBUI_TOKEN:'synthetic-launcher-token',...env},argv:['node','dev-webui.cjs',...args],execPath:'/node',exit:code=>{throw Error('Unexpected exit ' + code)}})
  const dependencies = {
    'node:child_process':{spawnSync:(...args)=>{calls.push(args);return {status:0}},spawn:(...args)=>{calls.push(args);return child}},
    'node:fs':{mkdirSync:()=>undefined},'node:path':path,'node:crypto':require('node:crypto'),dotenv:{config:()=>undefined},
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../scripts/dev-webui.cjs'),'utf8'),{
    __dirname:path.join(__dirname,'../scripts'),process,console:{log:value=>logs.push(value),error:value=>logs.push(value)},
    require:name=>{assert(name in dependencies);return dependencies[name]},
  })
  return {calls,logs,signals,process,child}
}

test('dev:webui defaults to the demo entry and forwards bind address, token and shutdown',()=>{
  const f = launch({WEBUI_HOST:'0.0.0.0',WEBUI_PORT:'18000'})
  assert.equal(f.calls[0][0],'npm')
  assert.equal(f.calls[0][1].join(' '),'run build')
  assert.equal(f.calls[1][1][0],'dist/webui/dev.js')
  assert.equal(f.calls[1][2].env.WEBUI_HOST,'0.0.0.0')
  assert.equal(f.calls[1][2].env.WEBUI_PORT,'18000')
  assert.equal(f.calls[1][2].env.WEBUI_TOKEN,'synthetic-launcher-token')
  assert(f.logs.some(text=>text.includes('演示模式')))
  assert(f.logs.some(text=>text.includes('监听地址：0.0.0.0:18000')))
  f.process.emit('SIGTERM')
  assert.deepEqual(f.signals,['SIGTERM'])
  f.child.emit('exit',0)
  assert.equal(f.process.exitCode,0)
})

for(const [env,args] of [[{WEBUI_MOCK:'false'},[]],[{},['--no-mock']]]) {
  test(`dev:webui explicit opt-out retains the disconnected standalone entry ${JSON.stringify({env,args})}`,()=>{
    const f = launch(env,args)
    assert.equal(f.calls[1][1][0],'dist/webui/standalone.js')
    assert(f.logs.some(text=>text.includes('未连接消息服务')))
  })
}