import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {persistedFields, validatePatch} from './schema'

export const settingsPath = () => path.resolve(process.env.WEBUI_CONFIG_PATH || 'storage/webui-config.json')

export function readOverrides(file = settingsPath()): Record<string, string> {
    if (!fs.existsSync(file)) return {}
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    // Environment values are persisted as strings, while the API uses typed booleans.
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const f of persistedFields.filter(f => f.source === 'environment' && f.type === 'boolean')) {
            if (data[f.key] === 'true' || data[f.key] === 'false') data[f.key] = data[f.key] === 'true'
        }
    }
    return validatePatch('environment', data, true) as Record<string, string>
}

export function writeOverrides(values: Record<string, string>, file = settingsPath()) {
    const directory = path.dirname(file)
    fs.mkdirSync(directory, {recursive: true})
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
    try {
        fs.writeFileSync(temporary, JSON.stringify(values, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
        fs.renameSync(temporary, file)
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
}

export function loadPersistentEnvironment() {
    const overrides = readOverrides()
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value
}

export function getAccessToken() {
    if (process.env.WEBUI_TOKEN) {
        if (process.env.WEBUI_TOKEN.length < 16) throw new Error('WEBUI_TOKEN 至少需要 16 个字符')
        return process.env.WEBUI_TOKEN
    }
    const file = path.join(path.dirname(settingsPath()), 'webui-token')
    fs.mkdirSync(path.dirname(file), {recursive: true})
    if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString('hex') + '\n', {mode: 0o600, flag: 'wx'})
    const token = fs.readFileSync(file, 'utf8').trim()
    if (token.length < 16) throw new Error('WebUI 访问令牌文件无效')
    return token
}
