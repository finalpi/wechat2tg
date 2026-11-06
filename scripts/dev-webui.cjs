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

// Generate or read the same token the standalone server will accept.
const settingsDir = path.dirname(path.resolve(root, process.env.WEBUI_CONFIG_PATH || 'storage/webui-config.json'))
const tokenFile = path.join(settingsDir, 'webui-token')
fs.mkdirSync(path.dirname(tokenFile), {recursive: true})
let token = process.env.WEBUI_TOKEN
if (!token) {
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex') + '\n', {mode: 0o600})
    token = fs.readFileSync(tokenFile, 'utf8').trim()
}

const port = process.env.WEBUI_PORT || '17863'
console.log(`\n登录地址：http://127.0.0.1:${port}/\n访问令牌：${token}\n`)

const child = spawn(process.execPath, ['dist/webui/standalone.js'], {
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