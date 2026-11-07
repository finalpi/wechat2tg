/* eslint-disable @typescript-eslint/no-var-requires */
/* global window,document,localStorage */
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')
const {parseStoredOfficialMenu} = require('wx2tg-puppet')

async function main(){
 const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p))
 const directory = fs.mkdtempSync(path.join(os.tmpdir(),'contact-directory-browser-'))
 const token = 'synthetic-directory-token',events = createMessageEvents()
 const contact = (wxId,name,category,indexLetter)=>({wxId,name,nickname:name,kind:category === 'group' ? 'group' : 'contact',category,indexLetter,hasAvatar:false,lastActivity:0,lastSequence:0,lastBody:'',lastType:'text',unsyncedCount:0})
 const group = contact('synthetic@chatroom','Fixture group','group','F')
 const service = contact('service-fixture','Service Alpha','service','S')
 const pending = contact('pending-fixture','Pending publisher','official','P')
 const moving = contact('moving-fixture','Moving publisher','official','M')
 const rows = [group,service,pending,moving,contact('member@openim','Enterprise member','enterprise','E'),contact('unknown','Unknown identity','unknown','U'),...Array.from({length:65},(_,i)=>contact('person-' + i,`Alpha person ${String(i).padStart(2,'0')}`,'person','A'))]
 const menu = parseStoredOfficialMenu({buttons:[{name:'Resources',kind:'group',children:[{name:'Documentation',kind:'url',url:'https://example.test/docs'},{name:'Event action',kind:'unsupported',reason:'event'},{name:'Mini program',kind:'unsupported',reason:'miniapp'},{name:'Authorization',kind:'unsupported',reason:'wechat'}]}]})
 let pendingReady = false,streams = 0,sends = 0,reads = 0
 const apiRequests = []
 const server = createWebUIServer({environment:{},token,file:path.join(directory,'settings.json'),messages:{
  subscribe:listener=>{streams++;const stop = events.subscribe(listener);return()=>{streams--;stop()}},
  status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
  contacts:async(q,kind,offset,order)=>{
   if(kind !== 'all')assert.equal(order,'letter','directory ordering must be requested before server pagination')
   const all = rows.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
   const counts = {person:0,group:0,official:0,service:0,enterprise:0,unknown:0};for(const c of all)counts[c.category]++
   const matches = all.filter(c=>kind === 'all' || (kind === 'contact' ? c.kind === 'contact' : c.category === kind)).sort((a,b)=>a.indexLetter.localeCompare(b.indexLetter) || a.name.localeCompare(b.name))
   return {contacts:matches.slice(offset,offset + 60),hasMore:matches.length > offset + 60,offset:offset + 60,directoryAvailable:true,counts,total:all.length,countsScope:'cached'}
  },
  officialMenu:async id=>{reads++;return id === service.wxId || id === pending.wxId && pendingReady ? {available:true,menu} : {available:false,menu:null,reason:id === pending.wxId ? 'notSynced' : 'notOfficial'}},
  history:async()=>({messages:[],hasMore:false,before:0,serverTime:1700000000}),
  send:async()=>{sends++;throw Error('No sends authorized in this fixture')},
 }})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 let browser
 try {
  browser = await chromium.launch({executablePath,headless:true})
  const context = await browser.newContext({viewport:{width:1440,height:900}})
  await context.addInitScript(token=>localStorage.setItem('webui-access-token',token),token)
  const page = await context.newPage(),errors = []
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
  page.on('request',r=>{if(r.url().includes('/api/'))apiRequests.push({url:r.url(),method:r.method()})})
  await page.goto('http://127.0.0.1:' + server.address().port + '/chat')
  await page.getByRole('tab',{name:'通讯录',exact:true}).click()
  await page.getByRole('button',{name:'分类：联系人',exact:true}).click()
  await page.getByRole('button',{name:'Alpha person 00',exact:true}).waitFor()
  assert.equal(await page.getByLabel('联系人已缓存数量',{exact:true}).innerText(),'65','count is not current page length')
  assert(await page.getByRole('region',{name:'通讯录字母 A',exact:true}).isVisible())
  await page.getByRole('button',{name:'更多会话',exact:true}).click()
  await page.getByRole('button',{name:'Alpha person 64',exact:true}).waitFor()
  await page.getByLabel('搜索通讯录',{exact:true}).fill('Alpha person 64')
  await page.waitForFunction(()=>document.querySelector('[aria-label="联系人已缓存数量"]').textContent === '1')
  assert.equal(await page.getByRole('button',{name:'Alpha person 00',exact:true}).count(),0)
  await page.getByLabel('搜索通讯录',{exact:true}).fill('')
  await page.getByRole('button',{name:'分类：公众号',exact:true}).click()
  await page.getByRole('button',{name:'Moving publisher',exact:true}).waitFor()
  moving.category = 'service';events.publish({type:'contacts'})
  await page.getByRole('button',{name:'Moving publisher',exact:true}).waitFor({state:'detached'})
  assert.equal(await page.getByLabel('公众号已缓存数量',{exact:true}).innerText(),'1')
  await page.getByRole('button',{name:'Pending publisher',exact:true}).click()
  await page.getByText('公众号菜单尚未同步；没有数据不代表没有菜单',{exact:true}).waitFor()
  pendingReady = true;events.publish({type:'contacts'})
  await page.getByRole('button',{name:'Resources',exact:true}).waitFor()
  await page.getByLabel('消息内容',{exact:true}).fill('retain directory draft')
  await page.getByRole('button',{name:'分类：服务号',exact:true}).click()
  await page.getByRole('button',{name:'Service Alpha',exact:true}).click()
  await page.getByRole('button',{name:'Resources',exact:true}).click()
  const dialog = page.getByRole('dialog')
  const link = dialog.getByRole('link',{name:'Documentation',exact:true})
  assert.equal(await link.getAttribute('href'),'https://example.test/docs')
  assert.equal(await link.getAttribute('target'),'_blank')
  assert((await link.getAttribute('rel')).includes('noopener'))
  for(const name of ['Event action','Mini program','Authorization'])assert(await dialog.getByRole('button',{name,exact:true}).isDisabled())
  await page.keyboard.press('Escape')
  const beforeIdle = reads
  await page.waitForTimeout(1300)
  assert.equal(reads,beforeIdle,'menu refresh is event-driven, not polling')
  await page.getByRole('button',{name:'分类：公众号',exact:true}).click()
  await page.getByRole('button',{name:'Pending publisher',exact:true}).click()
  assert.equal(await page.getByLabel('消息内容',{exact:true}).inputValue(),'retain directory draft')
  assert.equal(streams,1)
  if(process.env.DIRECTORY_SCREENSHOT_DIR){fs.mkdirSync(process.env.DIRECTORY_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DIRECTORY_SCREENSHOT_DIR,'desktop.png'),animations:'disabled'})}
  for(const width of [430,390,320]){
   await page.setViewportSize({width,height:720})
   await page.getByRole('button',{name:'返回会话列表',exact:true}).click()
   const services = page.getByRole('button',{name:'分类：服务号',exact:true})
   if(await services.getAttribute('aria-expanded') !== 'true')await services.click()
   await page.getByRole('button',{name:'Service Alpha',exact:true}).click()
   await page.getByRole('button',{name:'Resources',exact:true}).click()
   assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),'mobile menu must not overflow')
   await page.keyboard.press('Escape')
  }
  await page.getByRole('button',{name:'返回会话列表',exact:true}).click()
  if(process.env.DIRECTORY_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.DIRECTORY_SCREENSHOT_DIR,'mobile.png'),animations:'disabled'})
  assert.deepEqual(errors,[])
  assert.equal(sends,0)
  assert(apiRequests.every(r=>r.method === 'GET'),'directory and menu browsing must not invoke writes or native actions')
  console.log('Directory browser passed: cached category counts, >60 paging, letters, search, SSE category moves, drafts, safe menus, disabled native actions, no polling, mobile; no sends or external navigation.')
 } finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode = 1})