import fs from 'node:fs'
import path from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import {settingsPath} from '../webui/store'

const fail=(code:string,status=400)=>Object.assign(new Error(code),{code,status})
const defaultScript='/absolute/path/to/wechat2tg/scripts/wechat-mcp.cjs'
interface Settings {enabled:boolean;endpoint:string;scriptPath:string;write:string;read:string}
export class McpSettings {
    private queue=Promise.resolve()
    constructor(private file=path.join(path.dirname(settingsPath()),'mcp-settings.json'),private seed?:{write:string,read:string}){}
    private credential(role:'write'|'read'){
        const env=role==='write'?'MCP_TOKEN':'MCP_READ_TOKEN'
        const file=path.join(path.dirname(this.file),role==='write'?'mcp-token':'mcp-read-token')
        if(this.seed)return this.seed[role]
        if(process.env[env])return process.env[env]
        fs.mkdirSync(path.dirname(file),{recursive:true})
        if(!fs.existsSync(file))fs.writeFileSync(file,randomBytes(32).toString('hex')+'\n',{mode:0o600,flag:'wx'})
        return fs.readFileSync(file,'utf8').trim()
    }
    read():Settings {
        const data:Settings=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{enabled:process.env.MCP_ENABLED!=='false',endpoint:'',scriptPath:defaultScript,write:this.credential('write'),read:this.credential('read')}
        this.validate(data)
        return data
    }
    private validate(data:Settings){
        if(typeof data.enabled!=='boolean'||typeof data.endpoint!=='string'||typeof data.scriptPath!=='string'||!data.scriptPath.trim()||data.scriptPath.length>1000||/[\x00-\x1f]/.test(data.scriptPath))throw fail('mcpInvalidSettings')
        if(!path.isAbsolute(data.scriptPath)&&!path.win32.isAbsolute(data.scriptPath))throw fail('mcpInvalidSettings')
        if(data.endpoint){
            let url:URL;try{url=new URL(data.endpoint)}catch{throw fail('mcpInvalidEndpoint')}
            if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/mcp'||data.endpoint.length>2048)throw fail('mcpInvalidEndpoint')
            if(url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw fail('mcpHTTPSRequired')
        }
        for(const key of ['write','read'])if(typeof data[key]!=='string'||data[key].length<16||data[key].length>256||!/^[A-Za-z0-9._~-]+$/.test(data[key]))throw fail('mcpInvalidToken')
        if(data.write===data.read)throw fail('mcpTokensMustDiffer')
    }
    private revision(data:Settings){return createHash('sha256').update(JSON.stringify(data)).digest('hex')}
    metadata(){const data=this.read();return {enabled:data.enabled,endpoint:data.endpoint,scriptPath:data.scriptPath,revision:this.revision(data),writeConfigured:Boolean(data.write),readConfigured:Boolean(data.read)}}
    private write(data:Settings){
        this.validate(data)
        fs.mkdirSync(path.dirname(this.file),{recursive:true})
        const temporary=this.file+'.'+randomBytes(6).toString('hex')+'.tmp'
        try{fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temporary,this.file)}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary)}
        // The settings file is authoritative after the first WebUI save.
        // Keep legacy token files in sync for existing operational tooling.
        for(const role of ['write','read'] as const){
            const file=path.join(path.dirname(this.file),role==='write'?'mcp-token':'mcp-read-token')
            const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp'
            try{fs.writeFileSync(tmp,data[role]+'\n',{mode:0o600,flag:'wx'});fs.renameSync(tmp,file)}catch{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}
        }
    }
    async update(body:any){
        const operation=this.queue.then(()=>{
            const current=this.read()
            if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['revision','enabled','endpoint','scriptPath'].includes(k)))throw fail('mcpInvalidSettings')
            if(body.revision!==this.revision(current))throw fail('mcpConflict',409)
            const next={...current,...body};delete next.revision
            this.write(next)
            return this.metadata()
        })
        this.queue=operation.then(()=>undefined,()=>undefined);return operation
    }
    async token(body:any){
        const operation=this.queue.then(()=>{
            if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['revision','role','action','token'].includes(k))||!['read','write'].includes(body.role)||!['reveal','rotate','replace'].includes(body.action))throw fail('mcpInvalidSettings')
            const data=this.read()
            if(body.revision!==this.revision(data))throw fail('mcpConflict',409)
            if(body.action!=='reveal'){
                data[body.role]=body.action==='rotate'?randomBytes(32).toString('hex'):body.token
                this.write(data)
            }
            return {...this.metadata(),role:body.role,token:data[body.role]}
        })
        this.queue=operation.then(()=>undefined,()=>undefined);return operation
    }
}
