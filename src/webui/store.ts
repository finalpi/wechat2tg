import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {persistedFields, validatePatch} from './schema'
import {MESSAGE_TEMPLATE_DEFAULTS, MessageTemplateKey} from '../util/MessageTemplates'

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
    writeAtomicJson(values, file)
}

function writeAtomicJson(values: unknown, file: string) {
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

interface MessageTemplateMigration {
    version: 1
    completed: boolean
    backup: Record<MessageTemplateKey, string | null>
}

// Accept only this version's complete backup; never recover from an ambiguous marker.
function readMessageTemplateMigration(file: string): MessageTemplateMigration {
    let marker: MessageTemplateMigration
    try {
        marker = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
        throw new Error(`Cannot read message template migration marker: ${file}`)
    }
    const keys = Object.keys(MESSAGE_TEMPLATE_DEFAULTS)
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)
        || Object.keys(marker).sort().join(',') !== 'backup,completed,version'
        || marker.version !== 1 || typeof marker.completed !== 'boolean'
        || !marker.backup || typeof marker.backup !== 'object' || Array.isArray(marker.backup)
        || Object.keys(marker.backup).sort().join(',') !== keys.sort().join(',')
        || keys.some(key => marker.backup[key] !== null && typeof marker.backup[key] !== 'string')) {
        throw new Error(`Invalid message template migration marker: ${file}`)
    }
    return marker
}

export function migrateMessageTemplates(
    overrides: Record<string, string>,
    file = settingsPath(),
    environment: Record<string, string | undefined> = process.env,
): Record<string, string> {
    const markerFile = `${file}.message-templates-v1.json`
    let marker: MessageTemplateMigration
    if (fs.existsSync(markerFile)) {
        marker = readMessageTemplateMigration(markerFile)
        if (marker.completed) return overrides
    } else {
        const backup = {} as MessageTemplateMigration['backup']
        for (const key of Object.keys(MESSAGE_TEMPLATE_DEFAULTS) as MessageTemplateKey[]) {
            backup[key] = overrides[key] ?? environment[key] ?? null
        }
        marker = {version: 1, completed: false, backup}
        // Persist the original effective templates before changing any settings.
        writeAtomicJson(marker, markerFile)
    }
    const migrated = {...overrides, ...MESSAGE_TEMPLATE_DEFAULTS}
    writeOverrides(migrated, file)
    writeAtomicJson({...marker, completed: true}, markerFile)
    return migrated
}

export function loadPersistentEnvironment() {
    const file = settingsPath()
    const overrides = migrateMessageTemplates(readOverrides(file), file)
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