/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const {execFileSync} = require('node:child_process')
const http = require('node:http')
const yaml = require('js-yaml')
const {WxBot} = require('wx2tg-puppet')
const {msgApi} = require('wx2tg-puppet/dist/api/MsgApi')
const pkg = require('../package.json')
const lock = require('../package-lock.json')
const root = path.resolve(__dirname, '..')

test('bot release metadata agrees and pinned puppet/server stay within v6', () => {
  execFileSync(process.execPath, ['scripts/check-version.cjs'], {cwd: root})
  assert.equal(require('wx2tg-puppet/package.json').version, pkg.dependencies['wx2tg-puppet'])
  for (const name of ['docker-compose.yml', 'README.md', 'README_zh.md']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8')
    const botImage = name === 'docker-compose.yml' ? `finalpi/wechat2tg:v${pkg.version}` : 'finalpi/wechat2tg:latest'
    assert(source.includes(`image: ${botImage}`))
    assert.match(source, /image: finalpi\/wx2tg-server:v6\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.[1-9]\d*)?\s*\n/)
    assert(!source.includes('image: finalpi/wechat2tg-v3:'))
    assert(!source.includes('image: finalpi/wechat2tg:dev'))
  }
})

test('README Compose examples use latest and otherwise match the actual stack', () => {
  const compose = yaml.load(fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8'))
  assert.equal(compose.services.wechat2tg.image, `finalpi/wechat2tg:v${pkg.version}`)
  assert.equal(compose.services.wechat2tg.container_name, 'wechat2tg-v6')
  assert.equal(compose.services['wx2tg-v3'], undefined)
  for (const name of ['README.md', 'README_zh.md']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8')
    const blocks = [...source.matchAll(/```yaml\r?\n(services:\r?\n[\s\S]*?)```/g)]
    assert.equal(blocks.length, 1, `${name} must contain one complete Compose example`)
    const example = yaml.load(blocks[0][1])
    assert.equal(example.services.wechat2tg.image, 'finalpi/wechat2tg:latest')
    example.services.wechat2tg.image = compose.services.wechat2tg.image
    assert.deepEqual(example, compose, `${name} Compose must otherwise match docker-compose.yml`)
    for (const command of ['exec', 'restart', 'logs --tail=100']) {
      assert(source.includes(`docker compose ${command} wechat2tg`))
    }
  }
  const config = fs.readFileSync(path.join(root, 'app.conf.example'), 'utf8')
  assert(config.includes('syncmessagebusinessuri = "http://wechat2tg:8056/message/callback/{0}"'))
})

test('vendored artifact matches the lockfile SHA-512', () => {
  const dependency = lock.packages['node_modules/wx2tg-puppet']
  assert.equal(dependency.resolved, `file:vendor/wx2tg-puppet-${pkg.dependencies['wx2tg-puppet']}.tgz`)
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
