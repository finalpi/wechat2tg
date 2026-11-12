/* eslint-disable @typescript-eslint/no-var-requires */
/* global window, document */
// Only loopback fixtures. Never contacts a real account or AI provider.
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {AutomationEngine} = require('../dist/automation/engine')
async function main() {
 const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>fs.existsSync(p))
 assert(executablePath,'Chromium is required')
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'automation-browser-')),token = 'automation-browser-only'
 const scope = {source:'wechat',accountId:'self',groupId:'test@chatroom'},calls = []
 let availableScopes = [{...scope,name:'测试微信群'},{...scope,groupId:'',name:'目录空群不应展示'}]
 const engine = new AutomationEngine(path.join(dir,'automations.json'),{scopes:async()=>availableScopes,execute:async(...args)=>{calls.push(args);return {status:'success'}}})
 const server = createWebUIServer({environment:{},token,file:path.join(dir,'settings.json'),automation:engine})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 let browser
 try {
  browser = await chromium.launch({executablePath,headless:true})
  const page = await browser.newPage({viewport:{width:1400,height:1000}}),errors = []
  page.setDefaultTimeout(10000)
  let acceptDialogs = true
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>acceptDialogs ? d.accept() : d.dismiss())
  await page.goto('http://127.0.0.1:' + server.address().port + '/manage')
  await page.getByLabel('访问令牌',{exact:true}).fill(token)
  await page.getByRole('button',{name:'进入控制台'}).click()
  await page.locator('aside').getByRole('button',{name:'自动化',exact:true}).click()
  assert.equal(await page.getByRole('tab',{name:'群消息监听',exact:true}).getAttribute('aria-selected'),'true')
  assert.equal(await page.getByRole('switch',{name:'监听群组 目录空群不应展示',exact:true}).count(),0)
  let mutations = 0
  page.on('request',r=>{if(r.method() === 'POST' && r.url().endsWith('/api/automation'))mutations++})
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('请选择至少一个监听群',{exact:true}).waitFor()
  assert.equal(mutations,0,'missing scopes must be explained before posting')
  await page.getByRole('tab',{name:'函数库',exact:true}).click()
  await page.getByLabel('函数名称',{exact:true}).fill('午餐自动报名')
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByText('草稿已保存；线上版本未改变。').waitFor()
  await page.getByRole('button',{name:'发布函数版本',exact:true}).click()
  await page.getByText('已发布新版本，关联规则已暂停。').waitFor()
  await page.getByRole('tab',{name:'群消息监听',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  await page.getByRole('switch',{name:'监听群组 测试微信群',exact:true}).click()
  assert(await page.getByLabel('启用监听',{exact:true}).isChecked())
  assert.equal(await page.getByLabel('冷却秒数',{exact:true}).count(),0,'advanced fields start hidden')
  await page.getByLabel('报名内容',{exact:true}).fill('午餐一份')
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false,'unsaved rule inputs block PWA refresh')
  await page.getByRole('tabpanel',{name:'群消息监听'}).getByRole('button',{name:'高级设置',exact:true}).click()
  await page.getByLabel('规则名称',{exact:true}).fill('工作群午餐')
  assert(await page.getByLabel('参加微信接龙',{exact:true}).isChecked(),'built-in template has only its required capability')
  await page.getByRole('button',{name:'完成设置',exact:true}).click()
  // A second editor changes revision: show a useful error and retain the draft.
  await engine.command({operation:'saveScript',script:{name:'并发编辑草稿',source:'export default function(e,api){api.log("draft");}'},revision:(await engine.snapshot()).revision})
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('配置已被另一页面修改，请刷新后核对；当前输入保留。',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('报名内容',{exact:true}).inputValue(),'午餐一份')
  assert(await page.getByRole('switch',{name:'监听群组 测试微信群',exact:true}).isChecked())
  assert.equal((await engine.snapshot()).rules.length,0)
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听已保存。').waitFor()
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true,'saved rules release their refresh guard')
  let meta = await engine.snapshot()
  assert.equal(meta.rules.length,1);assert.equal(meta.rules[0].mode,'preview');assert.equal(meta.rules[0].enabled,true)
  assert.equal(meta.rules[0].params.entry,'午餐一份')
  assert.deepEqual(meta.rules[0].permissions,['solitaire.join'])
  acceptDialogs = false
  await page.getByRole('combobox',{name:'运行方式',exact:true}).click()
  await page.getByRole('option',{name:'实际执行（保存时需确认）',exact:true}).click()
  const beforeCancel = mutations
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  assert.equal((await engine.snapshot()).rules[0].mode,'preview')
  assert.equal(mutations,beforeCancel,'canceling live authorization must not save')
  assert.equal(await page.getByText('监听已保存。',{exact:true}).count(),0,'cancel is not a success')
  acceptDialogs = true
  await page.getByRole('combobox',{name:'运行方式',exact:true}).click()
  await page.getByRole('option',{name:'只预览，不发送',exact:true}).click()
  await page.getByRole('button',{name:'模拟这条规则',exact:true}).click()
  await page.getByRole('button',{name:'模拟运行（不会发送）',exact:true}).click()
  const output = page.getByLabel('动作预览与日志',{exact:true})
  await output.waitFor();assert.equal(JSON.parse(await output.inputValue()).actions[0].kind,'solitaire.join')
  assert.equal(calls.length,0)
  await engine.receive({...scope,id:'real-fixture',type:'solitaire.received',text:'午餐',sender:{id:'member',name:'测试成员'},timestamp:Date.now(),self:false,solitaire:{id:'fixture-round',title:'午餐',messageId:'9007199254740993123'}})
  assert.equal((await engine.snapshot()).runs[0]?.ruleName,'工作群午餐')
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('tab',{name:'运行记录',exact:true}).click()
  await page.getByText('工作群午餐',{exact:false}).waitFor()
  assert.equal(calls.length,0)
  // Editing a saved rule must retain advanced authorization, scopes and parameter types.
  meta = await engine.snapshot()
  const {id,version,failures,lastRun,daily,...stored} = meta.rules[0]
  void version;void failures;void lastRun;void daily
  const advanced = {...stored,enabled:false,permissions:['reply','send','state'],targets:[{source:'telegram',accountId:'old-account',groupId:'old-group',topicId:'42'}],senders:['member-fixture'],cooldownSeconds:37,maxActionsPerDay:43,params:{keyword:'午餐',entry:'原内容',count:2,flag:true,nested:{keep:'value'}}}
  await engine.command({operation:'saveRule',id,rule:advanced,revision:meta.revision})
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('tab',{name:'群消息监听',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  await page.getByRole('combobox',{name:'已有监听',exact:true}).click()
  await page.getByRole('option',{name:'○ 工作群午餐 · 预览',exact:true}).click()
  assert.equal(await page.getByLabel('启用监听',{exact:true}).isChecked(),false)
  await page.getByLabel('报名内容',{exact:true}).fill('仅修改报名内容')
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听已保存。',{exact:true}).waitFor()
  const preserved = (await engine.snapshot()).rules[0]
  for(const field of ['targets','permissions','senders','cooldownSeconds','maxActionsPerDay','enabled'])assert.deepEqual(preserved[field],advanced[field],field)
  assert.deepEqual(preserved.params,{...advanced.params,entry:'仅修改报名内容'})
  await page.getByRole('tab',{name:'函数库',exact:true}).click()
  await page.getByLabel('我要实现的操作',{exact:true}).fill('收到午餐接龙自动参加')
  await page.getByRole('button',{name:'复制 AI 提示词',exact:true}).click()
  await page.getByLabel('完整 AI 提示词',{exact:true}).waitFor()
  assert((await page.getByLabel('完整 AI 提示词',{exact:true}).inputValue()).includes('没有 process'))
  const generated = 'export default async function handler(e,api){api.log("generated-only");}'
  await page.route('**/api/automation/generate',async route=>{
   assert.deepEqual(route.request().postDataJSON(),{requirement:'收到午餐接龙自动参加'})
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({source:generated})})
  })
  await page.getByRole('button',{name:'用配置的 AI 生成草稿',exact:true}).click()
  await page.getByText('AI 已生成未保存草稿，请检查并模拟测试；尚未发布或启用。').waitFor()
  assert.equal(await page.locator('#automation-source').inputValue(),generated)
  assert.notEqual((await engine.snapshot()).scripts[0].draft,generated)
  await page.getByRole('button',{name:'保存草稿',exact:true}).click()
  await page.getByRole('button',{name:'发布函数版本',exact:true}).click()
  await page.getByText('已发布新版本，关联规则已暂停。').waitFor()
  meta = await engine.snapshot();assert.equal(meta.rules[0].enabled,false);assert.equal(meta.rules[0].mode,'preview')
  await page.getByRole('tab',{name:'群消息监听',exact:true}).click()
  // Reproduce a paused live rule with one valid group and an invalid second selection.
  const currentMeta = await engine.snapshot()
  const {id:existingId,version:ignoredVersion,failures:ignoredFailures,lastRun:ignoredRun,daily:ignoredDaily,...existingRule} = currentMeta.rules[0]
  void ignoredVersion;void ignoredFailures;void ignoredRun;void ignoredDaily
  await engine.command({operation:'saveRule',id:existingId,revision:currentMeta.revision,confirmLive:false,
   rule:{...existingRule,enabled:false,mode:'live',scopes:[scope],targets:[],permissions:['reply','solitaire.join'],params:{targetPosition:5}}})
  let malformedField = 'scopes',onlyInvalid = false
  const malformedMetadata = async route=>{
   if(route.request().method() !== 'GET')return route.continue()
   const response = await route.fetch(),data = await response.json()
   if(onlyInvalid)data.rules[0][malformedField] = [{...scope,groupId:''}]
   else data.rules[0][malformedField].push({...scope,groupId:''})
   data.scopes.push({...scope,groupId:'',name:'空白候选不应展示'})
   await route.fulfill({response,json:data})
  }
  await page.route('**/api/automation',malformedMetadata)
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  assert.equal(await page.getByRole('switch',{name:'监听群组 空白候选不应展示',exact:true}).count(),0)
  await page.getByRole('combobox',{name:'已有监听',exact:true}).click()
  await page.getByRole('option',{name:'○ 工作群午餐 · 实际执行',exact:true}).click()
  await page.getByLabel('搜索监听群组',{exact:true}).fill('测试')
  const beforeIncomplete = mutations
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听范围中有未选择的账号或群，请取消无效项后重新选择',{exact:true}).waitFor()
  assert.equal(mutations,beforeIncomplete,'incomplete scope never reaches saveRule')
  assert.equal(await page.getByLabel('搜索监听群组',{exact:true}).getAttribute('aria-invalid'),'true')
  assert.equal(await page.getByLabel('targetPosition',{exact:true}).inputValue(),'5')
  await page.getByText('第 2 项范围不完整，请移除后重新选择。',{exact:true}).waitFor()
  await page.getByRole('button',{name:'移除无效监听群组',exact:true}).click()
  assert.equal(await page.getByRole('switch',{name:'监听群组 未选择群（无效范围）',exact:true}).count(),0)
  assert(await page.getByRole('switch',{name:'监听群组 测试微信群',exact:true}).isChecked())
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听已保存。',{exact:true}).waitFor()
  const repaired = (await engine.snapshot()).rules[0]
  assert.deepEqual(repaired.scopes,[scope]);assert.equal(repaired.enabled,false);assert.equal(repaired.mode,'live')
  assert.deepEqual(repaired.params,{targetPosition:5});assert.deepEqual(repaired.permissions,['reply','solitaire.join'])
  assert.equal(calls.length,0,'saving a paused live rule must not execute it')
  await page.unroute('**/api/automation',malformedMetadata)
  // Exercise real backend validation and ApiError propagation, not a fabricated error response.
  const rejectedRevision = (await engine.snapshot()).revision
  const malformedRequest = async route=>{
   if(route.request().method() !== 'POST')return route.continue()
   const payload = route.request().postDataJSON()
   payload.rule.scopes.push({...scope,groupId:''})
   const response = await route.fetch({postData:JSON.stringify(payload)})
   assert.equal(response.status(),400)
   assert.deepEqual(await response.json(),{error:'scopeIncomplete',issues:[{path:['scopes',1,'groupId'],code:'required'}]})
   await route.fulfill({response})
  }
  await page.route('**/api/automation',malformedRequest)
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('第 2 项范围不完整，请移除后重新选择。',{exact:true}).waitFor()
  assert.equal((await engine.snapshot()).revision,rejectedRevision)
  assert.equal(await page.getByLabel('targetPosition',{exact:true}).inputValue(),'5')
  assert.equal(await page.getByRole('button',{name:'移除无效监听群组',exact:true}).count(),0,'server error positions alone must not delete a valid local selection')
  await page.unroute('**/api/automation',malformedRequest)
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听已保存。',{exact:true}).waitFor()
  // A bad optional target is repairable even when send permission is not enabled.
  malformedField = 'targets'
  await page.route('**/api/automation',malformedMetadata)
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  await page.getByRole('combobox',{name:'已有监听',exact:true}).click()
  await page.getByRole('option',{name:'○ 工作群午餐 · 实际执行',exact:true}).click()
  const beforeTargetRepair = mutations
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'移除无效允许发送的目标群',exact:true}).click()
  assert.equal(mutations,beforeTargetRepair)
  await page.getByRole('button',{name:'完成设置',exact:true}).click()
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('监听已保存。',{exact:true}).waitFor()
  const targetRepaired = (await engine.snapshot()).rules[0]
  assert.deepEqual(targetRepaired.targets,[]);assert.deepEqual(targetRepaired.permissions,['reply','solitaire.join'])
  assert.equal(targetRepaired.enabled,false);assert.deepEqual(targetRepaired.params,{targetPosition:5})
  // Removing the only invalid scope must still require a real group, never imply all groups.
  malformedField = 'scopes';onlyInvalid = true
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  await page.getByRole('combobox',{name:'已有监听',exact:true}).click()
  await page.getByRole('option',{name:'○ 工作群午餐 · 实际执行',exact:true}).click()
  await page.getByRole('button',{name:'移除无效监听群组',exact:true}).click()
  const beforeAllInvalid = mutations
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('请选择至少一个监听群',{exact:true}).waitFor()
  assert.equal(mutations,beforeAllInvalid)
  assert.equal(calls.length,0)
  await page.unroute('**/api/automation',malformedMetadata)
  for(const width of [390,320]) {
   await page.setViewportSize({width,height:720})
   assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1),'No horizontal overflow on mobile')
  }
  if(process.env.AUTOMATION_SCREENSHOT_PATH)await page.screenshot({path:process.env.AUTOMATION_SCREENSHOT_PATH,fullPage:true,animations:'disabled'})
  availableScopes = []
  await page.getByRole('button',{name:'刷新配置与记录',exact:true}).click()
  await page.getByRole('button',{name:'新建监听',exact:true}).click()
  await page.getByText('暂无可选群。请先登录微信 / Telegram，确认群目录或绑定已加载，再刷新配置。',{exact:true}).waitFor()
  const beforeEmptyDirectory = mutations
  await page.getByRole('button',{name:'保存监听',exact:true}).click()
  await page.getByText('请选择至少一个监听群',{exact:true}).waitFor()
  assert.equal(mutations,beforeEmptyDirectory)
  assert.deepEqual(errors,[])
  console.log('Automation browser: group-first setup, required selection, typed parameters, conflict recovery, preserved advanced settings, live cancellation, dry run, AI drafts, publish pause, mobile, empty directory — PASS; no live calls')
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode = 1})