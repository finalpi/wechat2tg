import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {createWebUIServer} from './server'
import {createDemoMessageCenter} from './demo-messages'

/** Dedicated dev entry point: production startWebUI never falls back to mocks. */
export async function createDemoWebUI(token = randomBytes(32).toString('hex')) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat2tg-webui-demo-'))
    try {
        const messages = await createDemoMessageCenter(path.join(directory, 'media'))
        const server = createWebUIServer({environment: {}, token, file: path.join(directory, 'settings.json'), messages, demo: true,
            runtime: {read: async () => ({}), save: async () => {throw Object.assign(new Error('demoReadOnly'), {code: 'demoReadOnly', status: 403})}},
            mcpTokens: {read: randomBytes(32).toString('hex'), write: randomBytes(32).toString('hex')},
        })
        const dispose = async () => {
            server.closeAllConnections()
            if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
            fs.rmSync(directory, {recursive: true, force: true})
        }
        return {server, token, directory, dispose}
    } catch (error) {
        fs.rmSync(directory, {recursive: true, force: true})
        throw error
    }
}

async function main() {
    const port = Number(process.env.WEBUI_PORT || 17863), host = process.env.WEBUI_HOST || '127.0.0.1'
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEBUI_PORT 必须为 1–65535')
    const preview = await createDemoWebUI(process.env.WEBUI_TOKEN)
    const stop = () => {void preview.dispose().then(() => process.exit(0))}
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    process.once('exit', () => fs.rmSync(preview.directory, {recursive: true, force: true}))
    preview.server.once('error', error => {
        console.error('演示 WebUI 启动失败：' + error.message)
        void preview.dispose().then(() => {process.exitCode = 1})
    })
    preview.server.listen(port, host, () => console.log(`演示 WebUI：http://${host}:${port}/chat · 不连接微信或 Telegram，重启后示例消息重置`))
}

if (require.main === module) void main().catch(error => {console.error('演示 WebUI 启动失败：' + error.message);process.exitCode = 1})