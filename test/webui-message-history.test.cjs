/* eslint-disable @typescript-eslint/no-var-requires */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const exportsObject = {}
const source = fs.readFileSync(path.join(__dirname, '../webui/src/lib/message-history.ts'), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS}}).outputText
vm.runInNewContext(compiled, {exports: exportsObject, Set})
const {fillMessageGap} = exportsObject
const row = id => ({id, timestamp: id, wxId: 'test', body: String(id)})
const page = (start, end, hasMore = true) => ({messages: Array.from({length: end - start + 1}, (_, i) => row(start + i)), before: start, hasMore, serverTime: 1000})

test('history polling backfills more than one page of messages after a long pause', async () => {
  const cursors = []
  const result = await fillMessageGap(page(121, 170), page(1, 50).messages, async before => {
    cursors.push(before)
    return before === 121 ? page(71, 120) : page(21, 70)
  })
  assert.deepEqual(cursors, [121, 71])
  const ids = new Set(result.messages.map(row => row.id))
  for (let id = 51; id <= 170; id++) assert(ids.has(id), `Message ${id} must not fall into an unreachable gap`)
})

test('overlapping history pages and an initially empty conversation need no backfill', async () => {
  const unexpected = async () => {throw new Error('Unexpected history request')}
  const latest = page(31, 80)
  assert.equal(await fillMessageGap(latest, page(1, 50).messages, unexpected), latest)
  assert.equal(await fillMessageGap(latest, [], unexpected), latest)
})

test('history backfill terminates when the server ends history or repeats a cursor', async () => {
  let calls = 0
  const latest = page(101, 150)
  await fillMessageGap(latest, [row(1)], async () => {calls++; return page(51, 100, false)})
  assert.equal(calls, 1)
  calls = 0
  await fillMessageGap(latest, [row(1)], async () => {calls++; return latest})
  assert.equal(calls, 1)
})