/* eslint-disable @typescript-eslint/no-var-requires */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {webcrypto} = require('node:crypto')

const source = fs.readFileSync(path.join(__dirname, '../webui/src/lib/request-id.ts'), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS}}).outputText
function load(crypto) {
  const exports = {}
  vm.runInNewContext(compiled, {exports, crypto, Uint8Array})
  return exports.createRequestId
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('request IDs prefer native UUID and preserve its crypto receiver', () => {
  const crypto = {randomUUID() {assert.equal(this, crypto); return 'native-id'}}
  assert.equal(load(crypto)(), 'native-id')
})

test('request IDs work without randomUUID using secure random bytes', () => {
  const crypto = {getRandomValues(bytes) {
    assert.equal(this, crypto)
    assert.equal(bytes.length, 16)
    return webcrypto.getRandomValues(bytes)
  }}
  const create = load(crypto)
  const ids = Array.from({length: 1000}, () => create())
  ids.forEach(id => assert.match(id, uuid))
  assert.equal(new Set(ids).size, ids.length)
})

test('fallback UUID sets the version, variant and zero-padding correctly', () => {
  assert.equal(load({getRandomValues: bytes => bytes.fill(0)})(), '00000000-0000-4000-8000-000000000000')
  assert.equal(load({randomUUID: null, getRandomValues: bytes => bytes.fill(255)})(), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
})

test('request IDs fail clearly instead of using weak randomness if Web Crypto is absent', () => {
  for (const crypto of [undefined, {}, {randomUUID: null}]) {
    assert.throws(load(crypto), /当前浏览器不支持安全请求编号/)
  }
})