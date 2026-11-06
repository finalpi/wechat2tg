/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {createHmac} = require('node:crypto')
const {once} = require('node:events')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const {createWebUIServer} = require('../dist/webui/server')
const {installMiniAppMenu} = require('../dist/webui/mini-app-menu')
const {Telegram} = require('telegraf')

const botToken = '12345:test-bot-secret'
function initData(id) {
  const values = {auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({id, first_name: 'test'})}
  const check = Object.keys(values).sort().map(key => `${key}=${values[key]}`).join('\n')
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return new URLSearchParams({...values, hash: createHmac('sha256', key).update(check).digest('hex')}).toString()
}
async function fixture(t, enabled = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-miniapp-http-'))
  let owner = 123
  const server = createWebUIServer({file: path.join(root, 'config.json'), token: 'browser-administrator-token',
    environment: {BOT_TOKEN: botToken, WEBUI_MINI_APP_URL: enabled ? 'https://wechat.example.test/' : ''},
    runtime: {read: async () => ({chatId: owner}), save: async () => undefined},
    mcpTokens: {write: 'w'.repeat(32), read: 'r'.repeat(32)},
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive: true, force: true})})
  const url = `http://127.0.0.1:${server.address().port}`
  return {setOwner: value => {owner = value}, get: (route, token) => fetch(url + route, {headers: token ? {Authorization: `Bearer ${token}`} : {}}),
    exchange: (data, headers = {}) => fetch(url + '/api/auth/telegram', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify({initData: data})}),
    logout: token => fetch(url + '/api/auth/logout', {method: 'POST', headers: {Authorization: `Bearer ${token}`}}),
  }
}

test('Mini App HTTP auth rejects forged/non-owner identity and keeps browser auth separate', async t => {
  const api = await fixture(t)
  assert.equal((await api.get('/api/config')).status, 401)
  assert.equal((await api.get('/api/messages/events?token=browser-administrator-token')).status, 401)
  assert.equal((await api.exchange(initData(456))).status, 403)
  assert.equal((await api.exchange(initData(456), {Authorization: 'Bearer browser-administrator-token'})).status, 403)
  assert.equal((await api.exchange(initData(123) + '&user=%7B%22id%22%3A123%7D')).status, 401)
  assert.equal((await api.exchange(initData(123), {Origin: 'https://attacker.example'})).status, 403)
  const response = await api.exchange(initData(123))
  assert.equal(response.status, 200)
  const session = await response.json()
  assert.match(session.token, /^miniapp_/)
  const snapshot = await api.get('/api/config', session.token)
  assert.equal(snapshot.status, 200)
  assert(!(await snapshot.text()).includes(botToken))
  assert.equal((await api.get('/api/config', 'browser-administrator-token')).status, 200)
  assert.equal((await api.logout(session.token)).status, 200)
  assert.equal((await api.get('/api/config', session.token)).status, 401)
  const next = await (await api.exchange(initData(123))).json()
  api.setOwner(456)
  assert.equal((await api.get('/api/config', next.token)).status, 401)
})

test('Mini App is disabled without URL/owner and only allows Telegram web frames when enabled', async t => {
  const disabled = await fixture(t, false)
  assert.equal((await disabled.exchange(initData(123))).status, 503)
  assert.match((await disabled.get('/')).headers.get('content-security-policy'), /frame-ancestors 'none'/)
  const enabled = await fixture(t)
  const policy = (await enabled.get('/')).headers.get('content-security-policy')
  assert.match(policy, /frame-ancestors https:\/\/web.telegram.org https:\/\/\*.web.telegram.org/)
  assert(!policy.includes('\'unsafe-inline\''))
  enabled.setOwner(0)
  assert.equal((await enabled.exchange(initData(123))).status, 503)
})

test('Mini App menu uses the real Telegraf wrapper and sends an owner-scoped web_app payload', async () => {
  const calls = []
  const telegram = new Telegram('12345:synthetic-menu-test')
  // Keep the real wrapper; intercept only the transport so no Telegram calls are made.
  telegram.callApi = async (method, payload) => {calls.push({method, payload}); return true}
  for (const id of [0, -123, undefined, NaN]) assert.equal(await installMiniAppMenu(telegram, id, 'https://wechat.example.test'), false)
  assert.equal(await installMiniAppMenu(telegram, 123, ''), false)
  await assert.rejects(installMiniAppMenu(telegram, 123, 'http://wechat.example.test'))
  assert.deepEqual(calls, [])
  await installMiniAppMenu(telegram, 123, 'https://wechat.example.test')
  assert.deepEqual(calls, [{method: 'setChatMenuButton', payload: {chat_id: 123, menu_button: {type: 'web_app', text: '控制台', web_app: {url: 'https://wechat.example.test/'}}}}])
  await installMiniAppMenu(telegram, 123, 'https://new-wechat.example.test/')
  assert.equal(calls[1].payload.chat_id, 123, 'changing the URL must still target only the owner')
  assert.equal(calls[1].payload.menu_button.web_app.url, 'https://new-wechat.example.test/')
})