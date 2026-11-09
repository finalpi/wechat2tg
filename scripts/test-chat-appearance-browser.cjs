/* eslint-disable @typescript-eslint/no-var-requires */
/* global document,window,localStorage,getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),os = require('node:os')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'chat-appearance-'))
  const token = 'synthetic-appearance-token',events = createMessageEvents()
  const rows = [
    {wxId:'demo@chatroom',name:'群聊示例',category:'group',kind:'group'},
    {wxId:'publisher',name:'公众号示例',category:'official',kind:'contact'},
    {wxId:'person',name:'联系人示例',category:'person',kind:'contact'},
  ].map(row=>({...row,nickname:row.name,hasAvatar:false,lastActivity:0,lastSequence:0,lastBody:'',lastType:'text',unsyncedCount:0}))
  const timestamp = Math.floor(Date.now() / 1000)
  const messages = ['甲','乙','甲','我'].map((name,index)=>({id:index + 1,wxId:'demo@chatroom',remoteId:String(index + 100),senderId:name,senderDisplayName:name,senderHasAvatar:true,
    direction:index === 3 ? 'outgoing' : 'incoming',type:'text',body:`清爽的消息 ${index + 1}`,timestamp:timestamp + index,status:index === 3 ? 'submitted' : 'received',telegramTracked:true,telegramStatus:'synced',canRevoke:index === 3}))
  const avatarCalls = []
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64')
  let sends = 0
  const server = createWebUIServer({environment:{},token,file:path.join(root,'config.json'),runtime:{read:async()=>({}),save:async()=>undefined},messages:{
    subscribe:listener=>events.subscribe(listener),
    status:async()=>({available:true,wechatOnline:true,telegramOnline:true,directoryAvailable:true}),
    contacts:async(q,kind,offset)=>{
      const all = rows.filter(row=>row.name.includes(q))
      const counts = {group:0,person:0,official:0,service:0,enterprise:0,unknown:0}
      all.forEach(row=>counts[row.category]++)
      return {contacts:all.filter(row=>kind === 'all' || row.category === kind),offset:offset + 60,hasMore:false,counts,countsScope:'cached',directoryAvailable:true}
    },
    history:async wxId=>({messages:wxId === 'demo@chatroom' ? messages : [],before:0,hasMore:false,serverTime:timestamp}),
    avatar:async(wxId,roomId)=>{avatarCalls.push({wxId,roomId});return png},
    groupMembers:async()=>({members:[{wxId:'甲',name:'甲',displayName:'甲',nickname:'甲',hasAvatar:true},{wxId:'乙',name:'乙',displayName:'乙',nickname:'乙',hasAvatar:true}],offset:100,hasMore:false,total:2}),
    send:async()=>{sends++;throw Error('No live sends permitted')},
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/usr/bin/chromium','/usr/bin/google-chrome','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>fs.existsSync(p))
    browser = await chromium.launch({executablePath,headless:true})
    const context = await browser.newContext({viewport:{width:1280,height:900}})
    await context.addInitScript(value=>localStorage.setItem('webui-access-token',value),token)
    const page = await context.newPage(),errors = []
    page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message))
    await page.goto(base + '/chat')
    await page.getByRole('button',{name:'群聊示例',exact:true}).click()
    await page.getByText('清爽的消息 1',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'连接状态',exact:true}).innerText(),'🟢')
    const first = page.locator('[data-slot="message"]').first()
    await page.mouse.move(0,0)
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-actions-content')).opacity === '0')
    const heightBeforeHover = (await first.boundingBox()).height
    await first.hover()
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-actions-content')).opacity === '1')
    const assertActionsAfterBubble = async row=>assert(await row.evaluate(element=>{
      const bubble = element.querySelector('[data-slot="bubble"]').getBoundingClientRect()
      const actions = element.querySelector('.message-actions-content').getBoundingClientRect()
      const style = getComputedStyle(element.querySelector('.message-actions-content'))
      return style.position === 'static' && actions.top >= bubble.bottom && actions.left >= 0 && actions.right <= window.innerWidth
    }),'status/actions must follow the bubble in normal layout, never overlap its content')
    await assertActionsAfterBubble(first)
    assert.equal((await first.boundingBox()).height,heightBeforeHover,'hover reserves its own footer space without moving the messages')
    const outgoing = page.locator('[data-slot="message"][data-align="end"]').last()
    await outgoing.hover()
    await assertActionsAfterBubble(outgoing)
    await page.mouse.move(0,0)
    await first.getByRole('button',{name:'引用回复',exact:true}).focus()
    assert.equal(await first.locator('.message-actions-content').evaluate(el=>getComputedStyle(el).pointerEvents),'auto','keyboard focus exposes controls')
    await page.waitForFunction(()=>[...document.querySelectorAll('[data-slot="message"] [role="img"] img')].every(img=>img.complete && img.naturalWidth > 0))
    assert.equal(await page.locator('[data-slot="message"] [role="img"]').count(),4,'each sender has an avatar, including self and consecutive messages')
    assert.equal(avatarCalls.length,3,'repeated sender avatars share one request')
    assert(avatarCalls.every(call=>call.roomId === 'demo@chatroom'))
    await page.getByRole('button',{name:'成员',exact:true}).click()
    await page.getByLabel('搜索群成员',{exact:true}).waitFor()
    await page.locator('label[for="member-甲"]').waitFor()
    assert.equal(avatarCalls.length,3,'member chooser reuses message avatars')
    if(process.env.CHAT_SCREENSHOT_DIR){fs.mkdirSync(process.env.CHAT_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'chat.png')})}
    await page.getByRole('button',{name:'聊天菜单',exact:true}).click()
    await page.getByRole('button',{name:'管理设置',exact:true}).click()
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'聊天界面',exact:true}).click()
    await page.getByRole('button',{name:'隐藏公众号',exact:true}).click()
    assert(await page.getByRole('button',{name:'显示公众号',exact:true}).isVisible())
    if(process.env.CHAT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'settings.png')})
    await page.getByRole('button',{name:'返回聊天',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'公众号示例',exact:true}).count(),0)
    await page.getByRole('tab',{name:'通讯录',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'分类：公众号',exact:true}).count(),0)
    await page.reload()
    await page.getByRole('tab',{name:'通讯录',exact:true}).click()
    await page.getByRole('button',{name:'分类：群聊',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'分类：公众号',exact:true}).count(),0,'visibility persists on reload')
    await page.getByRole('button',{name:'聊天菜单',exact:true}).click()
    await page.getByRole('button',{name:'管理设置',exact:true}).click()
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'聊天界面',exact:true}).click()
    await page.getByRole('button',{name:'显示全部分类',exact:true}).click()
    await page.getByRole('button',{name:'返回聊天',exact:true}).click()
    await page.getByRole('button',{name:'分类：公众号',exact:true}).waitFor()
    const touch = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
    await touch.addInitScript(value=>localStorage.setItem('webui-access-token',value),token)
    const mobile = await touch.newPage()
    mobile.on('pageerror',error=>errors.push(error.message))
    await mobile.goto(base + '/chat')
    await mobile.getByRole('button',{name:'群聊示例',exact:true}).click()
    const mobileFirst = mobile.locator('[data-slot="message"]').first()
    await mobileFirst.getByRole('button',{name:'消息操作',exact:true}).click()
    await assertActionsAfterBubble(mobileFirst)
    await mobileFirst.getByRole('button',{name:'引用回复',exact:true}).click()
    await mobile.getByRole('button',{name:'取消引用',exact:true}).waitFor()
    assert(await mobile.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),'touch chat must not overflow')
    assert.deepEqual(errors,[]);assert.equal(sends,0)
    console.log('Chat appearance browser passed: non-overlapping normal-flow hover/focus/touch actions, emoji status, all sender/member avatars with deduplication, visual hide/restore and reload persistence; no sends.')
  } finally {
    if(browser)await browser.close()
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})