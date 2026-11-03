/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const yaml = require('js-yaml')
const root = path.resolve(__dirname, '..')
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-and-push-docker-image.yml'), 'utf8'))
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
const commit = '0123456789abcdef0123456789abcdef01234567'

function runStep(script, variables = {}, fakeDocker = false) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-workflow-'))
  try {
    const output = path.join(temp, 'output')
    const calls = path.join(temp, 'docker-calls')
    fs.writeFileSync(output, '')
    if (fakeDocker) {
      fs.writeFileSync(path.join(temp, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS"\n', {mode: 0o700})
    }
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root, encoding: 'utf8',
      env: {...process.env, GITHUB_OUTPUT: output, GITHUB_SHA: commit, DOCKER_CALLS: calls,
        PATH: fakeDocker ? `${temp}:${process.env.PATH}` : process.env.PATH, ...variables},
    })
    return {...result, output: fs.readFileSync(output, 'utf8'), calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''}
  } finally {
    fs.rmSync(temp, {recursive: true})
  }
}

function step(job, id) {
  const value = workflow.jobs[job]?.steps.find(s => s.id === id)
  assert(value, `Missing ${job}/${id} step`)
  return value
}

test('architectures build independently on native runners with isolated caches', () => {
  const build = workflow.jobs.build
  assert(build, 'a separate matrix build job is required')
  assert.equal(build.needs, 'validate')
  assert.equal(build.strategy['fail-fast'], false)
  assert.deepEqual(build.strategy.matrix.include, [
    {arch: 'amd64', platform: 'linux/amd64', runner: 'ubuntu-24.04'},
    {arch: 'arm64', platform: 'linux/arm64', runner: 'ubuntu-24.04-arm'},
  ])
  assert.equal(build['runs-on'], '${{ matrix.runner }}')
  assert.equal(build.name, 'Build ${{ matrix.arch }}')
  assert(!build.steps.some(s => s.uses?.includes('setup-qemu')))
  const push = step('build', 'push').with
  assert.equal(push.platforms, '${{ matrix.platform }}')
  assert.equal(push.tags, '${{ steps.meta.outputs.tags }}')
  assert(push['cache-from'].includes('${{ matrix.arch }}'))
  assert(push['cache-to'].includes('${{ matrix.arch }}'))
})

test('only the final multi-architecture manifest waits for both build jobs', () => {
  assert.deepEqual(workflow.jobs.publish?.needs, ['validate', 'build'])
  assert.deepEqual(workflow.on.push.tags, ['v6.*'])
})

test('release and manual version metadata retain strict tag and branch checks', () => {
  const script = step('validate', 'meta').run
  const release = runStep(script, {GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}`, GITHUB_REF: `refs/tags/v${version}`})
  assert.equal(release.status, 0, release.stderr)
  assert(release.output.includes(`app_version=v${version}\n`))
  assert(release.output.includes('is_release=true\n'))
  const dev = runStep(script, {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'v6', GITHUB_REF: 'refs/heads/v6'})
  assert.equal(dev.status, 0, dev.stderr)
  assert(dev.output.includes('app_version=v6-dev-0123456\n'))
  assert(dev.output.includes('is_release=false\n'))
  for (const [event, type, name] of [['push', 'tag', 'v6'], ['push', 'tag', 'v7.0.0'], ['workflow_dispatch', 'branch', 'v7'], ['workflow_dispatch', 'tag', `v${version}`]]) {
    const result = runStep(script, {GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name, GITHUB_REF: `refs/${type === 'tag' ? 'tags' : 'heads'}/${name}`})
    assert.notEqual(result.status, 0, `${event}/${type}/${name} must be rejected`)
  }
})

for (const arch of ['amd64', 'arm64']) {
  test(`${arch} publishes immediately to its own tag without touching the combined tag`, () => {
    const script = step('build', 'meta').run
    const release = runStep(script, {IMAGE: 'finalpi/wechat2tg-v3', APP_VERSION: `v${version}`, IS_RELEASE: 'true', ARCH: arch})
    assert.equal(release.status, 0, release.stderr)
    assert.equal(release.output.trim(), `tags=finalpi/wechat2tg-v3:v${version}-${arch},finalpi/wechat2tg-v3:v6-latest-${arch}`)
    const dev = runStep(script, {IMAGE: 'finalpi/wechat2tg-v3', APP_VERSION: 'v6-dev-0123456', IS_RELEASE: 'false', ARCH: arch})
    assert.equal(dev.status, 0, dev.stderr)
    assert.equal(dev.output.trim(), `tags=finalpi/wechat2tg-v3:v6-dev-0123456-${arch}`)
  })
}

test('manifest publishing combines both images and reserves rolling tags for stable releases', () => {
  const script = step('publish', 'manifest').run
  for (const isRelease of ['true', 'false']) {
    const appVersion = isRelease === 'true' ? `v${version}` : 'v6-dev-0123456'
    const result = runStep(script, {IMAGE: 'finalpi/wechat2tg-v3', APP_VERSION: appVersion, IS_RELEASE: isRelease}, true)
    assert.equal(result.status, 0, result.stderr)
    assert(result.calls.includes(`finalpi/wechat2tg-v3:${appVersion}-amd64`))
    assert(result.calls.includes(`finalpi/wechat2tg-v3:${appVersion}-arm64`))
    assert.equal(result.calls.includes('-t finalpi/wechat2tg-v3:v6-latest'), isRelease === 'true')
    assert(!result.calls.includes('-t finalpi/wechat2tg-v3:latest'))
  }
})