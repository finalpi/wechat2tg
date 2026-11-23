/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),vm = require('node:vm')
const {Api} = require('telegram'),auth = require('telegram/client/auth')
const {safeErrorDetails} = require('../dist/util/SafeError')

function fixture({rejectPrompt = false} = {}) {
  const exports = {},timers = new Map(),prompts = [],calls = [],errors = []
  let id = 0,starts = 0,wechat = 0,refresh = 0
  const gram = {
    sendCode(credentials,number,forceSMS) {return auth.sendCode(this,credentials,number,forceSMS)},
    async invoke(request) {
      calls.push(request.className)
      if(request instanceof Api.auth.SendCode)return {phoneCodeHash:'synthetic',type:new Api.auth.SentCodeTypeApp({length:5})}
      assert.ok(request instanceof Api.auth.SignIn)
      return {user:{id:7}}
    },
  }
  const client = {hasLogin:false,async login(params) {
    starts++
    await auth.signInUser(gram,{apiId:1,apiHash:'synthetic'},params)
    client.hasLogin = true
    return true
  }}
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/client/TelegramBotClient'),'utf8'),{
    exports,require(name) {
      if(name === '../base/BaseClient')return {AbstractClient:class {static getSpyClient() {return client}}}
      if(name === '../util/SafeError')return {safeErrorDetails}
      return {}
    },
    setInterval(fn) {timers.set(++id,fn);return id},clearInterval(handle) {timers.delete(handle)},
  })
  const bot = Object.create(exports.TelegramBotClient.prototype)
  Object.assign(bot,{chatId:7,phoneCode:'',i18n:{t:key=>key},logger:{error(...args) {errors.push(args)}},
    client:{telegram:{async sendMessage(_owner,text) {
      if(rejectPrompt && text !== 'login.success') {rejectPrompt = false;throw new Error('synthetic send failure')}
      prompts.push(text);return {message_id:prompts.length}
    },async deleteMessage() {return true}}},
    refreshDisplayMembership() {refresh++},loginWechatClient() {wechat++},
  })
  const flush = ()=>new Promise(resolve=>setImmediate(resolve))
  const tick = async()=>{for(const poll of [...timers.values()])poll();await flush()}
  return {bot,calls,prompts,errors,timers,flush,tick,get starts() {return starts},get wechat() {return wechat},get refresh() {return refresh}}
}

test('startup and repeated login triggers share one flow before and after requesting a code',async()=>{
  const f = fixture(),task = f.bot.loginUserClient()
  assert.equal(f.bot.loginUserClient(),task)
  assert.equal(f.bot.loginUserClient(),task)
  await f.flush()
  assert.equal(f.starts,1)
  assert.deepEqual(f.prompts,['auth.phone_number'])
  f.bot.phoneNumber = '+00000000000'
  await f.tick()
  assert.equal(f.bot.loginUserClient(),task)
  assert.deepEqual(f.calls,['auth.SendCode'])
  assert.deepEqual(f.prompts,['auth.phone_number','auth.verification_code'])
  f.bot.phoneCode = '12345#'
  await f.tick()
  await task
  assert.deepEqual(f.calls,['auth.SendCode','auth.SignIn'])
  assert.equal(f.wechat,1)
  assert.equal(f.refresh,1)
  assert.equal(f.errors.length,0)
  assert.equal(f.timers.size,0)
  await f.bot.loginUserClient()
  assert.equal(f.starts,1)
  assert.equal(f.wechat,1)
})

test('a failed prompt ends the shared flow and a manual retry can start fresh',async()=>{
  const f = fixture({rejectPrompt:true}),failed = f.bot.loginUserClient()
  assert.equal(f.bot.loginUserClient(),failed)
  await failed
  assert.equal(f.starts,1)
  assert.equal(f.errors.length,1)
  assert.equal(f.timers.size,0)
  assert.deepEqual(f.calls,[])
  const retry = f.bot.loginUserClient()
  assert.notEqual(retry,failed)
  await f.flush()
  assert.equal(f.starts,2)
  assert.deepEqual(f.prompts,['auth.phone_number'])
  f.bot.phoneNumber = '+00000000000'
  await f.tick()
  f.bot.phoneCode = '12345#'
  await f.tick()
  await retry
  assert.deepEqual(f.calls,['auth.SendCode','auth.SignIn'])
})