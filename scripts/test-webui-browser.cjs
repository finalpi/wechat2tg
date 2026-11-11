/* eslint-disable @typescript-eslint/no-var-requires */
/* global window, document, getComputedStyle */
/* Browser regression tests use only a local fixture; no WeChat/Telegram account is contacted. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {createMessageEvents} = require('../dist/webui/message-events')

async function main() {
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(file => fs.existsSync(file))
  assert(executablePath, 'Set BROWSER_EXECUTABLE_PATH to a Chromium/Chrome executable.')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat2tg-browser-'))
  const token = 'local-browser-fixture-token'
  const group = 'test@chatroom'
  const stamp = Math.floor(Date.now() / 1000)
  const png = path.join(directory, 'image.png')
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
  const file = {id: '11111111-1111-4111-8111-111111111111', name: 'image.png', kind: 'image', mime: 'image/png', size: fs.statSync(png).size, path: png}
  const rows = [
    {id: 1, body: '<b>欢迎测试</b> <a href="javascript:alert(1)">危险链接</a><img src="x" onerror="window.hacked=1">', bodyFormat: 'telegram_html', direction: 'incoming', type: 'text'},
    {id: 2, body: '', direction: 'incoming', type: 'image'},
    {id: 3, body: '引用回复', direction: 'incoming', type: 'quote', details: {replyTo: {id: 1, remoteId: '18446744073709551614', name: '小王', preview: '查看原文'}}},
    {id: 4, body: '待核实同步', direction: 'outgoing', type: 'text', telegramStatus: 'unknown', status: 'submitted', canRevoke: true, revokeDeadline: stamp + 120},
    {id: 5, body: '不应显示的扁平记录', direction: 'incoming', type: 'chat_histroy', transcript: {
      path: 'root', title: '会议记录', content: '', entries: [{id: '1', sender: '小王', time: '', type: 'text', text: '第一条'}, {id: '2', sender: '小李', time: '', type: 'image', text: '', attachmentId: '2'}, {id: '3', sender: '小王', time: '', type: 'text', text: '最后一条'}],
      attachments: [{path: 'root', id: '2', type: 'image', name: '记录内图片.png'}], children: [], truncated: false,
    }},
  ].map(row => ({wxId: group, remoteId: '18446744073709551614', senderId: 'member', senderName: '小王', timestamp: stamp - 20 + row.id, status: 'received', telegramStatus: 'synced', telegramTracked: true, ...row}))
  const contacts = [
    {wxId: group, name: '测试群', nickname: '测试群', kind: 'group', hasAvatar: false, lastActivity: stamp, lastSequence: 4, lastBody: '待核实同步', unsyncedCount: 1},
    {wxId: 'alice', name: '小李', nickname: '小李', kind: 'contact', hasAvatar: false, lastActivity: stamp - 30, lastSequence: 0, lastBody: '', unsyncedCount: 0},
  ]
  const sends = [], syncs = [], recalls = [], uploads = [], histories = [], locates = []
  const accepted = new Map()
  const events = createMessageEvents()
  const sockets = new Set()
  let connections = 0, statusRequests = 0, contactRequests = 0
  const older = {...rows[0], id: 90, body: '更早的消息', timestamp: stamp - 100}
  let online = true
  let available = true
  let failLocate = false
  const revokeOutcomes = ['failed', 'unknown', 'revoked']
  const history = (wxId, before = 0, q = '') => {
    histories.push({wxId, before, q})
    const source = wxId === group ? rows : []
    const messages = before ? [older] : source.filter(row => !q || row.body.includes(q)).slice(-50)
    return {messages, before: messages[0]?.id || 0, hasMore: !before && !q && wxId === group, serverTime: Math.floor(Date.now() / 1000)}
  }
  const adapter = {
    subscribe: events.subscribe,
    updates: async (wxId, ids) => ({messages: [...rows, older].filter(row => row.wxId === wxId && ids.includes(row.id)), serverTime: Math.floor(Date.now() / 1000)}),
    status: async () => {statusRequests++; return {available, wechatOnline: online, telegramOnline: online, directoryAvailable: true}},
    contacts: async (q, kind, offset) => {contactRequests++; return {contacts: offset ? [] : contacts.filter(row => (kind === 'all' || row.kind === kind) && (!q || row.name.includes(q))), hasMore: false, offset: offset + 60, directoryAvailable: true}},
    history: async (...args) => history(...args),
    locate: async (wxId, id, remoteId) => {locates.push({wxId, id, remoteId}); if (failLocate) throw Object.assign(new Error(), {status: 404, code: 'messageMissing'}); return {...history(wxId), targetId: 1, hasNewer: false}},
    groupMembers: async (_wxId, q, offset) => ({wxId: group, members: offset || q && !'小王'.includes(q) ? [] : [{wxId: 'member', name: '小王', nickname: '王', displayName: '小王', hasAvatar: false}], total: 1, hasMore: false, offset: offset + 100}),
    attachment: async () => file,
    media: async () => file,
    upload: async (name, preference, stream) => {for await (const chunk of stream) {assert(Buffer.isBuffer(chunk))} uploads.push({name, preference}); return file},
    send: async (wxId, body, requestId, attachmentId, mentions, replyToId) => {
      sends.push({wxId, body, requestId, attachmentId, mentions, replyToId})
      if (accepted.has(requestId)) return accepted.get(requestId)
      const row = {id: rows.length + 1, wxId, body, requestId, attachmentId, direction: 'outgoing', type: attachmentId ? 'image' : 'text', timestamp: stamp + rows.length, remoteId: String(100 + rows.length), status: 'submitted', telegramTracked: true, telegramStatus: 'synced', canRevoke: true, revokeDeadline: stamp + 120}
      accepted.set(requestId, row); rows.push(row); return row
    },
    sync: async (id, confirm) => {syncs.push({id, confirm}); rows.find(row => row.id === id).telegramStatus = 'synced'; return {id, telegramStatus: 'synced'}},
    revoke: async (id, requestId, confirmUncertain) => {const revokeStatus = revokeOutcomes.shift() || 'revoked'; recalls.push({id, requestId, confirmUncertain}); Object.assign(rows.find(row => row.id === id), {revokeStatus, canRevoke: revokeStatus !== 'revoked'}); return {id, revokeStatus, revokeTelegramStatus: 'synced'}},
  }
  const server = createWebUIServer({environment: {}, token, file: path.join(directory, 'settings.json'), runtime: {read: async () => ({autoTranscript: false}), save: async () => undefined}, messages: adapter, mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)}})
  server.on('request', (req, res) => {if (req.url === '/api/messages/events') {connections++; sockets.add(res); res.on('close', () => sockets.delete(res))}})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    browser = await chromium.launch({executablePath, headless: true})
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
    page.setDefaultTimeout(10000)
    // HTTP origins / older WebViews may expose getRandomValues but no randomUUID.
    await page.addInitScript(() => Object.defineProperty(window.crypto, 'randomUUID', {value: undefined, configurable: true}))
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.goto(origin)
    await page.getByLabel('访问令牌').fill('wrong-token')
    await page.getByRole('button', {name: '进入控制台'}).click()
    await page.getByText('访问令牌不正确，请重试。').waitFor()
    await page.getByLabel('访问令牌').fill(token)
    await page.getByRole('button', {name: '进入控制台'}).click()
    const pickGroup = () => page.getByLabel('会话列表').getByRole('button', {name: /测试群/}).click()
    await pickGroup()
    await page.getByText('欢迎测试', {exact: false}).waitFor()
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0)
    assert.equal(await page.evaluate(() => window.hacked), undefined)
    if (process.env.WEBUI_SCREENSHOT_PATH) await page.screenshot({path: process.env.WEBUI_SCREENSHOT_PATH, fullPage: true})
    assert.equal(await page.locator('[data-slot="bubble"][data-align="end"]').count(), 1)
    const bubbleColor = await page.locator('[data-slot="bubble"][data-align="end"] [data-slot="bubble-content"]').evaluate(element => getComputedStyle(element).backgroundColor)
    assert.notEqual(bubbleColor, 'rgba(0, 0, 0, 0)', 'Outgoing bubbles must use the configured theme.')
    assert(await page.locator('[data-slot="message-scroller-viewport"]').evaluate(element => element.clientHeight > 100))
    await page.getByLabel('消息内容').fill('缺少 randomUUID 时也能发送')
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('#message-body').textContent === '' || document.querySelector('[role="alert"]'))
    assert.equal(await page.locator('[role="alert"]').count(), 0, await page.locator('[role="alert"]').allTextContents())
    assert.equal(sends.at(-1).body, '缺少 randomUUID 时也能发送')
    assert.match(sends.at(-1).requestId, /^[a-zA-Z0-9-]{16,80}$/)
    await page.getByRole('button', {name: '加载更早消息'}).click()
    await page.getByText('更早的消息').waitFor()
    assert(histories.some(request => request.before === 1))
    older.body = '更早的消息已更新'
    events.publish({type: 'messages', wxId: group, ids: [90]})
    await page.getByText('更早的消息已更新', {exact: true}).waitFor()
    await page.locator('button[aria-label="连接状态"][title="实时连接"]').waitFor()
    // Deliberately idle longer than the removed polling interval: no HTTP churn.
    await page.waitForTimeout(400)
    const idleCounts = [histories.length, statusRequests, contactRequests, connections]
    await page.waitForTimeout(5500)
    assert.deepEqual([histories.length, statusRequests, contactRequests, connections], idleCounts)
    assert.equal(sockets.size, 1, 'one long connection per message page')
    sockets.forEach(res => res.end())
    rows.push({...rows[0], id: 91, body: '重连期间的新消息', timestamp: stamp + 1, bodyFormat: 'plain'})
    await page.getByText('重连期间的新消息', {exact: true}).waitFor()
    assert(connections > idleCounts[3], 'stream reconnected and refreshed without polling')
    await page.getByRole('button', {name: '展开消息搜索'}).click()
    await page.getByLabel('搜索消息').fill('不存在')
    await page.getByText('未找到消息', {exact: true}).waitFor()
    await page.getByRole('button', {name: '返回最新'}).click()
    await page.getByText('欢迎测试', {exact: false}).waitFor()
    await page.getByRole('button', {name: /小王.*查看原文/}).click()
    await page.getByRole('button', {name: '返回最新'}).waitFor()
    assert.equal(locates.at(-1).remoteId, '18446744073709551614')
    await page.getByRole('button', {name: '返回最新'}).click()
    const messageAction = async name => {
      const button = page.getByRole('button', {name, exact:true,includeHidden:true}).first()
      const row = button.locator('xpath=ancestor::*[@data-slot="message"]')
      await row.hover()
      const toggle = row.getByRole('button',{name:'消息操作',exact:true})
      if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true')await toggle.click()
      await button.click()
    }
    await messageAction('同步 Telegram')
    assert.deepEqual(syncs, [{id: 4, confirm: true}])
    await messageAction('撤回')
    await page.getByText('撤回失败', {exact: true}).waitFor()
    await messageAction('撤回')
    await page.getByText('撤回结果未知', {exact: true}).waitFor()
    await messageAction('撤回')
    await page.getByText('已撤回', {exact: true}).waitFor()
    assert.equal(new Set(recalls.map(item => item.requestId)).size, 3)
    assert.equal(recalls.at(-1).confirmUncertain, true)
    assert.equal(await page.getByText('不应显示的扁平记录', {exact: true}).count(), 0)
    await page.getByText('会议记录', {exact: true}).click()
    const transcriptEntries = page.locator('details > div > div')
    assert((await transcriptEntries.nth(0).innerText()).includes('第一条'))
    await transcriptEntries.nth(1).getByRole('button', {name: '预览 image.png'}).waitFor()
    assert((await transcriptEntries.nth(2).innerText()).includes('最后一条'))
    await page.getByText('会议记录', {exact: true}).click()
    assert.equal(await page.getByRole('button', {name: '查看', exact: true}).count(), 0, 'images display automatically')
    await page.getByRole('button', {name: '预览 image.png'}).click()
    await page.getByRole('dialog').waitFor()
    await page.getByRole('button', {name: '放大', exact: true}).click()
    await page.getByRole('button', {name: '旋转', exact: true}).click()
    await page.getByText('125%', {exact: true}).waitFor()
    await page.getByRole('button', {name: '适应窗口', exact: true}).click()
    await page.getByText('100%', {exact: true}).waitFor()
    await page.getByRole('button', {name: '关闭预览', exact: true}).click()
    await page.getByRole('button', {name: '预览 image.png'}).click()
    await page.keyboard.press('Escape')
    failLocate = true
    await page.getByRole('button', {name: /小王.*查看原文/}).click()
    await page.getByText('操作失败（messageMissing）。', {exact: true}).waitFor()
    rows.push({...rows[0], id: 100, timestamp: stamp + 1, body: '定位失败后继续更新', bodyFormat: 'plain'})
    events.publish({type: 'messages', wxId: group, ids: [100]})
    await page.getByText('定位失败后继续更新', {exact: true}).waitFor()
    failLocate = false
    await page.getByLabel('消息内容').fill('保留草稿')
    await page.getByLabel('会话列表').getByRole('button', {name: /小李/}).click()
    await page.getByText('暂无消息', {exact: true}).waitFor()
    await pickGroup()
    assert.equal(await page.getByLabel('消息内容').innerText(), '保留草稿')
    await page.getByLabel('消息内容').fill('你好')
    await page.getByRole('button', {name: '成员', exact: true}).click()
    await page.getByRole('option', {name: /小王/}).click()
    assert.equal(await page.getByRole('listbox', {name: '群成员'}).count(), 0)
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('#message-body').textContent === '')
    assert.deepEqual(sends.at(-1).mentions, {memberIds: ['member'], inline: true})
    assert.equal(sends.at(-1).body, '你好@小王\u2005')
    await page.getByLabel('消息内容').fill('附件说明')
    await page.getByLabel('选择附件').setInputFiles({name: 'image.png', mimeType: 'image/png', buffer: fs.readFileSync(png)})
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('#message-body').textContent === '')
    assert.equal(uploads.length, 1)
    assert.equal(sends.at(-2).body, '附件说明')
    assert.equal(sends.at(-1).attachmentId, file.id)
    assert.equal(sends.at(-1).body, '')
    // Lost response after acceptance: the retry must reuse the exact idempotency key.
    let dropResponse = true
    await page.route('**/api/messages', async route => {
      if (route.request().method() === 'POST' && dropResponse) {dropResponse = false; await route.fetch(); await route.abort('failed')}
      else await route.continue()
    })
    await page.getByLabel('消息内容').fill('响应丢失测试')
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await page.getByRole('button', {name: '重试请求', exact: true}).waitFor()
    const firstId = sends.at(-1).requestId
    await page.getByRole('button', {name: '重试请求', exact: true}).click()
    await page.waitForFunction(() => document.querySelector('#message-body').textContent === '')
    assert.equal(sends.at(-1).requestId, firstId)
    assert.equal(rows.filter(row => row.body === '响应丢失测试').length, 1)
    await page.unroute('**/api/messages')
    let releaseResponse, responseAccepted
    const gate = new Promise(resolve => {releaseResponse = resolve})
    const acceptedResponse = new Promise(resolve => {responseAccepted = resolve})
    await page.route('**/api/messages', async route => {
      if (route.request().method() === 'POST') {const response = await route.fetch(); responseAccepted(); await gate; await route.fulfill({response})}
      else await route.continue()
    })
    await page.getByLabel('消息内容').fill('切换中发送')
    await page.getByRole('button', {name: '发送', exact: true}).click()
    await acceptedResponse
    await page.getByLabel('会话列表').getByRole('button', {name: /小李/}).click()
    await pickGroup()
    assert(await page.getByLabel('消息内容').isDisabled())
    releaseResponse()
    await page.waitForFunction(() => document.querySelector('#message-body').textContent === '' && document.querySelector('#message-body').getAttribute('aria-disabled') !== 'true')
    await page.unroute('**/api/messages')
    await page.getByRole('button', {name: '聊天菜单'}).click()
    await page.getByRole('button', {name: '切换主题'}).click()
    await page.keyboard.press('Escape')
    assert(await page.locator('html').evaluate(element => element.classList.contains('dark')))
    await page.getByLabel('消息内容').fill('设置页返回后仍保留')
    await page.getByRole('button', {name: '聊天菜单'}).click()
    await page.getByRole('button', {name: '管理设置', exact: true}).click()
    await page.getByRole('button', {name: 'AI 与语音', exact: false}).click()
    assert.equal(await page.locator('#autoTranscript').getAttribute('data-state'), 'unchecked')
    await page.getByRole('button', {name: '网络代理', exact: false}).click()
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', {name: '直连', exact: true}).click()
    await page.getByRole('button', {name: '消息管理', exact: false}).click()
    await pickGroup()
    assert.equal(await page.getByLabel('消息内容').innerText(), '设置页返回后仍保留')
    await page.getByLabel('消息内容').fill('')
    await page.setViewportSize({width: 390, height: 844})
    await page.getByRole('button', {name: '返回会话列表'}).click()
    await pickGroup()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.getByRole('button', {name: '加载更早消息'}).click()
    await page.getByText('更早的消息已更新', {exact: true}).waitFor()
    for (let i = 0; i < 60; i++) rows.push({...rows[0], id: 1000 + i, timestamp: stamp + 500 + i, body: `补齐消息 ${i}`, bodyFormat: 'plain'})
    events.publish({type: 'messages', wxId: group})
    await page.getByText('补齐消息 59', {exact: true}).waitFor()
    const delayed = {...rows[0], id: 9999, timestamp: stamp - 50, body: '迟到的历史消息', bodyFormat: 'plain'}
    // Keep this row outside the latest-50 response, as a real backdated insertion would be.
    rows.unshift(delayed)
    events.publish({type: 'messages', wxId: group, ids: [9999]})
    // The backdated row is intentionally off-screen. content-visibility may skip
    // painting it; assert reconciliation without forcing a jump to old history.
    await page.getByText('迟到的历史消息', {exact: true}).waitFor({state: 'attached'})
    rows.splice(rows.indexOf(delayed), 1)
    events.publish({type: 'messages', wxId: group, ids: [9999]})
    await page.getByText('迟到的历史消息', {exact: true}).waitFor({state: 'detached'})
    online = false
    events.publish({type: 'status'})
    await page.getByText('微信未连接，暂时无法发送。', {exact: true}).waitFor()
    assert(await page.getByRole('button', {name: '发送', exact: true}).isDisabled())
    available = false
    events.publish({type: 'status'})
    await page.setViewportSize({width: 1440, height: 1000})
    await page.getByText('消息服务未连接', {exact: true}).waitFor()
    assert.deepEqual(errors, [], 'No browser runtime errors')
    console.log('WebUI browser checks passed: auth, chat layout, paging/search, quote lookup, sync/revoke, media preview, drafts, mentions, attachment split, idempotent retry, theme, proxy, mobile, offline states.')
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, {recursive: true, force: true})
  }
}
main().catch(error => {console.error(error); process.exitCode = 1})
