/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS Node test runner. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function fixture(config = {wxid: 'self'}) {
  const calls = [], exports = {}
  const dependencies = {
    'wx2tg-puppet/dist/api/UserApi': {userApi: {async GetQRCode(body) {
      calls.push(body)
      return {data: {Data: {qrcode: {buffer: 'data:image/png;base64,aGVsbG8='}}}}
    }}},
    'wx2tg-puppet/dist/services/config.service': {configService: {async get() {return config}}},
  }
  const source = fs.readFileSync(require.resolve('../src/service/WechatQrCodeService.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021}}).outputText,
    {exports, require(name) {assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]}})
  return {get: exports.getWechatQrCode, calls}
}

test('personal QR defaults to style 0 and preserves explicit 0 and returned image', async () => {
  const f = fixture()
  for (const args of [[], [0], [3]]) {
    const result = await f.get(...args)
    assert.equal(result.qrCode, 'data:image/png;base64,aGVsbG8=')
  }
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [
    {Style: 0, Wxid: 'self'}, {Style: 0, Wxid: 'self'}, {Style: 3, Wxid: 'self'},
  ])
})

test('missing account configuration does not request a QR code', async () => {
  const f = fixture(null)
  await assert.rejects(f.get(), /configuration unavailable/)
  assert.equal(f.calls.length, 0)
})

test('getqr command uses the plain QR service rather than the SDK decorative default', () => {
  const source = fs.readFileSync(require.resolve('../src/client/TelegramBotClient.ts'), 'utf8')
  const command = source.slice(source.indexOf('bot.command(\'getqr\''), source.indexOf('private async updateGroupByChatId'))
  assert.match(command, /await getWechatQrCode\(\)/)
  assert.doesNotMatch(command, /\.qrcode\(/)
  assert.match(command, /replyWithPhoto/)
})