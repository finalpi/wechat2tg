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
  const publications = [
    {id:31,type:'text',body:'26.11.10 的日志\n\n作者：示例作者\n\n科研与复盘\n给内容留出阅读空间，而不是把消息堆在一起。\n\n一条完整的消息就是一张卡片，作者、正文、时间和操作各在自己的位置。'.repeat(2)},
    {id:32,type:'link',body:'今日精选',details:{articles:[{title:'如何整理一天的记录',description:'清晰的标题和摘要，保留文章原有链接。',url:'https://example.com/article',coverPath:'/api/media/article/32/0'},{title:'第二篇文章',description:'多篇图文仍属于同一条消息。',url:'https://example.com/second',coverPath:'/api/media/article/32/1'},{title:'封面失败仍可阅读',url:'https://example.com/third',coverPath:'/api/media/article/32/2'}]}},
    {id:33,type:'text',body:'这是一条短消息，也使用相同的卡片容器。'},
  ].map(row=>({...row,wxId:'publisher',remoteId:String(row.id),senderId:'publisher',senderDisplayName:'公众号示例',senderHasAvatar:true,direction:'incoming',timestamp:timestamp + row.id,status:'received',telegramTracked:true,telegramStatus:'synced'}))
  const avatarCalls = [],coverCalls = []
  const png = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#6366f1"/><rect x="26" y="23" width="44" height="50" rx="4" fill="none" stroke="white" stroke-width="4"/><path d="M34 36h28M34 48h28M34 60h18" stroke="white" stroke-width="4"/></svg>')).png().toBuffer()
  const cover = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="940" height="400"><defs><linearGradient id="g"><stop stop-color="#142c37"/><stop offset="1" stop-color="#207762"/></linearGradient></defs><rect width="940" height="400" fill="url(#g)"/><circle cx="750" cy="100" r="120" fill="#378a76"/><path d="M140 90h210v230H140zM365 90h210v230H365z" fill="#e9f2ea"/><path d="M175 150h135m-135 50h135m-135 50h90m165-100h135m-135 50h135m-135 50h90" stroke="#5c8278" stroke-width="12"/></svg>')).jpeg().toBuffer()
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
    history:async wxId=>({messages:wxId === 'demo@chatroom' ? messages : wxId === 'publisher' ? publications : [],before:0,hasMore:false,serverTime:timestamp}),
    avatar:async(wxId,roomId)=>{avatarCalls.push({wxId,roomId});return png},
    articleCover:async(id,index)=>{coverCalls.push([id,index]);if(index === 2)throw Object.assign(new Error('synthetic missing image'),{status:404,code:'coverUnavailable'});return cover},
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
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-actions-toggle')).opacity === '0')
    const heightBeforeHover = (await first.boundingBox()).height
    await first.hover()
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.message-actions-toggle')).opacity === '1')
    const assertActionsAfterBubble = async row=>assert(await row.evaluate(element=>{
      const body = element.querySelector('[data-slot="message-body"]').getBoundingClientRect()
      const card = element.querySelector('[data-message-card]').getBoundingClientRect()
      const actions = element.querySelector('.message-actions-content').getBoundingClientRect()
      const style = getComputedStyle(element.querySelector('.message-actions-content'))
      return style.position === 'static' && actions.top >= body.bottom && actions.bottom <= card.bottom && actions.left >= 0 && actions.right <= window.innerWidth
    }),'status/actions must follow the body inside the card, never overlap its content')
    assert.equal((await first.boundingBox()).height,heightBeforeHover,'hover does not move the messages')
    await first.getByRole('button',{name:'消息操作',exact:true}).click()
    await assertActionsAfterBubble(first)
    const outgoing = page.locator('[data-slot="message"][data-align="end"]').last()
    await outgoing.hover()
    await outgoing.getByRole('button',{name:'消息操作',exact:true}).click()
    await assertActionsAfterBubble(outgoing)
    await page.mouse.move(0,0)
    await first.getByRole('button',{name:'引用回复',exact:true}).focus()
    assert.equal(await first.locator('.message-actions-content').evaluate(el=>getComputedStyle(el).pointerEvents),'auto','keyboard focus exposes controls')
    await page.waitForFunction(()=>[...document.querySelectorAll('.chat-message-group [role="img"] img')].every(img=>img.complete && img.naturalWidth > 0))
    assert.equal(await page.locator('.chat-message-group [role="img"]').count(),3,'only incoming messages have sender avatars')
    assert.equal(await outgoing.locator('[role="img"], [data-slot="message-header"]').count(),0,'own messages have no self avatar or name header')
    assert(await first.evaluate(row=>{
      const avatar = row.closest('.chat-message-group').querySelector('[data-slot="message-avatar"]'),card = row.querySelector('[data-message-card]')
      return !card.contains(avatar) && avatar.getBoundingClientRect().right <= card.getBoundingClientRect().left
    }),'group avatar is outside the message card')
    assert.equal(avatarCalls.length,2,'repeated incoming sender avatars share requests; no self-avatar request')
    assert(avatarCalls.every(call=>call.roomId === 'demo@chatroom'))
    await page.getByRole('button',{name:'成员',exact:true}).click()
    await page.getByRole('listbox',{name:'群成员',exact:true}).waitFor()
    await page.getByRole('option',{name:/甲/}).waitFor()
    assert.equal(avatarCalls.length,2,'member chooser reuses incoming message avatars')
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
    await page.getByRole('button',{name:'分类：公众号',exact:true}).click()
    await page.getByRole('button',{name:'公众号示例',exact:true}).click()
    await page.getByText('如何整理一天的记录',{exact:true}).waitFor()
    const assertCards = async target=>{
      assert.equal(await target.locator('[data-message-card]').count(),3)
      await target.locator('[data-article-cover="hero"] img').waitFor()
      await target.locator('[data-article-cover="thumbnail"] img').waitFor()
      assert.equal(await target.getByText('今日精选',{exact:true}).count(),0,'legacy body is not repeated above article cards')
      assert.equal(await target.locator('[data-slot="article-item"]').count(),3)
      assert(await target.getByRole('link',{name:'封面失败仍可阅读',exact:true}).isVisible())
      assert(await target.locator('[data-article-cover="hero"]').evaluate(el=>el.getBoundingClientRect().width > el.getBoundingClientRect().height * 2))
      assert(await target.locator('[data-slot="message-body"]').first().innerText().then(text=>text.includes('作者：示例作者')))
      assert.equal(await target.getByRole('link',{name:'如何整理一天的记录',exact:true}).getAttribute('href'),'https://example.com/article')
      assert(await target.locator('[data-layout="publication"]').evaluateAll(rows=>rows.every((row,index)=>{
        const card = row.querySelector('[data-message-card]').getBoundingClientRect(),rect = row.getBoundingClientRect()
        const previous = index ? rows[index - 1].querySelector('[data-message-card]').getBoundingClientRect() : undefined
        return card.width >= rect.width * 0.95 && (!previous || card.top - previous.bottom >= 15)
      })),'publication cards use the reading width with at least 16px between messages')
      assert(await target.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth))
    }
    await assertCards(page)
    if(process.env.CHAT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'publication-light.png')})
    await page.getByRole('button',{name:'聊天菜单',exact:true}).click()
    await page.getByRole('button',{name:'切换主题',exact:true}).click()
    await page.keyboard.press('Escape');await page.waitForTimeout(250)
    if(process.env.CHAT_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'publication-dark.png')})
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
    await mobile.getByRole('button',{name:'返回会话列表',exact:true}).click()
    await mobile.getByRole('button',{name:'公众号示例',exact:true}).click()
    await mobile.getByText('如何整理一天的记录',{exact:true}).waitFor()
    await assertCards(mobile)
    if(process.env.CHAT_SCREENSHOT_DIR)await mobile.screenshot({path:path.join(process.env.CHAT_SCREENSHOT_DIR,'publication-mobile.png')})
    assert(coverCalls.some(([id,index])=>id === 32 && index === 0))
    assert(coverCalls.every(([id,index])=>id === 32 && index >= 0 && index < 3))
    assert.deepEqual(errors,[]);assert.equal(sends,0)
    console.log('Chat appearance browser passed: non-overlapping normal-flow hover/focus/touch actions, emoji status, all sender/member avatars with deduplication, visual hide/restore and reload persistence; no sends.')
  } finally {
    if(browser)await browser.close()
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})
