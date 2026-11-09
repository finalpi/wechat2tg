/* eslint-disable @typescript-eslint/no-var-requires */
const {spawnSync, spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.join(__dirname, '..')
require('dotenv').config({path: path.join(root, '.env')})

// Always rebuild so the preview includes the current frontend and backend.
console.log('正在构建 WebUI…')
const result = spawnSync('npm', ['run', 'build'], {stdio: 'inherit', cwd: root})
if (result.status !== 0) process.exit(result.status || 1)

// The standalone preview has no live message adapter. Use isolated demo data
// by default; explicitly opt out to inspect the original disconnected state.
const demo = process.env.WEBUI_MOCK !== 'false' && !process.argv.includes('--no-mock')

// Keep the demo login separate from the real standalone server's saved token.
const settingsDir = path.dirname(path.resolve(root, process.env.WEBUI_CONFIG_PATH || 'storage/webui-config.json'))
const tokenFile = path.join(settingsDir, demo ? 'webui-demo-token' : 'webui-token')
fs.mkdirSync(path.dirname(tokenFile), {recursive: true})
let token = process.env.WEBUI_TOKEN
if (!token) {
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex') + '\n', {mode: 0o600})
    token = fs.readFileSync(tokenFile, 'utf8').trim()
}

const port = process.env.WEBUI_PORT || '17863'
const host = process.env.WEBUI_HOST || '127.0.0.1'
console.log(`\n${demo ? '演示模式：示例数据，发送仅在内存中模拟，不连接真实账号。' : '独立配置预览：未连接消息服务。'}\n监听地址：${host}:${port}\n登录地址：http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port}/chat\n访问令牌：${token}\n`)
if (host === '0.0.0.0' || host === '::') console.log(`局域网访问：http://本机局域网IP:${port}/chat`)

const child = spawn(process.execPath, [demo ? 'dist/webui/dev.js' : 'dist/webui/standalone.js'], {
    stdio: 'inherit', cwd: root, env: {...process.env, WEBUI_TOKEN: token},
})
const interrupt = () => child.kill('SIGINT')
const terminate = () => child.kill('SIGTERM')
process.once('SIGINT', interrupt)
process.once('SIGTERM', terminate)
child.once('error', error => {console.error('WebUI 启动失败：', error.message); process.exitCode = 1})
child.once('exit', code => {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    process.exitCode = code ?? 1
})