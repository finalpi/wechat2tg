/* eslint-disable @typescript-eslint/no-var-requires */
/* global localStorage,document,window,getComputedStyle */
const assert = require('node:assert/strict'),fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {once} = require('node:events'),{chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server'),{createMessageEvents} = require('../dist/webui/message-events')
async function main(){
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'message-groups-')),events = createMessageEvents(),token = 'synthetic-group-token'
  const now = new Date(2026,10,6,18,9).getTime() / 1000 - 10
  const contact = {wxId:'group@chatroom',name:'讨论组',kind:'group',category:'group',hasAvatar:false}
  const row = (id,sender = 'alice',extra = {})=>({id,wxId:contact.wxId,remoteId:String(1000 + id),senderId:sender,senderDisplayName:sender === 'alice' ? '林小满' : sender === 'bob' ? '周予安' : '我',senderHasAvatar:false,body:`消息 ${id}：连续对话的正文`,timestamp:now + id + (id >= 11 ? 54 * 60 - 1 : 0),direction:sender === 'self' ? 'outgoing' : 'incoming',status:sender === 'self' ? 'submitted' : 'received',type:'text',telegramTracked:true,telegramStatus:'synced',...extra})
  const rows = [...Array.from({length:18},(_,i)=>row(10 + i)),row(28,'bob'),row(29,'bob'),row(30,'alice'),row(31,'self'),row(32,'self'),row(33,'bob',{type:'quote',details:{replyTo:{id:18,remoteId:'1018',name:'林小满',preview:'定位组内消息 18'}}})]
  const older = [row(7),row(8),row(9)]
  let expanded = false,sends = 0
  const server = createWebUIServer({environment:{},token,file:path.join(directory,'config.json'),messages:{
    subscribe:listener=>events.subscribe(listener),status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
    contacts:async()=>({contacts:[contact],offset:60,hasMore:false}),
    history:async(_id,before)=>{
      if(before){expanded = true;return {messages:older,hasMore:false,before:7,serverTime:now}}
      return {messages:expanded ? [...older,...rows] : rows,hasMore:!expanded,before:expanded ? 7 : 10,serverTime:now}
    },
    locate:async()=>({messages:expanded ? [...older,...rows] : rows,hasMore:!expanded,before:10,targetId:18,serverTime:now}),
    updates:async(_id,ids)=>({messages:[...older,...rows].filter(row=>ids.includes(row.id)),serverTime:now}),
    avatar:async()=>{throw Object.assign(new Error('no avatar'),{status:404,code:'avatarUnavailable'})},
    send:async()=>{sends++;throw Error('no sends permitted')},
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p))
    browser = await chromium.launch({executablePath,headless:true})
    const context = await browser.newContext({viewport:{width:1280,height:900}})
    await context.addInitScript(token=>localStorage.setItem('webui-access-token',token),token)
    const page = await context.newPage(),errors = []
    page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
    await page.goto(`http://127.0.0.1:${server.address().port}/chat`)
    await page.getByRole('button',{name:'讨论组',exact:true}).click()
    await page.getByText('消息 18：连续对话的正文',{exact:true}).waitFor()
    assert.equal(await page.locator('[data-slot="message-group"]').count(),5)
    const alice = page.locator('[data-slot="message-group"]').first()
    assert.equal(await alice.locator('[data-slot="message-avatar"]').count(),1)
    assert.equal(await alice.locator('[data-slot="message-header"]').count(),1)
    assert.equal(await alice.locator('[data-slot="message"]').count(),18)
    const firstTimes = await alice.locator('time').evaluateAll(nodes=>nodes.slice(0,2).map(el=>new Date(el.dateTime).getTime()))
    assert.equal(firstTimes[1] - firstTimes[0],54 * 60000,'54-minute same-day gap must not duplicate the avatar or name')
    assert.equal(await page.locator('[data-outgoing="true"] [data-slot="message-avatar"], [data-outgoing="true"] [data-slot="message-header"]').count(),0)
    const style = await alice.locator('[data-slot="message"]').first().evaluate(row=>{
      const name = getComputedStyle(row.querySelector('[data-slot="message-header"]')),body = getComputedStyle(row.querySelector('[data-slot="message-body"]')),time = getComputedStyle(row.querySelector('time'))
      return {name:parseFloat(name.fontSize),body:parseFloat(body.fontSize),time:parseFloat(time.fontSize),nameColor:name.color,bodyColor:body.color,timeColor:time.color,nameWeight:name.fontWeight,timeWeight:time.fontWeight}
    })
    assert(style.body > style.name && style.name > style.time,JSON.stringify(style))
    assert.notEqual(style.nameColor,style.bodyColor);assert.notEqual(style.timeColor,style.bodyColor)
    assert(Number(style.nameWeight) > Number(style.timeWeight))
    const viewport = page.getByRole('region',{name:'消息记录',exact:true})
    const scrollToGroup = async(fraction)=>{
      await alice.evaluate((group,fraction)=>{
        const viewport = group.closest('[data-slot="message-scroller-viewport"]'),rect = group.getBoundingClientRect(),v = viewport.getBoundingClientRect()
        viewport.scrollTop += rect.top - v.top + rect.height * fraction
      },fraction)
      await page.waitForTimeout(160)
    }
    const geometry = ()=>alice.evaluate(group=>{
      const avatar = group.querySelector('[data-slot="message-avatar"]').getBoundingClientRect(),bounds = group.getBoundingClientRect(),view = group.closest('[data-slot="message-scroller-viewport"]').getBoundingClientRect()
      return {avatarTop:avatar.top,avatarBottom:avatar.bottom,groupTop:bounds.top,groupBottom:bounds.bottom,viewTop:view.top,viewBottom:view.bottom}
    })
    await scrollToGroup(0.2)
    const first = await geometry()
    assert(first.avatarTop >= first.viewTop && first.avatarBottom <= first.viewBottom,'avatar visible partway through a long group: ' + JSON.stringify(first))
    await viewport.evaluate(el=>{el.scrollTop += 180});await page.waitForTimeout(160)
    const second = await geometry()
    assert(Math.abs(second.avatarTop - first.avatarTop) < 2,'avatar stays at viewport edge while its group scrolls: ' + JSON.stringify({first,second}))
    assert(second.avatarTop >= second.groupTop && second.avatarBottom <= second.groupBottom,'avatar stays within sender bounds')
    const groupRects = await alice.locator('[data-slot="message"]').evaluateAll(rows=>rows.slice(0,3).map(row=>{const r = row.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}}))
    assert(groupRects[1].top - groupRects[0].bottom <= 5,'tight within-group spacing')
    assert(groupRects[1].height < 85,'ordinary short bubbles must not remain tall cards')
    // Prepending into the SAME sender group must not move the existing reading anchor.
    await viewport.evaluate(el=>{el.scrollTop = 0});await page.waitForTimeout(100)
    const anchor = page.locator('[data-message-id="10"]')
    const before = (await anchor.boundingBox()).y
    await page.getByRole('button',{name:'加载更早消息',exact:true}).click()
    await page.locator('[data-message-id="7"]').waitFor();await page.waitForTimeout(350)
    const after = (await anchor.boundingBox()).y
    assert(Math.abs(after - before) < 3,`prepend reading anchor shifted: ${before} -> ${after}`)
    // Registration remains per message, not just per group, for quote lookup.
    await page.getByRole('button',{name:/林小满.*定位组内消息 18/}).click()
    await page.waitForFunction(()=>Boolean(document.querySelector('[data-message-id="18"] [data-locate-active="true"]')))
    const located = await page.locator('[data-message-id="18"]').boundingBox(),view = await viewport.boundingBox()
    assert(located.y + located.height > view.y && located.y < view.y + view.height,'quote target inside a group is located')
    assert.equal(await page.locator('[data-message-id="18"] [data-slot="bubble"]').getAttribute('data-locate-active'),'true')
    const viewportBeforeRepeat = await viewport.elementHandle()
    await viewport.evaluate(el=>{el.scrollTop=el.scrollHeight})
    await page.getByRole('button',{name:/林小满.*定位组内消息 18/}).click()
    await page.waitForFunction(()=>{
      const row=document.querySelector('[data-message-id="18"]'),view=document.querySelector('[data-slot="message-scroller-viewport"]')
      const r=row.getBoundingClientRect(),v=view.getBoundingClientRect()
      return r.bottom>v.top && r.top<v.bottom && row.querySelector('[data-locate-active="true"]')
    })
    assert(await viewport.evaluate((el,previous)=>el===previous,viewportBeforeRepeat),'repeat location preserves the scroll viewport')
    await page.waitForFunction(()=>!document.querySelector('[data-message-id="18"] [data-locate-active="true"]'))
    // A status update must not split groups or replace the sticky avatar.
    await page.locator('[data-slot="message-group"]').first().locator('[data-slot="message-avatar"]').evaluate(el=>el.setAttribute('data-test-stable','yes'))
    rows[2].telegramStatus = 'failed';events.publish({type:'messages',wxId:contact.wxId,ids:[12]})
    await page.locator('[data-message-id="12"]').getByText('同步失败',{exact:true}).waitFor()
    assert.equal(await page.locator('[data-test-stable="yes"]').count(),1)
    if(process.env.CHAT_SCREENSHOT_DIR){fs.mkdirSync(process.env.CHAT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'group-sticky.png')})}
    await page.getByRole('button',{name:'返回最新',exact:true}).click()
    await page.waitForTimeout(250)
    const tail = page.locator('[data-slot="message-group"]').last()
    await tail.locator('[data-slot="message-avatar"]').evaluate(el=>el.setAttribute('data-test-tail','yes'))
    rows.push(row(34,'bob'));events.publish({type:'messages',wxId:contact.wxId,ids:[34]})
    await page.locator('[data-message-id="34"]').waitFor();await page.waitForTimeout(250)
    assert.equal(await page.locator('[data-test-tail="yes"]').count(),1,'append does not replace the group avatar')
    assert(await page.locator('[data-message-id="34"]').evaluate(el=>{
      const v = el.closest('[data-slot="message-scroller-viewport"]').getBoundingClientRect(),r = el.getBoundingClientRect()
      return r.bottom <= v.bottom + 2 && r.top >= v.top
    }),'same-group live append follows the bottom')
    // Later messages from another sender move the former avatar out with its run.
    await viewport.evaluate(el=>{el.scrollTop = el.scrollHeight});await page.waitForTimeout(100)
    const end = await geometry()
    assert(end.avatarBottom <= end.groupBottom + 1)
    if(process.env.CHAT_SCREENSHOT_DIR){
      await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'group-bottom.png')})
      await page.getByRole('button',{name:'聊天菜单',exact:true}).click()
      await page.getByRole('button',{name:'切换主题',exact:true}).click();await page.keyboard.press('Escape')
      await page.waitForTimeout(200);await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'group-dark.png')})
    }
    await page.setViewportSize({width:390,height:844})
    await page.getByText('消息 18：连续对话的正文',{exact:true}).waitFor()
    assert(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth))
    const touchRow = page.locator('[data-message-id="18"]')
    await touchRow.getByRole('button',{name:'消息操作',exact:true}).click()
    await touchRow.getByRole('button',{name:'引用回复',exact:true}).click()
    await page.getByRole('button',{name:'取消引用',exact:true}).waitFor()
    if(process.env.CHAT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'group-mobile.png')})
    assert.deepEqual(errors,[]);assert.equal(sends,0)
    console.log('Grouped chat browser passed: identity grouping across a 54-minute gap, typography, sticky bounded avatars, compact spacing, same-group prepend anchoring, inner quote location, status updates and mobile controls; no sends.')
  } finally {if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode = 1})
