import fs from 'node:fs'
import {createHash,timingSafeEqual,webcrypto} from 'node:crypto'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type {IncomingMessage,ServerResponse} from 'node:http'
import type {MessageCenterAdapter} from '../webui/messages'
import {createWechatMcp} from './tools'
import {McpSettings} from './settings'

// Node 18 exposes Web Crypto through node:crypto but not always globally.
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})

export function createMcpHandler(messages:MessageCenterAdapter,tokens?:{write:string,read:string},settings?:McpSettings){
    if(!messages)return undefined
    if(!tokens&&!settings)settings=new McpSettings()
    tokens=settings?settings.read():tokens
    if(tokens.write===tokens.read)throw new Error('MCP tokens must differ')
    const hash=(s:string)=>createHash('sha256').update(s).digest()
    const equal=(a:string,b:string)=>timingSafeEqual(hash(a),hash(b))
    const failures=new Map<string,{count:number,until:number}>()
    return async(req:IncomingMessage,res:ServerResponse)=>{
        const reply=(status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}))}
        let current
        try{current=settings?settings.read():{...tokens,enabled:process.env.MCP_ENABLED!=='false'}}catch{return reply(503,'mcpUnavailable')}
        if(!current.enabled)return reply(503,'mcpDisabled')
        if(req.headers.origin&&![`http://${req.headers.host}`,`https://${req.headers.host}`].includes(req.headers.origin))return reply(403,'forbidden')
        const ip=req.socket.remoteAddress||'unknown',now=Date.now()
        for(const [id,item] of failures)if(item.until<now)failures.delete(id)
        if((failures.get(ip)?.count||0)>=20)return reply(429,'rateLimited')
        const supplied=req.headers.authorization?.replace(/^Bearer /,'')||''
        const readonly=equal(supplied,current.read)
        if(!readonly&&!equal(supplied,current.write)){
            const entry=failures.get(ip)||{count:0,until:now+60000};entry.count++;failures.set(ip,entry)
            return reply(401,'unauthorized')
        }
        failures.delete(ip)
        const url=new URL(req.url,'http://localhost')
        try{
            if(url.pathname==='/mcp/media'&&req.method==='POST'){
                if(readonly)return reply(403,'readOnlyToken')
                if(req.headers['content-type']!=='application/octet-stream')return reply(415,'binaryRequired')
                const name=url.searchParams.get('name')||'attachment.bin'
                if(name.length>240)return reply(400,'invalidRequest')
                const {path:privatePath,...file}=await messages.upload(name,url.searchParams.get('type')||'auto',req) as any
                res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify(file));return
            }
            const binary=url.pathname.match(/^\/mcp\/media\/([a-f0-9-]{36})$/)
            if(binary&&req.method==='GET'){
                const file=await messages.media(binary[1])
                res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':file.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`})
                const stream=fs.createReadStream(file.path);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return
            }
            if(url.pathname!=='/mcp')return reply(404,'notFound')
            if(req.method!=='POST')return reply(405,'methodNotAllowed')
            let size=0,raw=''
            for await(const chunk of req){size+=chunk.length;if(size>65536)return reply(413,'tooLarge');raw+=chunk.toString()}
            let body;try{body=JSON.parse(raw)}catch{return reply(400,'invalidJson')}
            const server=createWechatMcp(messages,readonly)
            const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
            res.on('close',()=>{void server.close().catch(()=>{})})
            await server.connect(transport)
            await transport.handleRequest(req,res,body)
        }catch(e){if(!res.headersSent)reply(e?.status||500,typeof e?.code==='string'?e.code:'operationFailed');else res.destroy()}
    }
}
