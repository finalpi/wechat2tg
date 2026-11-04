/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const {createRequire} = require('node:module')
const {MESSAGE_TEMPLATE_DEFAULTS, resolveMessageTemplates} = require('../dist/util/MessageTemplates')
const {readOverrides, writeOverrides, migrateMessageTemplates} = require('../dist/webui/store')

const expectedDefaults = {
  CONTACT_MESSAGE: '<b>#[alias_first]: </b>',
  CONTACT_MESSAGE_GROUP: '<b>#[alias_first]: </b>',
  OFFICIAL_MESSAGE: '<b>#[name]: </b>',
  OFFICIAL_MESSAGE_GROUP: '<b>#[name]: </b>',
  ROOM_MESSAGE: '<b>#[member_name]: </b>',
  ROOM_MESSAGE_GROUP: '<b>#[member_name]: </b>',
  MESSAGE_DISPLAY: '#[identity]#[br]#[body]',
}
const keys = Object.keys(expectedDefaults)
const templates = prefix => Object.fromEntries(keys.map(key => [key, `${prefix}-${key}`]))
const markerPath = file => `${file}.message-templates-v1.json`
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function fixture(t, relative = 'webui-config.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wx2tg-message-templates-'))
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}))
  return {directory, file: path.join(directory, relative)}
}

// Exercise startup and injected write failures without changing the real process.env or fs.
function isolatedStore(environment, filesystem = fs) {
  const filename = require.resolve('../dist/webui/store')
  const localRequire = createRequire(filename)
  const exports = {}
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports,
    process: {env: environment},
    require: name => name === 'node:fs' ? filesystem : localRequire(name),
  }, {filename})
  return exports
}

test('message defaults are frozen, undecorated, and use the member directly in groups', () => {
  assert.deepEqual(MESSAGE_TEMPLATE_DEFAULTS, expectedDefaults)
  assert(Object.isFrozen(MESSAGE_TEMPLATE_DEFAULTS))
  assert.deepEqual(resolveMessageTemplates({}), expectedDefaults)
})

test('missing, empty, whitespace, and non-string message templates fall back to defaults', () => {
  for (const value of [undefined, null, '', ' \t\r\n ', 0, false, {}, []]) {
    assert.deepEqual(resolveMessageTemplates(Object.fromEntries(keys.map(key => [key, value]))), expectedDefaults)
  }
  assert.deepEqual(resolveMessageTemplates({UNRELATED: 'ignored'}), expectedDefaults)
})

test('valid custom message templates retain intentional leading and trailing spacing', () => {
  const values = Object.fromEntries(keys.map(key => [key, ` \t${key}: #[body]\n  `]))
  const original = {...values}
  assert.deepEqual(resolveMessageTemplates(values), original)
  assert.deepEqual(values, original)
})

for (const source of ['overrides', 'environment', 'mixed']) {
  test(`first migration resets all seven templates from ${source} and preserves unrelated settings`, t => {
    const {directory, file} = fixture(t)
    const environment = {
      ...templates('env'),
      BOT_TOKEN: 'synthetic-env-secret',
      CREATE_ROOM_NAME: 'env room #[name]',
      CREATE_CONTACT_NAME: 'env contact #[alias_first]',
    }
    const overrides = {
      BOT_TOKEN: 'synthetic-override-secret',
      AI_API_KEY: 'synthetic-ai-secret',
      CREATE_ROOM_NAME: 'room #[name]',
      CREATE_CONTACT_NAME: 'contact #[alias_first]',
      AUTO_CREATE_GROUPS: 'false',
      MQTT_PASSWORD: 'synthetic-legacy-secret',
    }
    const oldOverrides = templates('saved')
    if (source === 'overrides') Object.assign(overrides, oldOverrides)
    if (source === 'mixed') {
      for (const [index, key] of keys.entries()) {
        if (index % 2 === 0) overrides[key] = oldOverrides[key]
      }
      overrides.CONTACT_MESSAGE = '' // Even empty overrides win in the backup.
      overrides.ROOM_MESSAGE = '   '
    }
    const originalEnvironment = {...environment}
    const envFile = path.join(directory, '.env')
    fs.writeFileSync(envFile, 'BOT_TOKEN=synthetic-dotenv-secret\nROOM_MESSAGE=old\n')
    const envContents = fs.readFileSync(envFile, 'utf8')
    writeOverrides(overrides, file)
    const migrated = migrateMessageTemplates(readOverrides(file), file, environment)
    assert.deepEqual({...migrated}, {...overrides, ...expectedDefaults})
    assert.deepEqual({...readOverrides(file)}, {...overrides, ...expectedDefaults})
    assert.deepEqual(environment, originalEnvironment)
    assert.equal(fs.readFileSync(envFile, 'utf8'), envContents)
    const backup = Object.fromEntries(keys.map(key => [key, overrides[key] ?? environment[key] ?? null]))
    const marker = readJson(markerPath(file))
    assert.deepEqual(marker, {version: 1, completed: true, backup})
    for (const secret of ['synthetic-env-secret', 'synthetic-override-secret', 'synthetic-ai-secret', 'synthetic-legacy-secret', 'synthetic-dotenv-secret']) {
      assert(!fs.readFileSync(markerPath(file), 'utf8').includes(secret))
    }
    assert.equal(fs.statSync(markerPath(file)).mode & 0o777, 0o600)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  })
}

test('absent prior template values are backed up as null', t => {
  const {file} = fixture(t)
  migrateMessageTemplates({}, file, {})
  assert.deepEqual(readJson(markerPath(file)).backup, Object.fromEntries(keys.map(key => [key, null])))
})

test('custom WEBUI_CONFIG_PATH scopes startup migration and later customizations survive restarts', t => {
  const {directory, file} = fixture(t, 'custom/nested/settings.json')
  const firstEnv = {
    WEBUI_CONFIG_PATH: file,
    ...templates('env'),
    BOT_TOKEN: 'synthetic-env-token',
    CREATE_ROOM_NAME: 'keep env room',
    CREATE_CONTACT_NAME: 'keep env contact',
  }
  const startup = isolatedStore(firstEnv)
  assert.equal(startup.settingsPath(), file)
  startup.loadPersistentEnvironment()
  for (const key of keys) assert.equal(firstEnv[key], expectedDefaults[key])
  assert.equal(firstEnv.BOT_TOKEN, 'synthetic-env-token')
  assert.equal(firstEnv.CREATE_ROOM_NAME, 'keep env room')
  assert.equal(firstEnv.CREATE_CONTACT_NAME, 'keep env contact')
  assert(!fs.existsSync(path.join(directory, 'storage/webui-config.json')))
  const markerContents = fs.readFileSync(markerPath(file), 'utf8')
  const customized = {...templates('new customization'), CONTACT_MESSAGE: '   '}
  writeOverrides(customized, file)
  for (let restart = 0; restart < 2; restart++) {
    const environment = {WEBUI_CONFIG_PATH: file, ...templates('stale env')}
    isolatedStore(environment).loadPersistentEnvironment()
    for (const key of keys) assert.equal(environment[key], customized[key])
    assert.deepEqual({...readOverrides(file)}, customized)
    assert.equal(fs.readFileSync(markerPath(file), 'utf8'), markerContents)
  }
  // A separate config gets its own migration, not this config's completion status.
  const secondFile = path.join(directory, 'another.json')
  migrateMessageTemplates({}, secondFile, templates('second'))
  assert.equal(readJson(markerPath(secondFile)).backup.ROOM_MESSAGE, 'second-ROOM_MESSAGE')
})

for (const alreadyReset of [false, true]) {
  test(`prepared migration recovers with original backup (${alreadyReset ? 'after' : 'before'} config replacement)`, t => {
    const {file} = fixture(t)
    const backup = {...templates('original'), MESSAGE_DISPLAY: null}
    writeOverrides({BOT_TOKEN: 'synthetic-preserved', ...(alreadyReset ? expectedDefaults : templates('old saved'))}, file)
    fs.writeFileSync(markerPath(file), JSON.stringify({version: 1, completed: false, backup}), {mode: 0o600})
    migrateMessageTemplates(readOverrides(file), file, templates('changed env'))
    assert.deepEqual({...readOverrides(file)}, {BOT_TOKEN: 'synthetic-preserved', ...expectedDefaults})
    assert.deepEqual(readJson(markerPath(file)), {version: 1, completed: true, backup})
  })
}

test('malformed migration markers fail closed without changing config, marker, or synthetic environment', t => {
  const {file} = fixture(t)
  const invalidMarkers = [
    '{', 'null', '[]', '{}',
    JSON.stringify({version: 2, completed: true, backup: templates('old')}),
    JSON.stringify({version: 1, completed: 'true', backup: templates('old')}),
    JSON.stringify({version: 1, completed: false, backup: {}}),
    JSON.stringify({version: 1, completed: true, backup: {...templates('old'), ROOM_MESSAGE: 42}}),
    JSON.stringify({version: 1, completed: true, backup: {...templates('old'), BOT_TOKEN: 'not-a-template'}}),
    JSON.stringify({version: 1, completed: true, backup: templates('old'), extra: true}),
  ]
  writeOverrides(templates('saved'), file)
  const originalConfig = fs.readFileSync(file, 'utf8')
  for (const marker of invalidMarkers) {
    fs.writeFileSync(markerPath(file), marker)
    const environment = {WEBUI_CONFIG_PATH: file, ...templates('env')}
    const originalEnvironment = {...environment}
    assert.throws(() => isolatedStore(environment).loadPersistentEnvironment(), /migration marker/)
    assert.equal(fs.readFileSync(file, 'utf8'), originalConfig)
    assert.equal(fs.readFileSync(markerPath(file), 'utf8'), marker)
    assert.deepEqual(environment, originalEnvironment)
  }
})

for (const phase of ['prepare', 'configuration', 'complete']) {
  test(`failure writing ${phase} aborts startup and retry keeps the original backup`, t => {
    const {file} = fixture(t)
    const saved = {...templates('saved'), BOT_TOKEN: 'synthetic-secret'}
    writeOverrides(saved, file)
    const originalConfig = fs.readFileSync(file, 'utf8')
    const environment = {WEBUI_CONFIG_PATH: file, ...templates('env')}
    const originalEnvironment = {...environment}
    let markerWrites = 0
    const filesystem = {
      ...fs,
      renameSync(from, to) {
        if (to === markerPath(file)) markerWrites++
        if ((phase === 'prepare' && to === markerPath(file) && markerWrites === 1)
          || (phase === 'configuration' && to === file)
          || (phase === 'complete' && to === markerPath(file) && markerWrites === 2)) {
          throw new Error(`synthetic ${phase} write failure`)
        }
        fs.renameSync(from, to)
      },
    }
    assert.throws(() => isolatedStore(environment, filesystem).loadPersistentEnvironment(), /synthetic .* write failure/)
    assert.deepEqual(environment, originalEnvironment, 'failed startup must not apply any environment overrides')
    if (phase === 'prepare') assert(!fs.existsSync(markerPath(file)))
    else assert.deepEqual(readJson(markerPath(file)), {version: 1, completed: false, backup: templates('saved')})
    if (phase !== 'complete') assert.equal(fs.readFileSync(file, 'utf8'), originalConfig)
    assert(!fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')))
    isolatedStore({...originalEnvironment, ...templates('changed-env')}).loadPersistentEnvironment()
    assert.deepEqual(readJson(markerPath(file)), {version: 1, completed: true, backup: templates('saved')})
    assert.deepEqual({...readOverrides(file)}, {...saved, ...expectedDefaults})
  })
}

test('override reads still validate persisted keys and boolean representations', t => {
  const {file} = fixture(t)
  writeOverrides({AUTO_CREATE_GROUPS: 'false', CONTACT_MESSAGE: 'old'}, file)
  assert.equal(readOverrides(file).AUTO_CREATE_GROUPS, 'false')
  fs.writeFileSync(file, JSON.stringify({UNSUPPORTED: 'value'}))
  assert.throws(() => readOverrides(file), /不支持的配置项/)
})