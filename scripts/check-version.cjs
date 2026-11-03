/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

try {
  const root = path.resolve(__dirname, '..')
  const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  assert.match(version, /^6\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  assert.equal(pkg.version, version, 'package.json must match VERSION')
  assert.equal(lock.version, version, 'lockfile version must match VERSION')
  assert.equal(lock.packages[''].version, version)
  assert.equal(pkg.dependencies['wx2tg-puppet'], version, 'pin the matching puppet release')
  assert.equal(lock.packages['node_modules/wx2tg-puppet'].version, version)
  assert.equal(lock.packages[''].dependencies['wx2tg-puppet'], version)
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    assert.equal(process.env.GITHUB_REF_NAME, 'v' + version, 'release tag must match VERSION')
  }
  console.log(pkg.name + ': v' + version + ' release metadata matches')
} catch (error) {
  console.error('Release version check failed:', error.message)
  process.exitCode = 1
}