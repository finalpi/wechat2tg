/* eslint-disable @typescript-eslint/no-var-requires */
/* global localStorage */
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')
const {installTelegramPollingHealth} = require('../dist/util/TelegramPollingHealth')

async function main() {
  let now = Date.now(),failed = false
  const timers = new Map(),events = createMessageEvents(),logs = []
  const clock = {now:()=>now,setTimeout:(callback,delay)=>{const handle = {unref:()=>undefined};timers.set(handle,{callback,at:now + delay});return handle},clearTimeout:handle=>timers.delete(handle)}
  const telegram = {callApi:async()=>{
    if(failed)throw Object.assign(new Error('synthetic private request URL'),{name:'FetchError',code:'ECONNRESET'})
    return []
  }}
  const monitor = installTelegramPollingHealth(telegram,{clock,logger:{info:text=>logs.push(text),warn:text=>logs.push(text)},onChange:()=>events.publish({type:'status'})})
  monitor.start()
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'polling-health-browser-')),token = 'synthetic-polling-health-token'
  const server = createWebUIServer({environment:{},token,file:path.join(root,'config.json'),mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    subscribe:listener=>events.subscribe(listener),
    status:async()=>({available:true,wechatOnline:true,telegramOnline:monitor.snapshot().healthy,telegramPolling:monitor.snapshot(),directoryAvailable:true}),
    contacts:async()=>({contacts:[],hasMore:false,offset:0,directoryAvailable:true}),
    history:async()=>({messages:[],hasMore:false,before:0,serverTime:Math.floor(now / 1000)}),
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(file=>fs.existsSync(file))
    browser = await chromium.launch({executablePath,headless:true})
    const context = await browser.newContext({viewport:{width:1280,height:900}})
    await context.addInitScript(token=>localStorage.setItem('webui-access-token',token),token)
    const page = await context.newPage(),errors = []
    page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/chat`)
    const indicator = page.locator('button[aria-label="连接状态"]')
    await indicator.click()
    const detail = page.getByLabel('Telegram 轮询详情',{exact:true})
    await detail.getByText('尚未成功拉取更新',{exact:true}).waitFor()
    assert((await detail.innerText()).includes('85 秒，仅 getUpdates'))
    now += 50_000
    await telegram.callApi('getUpdates',{timeout:50})
    await detail.getByText('更新拉取正常',{exact:true}).waitFor()
    assert.equal(await indicator.getAttribute('title'),'实时连接')
    assert.equal(await detail.getByText('尚未成功拉取更新',{exact:true}).count(),0)
    failed = true
    await telegram.callApi('getUpdates',{timeout:50}).catch(()=>undefined)
    await detail.getByText('轮询失败，正在重试',{exact:true}).waitFor()
    await detail.getByText('1 次',{exact:true}).waitFor()
    assert((await detail.innerText()).includes('ECONNRESET'))
    failed = false
    await telegram.callApi('getUpdates',{timeout:50})
    await detail.getByText('更新拉取正常',{exact:true}).waitFor()
    now += 90_000
    for(const [handle,entry] of [...timers])if(entry.at <= now){timers.delete(handle);entry.callback()}
    await detail.getByText('轮询进度停滞',{exact:true}).waitFor()
    assert.notEqual(await indicator.getAttribute('title'),'实时连接','WebUI/SSE availability cannot mask stalled Telegram polling')
    assert(logs.some(text=>text.includes('恢复')))
    assert(!logs.join('').includes('private request'))
    assert.deepEqual(errors,[])
    console.log('Telegram health browser passed: first-poll state, last success timestamp, deadline, SSE failure/recovery/staleness and honest online indicator; no Telegram requests.')
  } finally {
    if(browser)await browser.close()
    monitor.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})