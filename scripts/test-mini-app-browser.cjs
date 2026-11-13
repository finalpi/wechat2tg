/* eslint-disable @typescript-eslint/no-var-requires */
/* global window, localStorage, document */
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const {createHmac} = require('node:crypto')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-mini-browser-'))
  const botToken = '12345:local-mini-app-bot-secret', browserToken = 'local-browser-token-for-test'
  let owner = 123
  const sign = id => {
    const data = {auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({id, first_name: 'Owner'})}
    const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
    const hash = createHmac('sha256', key).update(Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('\n')).digest('hex')
    return new URLSearchParams({...data, hash}).toString()
  }
  const events = createMessageEvents()
  const contacts = Array.from({length: 20}, (_, i) => ({wxId: `contact-${i}`, name: `测试会话 ${i + 1}`, nickname: '消息摘要', kind: 'contact', hasAvatar: false, lastActivity: 0, lastSequence: 0, lastBody: '点击查看聊天记录', unsyncedCount: 0}))
  const message = {id: 1, wxId: 'contact-0', body: '聊天内容应占据主要空间。', direction: 'incoming', type: 'text', status: 'received', telegramStatus: 'synced', timestamp: Math.floor(Date.now() / 1000)}
  const server = createWebUIServer({environment: {BOT_TOKEN: botToken, WEBUI_MINI_APP_URL: 'https://wechat.example.test/'}, token: browserToken,
    file: path.join(directory, 'config.json'), runtime: {read: async () => ({chatId: owner}), save: async () => undefined},
    messages: {
      subscribe: events.subscribe,
      status: async () => ({available: true, wechatOnline: true, telegramOnline: true, directoryAvailable: true}),
      contacts: async q => ({contacts: contacts.filter(item => item.name.includes(q)), hasMore: false, offset: 60, directoryAvailable: true}),
      history: async () => ({messages: [message], before: 1, hasMore: false, serverTime: Math.floor(Date.now() / 1000)}),
      updates: async () => ({messages: [message], serverTime: Math.floor(Date.now() / 1000)}),
    },
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)},
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file))
    browser = await chromium.launch({executablePath, headless: true})
    const context = await browser.newContext({viewport: {width: 390, height: 844}})
    // A previously saved browser token must not bypass Mini App ownership checks.
    await context.addInitScript(value => {if (window.location.protocol === 'http:') localStorage.setItem('webui-access-token', value)}, browserToken)
    await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({contentType: 'text/javascript', body: `
      window.__telegramCallbacks = {};
      window.Telegram = {WebApp: {
        initData: new URLSearchParams(location.hash.slice(1)).get('tgWebAppData'), colorScheme: 'dark', viewportStableHeight: 720,
        ready() {}, expand() {}, close() {},
        isVersionAtLeast() {return window.__homeSupported !== false},
        checkHomeScreenStatus(callback) {callback(window.__homeStatus || 'missed')},
        addToHomeScreen() {window.__homeAddCalls = (window.__homeAddCalls || 0) + 1},
        onEvent(name, callback) {window.__telegramCallbacks[name] = callback},
        offEvent(name) {delete window.__telegramCallbacks[name]},
        BackButton: {show() {window.__backVisible = true}, hide() {window.__backVisible = false}, onClick(cb) {window.__backClick = cb}, offClick() {window.__backClick = null}}
      }};
    `}))
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors = [], apiRequests = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', request => {if (request.url().includes('/api/')) apiRequests.push({url: request.url(), authorization: request.headers().authorization})})
    const launch = id => `${origin}/#${new URLSearchParams({tgWebAppData: sign(id), tgWebAppPlatform: 'tdesktop'})}`
    await page.goto(launch(456))
    await page.getByText('仅机器人主人可访问。', {exact: true}).waitFor()
    assert.equal(await page.getByLabel('访问令牌').count(), 0)
    assert.equal(apiRequests.filter(request => request.url.endsWith('/api/config')).length, 0)
    await page.goto('about:blank')
    await page.goto(launch(123))
    await page.getByLabel('会话列表').waitFor()
    await page.locator('button[aria-label="连接状态"][title="实时连接"]').waitFor()
    assert.equal(apiRequests.filter(request => request.url.endsWith('/api/config')).length, 0, 'chat is independent of admin settings')
    assert.equal(await page.evaluate(async () => (await window.navigator.serviceWorker.getRegistrations()).length), 0, 'Mini App must not register a PWA worker')
    assert(apiRequests.every(request => !new URL(request.url).searchParams.has('token')))
    assert.equal(await page.evaluate(() => localStorage.getItem('webui-access-token')), browserToken)
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.startsWith('miniapp_'))), false)
    assert.equal(await page.evaluate(() => new URLSearchParams(window.location.hash.slice(1)).has('tgWebAppData')), false)
    assert(await page.locator('html').evaluate(element => element.classList.contains('dark')))
    assert.equal(await page.locator('.mini-app-shell').evaluate(element => Math.round(element.getBoundingClientRect().height)), 720)
    const listSize = await page.getByLabel('会话列表').boundingBox()
    const shellSize = await page.locator('.mini-app-shell').boundingBox()
    console.log(`Mini App conversation list: ${Math.round(listSize.height)}/${Math.round(shellSize.height)}px`)
    assert(listSize.height / shellSize.height >= 0.75, 'The conversation list must use at least 75% of the Mini App viewport')
    const captures = process.env.MINI_APP_SCREENSHOT_DIR
    if (captures) fs.mkdirSync(captures, {recursive: true})
    for (const [width, height] of [[425, 650], [390, 720], [320, 600]]) {
      await page.setViewportSize({width, height})
      await page.evaluate(height => {
        window.Telegram.WebApp.viewportStableHeight = height
        window.__telegramCallbacks.viewportChanged()
      }, height)
      const list = await page.getByLabel('会话列表').boundingBox()
      assert(list.height / height >= 0.75, `${width}x${height}: conversation list must occupy at least 75%`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow')
      await page.getByRole('button', {name: '连接状态', exact: true}).click()
      await page.getByRole('dialog').getByText('微信在线', {exact: true}).waitFor()
      await page.keyboard.press('Escape')
      if (captures && width === 425) await page.screenshot({path: path.join(captures, 'home.png')})
      await page.getByLabel('会话列表').getByRole('button', {name: '测试会话 1', exact:true}).click()
      await page.getByText('聊天内容应占据主要空间。', {exact: true}).waitFor()
      const history = await page.locator('[data-slot="message-scroller-viewport"]').boundingBox()
      assert(history.height / height >= 0.60, `${width}x${height}: chat history must occupy at least 60%`)
      assert(await page.getByLabel('搜索消息', {exact: true}).isHidden(), 'mobile history search starts collapsed')
      await page.getByRole('button', {name: '展开消息搜索'}).click()
      assert(await page.getByLabel('搜索消息', {exact: true}).isVisible())
      await page.getByRole('button', {name: '展开消息搜索'}).click()
      const input = await page.getByLabel('消息内容').boundingBox()
      assert(input.y + input.height <= height, 'composer stays inside the viewport')
      if (captures && width === 425) await page.screenshot({path: path.join(captures, 'chat.png')})
      await page.getByRole('button', {name: '返回会话列表'}).click()
    }
    assert.equal(await page.evaluate(() => window.__homeAddCalls || 0),0,'home-screen prompts require a click')
    await page.getByRole('button', {name: '聊天菜单'}).click()
    assert.equal(await page.getByRole('button',{name:'安装应用',exact:true}).count(),0,'Mini App uses the native shortcut, not a PWA prompt')
    await page.getByRole('button',{name:'添加到主屏幕',exact:true}).click()
    assert.equal(await page.evaluate(() => window.__homeAddCalls),1)
    assert.equal(await page.getByRole('button',{name:'已添加到主屏幕',exact:true}).count(),0,'requesting does not prove installation')
    await page.evaluate(() => window.__telegramCallbacks.homeScreenAdded())
    assert(await page.getByRole('button',{name:'已添加到主屏幕',exact:true}).isDisabled())
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !window.__telegramCallbacks.homeScreenAdded && !window.__telegramCallbacks.homeScreenChecked)
    for(const status of ['added','unsupported','unknown']){
      await page.evaluate(value => {window.__homeStatus = value},status)
      await page.getByRole('button',{name:'聊天菜单'}).click()
      const button = page.getByRole('button',{name:status === 'added' ? '已添加到主屏幕' : '添加到主屏幕',exact:true})
      await button.waitFor()
      assert.equal(await button.isDisabled(),status !== 'unknown')
      if(status === 'unsupported')await page.getByText('当前 Telegram 客户端不支持添加到主屏幕。',{exact:false}).waitFor()
      await page.keyboard.press('Escape')
    }
    await page.evaluate(() => {window.__homeSupported = false;window.__homeStatus = 'missed'})
    await page.getByRole('button',{name:'聊天菜单'}).click()
    assert(await page.getByRole('button',{name:'添加到主屏幕',exact:true}).isDisabled())
    assert.equal(await page.evaluate(() => window.__homeAddCalls),1,'old clients never invoke the native prompt')
    await page.keyboard.press('Escape')
    await page.evaluate(() => {window.__homeSupported = true})
    await page.getByRole('button', {name: '聊天菜单'}).click()
    await page.getByRole('button', {name: '管理设置', exact: true}).click()
    await page.getByRole('combobox', {name: '切换页面'}).click()
    await page.getByRole('option', {name: 'AI 与语音'}).click()
    assert.equal(await page.evaluate(() => window.__backVisible), true)
    await page.evaluate(() => {window.Telegram.WebApp.colorScheme = 'light'; window.__telegramCallbacks.themeChanged()})
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
    await page.evaluate(() => window.__backClick())
    await page.getByLabel('会话列表').waitFor()
    await page.locator('button[aria-label="连接状态"][title="实时连接"]').waitFor()
    // Changed owner invalidates an already-open stream and cannot fall back to stored token.
    owner = 999
    events.publish({type: 'status'})
    await page.getByText('已退出或登录已失效，请关闭后从机器人菜单重新打开。', {exact: true}).waitFor()
    assert.equal(await page.getByLabel('访问令牌').count(), 0)
    assert.deepEqual(errors, [])
    console.log('Mini App browser checks passed: owner-only, no saved-token bypass, same UI, memory-only session, theme/viewport/back button, native home-screen shortcut states, live-session revocation.')
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, {recursive: true, force: true})
  }
}
main().catch(e => {console.error(e); process.exitCode = 1})