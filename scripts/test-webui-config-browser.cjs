/* eslint-disable @typescript-eslint/no-var-requires */
/* global document */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {once} = require('node:events')
const {chromium} = require('playwright-core')
const {createWebUIServer} = require('../dist/webui/server')
const {readOverrides} = require('../dist/webui/store')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-config-browser-'))
  const file = path.join(directory, 'settings.json')
  let runtime = {autoTranscript: false, chatId: 1}
  const server = createWebUIServer({file, token: 'local-config-test-token', environment: {},
    runtime: {read: async () => runtime, save: async patch => {runtime = {...runtime, ...patch}}},
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)},
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  let browser
  try {
    const executablePath = process.env.BROWSER_EXECUTABLE_PATH || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => fs.existsSync(file))
    browser = await chromium.launch({executablePath, headless: true})
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.getByLabel('访问令牌').fill('local-config-test-token')
    await page.getByRole('button', {name: '进入控制台'}).click()
    await page.getByRole('button', {name: 'AI 与语音'}).click()
    await page.locator('#AI_API_URL').fill('https://ai.example.test/v1')
    await page.locator('#AI_MODEL').fill('default')
    // A real editable setting changed elsewhere after the page was loaded.
    runtime.autoTranscript = true
    const response = page.waitForResponse(r => r.url().endsWith('/api/config') && r.request().method() === 'PATCH')
    await page.getByRole('button', {name: '保存', exact: true}).click()
    const conflict = await response
    assert.equal(conflict.status(), 409)
    assert.deepEqual(await conflict.json(), {error: 'conflict'})
    console.log('Reproduced: AI config PATCH returns 409 {error:"conflict"} after a concurrent setting change.')
    let failReload = true
    await page.route('**/api/config', async route => {
      if (route.request().method() === 'GET' && failReload) {failReload = false; await route.abort('failed')}
      else await route.continue()
    })
    await page.getByRole('button', {name: '重新加载配置', exact: true}).click()
    await page.getByText('重新加载失败，输入已保留，请重试。', {exact: true}).waitFor()
    assert.equal(await page.locator('#AI_MODEL').inputValue(), 'default')
    assert(await page.getByRole('button', {name: '保存', exact: true}).isDisabled())
    await page.getByRole('button', {name: '重新加载配置', exact: true}).click()
    await page.getByText('已加载最新配置，保留了未保存的输入。请核对后再次保存。', {exact: true}).waitFor()
    assert.equal(await page.locator('#AI_API_URL').inputValue(), 'https://ai.example.test/v1')
    assert.equal(await page.locator('#AI_MODEL').inputValue(), 'default')
    assert.equal(await page.locator('#autoTranscript').getAttribute('data-state'), 'checked')
    await page.getByRole('button', {name: '保存', exact: true}).click()
    await page.getByText('已保存，重启后生效。', {exact: true}).waitFor()
    assert.equal(readOverrides(file).AI_MODEL, 'default')
    assert.equal(await page.locator('#AI_MODEL').inputValue(), 'default')
    // Save environment plus runtime together, and make another save afterwards.
    await page.locator('#AI_MODEL').fill('second-model')
    await page.locator('#autoTranscript').click()
    await page.getByRole('button', {name: '保存', exact: true}).click()
    await page.getByText('已保存，重启后生效。', {exact: true}).waitFor()
    assert.equal(runtime.autoTranscript, false)
    assert.equal(readOverrides(file).AI_MODEL, 'second-model')
    await page.unroute('**/api/config')
    // Environment commits, then runtime fails. Retrying must only send runtime.
    const patches = []
    let failRuntime = true
    await page.route('**/api/config', async route => {
      if (route.request().method() !== 'PATCH') return route.continue()
      const payload = route.request().postDataJSON()
      patches.push(payload)
      if (payload.source === 'runtime' && failRuntime) {
        failRuntime = false
        return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'runtimeUnavailable'})})
      }
      return route.continue()
    })
    await page.locator('#AI_MODEL').fill('third-model')
    await page.locator('#autoTranscript').click()
    await page.getByRole('button', {name: '保存', exact: true}).click()
    await page.getByText('部分配置已保存，其余输入已保留。', {exact: true}).waitFor()
    assert.equal(readOverrides(file).AI_MODEL, 'third-model')
    assert.equal(runtime.autoTranscript, false)
    await page.getByRole('button', {name: '保存', exact: true}).click()
    await page.getByText('已保存，重启后生效。', {exact: true}).waitFor()
    assert.equal(runtime.autoTranscript, true)
    assert.deepEqual(patches.map(item => item.source), ['environment', 'runtime', 'runtime'])
    assert.equal(patches[1].revision, patches[2].revision)
    assert.deepEqual(errors, [])
    console.log('Config browser checks passed: conflict recovery keeps inputs, successful saves keep schema, mixed-source saves work.')
  } finally {
    if (browser) await browser.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, {recursive: true, force: true})
  }
}
main().catch(e => {console.error(e); process.exitCode = 1})