/* eslint-disable @typescript-eslint/no-var-requires */
/* global localStorage, HTMLButtonElement */
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'contact-refresh-browser-'))
  const events = createMessageEvents(),token = 'synthetic-refresh-token',requests = [],pending = new Set(),avatarReads = []
  const contact = (id,name,category = 'person')=>({wxId:id,name,nickname:name,category,indexLetter:'C',kind:category === 'group' ? 'group' : 'contact',hasAvatar:id === 'person-0',lastActivity:0,lastSequence:0,lastBody:'',lastType:'text',unsyncedCount:0})
  const rows = [...Array.from({length:65},(_,i)=>contact('person-' + i,`Contact ${String(i).padStart(3,'0')}`)),contact('room@chatroom','Group one','group'),contact('publisher','Publisher old','official')]
  let pause,failOffset
  const holdNext = (kind,offset = 0)=>{
    let release,started
    const gate = new Promise(resolve=>{release = resolve})
    const ready = new Promise(resolve=>{started = resolve})
    const entry = {kind,offset,gate,started,release:()=>{release();pending.delete(entry)}}
    pause = entry;pending.add(entry)
    return {ready,release:entry.release}
  }
  const server = createWebUIServer({environment:{},token,file:path.join(directory,'config.json'),mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    subscribe:listener=>events.subscribe(listener),
    status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
    contacts:async(q,kind,offset,order)=>{
      requests.push({q,kind,offset,order})
      const all = rows.filter(row=>row.name.toLowerCase().includes(q.toLowerCase()))
      const counts = {person:0,group:0,official:0,service:0,enterprise:0,unknown:0}
      all.forEach(row=>counts[row.category]++)
      const filtered = all.filter(row=>kind === 'all' || row.category === kind).sort((a,b)=>a.name.localeCompare(b.name))
      const response = structuredClone({contacts:filtered.slice(offset,offset + 60),counts,countsScope:'cached',hasMore:filtered.length > offset + 60,offset:offset + 60,directoryAvailable:true,total:all.length})
      if(pause?.kind === kind && pause.offset === offset){const held = pause;pause = undefined;held.started();await held.gate}
      if(failOffset === offset)throw Object.assign(new Error('synthetic failure'),{code:'serverError',status:503})
      return response
    },
    history:async()=>({messages:[],hasMore:false,before:0,serverTime:1700000000}),
    avatar:async wxId=>{avatarReads.push(wxId);return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64')},
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file=>fs.existsSync(file))
    browser = await chromium.launch({executablePath,headless:true})
    const context = await browser.newContext({viewport:{width:1440,height:1000}})
    await context.addInitScript(token=>localStorage.setItem('webui-access-token',token),token)
    const page = await context.newPage(),errors = [],methods = []
    page.on('pageerror',error=>errors.push(error.message))
    page.on('request',request=>{if(request.url().includes('/api/'))methods.push(request.method())})
    page.setDefaultTimeout(10000)
    await page.goto(`http://127.0.0.1:${server.address().port}/chat`)
    await page.getByRole('tab',{name:'通讯录',exact:true}).click()
    await page.getByRole('button',{name:'分类：公众号',exact:true}).click()
    await page.getByRole('button',{name:'Publisher old',exact:true}).waitFor()
    await page.getByRole('button',{name:'分类：联系人',exact:true}).click()
    await page.getByRole('button',{name:'Contact 000',exact:true}).waitFor()
    await page.getByRole('button',{name:'更多会话',exact:true}).click()
    await page.getByRole('button',{name:'Contact 064',exact:true}).waitFor()
    const refresh = page.getByRole('button',{name:'刷新通讯录',exact:true})
    const feedback = page.getByLabel('联系人刷新状态',{exact:true})
    rows[0].name = 'Contact 000 renamed'
    rows.splice(rows.findIndex(row=>row.wxId === 'person-1'),1)
    for(let i = 65;i < 68;i++)rows.push(contact('person-' + i,`Contact ${String(i).padStart(3,'0')}`))
    rows.find(row=>row.wxId === 'publisher').name = 'Publisher new'
    await page.getByRole('button',{name:'Contact 000',exact:true}).locator('img').waitFor()
    const avatarsBefore = avatarReads.length
    const held = holdNext('person'),before = requests.length
    await refresh.click();await held.ready
    assert.equal(await refresh.getAttribute('aria-busy'),'true')
    assert(await refresh.isDisabled())
    assert((await feedback.innerText()).includes('正在刷新'))
    assert(await page.getByRole('button',{name:'Contact 000',exact:true}).isVisible())
    assert.equal(await page.getByLabel('联系人已缓存数量',{exact:true}).innerText(),'65')
    await refresh.evaluate(button=>{
      if(!(button instanceof HTMLButtonElement))throw new Error('Expected a native refresh button')
      button.click();button.click()
    })
    assert.equal(requests.length,before + 1,'repeated clicks cannot enqueue duplicate refreshes')
    held.release()
    await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    assert.equal(await refresh.getAttribute('aria-busy'),'false')
    assert.equal(await refresh.isDisabled(),false)
    assert.deepEqual(requests.slice(before).map(row=>row.offset),[0,60],'refresh covers the entire loaded window')
    assert(requests.slice(before).every(row=>row.kind === 'person' && row.q === '' && row.order === 'letter'))
    await page.getByRole('button',{name:'Contact 067',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Contact 001',exact:true}).count(),0)
    assert.equal(await page.getByLabel('联系人已缓存数量',{exact:true}).innerText(),'67')
    await page.getByRole('button',{name:'Contact 000 renamed',exact:true}).locator('img').waitFor()
    assert.equal(avatarReads.length,avatarsBefore + 1,'successful manual refresh invalidates the avatar cache too')
    await page.getByRole('button',{name:'分类：公众号',exact:true}).click()
    await page.getByRole('button',{name:'Publisher new',exact:true}).waitFor()
    await page.getByRole('button',{name:'分类：联系人',exact:true}).click()
    await page.getByRole('button',{name:'Contact 067',exact:true}).waitFor()

    // Page two failure must not commit new page-one rows or lose old paging.
    failOffset = 60
    const avatarsBeforeFailure = avatarReads.length
    rows[0].name = 'Contact 000 after retry'
    await refresh.click()
    await feedback.getByText(/刷新失败/).waitFor()
    assert(await page.getByRole('button',{name:'Contact 000 renamed',exact:true}).isVisible())
    assert.equal(await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).count(),0)
    assert(await page.getByRole('button',{name:'Contact 067',exact:true}).isVisible())
    events.publish({type:'status'});await page.waitForTimeout(400)
    assert((await feedback.innerText()).includes('刷新失败'),'status success must not erase contact refresh errors')
    assert.equal(avatarReads.length,avatarsBeforeFailure,'failed refresh preserves current avatars')
    assert.equal(await refresh.isDisabled(),false)
    failOffset = undefined
    await refresh.click();await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).waitFor()

    // Search/category stay intact, including a refresh with every section closed.
    const search = page.getByLabel('搜索通讯录',{exact:true})
    await search.fill('Contact 064')
    await page.getByRole('button',{name:'Contact 067',exact:true}).waitFor({state:'detached'})
    await page.getByRole('button',{name:'Contact 064',exact:true}).waitFor()
    const beforeSearch = requests.length
    await refresh.click();await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    assert.equal(await search.inputValue(),'Contact 064')
    assert(requests.slice(beforeSearch).every(row=>row.q === 'Contact 064' && row.kind === 'person'))
    await search.fill('')
    await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).waitFor()
    await page.getByRole('button',{name:'分类：联系人',exact:true}).click()
    rows.push(contact('second@chatroom','Group two','group'))
    const beforeCollapsed = requests.length
    await refresh.click();await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    assert.equal(requests[beforeCollapsed].kind,'all')
    assert.equal(await page.getByLabel('群聊已缓存数量',{exact:true}).innerText(),'2')

    // A cancelled refresh cannot report success or overwrite a new category.
    await page.getByRole('button',{name:'分类：联系人',exact:true}).click()
    await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).waitFor()
    const cancelled = holdNext('person')
    await refresh.click();await cancelled.ready
    await page.getByRole('button',{name:'分类：群聊',exact:true}).click()
    await page.getByRole('button',{name:'Group one',exact:true}).waitFor()
    cancelled.release();await page.waitForTimeout(300)
    assert.equal(await feedback.count(),0)
    assert.equal(await refresh.isDisabled(),false)
    assert.equal(await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).count(),0)

    // Deadline feedback is real and a subsequent attempt can succeed.
    await page.clock.install()
    const timeout = holdNext('group')
    await refresh.click();await timeout.ready
    await page.clock.fastForward(30001)
    await feedback.getByText(/超过 30 秒/).waitFor()
    assert.equal(await refresh.isDisabled(),false)
    assert(await page.getByRole('button',{name:'Group one',exact:true}).isVisible())
    timeout.release()
    await refresh.click();await feedback.getByText(/已重新读取服务端缓存/).waitFor()

    // Clicking during a background request starts a fresh request, not old data.
    const background = holdNext('group')
    events.publish({type:'contacts'});await background.ready
    rows.find(row=>row.wxId === 'room@chatroom').name = 'Group refreshed'
    await refresh.click()
    await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    await page.getByRole('button',{name:'Group refreshed',exact:true}).waitFor()
    background.release();await page.waitForTimeout(300)
    assert.equal(await page.getByRole('button',{name:'Group one',exact:true}).count(),0)

    await page.getByRole('tab',{name:'聊天',exact:true}).click()
    await page.getByRole('button',{name:'Contact 000 after retry',exact:true}).waitFor()
    rows[0].name = 'Contact 000 chat refreshed'
    const chats = holdNext('all')
    const refreshChats = page.getByRole('button',{name:'刷新会话',exact:true})
    await refreshChats.click();await chats.ready
    assert(await refreshChats.isDisabled())
    chats.release();await feedback.getByText(/已重新读取服务端缓存/).waitFor()
    await page.getByRole('button',{name:'Contact 000 chat refreshed',exact:true}).waitFor()
    assert.deepEqual(errors,[])
    assert(methods.every(method=>method === 'GET'),'manual list refresh does not invoke native writes or full WeChat synchronization')
    console.log('Contact refresh browser passed: actual HTTP refresh, busy/disabled feedback, loaded pages and counts, directory/avatar cache invalidation, atomic failure/retry, search/collapse, cancellation, timeout and stale background response safety.')
  } finally {
    pending.forEach(entry=>entry.release())
    if(browser)await browser.close()
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})