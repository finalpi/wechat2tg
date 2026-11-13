import http, {IncomingMessage, ServerResponse} from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {createHash, timingSafeEqual} from 'node:crypto'
import {fields, groups, validatePatch} from './schema'
import {getAccessToken, readOverrides, settingsPath, writeOverrides} from './store'
import type {MessageCenterAdapter} from './messages'
import {CONTACT_KINDS} from './contact-directory'
import {createAIConnector} from './ai-connector'
import {createMcpHandler} from '../mcp/http'
import {McpSettings} from '../mcp/settings'
import {MESSAGE_TEMPLATE_DEFAULTS, resolveMessageTemplates} from '../util/MessageTemplates'
import {createMiniAppAuth, normalizeMiniAppUrl} from './mini-app-auth'
import {createMessageStreamHandler} from './message-stream'
import {safeErrorDetails} from '../util/SafeError'
import {AutomationEngine} from '../automation/engine'
import {AutomationError} from '../automation/contracts'

export interface RuntimeAdapter {
    read(): Promise<Record<string, unknown>>
    save(patch: Record<string, unknown>): Promise<void>
}
interface Options {
    environment: Record<string, unknown>
    runtime?: RuntimeAdapter
    token?: string
    file?: string
    publicDirectory?: string
    messages?: MessageCenterAdapter
    mcpTokens?: {write:string,read:string}
    automation?: AutomationEngine
    /** Only the isolated dev entry point enables this; never inferred from an outage. */
    demo?: boolean
}

const aliases = {PROXY_PROTOCOL: 'PROTOCOL', PROXY_HOST: 'HOST', PROXY_PORT: 'PORT', PROXY_USERNAME: 'USERNAME', PROXY_PASSWORD: 'PASSWORD'}

export function createWebUIServer(options: Options) {
    const token = options.token || getAccessToken()
    const file = options.file || settingsPath()
    const assetDirectory = options.publicDirectory || path.join(__dirname, 'public')
    const startedAt = new Date().toISOString()
    const miniAppUrl = options.demo ? '' : normalizeMiniAppUrl(options.environment.WEBUI_MINI_APP_URL || process.env.WEBUI_MINI_APP_URL)
    const miniAppAuth = createMiniAppAuth({
        botToken: String(options.environment.BOT_TOKEN || ''),
        ownerId: async () => (await options.runtime?.read())?.chatId,
    })
    const stream = createMessageStreamHandler()
    const mcpSettings = new McpSettings(path.join(path.dirname(file),'mcp-settings.json'),options.mcpTokens)
    const mcp = options.messages && !options.demo ? createMcpHandler(options.messages,undefined,mcpSettings) : undefined
    const ai = createAIConnector(()=>{const saved = readOverrides(file);return {url:saved.AI_API_URL ?? String(options.environment.AI_API_URL || ''),key:saved.AI_API_KEY ?? String(options.environment.AI_API_KEY || ''),model:saved.AI_MODEL ?? String(options.environment.AI_MODEL || '')}})
    let automation = options.automation
    const automationService = () => automation || (automation = new AutomationEngine(path.join(path.dirname(file),'automations.json')))
    let queue = Promise.resolve()
    const attempts = new Map<string, {count: number, until: number}>()
    const digest = (value: string) => createHash('sha256').update(value).digest()
    const snapshot = async () => {
        const overrides = readOverrides(file)
        const environment = Object.fromEntries(fields.filter(f => f.source === 'environment').map(f => [f.key, overrides[f.key] ?? options.environment[aliases[f.key] || f.key] ?? f.defaultValue ?? '']))
        // Blank or missing message templates always behave like their defaults.
        Object.assign(environment, resolveMessageTemplates(environment))
        const runtime = options.runtime ? await options.runtime.read() : {}
        // Only editable preferences belong to the WebUI revision. Login/account
        // metadata (chatId, botId, etc.) can change without changing this form.
        const preferences = Object.fromEntries(fields.filter(f => f.source === 'runtime').map(f =>
            [f.key, f.type === 'boolean' ? runtime[f.key] === true || runtime[f.key] === 'true' : runtime[f.key] ?? '']))
        const revision = digest(JSON.stringify({environment, runtime: preferences})).toString('hex')
        const values = {}
        const secrets = {}
        for (const f of fields) {
            const value = (f.source === 'environment' ? environment : runtime)[f.key]
            if (f.type === 'password') {
                values[f.key] = ''
                secrets[f.key] = Boolean(value)
            } else values[f.key] = f.type === 'boolean' ? value === true || value === 'true' : value ?? ''
        }
        const startupTemplates = resolveMessageTemplates(options.environment)
        const savedTemplates = resolveMessageTemplates(environment)
        // A saved value equal to its effective default does not need a restart.
        const restartRequired = Object.entries(overrides).some(([key, value]) =>
            Object.prototype.hasOwnProperty.call(MESSAGE_TEMPLATE_DEFAULTS, key)
                ? startupTemplates[key] !== savedTemplates[key]
                : String(options.environment[aliases[key] || key] ?? fields.find(field=>field.key === key)?.defaultValue ?? '') !== value)
        return {revision, values, secrets, restartRequired, runtimeAvailable: Boolean(options.runtime), startedAt, templateDefaults: MESSAGE_TEMPLATE_DEFAULTS, ...(options.demo ? {demo: true} : {})}
    }
    const respond = (res: ServerResponse, status: number, data: unknown) => {
        res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'})
        res.end(JSON.stringify(data))
    }
    return http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${miniAppUrl ? ' https://telegram.org' : ''}; worker-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors ${miniAppUrl ? 'https://web.telegram.org https://*.web.telegram.org' : '\'none\''}; base-uri 'none'; form-action 'self'`)
        const route = req.url?.split('?')[0]
        if(route === '/mcp' || route?.startsWith('/mcp/')){
            if(!mcp)return respond(res,503,{error:'messagesUnavailable'})
            return mcp(req,res)
        }
        if (!route?.startsWith('/api/')) {
            const emoji = route?.match(/^\/assets\/wechat-emoji\/(emoji-[a-f0-9]{16}\.(png|webp))$/)
            if(emoji){
                if(!['GET','HEAD'].includes(req.method))return respond(res,404,{error:'notFound'})
                try{
                    const content = fs.readFileSync(path.join(assetDirectory,'emoji',emoji[1]))
                    res.writeHead(200,{'Content-Type':emoji[2] === 'webp' ? 'image/webp' : 'image/png','Content-Length':content.length,'Cache-Control':'public, max-age=31536000, immutable'})
                    res.end(req.method === 'HEAD' ? undefined : content)
                }catch(error){respond(res,error?.code === 'ENOENT' ? 404 : 500,{error:error?.code === 'ENOENT' ? 'notFound' : 'assetsUnavailable'})}
                return
            }
            if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 404, {error: 'notFound'})
            // Static files: the React SPA bundle plus the emoji image directory.
            const relative = ['/', '/chat', '/manage'].includes(route) ? 'index.html' : route.replace(/^\/+/, '')
            if (relative.includes('..') || relative.includes('\0')) return respond(res, 404, {error: 'notFound'})
            const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.json':'application/json', '.webmanifest':'application/manifest+json; charset=utf-8'}[path.extname(relative)] || 'application/octet-stream'
            try {
                const content = fs.readFileSync(path.join(assetDirectory, relative))
                if (relative === 'sw.js') res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
                res.writeHead(200, {'Content-Type': mime, 'Content-Length': content.length})
                res.end(req.method === 'HEAD' ? undefined : content)
            } catch { respond(res, 404, {error: 'notFound'}) }
            return
        }
        // Reject cross-origin requests and require the credential in a header, never in a URL.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return respond(res, 403, {error: 'forbidden'})
        const ip = req.socket.remoteAddress || 'unknown'
        const now = Date.now()
        for (const [address, entry] of attempts) if (entry.until < now) attempts.delete(address)
        if ((attempts.get(ip)?.count || 0) >= 20) return respond(res, 429, {error: 'rateLimited'})
        if (route === '/api/auth/telegram') {
            if (req.method !== 'POST') return respond(res, 405, {error: 'invalidRequest'})
            if (!miniAppUrl) return respond(res, 503, {error: 'miniAppUnavailable'})
            if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, {error: 'jsonRequired'})
            try {
                let raw = '', bytes = 0
                for await (const chunk of req) {
                    bytes += chunk.length
                    if (bytes > 20000) return respond(res, 413, {error: 'tooLarge'})
                    raw += chunk.toString()
                }
                const body = JSON.parse(raw)
                const session = await miniAppAuth.exchange(body?.initData)
                attempts.delete(ip)
                return respond(res, 200, session)
            } catch (error) {
                const entry = attempts.get(ip) || {count: 0, until: now + 60000}
                entry.count++; attempts.set(ip, entry)
                const status = [401, 403, 503].includes(error?.status) ? error.status : 401
                return respond(res, status, {error: status === 503 ? 'miniAppUnavailable' : status === 403 ? 'miniAppForbidden' : 'miniAppUnauthorized'})
            }
        }
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || ''
        const authorized = async () => timingSafeEqual(digest(supplied), digest(token))
            || Boolean(miniAppUrl && await miniAppAuth.authorize(supplied))
        if (!await authorized()) {
            const entry = attempts.get(ip) || {count: 0, until: now + 60000}
            entry.count++
            attempts.set(ip, entry)
            return respond(res, 401, {error: 'unauthorized'})
        }
        attempts.delete(ip)
        // A dev preview may simulate chat mutations, never configuration writes,
        // automation, AI requests, MCP access or calls to real external services.
        if (options.demo && (route.startsWith('/api/telegram/') || route.startsWith('/api/ai/') || route.startsWith('/api/automation')
            || route.startsWith('/api/mcp/') || route === '/api/config' && req.method !== 'GET')) {
            return respond(res, 403, {error: 'demoReadOnly'})
        }
        try {
            if(route === '/api/telegram/emoji-capability') {
                if(req.method === 'GET') {
                    if(!options.messages?.telegramDisplayStatus)return respond(res,503,{error:'telegramOffline'})
                    return respond(res,200,await options.messages.telegramDisplayStatus())
                }
                if(req.method !== 'POST')return respond(res,405,{error:'methodNotAllowed'})
                let size = 0,raw = ''
                for await(const chunk of req){size += chunk.length;if(size > 256)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body
                try{body = JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body || body.confirm !== true || Object.keys(body).some(key=>key !== 'confirm'))return respond(res,400,{error:'invalidRequest'})
                if(!options.messages?.probeTelegramCustomEmoji)return respond(res,503,{error:'telegramOffline'})
                return respond(res,200,await options.messages.probeTelegramCustomEmoji())
            }
            if (route === '/api/automation' || route === '/api/automation/test' || route === '/api/automation/generate') {
                if (route === '/api/automation' && req.method === 'GET') return respond(res,200,await automationService().snapshot())
                if (req.method !== 'POST') return respond(res,405,{error:'invalidRequest'})
                if (!req.headers['content-type']?.startsWith('application/json')) return respond(res,415,{error:'jsonRequired'})
                let raw = '',size = 0
                for await (const chunk of req) {size += chunk.length;if (size > 96000) return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body
                try {body = JSON.parse(raw)} catch {return respond(res,400,{error:'invalidJson'})}
                if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res,400,{error:'invalidRequest'})
                if (route === '/api/automation/generate') {
                    if (typeof body.requirement !== 'string' || !body.requirement.trim() || body.requirement.length > 4000) return respond(res,400,{error:'invalidRequest'})
                    return respond(res,200,await ai('script',{requirement:body.requirement}))
                }
                try {return respond(res,200,route.endsWith('/test') ? await automationService().test(body) : await automationService().command(body))}
                catch (error) {
                    if(error instanceof AutomationError && error.issues)return respond(res,error.status,{error:error.code,issues:error.issues})
                    if(error?.name === 'ZodError')return respond(res,400,{error:'automationValidation'})
                    throw error
                }
            }
            if (route === '/api/auth/logout') {
                if (req.method !== 'POST') return respond(res, 405, {error: 'invalidRequest'})
                miniAppAuth.revoke(supplied)
                return respond(res, 200, {ok: true})
            }
            if (route === '/api/messages/events') {
                if (req.method !== 'GET') return respond(res, 405, {error: 'invalidRequest'})
                return stream(req, res, options.messages?.subscribe?.bind(options.messages), authorized)
            }
            if (route === '/api/messages/updates') {
                if (req.method !== 'GET') return respond(res, 405, {error: 'invalidRequest'})
                if (!options.messages?.updates) return respond(res, 503, {error: 'messagesUnavailable'})
                const params = new URL(req.url, 'http://localhost').searchParams
                const wxId = params.get('wxId') || '', query = params.get('q') || '', rawIds = (params.get('ids') || '').split(',')
                if (!wxId || wxId.length > 256 || query.length > 100 || rawIds.length > 100 || rawIds.some(id => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) return respond(res, 400, {error: 'invalidRequest'})
                return respond(res, 200, await options.messages.updates(wxId, [...new Set(rawIds.map(Number))], query))
            }
            if(route === '/api/mcp/settings' || route === '/api/mcp/token'){
                if(route === '/api/mcp/settings' && req.method === 'GET')return respond(res,200,{...mcpSettings.metadata(),available:Boolean(options.messages)})
                if(req.method !== (route === '/api/mcp/settings' ? 'PATCH' : 'POST'))return respond(res,405,{error:'invalidRequest'})
                if(!req.headers['content-type']?.startsWith('application/json'))return respond(res,415,{error:'jsonRequired'})
                let size = 0,raw = '';for await(const chunk of req){size += chunk.length;if(size > 8192)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body;try{body = JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                return respond(res,200,route === '/api/mcp/settings' ? await mcpSettings.update(body) : await mcpSettings.token(body))
            }
            if(route === '/api/ai/models' || route === '/api/ai/test'){
                if(req.method !== 'POST')return respond(res,405,{error:'invalidRequest'})
                let bytes = 0,raw = ''
                for await(const chunk of req){bytes += chunk.length;if(bytes > 20000)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body
                try{body = JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                return respond(res,200,await ai(route.endsWith('/models') ? 'models' : 'test',body))
            }
            if (req.method === 'GET' && route === '/api/config') return respond(res, 200, {...await snapshot(), fields, groups})
            if(route === '/api/avatar'){
                if(req.method !== 'GET' || !options.messages?.avatar)return respond(res,404,{error:'avatarUnavailable'})
                const params = new URL(req.url,'http://localhost').searchParams
                const wxId = params.get('wxId') || '',roomId = params.get('roomId') || undefined
                if(!wxId || wxId.length > 256 || (roomId && (!roomId.endsWith('@chatroom') || roomId.length > 256)))return respond(res,400,{error:'invalidRequest'})
                const image = await options.messages.avatar(wxId,roomId)
                res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length});res.end(image);return
            }
            const redPacketCoverRoute = route?.match(/^\/api\/media\/red-packet\/([1-9]\d*)$/)
            if(redPacketCoverRoute){
                const id = Number(redPacketCoverRoute[1])
                if(req.method !== 'GET' || !options.messages?.redPacketCover)return respond(res,404,{error:'coverUnavailable'})
                if(!Number.isSafeInteger(id))return respond(res,400,{error:'invalidRequest'})
                const image = await options.messages.redPacketCover(id)
                res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.length,'Cache-Control':'no-store'});res.end(image);return
            }
            const redPacketRoute = route?.match(/^\/api\/messages\/([1-9]\d*)\/red-packet$/)
            if(redPacketRoute){
                const id = Number(redPacketRoute[1])
                if(!Number.isSafeInteger(id))return respond(res,400,{error:'invalidRequest'})
                if(options.demo)return respond(res,403,{error:'demoReadOnly'})
                if(req.method === 'GET'){
                    if(!options.messages?.redPacketStatus)return respond(res,503,{error:'redPacketUnavailable'})
                    return respond(res,200,await options.messages.redPacketStatus(id))
                }
                if(req.method !== 'POST')return respond(res,405,{error:'methodNotAllowed'})
                if(!req.headers['content-type']?.startsWith('application/json'))return respond(res,415,{error:'jsonRequired'})
                let size = 0,raw = ''
                for await(const chunk of req){size += chunk.length;if(size > 256)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body
                try{body = JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body || body.confirm !== true || typeof body.confirmation !== 'string' || !/^[a-f0-9]{32}$/.test(body.confirmation)
                    || Object.keys(body).some(key=>!['confirm','confirmation'].includes(key)))return respond(res,400,{error:'invalidRequest'})
                if(!options.messages?.openRedPacket)return respond(res,503,{error:'redPacketUnavailable'})
                return respond(res,200,await options.messages.openRedPacket(id,body.confirmation))
            }
            const articleCoverRoute = route?.match(/^\/api\/media\/article\/([1-9]\d*)\/(\d+)$/)
            if(articleCoverRoute){
                if(req.method !== 'GET' || !options.messages?.articleCover)return respond(res,404,{error:'coverUnavailable'})
                const id = Number(articleCoverRoute[1]),index = Number(articleCoverRoute[2])
                if(!Number.isSafeInteger(id) || !Number.isSafeInteger(index) || index < 0 || index >= 20)return respond(res,400,{error:'invalidRequest'})
                const image = await options.messages.articleCover(id,index)
                res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.length});res.end(image);return
            }
            if(route === '/api/media') {
                if(req.method !== 'POST' || !options.messages?.upload)return respond(res,405,{error:'messagesUnavailable'})
                if(!req.headers['content-type']?.startsWith('application/octet-stream'))return respond(res,415,{error:'binaryRequired'})
                const url = new URL(req.url,'http://localhost'),name = url.searchParams.get('name') || 'attachment.bin',preference = url.searchParams.get('type') || 'auto'
                if(name.length > 240)return respond(res,400,{error:'invalidRequest'})
                return respond(res,201,await options.messages.upload(name,preference,req))
            }
            const attachmentRoute = route?.match(/^\/api\/media\/message\/(\d+)$/)
            if(attachmentRoute) {
                if(req.method !== 'GET' || !options.messages?.attachment)return respond(res,405,{error:'messagesUnavailable'})
                const {path,...file} = await options.messages.attachment(Number(attachmentRoute[1]))
                void path // Filesystem paths are private; return metadata only.
                return respond(res,200,file)
            }
            const transcriptRoute = route?.match(/^\/api\/media\/transcript\/(\d+)$/)
            if(transcriptRoute){
                if(req.method !== 'GET' || !options.messages?.transcriptAttachment)return respond(res,404,{error:'mediaMissing'})
                const query = new URL(req.url,'http://localhost').searchParams,path = query.get('path') || 'root',id = query.get('id') || ''
                if(!/^(root|[a-zA-Z0-9_.-]{1,80})$/.test(path) || !/^\d{1,10}$/.test(id))return respond(res,400,{error:'invalidRequest'})
                const {path:ignored,...file} = await options.messages.transcriptAttachment(Number(transcriptRoute[1]),path,id)
                void ignored // Filesystem paths are private; return metadata only.
                return respond(res,200,file)
            }
            const thumbnailRoute = route?.match(/^\/api\/media\/([a-f0-9-]{36})\/thumbnail$/)
            if(thumbnailRoute) {
                if(req.method !== 'GET' || !options.messages?.mediaThumbnail)return respond(res,404,{error:'thumbnailUnavailable'})
                const file = await options.messages.mediaThumbnail(thumbnailRoute[1])
                const stat = await fs.promises.stat(file)
                res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':stat.size})
                const stream = fs.createReadStream(file)
                stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return
            }
            const binaryRoute = route?.match(/^\/api\/media\/([a-f0-9-]{36})$/)
            if(binaryRoute) {
                if(req.method !== 'GET' || !options.messages?.media)return respond(res,405,{error:'messagesUnavailable'})
                const file = await options.messages.media(binaryRoute[1])
                const safeMime = ['image/png','image/jpeg','image/webp','image/gif','video/mp4','audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/webm'].includes(file.mime) ? file.mime : 'application/octet-stream'
                res.setHeader('Content-Type',safeMime)
                res.setHeader('Content-Disposition',`${safeMime === 'application/octet-stream' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
                res.setHeader('Accept-Ranges','bytes')
                let start = 0,end = file.size - 1,status = 200
                if(req.headers.range) {
                    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
                    if(!match || (!match[1] && !match[2])){res.writeHead(416);res.end();return}
                    if(!match[1])start = Math.max(0,file.size - Number(match[2]))
                    else {start = Number(match[1]);if(match[2])end = Math.min(end,Number(match[2]))}
                    if(!Number.isSafeInteger(start) || start > end || start >= file.size){res.setHeader('Content-Range',`bytes */${file.size}`);res.writeHead(416);res.end();return}
                    status = 206;res.setHeader('Content-Range',`bytes ${start}-${end}/${file.size}`)
                }
                res.writeHead(status,{'Content-Length':end - start + 1})
                const stream = fs.createReadStream(file.path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return
            }
            const syncRoute = route?.match(/^\/api\/messages\/(\d+)\/sync$/)
            const revokeRoute = route?.match(/^\/api\/messages\/(\d+)\/revoke$/)
            if(revokeRoute){
                if(req.method !== 'POST' || !options.messages)return respond(res,405,{error:'messagesUnavailable'})
                let raw = '',size = 0;for await(const chunk of req){size += chunk.length;if(size > 2048)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body;try{body = JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body || typeof body !== 'object' || body.confirm !== true || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId) || (body.confirmUncertain !== undefined && typeof body.confirmUncertain !== 'boolean'))return respond(res,400,{error:'invalidRequest'})
                return respond(res,200,await options.messages.revoke(Number(revokeRoute[1]),body.requestId,body.confirmUncertain === true))
            }
            if(syncRoute) {
                if(req.method !== 'POST' || !options.messages?.sync)return respond(res,405,{error:'messagesUnavailable'})
                let bytes = 0,raw = ''
                for await(const chunk of req){bytes += chunk.length;if(bytes > 512)return respond(res,413,{error:'tooLarge'});raw += chunk.toString()}
                let body
                try{body = JSON.parse(raw || '{}')}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body || typeof body !== 'object' || (body.confirm !== undefined && typeof body.confirm !== 'boolean'))return respond(res,400,{error:'invalidRequest'})
                return respond(res,202,await options.messages.sync(Number(syncRoute[1]),body.confirm === true))
            }
            if (route === '/api/messages/status') {
                return respond(res, 200, options.messages ? await options.messages.status() : {available: false, wechatOnline: false, directoryAvailable: false})
            }
            if(route === '/api/messages/locate'){
                if(req.method !== 'GET')return respond(res,405,{error:'invalidRequest'})
                if(!options.messages?.locate)return respond(res,503,{error:'messagesUnavailable'})
                const url = new URL(req.url,'http://localhost'),wxId = url.searchParams.get('wxId') || '',id = url.searchParams.get('id'),remoteId = url.searchParams.get('remoteId')
                if(!wxId || wxId.length > 256 || (!id && !remoteId) || (id !== null && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) || (remoteId !== null && (!/^[1-9]\d{0,19}$/.test(remoteId) || BigInt(remoteId) > 18446744073709551615n)))return respond(res,400,{error:'invalidRequest'})
                return respond(res,200,await options.messages.locate(wxId,id === null ? undefined : Number(id),remoteId === null ? undefined : remoteId))
            }
            if (route === '/api/contacts/menu') {
                if (req.method !== 'GET') return respond(res, 405, {error: 'invalidRequest'})
                const params = new URL(req.url, 'http://localhost').searchParams
                const wxId = params.get('wxId') || ''
                if (params.getAll('wxId').length !== 1 || !wxId.trim() || wxId.length > 256) return respond(res, 400, {error: 'invalidRequest'})
                if (!options.messages?.officialMenu) return respond(res, 503, {error: 'messagesUnavailable'})
                return respond(res, 200, await options.messages.officialMenu(wxId))
            }
            if (route === '/api/contacts' || route === '/api/messages') {
                if (!options.messages) return respond(res, 503, {error: 'messagesUnavailable'})
                const url = new URL(req.url, 'http://localhost')
                const query = url.searchParams.get('q') || ''
                const wxId = url.searchParams.get('wxId') || ''
                const number = (key: string) => {
                    const value = url.searchParams.get(key) || '0'
                    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Object.assign(new Error(), {code: 'invalidRequest', status: 400})
                    if (key === 'offset' && Number(value) > 10000) throw Object.assign(new Error(), {code: 'invalidRequest', status: 400})
                    return Number(value)
                }
                if (query.length > 100 || wxId.length > 256) return respond(res, 400, {error: 'invalidRequest'})
                if (req.method === 'GET') {
                    if (route === '/api/contacts') {
                        const kind = url.searchParams.get('kind') || 'all'
                        const order = url.searchParams.get('order')
                        if (!CONTACT_KINDS.some(value => value === kind) || (order !== null && order !== 'letter')) return respond(res, 400, {error: 'invalidRequest'})
                        return respond(res, 200, await options.messages.contacts(query, kind, number('offset'), order === 'letter' ? 'letter' : undefined))
                    }
                    if (!wxId) return respond(res, 400, {error: 'invalidRequest'})
                    return respond(res, 200, await options.messages.history(wxId, number('before'), query))
                }
                if (req.method !== 'POST' || route !== '/api/messages') return respond(res, 405, {error: 'invalidRequest'})
                if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, {error: 'jsonRequired'})
                const chunks = []
                let size = 0
                for await (const chunk of req) {
                    size += chunk.length
                    if (size > 20000) return respond(res, 413, {error: 'tooLarge'})
                    chunks.push(Buffer.from(chunk))
                }
                let body
                try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'))} catch {return respond(res, 400, {error: 'invalidJson'})}
                if (!body || typeof body.wxId !== 'string' || !body.wxId || body.wxId.length > 256 || typeof body.body !== 'string' || (!body.body.trim() && !body.attachmentId) || body.body.length > 4000 || (body.attachmentId !== undefined && !/^[a-f0-9-]{36}$/.test(body.attachmentId)) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)) return respond(res, 400, {error: 'invalidRequest'})
                return respond(res, 202, await options.messages.send(body.wxId, body.body, body.requestId,body.attachmentId,body.mentions,body.replyToId))
            }
            if(route === '/api/groups/members'){
                if(req.method !== 'GET' || !options.messages)return respond(res,405,{error:'messagesUnavailable'})
                const url = new URL(req.url,'http://localhost'),wxId = url.searchParams.get('wxId') || '',q = url.searchParams.get('q') || '',offset = url.searchParams.get('offset') || '0',refresh = url.searchParams.get('refresh') || 'false'
                if(!wxId.endsWith('@chatroom') || wxId.length > 256 || q.length > 100 || !/^\d{1,5}$/.test(offset) || Number(offset) > 10000 || !['true','false'].includes(refresh))return respond(res,400,{error:'invalidRequest'})
                return respond(res,200,await options.messages.groupMembers(wxId,q,Number(offset),refresh === 'true'))
            }
            if (req.method !== 'PATCH' || route !== '/api/config') return respond(res, 404, {error: 'notFound'})
            if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, {error: 'jsonRequired'})
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of req) {
                size += chunk.length
                if (size > 65536) return respond(res, 413, {error: 'tooLarge'})
                chunks.push(Buffer.from(chunk))
            }
            let body
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return respond(res, 400, {error: 'invalidJson'}) }
            if (!body || typeof body !== 'object' || !['environment', 'runtime'].includes(body.source) || typeof body.revision !== 'string') return respond(res, 400, {error: 'invalidRequest'})
            let patch
            try { patch = validatePatch(body.source, body.values) } catch (error) {
                return respond(res, 400, {error: 'validation', detail: error.message})
            }
            const operation = queue.then(async () => {
                const current = await snapshot()
                if (current.revision !== body.revision) return respond(res, 409, {error: 'conflict'})
                if (body.source === 'runtime') {
                    if (!options.runtime) return respond(res, 503, {error: 'runtimeUnavailable'})
                    await options.runtime.save(patch)
                } else {
                    const overrides = {...readOverrides(file), ...patch}
                    const effective = {...current.values, ...overrides}
                    if (effective.PROXY_PROTOCOL && (!effective.PROXY_HOST || !effective.PROXY_PORT)) return respond(res, 400, {error: 'proxyIncomplete'})
                    if (effective.MODE === 'callback' && Number(effective.CALLBACK_PORT) === Number(process.env.WEBUI_PORT || 17863)) return respond(res, 400, {error: 'portConflict'})
                    writeOverrides(overrides, file)
                }
                return respond(res, 200, await snapshot())
            })
            queue = operation.then(() => undefined, () => undefined)
            await operation
        } catch (error) {
            if (error?.status && typeof error?.code === 'string') return respond(res, error.status, {error: error.code})
            // Log source locations and error categories, never credentials, SQL or request bodies.
            console.error('[WebUI] %s %s failed', req.method, route, safeErrorDetails(error))
            if (!res.headersSent) respond(res, 500, {error: 'serverError'})
        }
    })
}

export function startWebUI(environment: Record<string, unknown>, runtime?: RuntimeAdapter, messages?: MessageCenterAdapter, automation?: AutomationEngine) {
    if (process.env.WEBUI_ENABLED === 'false') return
    const port = Number(process.env.WEBUI_PORT || 17863)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEBUI_PORT 必须为 1–65535')
    const host = process.env.WEBUI_HOST || '127.0.0.1'
    const server = createWebUIServer({environment, runtime, messages, automation})
    server.on('error', error => console.error(`WebUI 启动失败：${error.message}`))
    server.listen(port, host, () => {
        console.log(`WebUI: http://${host}:${port} · 访问令牌：WEBUI_TOKEN 或 ${path.join(path.dirname(settingsPath()), 'webui-token')}`)
    })
    return server
}
