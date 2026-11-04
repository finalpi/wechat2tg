/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')

function fixture(t, {bot = '6.0.17', puppet = '6.0.16', server = '6.0.16'} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat2tg-release-'))
  t.after(() => fs.rmSync(root, {recursive: true, force: true}))
  fs.mkdirSync(path.join(root, 'scripts'))
  fs.copyFileSync(path.join(__dirname, '../scripts/check-version.cjs'), path.join(root, 'scripts/check-version.cjs'))
  const pkg = {name: 'wechat2tg', version: bot, dependencies: {'wx2tg-puppet': puppet}}
  const lock = {version: bot, packages: {
    '': {version: bot, dependencies: {'wx2tg-puppet': puppet}},
    'node_modules/wx2tg-puppet': {version: puppet},
  }}
  let compose = `services:\n  wechat2tg:\n    image: finalpi/wechat2tg:v${bot}\n  wx2tg-server:\n    image: finalpi/wx2tg-server:v${server}\n`
  return {pkg, lock, setCompose: value => {compose = value}, run: (env = {}) => {
    fs.writeFileSync(path.join(root, 'VERSION'), bot + '\n')
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock))
    fs.writeFileSync(path.join(root, 'docker-compose.yml'), compose)
    return spawnSync(process.execPath, ['scripts/check-version.cjs'], {
      cwd: root, encoding: 'utf8',
      env: {...process.env, GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'v6', ...env},
    })
  }}
}

for (const versions of [
  {bot: '6.0.17', puppet: '6.0.16', server: '6.0.16'},
  {bot: '6.1.0', puppet: '6.0.12', server: '6.2.1'},
  {bot: '6.1.0-dev.2', puppet: '6.0.13-dev.1', server: '6.0.16'},
]) {
  test(`v6 components may release independently: ${JSON.stringify(versions)}`, t => {
    const result = fixture(t, versions).run({GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v' + versions.bot})
    assert.equal(result.status, 0, result.stderr)
  })
}

for (const component of ['bot', 'puppet', 'server']) {
  for (const invalid of ['7.0.0', '60.0.0', '6', '6.01.0', '6.0.1-dev.0', '6.0.1-extra', '^6.0.16', '~6.0.16', 'latest']) {
    test(`release check rejects invalid ${component} version ${invalid}`, t => {
      const result = fixture(t, {[component]: invalid}).run()
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /Release version check failed/)
    })
  }
}

for (const mutate of [
  f => {f.pkg.version = '6.0.18'},
  f => {f.lock.version = '6.0.18'},
  f => {f.lock.packages[''].version = '6.0.18'},
  f => {f.lock.packages[''].dependencies['wx2tg-puppet'] = '6.0.15'},
  f => {f.lock.packages['node_modules/wx2tg-puppet'].version = '6.0.15'},
]) {
  test('independent component versions do not relax package/lock consistency', t => {
    const f = fixture(t)
    mutate(f)
    assert.notEqual(f.run().status, 0)
  })
}

test('the bot tag must still match its full version, not merely the major', t => {
  const f = fixture(t)
  for (const tag of ['v6.0.16', 'v6.0.17-dev.1', 'v7.0.0', '6.0.17', 'v6']) {
    assert.notEqual(f.run({GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: tag}).status, 0)
  }
})

test('unversioned or missing server images fail closed', t => {
  const f = fixture(t)
  for (const image of ['finalpi/wx2tg-server:latest', 'finalpi/wx2tg-server:v6', 'finalpi/another-server:v6.0.16', '']) {
    f.setCompose('services:\n  wx2tg-server:\n    image: ' + image + '\n')
    assert.notEqual(f.run().status, 0)
  }
})