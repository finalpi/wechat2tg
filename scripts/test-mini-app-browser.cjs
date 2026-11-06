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
  const server = createWebUIServer({environment: {BOT_TOKEN: botToken, WEBUI_MINI_APP_URL: 'https://wechat.example.test/'}, token: browserToken,
    file: path.join(directory, 'config.json'), runtime: {read: async () => ({chatId: owner}), save: async () => undefined},
    messages: {subscribe: events.subscribe, status: async () => ({available: false, wechatOnline: false, directoryAvailable: false})},
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
    await page.getByRole('button', {name: 'AI 与语音'}).waitFor()
    await page.getByText('实时连接', {exact: true}).waitFor()
    assert(apiRequests.filter(request => request.url.endsWith('/api/config')).every(request => request.authorization?.startsWith('Bearer miniapp_')))
    assert(apiRequests.every(request => !new URL(request.url).searchParams.has('token')))
    assert.equal(await page.evaluate(() => localStorage.getItem('webui-access-token')), browserToken)
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.startsWith('miniapp_'))), false)
    assert.equal(await page.evaluate(() => new URLSearchParams(window.location.hash.slice(1)).has('tgWebAppData')), false)
    assert(await page.locator('html').evaluate(element => element.classList.contains('dark')))
    assert.equal(await page.locator('.mini-app-shell').evaluate(element => Math.round(element.getBoundingClientRect().height)), 720)
    await page.getByRole('button', {name: 'AI 与语音'}).click()
    assert.equal(await page.evaluate(() => window.__backVisible), true)
    await page.evaluate(() => {window.Telegram.WebApp.colorScheme = 'light'; window.__telegramCallbacks.themeChanged()})
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
    await page.evaluate(() => window.__backClick())
    await page.getByText('消息服务未连接', {exact: true}).waitFor()
    await page.getByText('实时连接', {exact: true}).waitFor()
    // Changed owner invalidates an already-open stream and cannot fall back to stored token.
    owner = 999
    events.publish({type: 'status'})
    await page.getByText('已退出或登录已失效，请关闭后从机器人菜单重新打开。', {exact: true}).waitFor()
    assert.equal(await page.getByLabel('访问令牌').count(), 0)
    assert.deepEqual(errors, [])
    console.log('Mini App browser checks passed: owner-only, no saved-token bypass, same UI, memory-only session, theme/viewport/back button, live-session revocation.')
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, {recursive: true, force: true})
  }
}
main().catch(e => {console.error(e); process.exitCode = 1})