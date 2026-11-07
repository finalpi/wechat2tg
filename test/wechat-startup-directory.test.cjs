/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const {DataSource} = require('typeorm')
const {WxBot, Contact} = require('wx2tg-puppet')
const database = require('wx2tg-puppet/dist/database/data-source')
const {configService} = require('wx2tg-puppet/dist/services/config.service')
const {contactService} = require('wx2tg-puppet/dist/services/contact.service')
const {friendApi} = require('wx2tg-puppet/dist/api/FriendApi')
const {msgApi} = require('wx2tg-puppet/dist/api/MsgApi')
const {loginApi} = require('wx2tg-puppet/dist/api/LoginApi')
const transport = require('wx2tg-puppet/dist/utils/axiosInstance')
const {WxContact} = require('../dist/entity/WxContact')
function deferred() {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}}

test('bundled SDK releases Bot startup and its SQLite mirror before directory hydration', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-startup-'))
  const file = path.join(directory, 'puppet.db'), blocked = deferred(), detailsStarted = deferred()
  const changes = [], errors = []
  let startup, mirrorTask, initialized = false
  const mirror = new DataSource({type:'sqlite',database:file,entities:[WxContact],synchronize:false})
  const create = database.createAppDataSource
  t.mock.method(database, 'createAppDataSource', file => {
    const source = create(file), initialize = source.initialize.bind(source)
    source.initialize = async () => {
      await initialize()
      await configService.save({wxid:'synthetic-owner'})
      await contactService.upsertByUsername('cached-friend', {nickName:'cached name'})
      return source
    }
    return source
  })
  const initializeMirror = mirror.initialize.bind(mirror)
  mirror.initialize = () => {initialized = true; mirrorTask = initializeMirror(); return mirrorTask}
  t.mock.method(transport, 'detectProtocolVersion', async () => true)
  t.mock.method(loginApi, 'GetCacheInfo', async () => ({data:{Message:'not cached'}}))
  t.mock.method(loginApi, 'AutoHeartBeat', async () => undefined)
  t.mock.method(msgApi, 'Sync', async () => ({data:{Code:0,Success:true,Message:'成功',Data:{AddMsgs:[]}}}))
  t.mock.method(friendApi, 'GetContractList', async () => ({data:{Success:true,Data:{ContactUsernameList:['late-friend'],CountinueFlag:0}}}))
  t.mock.method(Contact, 'fetchAndUpsertContactDetail', async () => {
    detailsStarted.resolve()
    await blocked.promise
    return contactService.upsertByUsername('late-friend', {nickName:'new name'})
  })
  const sdk = new WxBot({baseUrl:'http://127.0.0.1:1/api',databasePath:file,deviceType:'ipad'})
  t.mock.method(sdk, 'info', async () => ({wxid:'synthetic-owner'}))
  const start = sdk.start.bind(sdk)
  t.mock.method(sdk, 'start', () => {startup = start(); return startup})
  t.after(async () => {
    blocked.resolve()
    await startup
    await sdk.waitForContactSync?.()
    sdk.clearAllIntervals()
    await mirrorTask
    if(mirror.isInitialized)await mirror.destroy()
    if(database.AppDataSource?.isInitialized)await database.AppDataSource.destroy()
    fs.rmSync(directory, {recursive:true,force:true})
  })
  // Real Bot login/init methods, real installed SDK and two real SQLite connections.
  // Telegram and unrelated services remain isolated; no account/network operations.
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/client/WechatClient.js'), 'utf8'), {
    exports, process:{env:{WEBUI_ENABLED:'false'}}, setTimeout,
    require(name) {
      if(name === '../base/BaseClient')return {AbstractClient:class {static getSpyClient(){return {}}}}
      if(name === '../i18n')return {getInstance:()=>({t:key=>key})}
      if(name === '../data-sourse')return {getGeWeChatDataSource:()=>mirror}
      if(name === '../webui/message-events')return {messageEvents:{publish:event=>changes.push(event.type)}}
      return {}
    },
  })
  const bot = Object.create(exports.WeChatClient.prototype)
  bot.client = sdk
  bot.logger = {info:()=>undefined,debug:()=>undefined,warn:()=>undefined,error:(...args)=>errors.push(args)}
  bot.loginSuccess = async () => undefined
  bot.init()
  await bot.login()
  await detailsStarted.promise
  await new Promise(resolve=>setImmediate(resolve))
  const before = {initialized,online:bot.hasLogin}
  // Assert before releasing details: the previous bundled SDK stalls at this seam.
  assert.deepEqual(before, {initialized:true,online:true})
  await mirrorTask
  assert.deepEqual((await mirror.getRepository(WxContact).find()).map(row=>row.userName), ['cached-friend'])
  const beforeUpdates = changes.filter(type=>type === 'contacts').length
  blocked.resolve()
  await sdk.waitForContactSync()
  assert.deepEqual((await mirror.getRepository(WxContact).find()).map(row=>row.userName).sort(), ['cached-friend','late-friend'])
  assert(changes.filter(type=>type === 'contacts').length > beforeUpdates, 'the hydrated directory must invalidate WebUI contacts')
  assert.deepEqual(errors, [])
})