/* eslint-disable @typescript-eslint/no-var-requires */
const {spawnSync, spawn} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.join(__dirname, '..')
const standalone = path.join(root, 'dist/webui/standalone.js')

// Build the backend and frontend bundle once if they are not there yet.
if (!fs.existsSync(standalone)) {
    console.log('首次运行，正在构建（npm run build）…')
    const result = spawnSync('npm', ['run', 'build'], {stdio: 'inherit', cwd: root})
    if (result.status !== 0) process.exit(result.status || 1)
}

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

spawn(process.execPath, ['dist/webui/standalone.js'], {stdio: 'inherit', cwd: root, env: process.env})