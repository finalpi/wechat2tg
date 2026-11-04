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
const commit = '0123456789abcdef0123456789abcdef01234567'
const image = 'finalpi/wechat2tg'
const channels = [
  {version: 'v6.0.13', channel: 'stable', tagged: 'true', aliases: ['v6']},
  {version: 'v6.0.13-dev.1', channel: 'dev', tagged: 'true', aliases: ['v6-dev']},
  {version: 'v6-dev-0123456', channel: 'dev', tagged: 'false', aliases: []},
]

function runStep(script, variables = {}, {version = '6.0.13', packageVersion = version} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-workflow-'))
  try {
    // Exercise the production validator without depending on the checkout's release channel.
    fs.mkdirSync(path.join(temp, 'scripts'))
    fs.copyFileSync(path.join(root, 'scripts/check-version.cjs'), path.join(temp, 'scripts/check-version.cjs'))
    fs.writeFileSync(path.join(temp, 'VERSION'), `${version}\n`)
    fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(temp, 'docker-compose.yml'))
    const pkg = {name: 'wechat2tg', version: packageVersion,
      scripts: {'check:version': 'node scripts/check-version.cjs'},
      dependencies: {'wx2tg-puppet': version}}
    fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify(pkg))
    fs.writeFileSync(path.join(temp, 'package-lock.json'), JSON.stringify({
      version, lockfileVersion: 3, packages: {'': {version, dependencies: pkg.dependencies},
        'node_modules/wx2tg-puppet': {version}},
    }))
    const output = path.join(temp, 'output')
    const calls = path.join(temp, 'docker-calls')
    fs.writeFileSync(output, '')
    // Never invoke real Docker, even if a workflow step starts using it unexpectedly.
    fs.writeFileSync(path.join(temp, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS"\n', {mode: 0o700})
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: temp, encoding: 'utf8',
      env: {...process.env, GITHUB_EVENT_NAME: '', GITHUB_REF_TYPE: '', GITHUB_REF_NAME: '', GITHUB_REF: '',
        GITHUB_OUTPUT: output, GITHUB_SHA: commit, DOCKER_CALLS: calls,
        PATH: `${temp}:${process.env.PATH}`, ...variables},
    })
    return {...result, output: fs.readFileSync(output, 'utf8'), calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''}
  } finally {
    fs.rmSync(temp, {recursive: true, force: true})
  }
}

function step(job, id) {
  const value = workflow.jobs[job]?.steps.find(s => s.id === id)
  assert(value, `Missing ${job}/${id} step`)
  return value
}

function ref(event, type, name) {
  return {GITHUB_EVENT_NAME: event, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name,
    GITHUB_REF: `refs/${type === 'tag' ? 'tags' : 'heads'}/${name}`}
}

test('validation rebuilds sqlite3 before running tests', () => {
  const install = workflow.jobs.validate.steps.find(s => s.name === 'Install dependencies and test')
  assert(install)
  assert.match(install.run, /npm ci[^\n]*\nnpm rebuild sqlite3[^\n]*\nnpm test/)
})

test('architectures build independently on native runners with isolated caches', () => {
  const build = workflow.jobs.build
  assert(build, 'a separate matrix build job is required')
  assert.equal(build.needs, 'validate')
  assert.equal(build.strategy['fail-fast'], false)
  assert.equal(build.strategy['max-parallel'], 2)
  assert.deepEqual(build.strategy.matrix.include, [
    {arch: 'amd64', platform: 'linux/amd64', runner: 'ubuntu-24.04'},
    {arch: 'arm64', platform: 'linux/arm64', runner: 'ubuntu-24.04-arm'},
  ])
  assert.equal(build['runs-on'], '${{ matrix.runner }}')
  assert.equal(build.name, 'Build ${{ matrix.arch }}')
  assert(!build.steps.some(s => s.uses?.includes('setup-qemu')))
  const push = step('build', 'push').with
  assert.equal(push.push, true)
  assert.equal(push.platforms, '${{ matrix.platform }}')
  assert.equal(push.tags, '${{ steps.meta.outputs.tags }}')
  assert(push['cache-from'].includes('${{ matrix.arch }}'))
  assert(push['cache-to'].includes('${{ matrix.arch }}'))
})

test('only the final manifest waits for both builds; channel metadata reaches both jobs', () => {
  assert.deepEqual(workflow.jobs.publish?.needs, ['validate', 'build'])
  assert.deepEqual(workflow.on.push.tags, ['v6.*'])
  assert.equal(workflow.on.push.branches, undefined)
  for (const key of ['app_version', 'channel', 'is_tagged']) {
    assert.equal(workflow.jobs.validate.outputs[key], `\${{ steps.meta.outputs.${key} }}`)
    for (const job of ['build', 'publish']) {
      assert.equal(workflow.jobs[job].env[key.toUpperCase()], `\${{ needs.validate.outputs.${key} }}`)
    }
  }
  const description = workflow.jobs.publish.steps.find(s => s.uses?.includes('dockerhub-description'))
  assert.equal(workflow.env.IMAGE, image)
  assert.equal(description.with.repository, image)
  assert.equal(description.if, 'needs.validate.outputs.is_tagged == \'true\' && needs.validate.outputs.channel == \'stable\'')
})

for (const version of ['6.0.13', '6.0.13-dev.1', '6.12.30-dev.12']) {
  test(`matching tag ${version} selects its own release channel`, () => {
    const result = runStep(step('validate', 'meta').run, ref('push', 'tag', `v${version}`), {version})
    assert.equal(result.status, 0, result.stderr)
    const channel = version.includes('-dev.') ? 'dev' : 'stable'
    assert.equal(result.output, `app_version=v${version}\nchannel=${channel}\nis_tagged=true\n`)
  })
}

test('manual builds accept only branch v6, without any rolling aliases', () => {
  const script = step('validate', 'meta').run
  const result = runStep(script, ref('workflow_dispatch', 'branch', 'v6'), {version: '6.0.13-dev.1'})
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.output, 'app_version=v6-dev-0123456\nchannel=dev\nis_tagged=false\n')
  for (const [event, type, name] of [
    ['workflow_dispatch', 'branch', 'v6-dev'], ['workflow_dispatch', 'branch', 'main'],
    ['workflow_dispatch', 'branch', 'v7'], ['workflow_dispatch', 'tag', 'v6.0.13'],
    ['push', 'branch', 'v6'], ['pull_request', 'branch', 'v6'],
  ]) {
    const rejected = runStep(script, ref(event, type, name))
    assert.notEqual(rejected.status, 0, `${event}/${type}/${name} must be rejected`)
    assert.equal(rejected.output, '')
  }
})

test('invalid dev.N grammar, version mismatches and legacy tags are rejected', () => {
  const script = step('validate', 'meta').run
  for (const version of ['6.0.13-dev.0', '6.0.13-dev.01', '6.0.13-dev.-1', '6.0.13-dev.',
    '6.0.13-dev.1.2', '6.0.13-dev', '6.0.13-rc.1', '6.0.13+build', '6.01.13', '6.0.013', '7.0.0']) {
    const result = runStep(script, ref('push', 'tag', `v${version}`), {version})
    assert.notEqual(result.status, 0, `${version} must be rejected`)
    assert.equal(result.output, '')
  }
  for (const [version, tag] of [['6.0.13', 'v6'], ['6.0.13', 'v6.0.12'],
    ['6.0.13', 'v6.0.13-dev.1'], ['6.0.13-dev.1', 'v6.0.13'], ['6.0.13-dev.1', 'v6.0.13-dev.2'],
    ['6.0.13', '6.0.13'], ['6.0.13-dev.1', '6.0.13-dev.1']]) {
    const result = runStep(script, ref('push', 'tag', tag), {version})
    assert.notEqual(result.status, 0, `${tag} must not match ${version}`)
    assert.equal(result.output, '')
  }
  const mismatch = runStep(script, ref('push', 'tag', 'v6.0.13'), {packageVersion: '6.0.12'})
  assert.notEqual(mismatch.status, 0, 'package.json must match VERSION')
})

for (const arch of ['amd64', 'arm64']) {
  for (const {version, channel, tagged, aliases} of channels) {
    test(`${arch}/${version} publishes exact and channel-specific architecture tags immediately`, () => {
      const result = runStep(step('build', 'meta').run,
        {IMAGE: image, APP_VERSION: version, CHANNEL: channel, IS_TAGGED: tagged, ARCH: arch})
      assert.equal(result.status, 0, result.stderr)
      const tags = [version, ...aliases].map(tag => `${image}:${tag}-${arch}`)
      assert.equal(result.output, `tags=${tags.join(',')}\n`)
    })
  }
}

for (const {version, channel, tagged, aliases} of channels) {
  test(`manifest ${version} combines both images without crossing release channels`, () => {
    const result = runStep(step('publish', 'manifest').run,
      {IMAGE: image, APP_VERSION: version, CHANNEL: channel, IS_TAGGED: tagged})
    assert.equal(result.status, 0, result.stderr)
    const tags = [version, ...aliases].map(tag => `-t ${image}:${tag}`).join(' ')
    assert.equal(result.calls,
      `buildx imagetools create ${tags} ${image}:${version}-amd64 ${image}:${version}-arm64\n` +
      `buildx imagetools inspect ${image}:${version}\n`)
  })
}