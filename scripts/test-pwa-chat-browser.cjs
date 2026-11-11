/* eslint-disable @typescript-eslint/no-var-requires */
/* global window,document,navigator,caches,localStorage */
// Real service workers and HTTP, synthetic accounts/messages only.
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')
const {generateServiceWorker} = require('./pwa-build.cjs')
async function main(){
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pwa-chat-browser-')),publicDirectory = path.join(dir,'public')
 fs.cpSync(path.join(__dirname,'../dist/webui/public'),publicDirectory,{recursive:true})
 const token = 'pwa-private-token-fixture',secret = 'pwa-private-message-fixture',wxId = 'synthetic@chatroom',events = createMessageEvents()
 const rows = Array.from({length:100},(_,i)=>({id:i + 1,wxId,remoteId:String(i + 1),senderId:'member',senderName:'测试成员',body:`${secret} ${i + 1}`,direction:i % 3 ? 'incoming' : 'outgoing',type:'text',status:i % 3 ? 'received' : 'submitted',timestamp:1700000000 + i,bodyFormat:'plain',telegramTracked:false,canRevoke:false}))
 Object.assign(rows[94],{senderId:'',senderName:'未识别成员甲'})
 Object.assign(rows[95],{senderId:'',senderName:'未识别成员乙'})
 let streams = 0,configReads = 0,sends = 0
 const server = createWebUIServer({environment:{},token,file:path.join(dir,'settings.json'),publicDirectory,runtime:{read:async()=>{configReads++;return {}},save:async()=>undefined},messages:{
  subscribe:listener=>{streams++;const stop = events.subscribe(listener);return()=>{streams--;stop()}},
  status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
  contacts:async()=>({contacts:[{wxId,name:'测试聊天群',kind:'group',lastBody:secret,lastActivity:1700000100}],hasMore:false,offset:1}),
  history:async(_id,before,q)=>{const list = rows.filter(r=>(!before || r.id < before) && (!q || r.body.includes(q)));return{messages:list.slice(-50),hasMore:list.length > 50,before:list.slice(-50)[0]?.id || 0,serverTime:1700000100}},
  updates:async(_id,ids)=>({messages:rows.filter(r=>ids.includes(r.id)),serverTime:1700000100}),
  send:async()=>{sends++;throw Error('No sends expected')},
 }})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const origin = `http://127.0.0.1:${server.address().port}`
 const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p))
 let browser
 try{
  browser = await chromium.launch({executablePath,headless:true})
  const context = await browser.newContext({viewport:{width:1440,height:900}})
  await context.addInitScript(token=>localStorage.setItem('webui-access-token',token),token)
  const page = await context.newPage(),errors = []
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  await page.goto(origin + '/chat')
  await page.getByLabel('会话列表',{exact:true}).waitFor()
  assert.equal(configReads,0,'chat must not load the management configuration')
  assert.equal(await page.getByLabel('主导航').count(),0)
  await page.evaluate(()=>navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller))
  await page.getByLabel('会话列表',{exact:true}).getByRole('button',{name:/测试聊天群/}).click()
  const input = page.getByLabel('消息内容',{exact:true}),viewport = page.getByLabel('消息记录',{exact:true})
  await input.fill('切换模式保留草稿')
  await page.goBack()
  await page.getByLabel('消息内容',{exact:true}).waitFor({state:'detached'})
  await page.goForward()
  await input.waitFor()
  await page.getByText('未识别成员甲',{exact:true}).waitFor()
  await page.getByText('未识别成员乙',{exact:true}).waitFor() // missing IDs must not merge distinct authors
  assert.equal(await input.innerText(),'切换模式保留草稿','browser back/forward retain the conversation draft')
  await page.getByRole('button',{name:'专注当前会话'}).click()
  assert(await page.getByLabel('会话侧栏',{exact:true}).isHidden())
  assert.equal(await input.innerText(),'切换模式保留草稿')
  await page.getByRole('button',{name:'显示会话列表'}).click()
  assert(await page.getByLabel('会话侧栏',{exact:true}).isVisible())
  await page.getByRole('separator',{name:'调整侧栏宽度'}).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('separator',{name:'调整侧栏宽度'}).getAttribute('aria-valuenow'),'336')
  await viewport.hover()
  await page.mouse.wheel(0,-600)
  await page.waitForFunction(()=>{const el = document.querySelector('[aria-label="消息记录"]');return el.scrollTop < el.scrollHeight - el.clientHeight - 100})
  await page.evaluate(()=>new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r))))
  // content-visibility may replace intrinsic heights above the viewport. Compare
  // the visible message anchor, not an absolute scrollTop that should then move.
  const readingPosition = el=>{
   const top = el.getBoundingClientRect().top
   const anchor = [...el.querySelectorAll('[data-message-id]')].find(item=>item.getBoundingClientRect().bottom > top + 1)
   return {id:anchor?.dataset.messageId,offset:anchor ? anchor.getBoundingClientRect().top - top : null,top:el.scrollTop,height:el.scrollHeight}
  }
  const beforeScroll = await viewport.evaluate(readingPosition)
  await page.getByRole('button',{name:'聊天菜单'}).click()
  await page.getByRole('button',{name:'管理设置',exact:true}).click()
  await page.getByLabel('主导航').waitFor()
  assert.equal(new URL(page.url()).pathname,'/manage')
  await page.getByRole('button',{name:'返回聊天',exact:true}).click()
  await input.waitFor()
  assert.equal(await input.innerText(),'切换模式保留草稿')
  const afterScroll = await viewport.evaluate(readingPosition)
  assert(beforeScroll.id && beforeScroll.id === afterScroll.id && Math.abs(afterScroll.offset - beforeScroll.offset) < 5,`management switch retains the visible reading position: ${JSON.stringify({beforeScroll,afterScroll})}`)
  assert.equal(streams,1,'switching shell must not create a second SSE connection')
  if(process.env.PWA_CHAT_SCREENSHOT_DIR){fs.mkdirSync(process.env.PWA_CHAT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PWA_CHAT_SCREENSHOT_DIR,'desktop.png'),animations:'disabled'})}
  await input.fill('')
  await page.getByRole('button',{name:'聊天菜单'}).click()
  await page.getByRole('button',{name:'管理设置',exact:true}).click()
  await page.getByRole('button',{name:'MCP 接入',exact:true}).click()
  const endpoint = page.getByPlaceholder('例如 https://example.com/mcp')
  const originalEndpoint = await endpoint.inputValue()
  await endpoint.fill('https://draft.example/mcp')
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false,'MCP drafts also block updates')
  await endpoint.fill(originalEndpoint)
  assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true)
  await page.getByRole('button',{name:'返回聊天',exact:true}).click()
  for(const height of [780,360]){
   await page.setViewportSize({width:390,height})
   await input.fill('键盘与长草稿\n'.repeat(18))
   await page.waitForFunction(height=>document.querySelector('[data-workspace]').getBoundingClientRect().height <= height,height)
   const box = await input.boundingBox()
   const geometry = await page.evaluate(()=>({height:window.visualViewport?.height,top:window.visualViewport?.offsetTop,root:document.querySelector('[data-workspace]').getBoundingClientRect().toJSON()}))
   assert(box.y + box.height <= height + 1,`composer must fit in the visible keyboard viewport: ${JSON.stringify({height,box,geometry})}`)
   assert(box.height <= 161,'long input does not grow without limit')
   assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth))
  }
  await page.setViewportSize({width:390,height:780})
  await input.fill('更新前必须保留的草稿')
  if(process.env.PWA_CHAT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.PWA_CHAT_SCREENSHOT_DIR,'mobile.png'),animations:'disabled'})
  const other = await context.newPage();other.setDefaultTimeout(10000)
  await other.goto(origin + '/chat')
  await other.getByLabel('会话列表',{exact:true}).getByRole('button',{name:/测试聊天群/}).click()
  await other.getByLabel('消息内容',{exact:true}).fill('另一个窗口的草稿')
  let navigations = 0,otherNavigations = 0
  page.on('framenavigated',f=>{if(f === page.mainFrame())navigations++})
  other.on('framenavigated',f=>{if(f === other.mainFrame())otherNavigations++})
  fs.appendFileSync(path.join(publicDirectory,'index.html'),'\n<!-- synthetic next build -->\n')
  generateServiceWorker(publicDirectory)
  await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update()})
  await page.getByRole('button',{name:'更新应用',exact:true}).waitFor()
  await page.getByRole('button',{name:'更新应用',exact:true}).click()
  await page.getByText('存在未保存或正在提交的编辑，请完成后再更新。',{exact:true}).waitFor()
  assert.equal(navigations,0)
  assert.equal(await input.innerText(),'更新前必须保留的草稿')
  await input.fill('')
  // Insert an edit after approval but before the real worker receives activation.
  // This deterministically exercises React draft guards during the worker race.
  await page.evaluate(async()=>{
   const worker = (await navigator.serviceWorker.getRegistration()).waiting
   const post = worker.postMessage
   worker.postMessage = function(...args){
    worker.postMessage = post
    const field = document.querySelector('#message-body')
    field.textContent = '激活期间的新草稿'
    field.dispatchEvent(new Event('input',{bubbles:true}))
    return post.apply(this,args)
   }
  })
  await page.getByRole('button',{name:'更新应用',exact:true}).click()
  await page.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration()).waiting)
  await page.getByText('存在未保存或正在提交的编辑，请完成后再更新。',{exact:true}).waitFor()
  assert.equal(navigations,0,'activation must recheck edits before reloading')
  assert.equal(await input.innerText(),'激活期间的新草稿')
  await input.fill('')
  await page.getByRole('button',{name:'更新应用',exact:true}).click()
  await page.waitForFunction(()=>!document.body.textContent.includes('新版本已就绪') && document.querySelector('[aria-label="会话列表"]'))
  assert.equal(navigations,1,'only the approving tab reloads')
  assert.equal(otherNavigations,0)
  assert.equal(await other.getByLabel('消息内容',{exact:true}).innerText(),'另一个窗口的草稿')
  const cached = await page.evaluate(async()=>{
   const entries = []
   for(const name of await caches.keys())for(const r of await (await caches.open(name)).keys()){
    const response = await (await caches.open(name)).match(r)
    entries.push({url:r.url,text:/text|javascript|json/.test(response.headers.get('content-type') || '') ? await response.text() : ''})
   }
   return entries
  })
  assert(cached.some(e=>e.url.endsWith('/index.html')))
  assert(cached.every(e=>!e.url.includes('/api/') && !e.url.includes('?')))
  assert(!JSON.stringify(cached).includes(token));assert(!JSON.stringify(cached).includes(secret))
  await context.setOffline(true)
  await other.getByLabel('消息内容',{exact:true}).fill('离线仍可保留的草稿')
  assert(await other.getByRole('button',{name:'发送',exact:true}).isDisabled(),'offline drafts are editable but never sent automatically')
  const offline = await context.newPage()
  await offline.goto(origin + '/chat')
  await offline.locator('[data-workspace="chat"]').waitFor()
  await offline.getByRole('alert').waitFor()
  assert(!await offline.locator('body').innerText().then(text=>text.includes(secret)),'offline shell must not serve cached messages')
  assert.equal(await offline.evaluate(async()=>{try{await fetch('/api/messages/status');return false}catch{return true}}),true)
  await offline.getByRole('button',{name:'聊天菜单'}).click()
  await offline.getByRole('button',{name:'退出登录',exact:true}).click()
  await offline.getByLabel('访问令牌',{exact:true}).waitFor()
  await other.getByLabel('访问令牌',{exact:true}).waitFor()
  assert.equal(await other.getByLabel('消息内容',{exact:true}).count(),0,'browser/PWA logout clears the other tab session and draft')
  assert.equal(sends,0)
  assert.deepEqual(errors,[])
  console.log('PWA/chat browser passed: chat-only shell, focus, sizing, drafts/scroll, keyboard viewport, real SW, guarded update, other-tab preservation, public-only caches, offline shell; no sends.')
 }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(e);process.exitCode = 1})