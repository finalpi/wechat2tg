/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

try {
  const root = path.resolve(__dirname, '..')
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const v6 = /^6\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.[1-9]\d*)?$/
  assert.match(version, v6)
  assert.equal(pkg.version, version, 'package.json must match VERSION')
  assert.equal(lock.version, version, 'lockfile version must match VERSION')
  assert.equal(lock.packages[''].version, version)
  // Components release independently within v6; the selected SDK stays exactly pinned.
  const puppetVersion = pkg.dependencies['wx2tg-puppet']
  assert.match(puppetVersion, v6, 'pin an exact v6 puppet release')
  assert.equal(lock.packages['node_modules/wx2tg-puppet'].version, puppetVersion)
  assert.equal(lock.packages[''].dependencies['wx2tg-puppet'], puppetVersion)
  const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8')
  const serverVersion = compose.match(/^\s+image: finalpi\/wx2tg-server:v(\S+)\s*$/m)?.[1] || ''
  assert.match(serverVersion, v6, 'Compose must use a versioned v6 server image')
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    assert.equal(process.env.GITHUB_REF_NAME, 'v' + version, 'release tag must match VERSION')
  }
  console.log(pkg.name + ': v' + version + ' release metadata matches')
} catch (error) {
  console.error('Release version check failed:', error.message)
  process.exitCode = 1
}