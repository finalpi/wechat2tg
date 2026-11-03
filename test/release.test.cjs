/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const {execFileSync} = require('node:child_process')
const http = require('node:http')
const {WxBot} = require('wx2tg-puppet')
const {msgApi} = require('wx2tg-puppet/dist/api/MsgApi')
const pkg = require('../package.json')
const lock = require('../package-lock.json')
const root = path.resolve(__dirname, '..')

test('package, lockfile, installed puppet, Compose, and README versions agree', () => {
  execFileSync(process.execPath, ['scripts/check-version.cjs'], {cwd: root})
  assert.equal(require('wx2tg-puppet/package.json').version, pkg.version)
  for (const name of ['docker-compose.yml', 'README.md', 'README_zh.md']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8')
    assert(source.includes(`image: finalpi/wechat2tg-v3:v${pkg.version}`))
    assert(source.includes(`image: finalpi/wx2tg-server:v${pkg.version}`))
    assert(!source.includes('image: finalpi/wechat2tg-v3:latest'))
  }
})

test('vendored artifact matches the lockfile SHA-512', () => {
  const dependency = lock.packages['node_modules/wx2tg-puppet']
  assert.equal(dependency.resolved, `file:vendor/wx2tg-puppet-${pkg.version}.tgz`)
  const bytes = fs.readFileSync(path.join(root, dependency.resolved.slice(5)))
  assert.equal('sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'), dependency.integrity)
})

test('release checks reject a mismatched tag', () => {
  assert.throws(() => execFileSync(process.execPath, ['scripts/check-version.cjs'], {
    cwd: root, env: {...process.env, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v7.0.0'}, stdio: 'pipe',
  }))
})

test('the installed puppet artifact handles body callbacks without fetching Sync again', async t => {
  const bot = new WxBot({baseUrl: 'http://127.0.0.1:1', databasePath: ':memory:', deviceType: 'ipad', callbackPort: 0})
  let syncs = 0
  t.mock.method(msgApi, 'Sync', async () => {syncs++; throw new Error('unexpected Sync')})
  const ids = []
  bot.on('message', msg => ids.push(msg.newMsgId))
  await bot.startCallbackServer('wxid_test')
  t.after(() => bot.clearAllIntervals())
  const body = '{"Code":0,"Success":true,"Message":"成功","Data":{"AddMsgs":[{"MsgId":1,"NewMsgId":9223372036854775806,"FromUserName":{"string":"wxid_sender"},"ToUserName":{"string":"wxid_test"},"MsgType":1,"CreateTime":1,"Content":{"string":"synthetic"}}]}}'
  const status = await new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: bot.httpServer.address().port,
      method: 'POST', path: '/message/callback/wxid_test'}, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end(body)
  })
  assert.equal(status, 200)
  assert.deepEqual(ids, ['9223372036854775806'])
  assert.equal(syncs, 0)
})