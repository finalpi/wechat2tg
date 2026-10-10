import http, {IncomingMessage, ServerResponse} from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import {createHash, timingSafeEqual} from 'node:crypto'
import {fields, groups, validatePatch} from './schema'
import {getAccessToken, readOverrides, settingsPath, writeOverrides} from './store'
import type {MessageCenterAdapter} from './messages'
import {createAIConnector} from './ai-connector'
import {createMcpHandler} from '../mcp/http'
import {McpSettings} from '../mcp/settings'

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
}

const aliases = {PROXY_PROTOCOL: 'PROTOCOL', PROXY_HOST: 'HOST', PROXY_PORT: 'PORT', PROXY_USERNAME: 'USERNAME', PROXY_PASSWORD: 'PASSWORD'}

export function createWebUIServer(options: Options) {
    const token = options.token || getAccessToken()
    const file = options.file || settingsPath()
    const assetDirectory = options.publicDirectory || path.join(__dirname, 'public')
    const startedAt = new Date().toISOString()
    const mcpSettings=new McpSettings(path.join(path.dirname(file),'mcp-settings.json'),options.mcpTokens)
    const mcp=options.messages?createMcpHandler(options.messages,undefined,mcpSettings):undefined
    const ai=createAIConnector(()=>{const saved=readOverrides(file);return {url:saved.AI_API_URL??String(options.environment.AI_API_URL||''),key:saved.AI_API_KEY??String(options.environment.AI_API_KEY||''),model:saved.AI_MODEL??String(options.environment.AI_MODEL||'')}})
    let queue = Promise.resolve()
    const attempts = new Map<string, {count: number, until: number}>()
    const digest = (value: string) => createHash('sha256').update(value).digest()
    const snapshot = async () => {
        const overrides = readOverrides(file)
        const environment = Object.fromEntries(fields.filter(f => f.source === 'environment').map(f => [f.key, overrides[f.key] ?? options.environment[aliases[f.key] || f.key] ?? '']))
        const runtime = options.runtime ? await options.runtime.read() : {}
        const revision = digest(JSON.stringify({environment, runtime})).toString('hex')
        const values = {}
        const secrets = {}
        for (const f of fields) {
            const value = (f.source === 'environment' ? environment : runtime)[f.key]
            if (f.type === 'password') {
                values[f.key] = ''
                secrets[f.key] = Boolean(value)
            } else values[f.key] = f.type === 'boolean' ? value === true || value === 'true' : value ?? ''
        }
        const restartRequired = Object.entries(overrides).some(([key, value]) => String(options.environment[aliases[key] || key] ?? '') !== value)
        return {revision, values, secrets, restartRequired, runtimeAvailable: Boolean(options.runtime), startedAt}
    }
    const respond = (res: ServerResponse, status: number, data: unknown) => {
        res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'})
        res.end(JSON.stringify(data))
    }
    return http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        const route = req.url?.split('?')[0]
        if(route==='/mcp'||route?.startsWith('/mcp/')){
            if(!mcp)return respond(res,503,{error:'messagesUnavailable'})
            return mcp(req,res)
        }
        if (!route?.startsWith('/api/')) {
            const assets = {'/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/mention-compose.js':['mention-compose.js','text/javascript'], '/messages.js': ['messages.js', 'text/javascript'], '/chat-content.js': ['chat-content.js','text/javascript'], '/mcp-settings.js':['mcp-settings.js','text/javascript'], '/ai-settings.js':['ai-settings.js','text/javascript'], '/template-preview.js': ['template-preview.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']}
            if (!assets[route] || !['GET', 'HEAD'].includes(req.method)) return respond(res, 404, {error: 'notFound'})
            try {
                const [name, mime] = assets[route]
                const content = fs.readFileSync(path.join(assetDirectory, name))
                res.writeHead(200, {'Content-Type': `${mime}; charset=utf-8`})
                res.end(req.method === 'HEAD' ? undefined : content)
            } catch { respond(res, 500, {error: 'assetsUnavailable'}) }
            return
        }
        // Reject cross-origin requests and require the credential in a header, never in a URL.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return respond(res, 403, {error: 'forbidden'})
        const ip = req.socket.remoteAddress || 'unknown'
        const now = Date.now()
        for (const [address, entry] of attempts) if (entry.until < now) attempts.delete(address)
        if ((attempts.get(ip)?.count || 0) >= 20) return respond(res, 429, {error: 'rateLimited'})
        const supplied = req.headers.authorization?.replace(/^Bearer /, '') || ''
        if (!timingSafeEqual(digest(supplied), digest(token))) {
            const entry = attempts.get(ip) || {count: 0, until: now + 60000}
            entry.count++
            attempts.set(ip, entry)
            return respond(res, 401, {error: 'unauthorized'})
        }
        attempts.delete(ip)
        try {
            if(route==='/api/mcp/settings'||route==='/api/mcp/token'){
                if(route==='/api/mcp/settings'&&req.method==='GET')return respond(res,200,{...mcpSettings.metadata(),available:Boolean(options.messages)})
                if(req.method!==(route==='/api/mcp/settings'?'PATCH':'POST'))return respond(res,405,{error:'invalidRequest'})
                if(!req.headers['content-type']?.startsWith('application/json'))return respond(res,415,{error:'jsonRequired'})
                let size=0,raw='';for await(const chunk of req){size+=chunk.length;if(size>8192)return respond(res,413,{error:'tooLarge'});raw+=chunk.toString()}
                let body;try{body=JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                return respond(res,200,route==='/api/mcp/settings'?await mcpSettings.update(body):await mcpSettings.token(body))
            }
            if(route==='/api/ai/models'||route==='/api/ai/test'){
                if(req.method!=='POST')return respond(res,405,{error:'invalidRequest'})
                let bytes=0,raw=''
                for await(const chunk of req){bytes+=chunk.length;if(bytes>20000)return respond(res,413,{error:'tooLarge'});raw+=chunk.toString()}
                let body
                try{body=JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                return respond(res,200,await ai(route.endsWith('/models')?'models':'test',body))
            }
            if (req.method === 'GET' && route === '/api/config') return respond(res, 200, {...await snapshot(), fields, groups})
            if(route==='/api/avatar'){
                if(req.method!=='GET'||!options.messages?.avatar)return respond(res,404,{error:'avatarUnavailable'})
                const wxId=new URL(req.url,'http://localhost').searchParams.get('wxId')||''
                if(!wxId||wxId.length>256)return respond(res,400,{error:'invalidRequest'})
                const image=await options.messages.avatar(wxId)
                res.writeHead(200,{'Content-Type':'image/png','Content-Length':image.length});res.end(image);return
            }
            if(route==='/api/media') {
                if(req.method!=='POST'||!options.messages?.upload)return respond(res,405,{error:'messagesUnavailable'})
                if(!req.headers['content-type']?.startsWith('application/octet-stream'))return respond(res,415,{error:'binaryRequired'})
                const url=new URL(req.url,'http://localhost'),name=url.searchParams.get('name')||'attachment.bin',preference=url.searchParams.get('type')||'auto'
                if(name.length>240)return respond(res,400,{error:'invalidRequest'})
                return respond(res,201,await options.messages.upload(name,preference,req))
            }
            const attachmentRoute=route?.match(/^\/api\/media\/message\/(\d+)$/)
            if(attachmentRoute) {
                if(req.method!=='GET'||!options.messages?.attachment)return respond(res,405,{error:'messagesUnavailable'})
                const {path,...file}=await options.messages.attachment(Number(attachmentRoute[1]))
                return respond(res,200,file)
            }
            const transcriptRoute=route?.match(/^\/api\/media\/transcript\/(\d+)$/)
            if(transcriptRoute){
                if(req.method!=='GET'||!options.messages?.transcriptAttachment)return respond(res,404,{error:'mediaMissing'})
                const query=new URL(req.url,'http://localhost').searchParams,path=query.get('path')||'root',id=query.get('id')||''
                if(!/^(root|[a-zA-Z0-9_.-]{1,80})$/.test(path)||!/^\d{1,10}$/.test(id))return respond(res,400,{error:'invalidRequest'})
                const {path:ignored,...file}=await options.messages.transcriptAttachment(Number(transcriptRoute[1]),path,id)
                return respond(res,200,file)
            }
            const binaryRoute=route?.match(/^\/api\/media\/([a-f0-9-]{36})$/)
            if(binaryRoute) {
                if(req.method!=='GET'||!options.messages?.media)return respond(res,405,{error:'messagesUnavailable'})
                const file=await options.messages.media(binaryRoute[1])
                const safeMime=['image/png','image/jpeg','image/webp','image/gif','video/mp4','audio/mpeg','audio/wav','audio/ogg','audio/mp4','audio/webm'].includes(file.mime)?file.mime:'application/octet-stream'
                res.setHeader('Content-Type',safeMime)
                res.setHeader('Content-Disposition',`${safeMime==='application/octet-stream'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
                res.setHeader('Accept-Ranges','bytes')
                let start=0,end=file.size-1,status=200
                if(req.headers.range) {
                    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
                    if(!match||(!match[1]&&!match[2])){res.writeHead(416);res.end();return}
                    if(!match[1])start=Math.max(0,file.size-Number(match[2]))
                    else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]))}
                    if(!Number.isSafeInteger(start)||start>end||start>=file.size){res.setHeader('Content-Range',`bytes */${file.size}`);res.writeHead(416);res.end();return}
                    status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${file.size}`)
                }
                res.writeHead(status,{'Content-Length':end-start+1})
                const stream=fs.createReadStream(file.path,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return
            }
            const syncRoute=route?.match(/^\/api\/messages\/(\d+)\/sync$/)
            const revokeRoute=route?.match(/^\/api\/messages\/(\d+)\/revoke$/)
            if(revokeRoute){
                if(req.method!=='POST'||!options.messages)return respond(res,405,{error:'messagesUnavailable'})
                let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>2048)return respond(res,413,{error:'tooLarge'});raw+=chunk.toString()}
                let body;try{body=JSON.parse(raw)}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body||typeof body!=='object'||body.confirm!==true||typeof body.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)||(body.confirmUncertain!==undefined&&typeof body.confirmUncertain!=='boolean'))return respond(res,400,{error:'invalidRequest'})
                return respond(res,200,await options.messages.revoke(Number(revokeRoute[1]),body.requestId,body.confirmUncertain===true))
            }
            if(syncRoute) {
                if(req.method!=='POST'||!options.messages?.sync)return respond(res,405,{error:'messagesUnavailable'})
                let bytes=0,raw=''
                for await(const chunk of req){bytes+=chunk.length;if(bytes>512)return respond(res,413,{error:'tooLarge'});raw+=chunk.toString()}
                let body
                try{body=JSON.parse(raw||'{}')}catch{return respond(res,400,{error:'invalidJson'})}
                if(!body||typeof body!=='object'||(body.confirm!==undefined&&typeof body.confirm!=='boolean'))return respond(res,400,{error:'invalidRequest'})
                return respond(res,202,await options.messages.sync(Number(syncRoute[1]),body.confirm===true))
            }
            if (route === '/api/messages/status') {
                return respond(res, 200, options.messages ? await options.messages.status() : {available: false, wechatOnline: false, directoryAvailable: false})
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
                        if (!['all', 'contact', 'group'].includes(kind)) return respond(res, 400, {error: 'invalidRequest'})
                        return respond(res, 200, await options.messages.contacts(query, kind, number('offset')))
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
                if (!body || typeof body.wxId !== 'string' || !body.wxId || body.wxId.length > 256 || typeof body.body !== 'string' || (!body.body.trim()&&!body.attachmentId) || body.body.length > 4000 || (body.attachmentId!==undefined&&!/^[a-f0-9-]{36}$/.test(body.attachmentId)) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId)) return respond(res, 400, {error: 'invalidRequest'})
                return respond(res, 202, await options.messages.send(body.wxId, body.body, body.requestId,body.attachmentId,body.mentions,body.replyToId))
            }
            if(route==='/api/groups/members'){
                if(req.method!=='GET'||!options.messages)return respond(res,405,{error:'messagesUnavailable'})
                const url=new URL(req.url,'http://localhost'),wxId=url.searchParams.get('wxId')||'',q=url.searchParams.get('q')||'',offset=url.searchParams.get('offset')||'0',refresh=url.searchParams.get('refresh')||'false'
                if(!wxId.endsWith('@chatroom')||wxId.length>256||q.length>100||!/^\d{1,5}$/.test(offset)||Number(offset)>10000||!['true','false'].includes(refresh))return respond(res,400,{error:'invalidRequest'})
                return respond(res,200,await options.messages.groupMembers(wxId,q,Number(offset),refresh==='true'))
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
            // Never reflect exceptions which may contain credentials or request bodies.
            if (!res.headersSent) respond(res, 500, {error: 'serverError'})
        }
    })
}

export function startWebUI(environment: Record<string, unknown>, runtime?: RuntimeAdapter, messages?: MessageCenterAdapter) {
    if (process.env.WEBUI_ENABLED === 'false') return
    const port = Number(process.env.WEBUI_PORT || 17863)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WEBUI_PORT 必须为 1–65535')
    const host = process.env.WEBUI_HOST || '127.0.0.1'
    const server = createWebUIServer({environment, runtime, messages})
    server.on('error', error => console.error(`WebUI 启动失败：${error.message}`))
    server.listen(port, host, () => {
        console.log(`WebUI: http://${host}:${port} · 访问令牌：WEBUI_TOKEN 或 ${path.join(path.dirname(settingsPath()), 'webui-token')}`)
    })
    return server
}
