#!/usr/bin/env node
// Local stdio bridge: stdout is exclusively MCP protocol traffic.
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:require('node:crypto').webcrypto,configurable:true})
const {Client}=require('@modelcontextprotocol/sdk/client/index.js')
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const {Server}=require('@modelcontextprotocol/sdk/server/index.js')
const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js')
const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js')
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os')

async function main(){
    if(!process.env.WECHAT_MCP_URL)throw new Error('Set WECHAT_MCP_URL')
    const endpoint=new URL(process.env.WECHAT_MCP_URL)
    if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Invalid MCP URL')
    if(endpoint.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('Use HTTPS or a loopback SSH tunnel')
    const token=process.env.WECHAT_MCP_TOKEN||(process.env.WECHAT_MCP_TOKEN_FILE? (await fs.readFile(process.env.WECHAT_MCP_TOKEN_FILE,'utf8')).trim():'')
    if(token.length<16)throw new Error('Set WECHAT_MCP_TOKEN or WECHAT_MCP_TOKEN_FILE')
    const headers={Authorization:`Bearer ${token}`}
    const client=new Client({name:'wechat2tg-local-bridge',version:'1.0.0'})
    await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{headers}}))
    const server=new Server({name:'wechat2tg',version:'1.0.0'},{capabilities:{tools:{}}})
    server.setRequestHandler(ListToolsRequestSchema,async()=>{
        const result=await client.listTools()
        for(const tool of result.tools){
            if(tool.name==='wechat_send_media'){
                tool.inputSchema.properties.filePath={type:'string',description:'Absolute local file path; mutually exclusive with attachmentId'}
                tool.inputSchema.properties.asVoice={type:'boolean',description:'Convert uploaded audio to WeChat voice'}
                tool.inputSchema.required=tool.inputSchema.required.filter(x=>x!=='attachmentId')
                tool.description+=' Local bridge accepts filePath instead of attachmentId.'
            }
            if(tool.name==='wechat_download_attachment'){
                tool.inputSchema.properties.outputPath={type:'string',description:'Absolute destination file path; existing files are never overwritten'}
                tool.description+=' Saves to local disk and returns localPath; images <= 10 MiB also returned as image content.'
            }
        }
        return result
    })
    server.setRequestHandler(CallToolRequestSchema,async request=>{
        try{
            const args={...request.params.arguments},name=request.params.name
            if(name==='wechat_send_media'){
                if(Boolean(args.filePath)===Boolean(args.attachmentId))throw new Error('Provide exactly one filePath or attachmentId')
                if(args.filePath){
                    if(typeof args.filePath!=='string'||!path.isAbsolute(args.filePath))throw new Error('filePath must be absolute')
                    const handle=await fs.open(args.filePath,'r')
                    try{
                        const stat=await handle.stat()
                        if(!stat.isFile()||!stat.size||stat.size>50*1024*1024)throw new Error('File must be between 1 byte and 50 MiB')
                        const body=await handle.readFile()
                        if(body.length>50*1024*1024)throw new Error('File exceeds 50 MiB')
                        const url=new URL('/mcp/media',endpoint);url.searchParams.set('name',path.basename(args.filePath));url.searchParams.set('type',args.asVoice?'voice':'auto')
                        const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body,redirect:'error',signal:AbortSignal.timeout(120000)})
                        if(!response.ok)throw new Error(`Upload failed (${response.status})`)
                        args.attachmentId=(await response.json()).id
                    }finally{await handle.close()}
                }
                delete args.filePath;delete args.asVoice
            }
            const outputPath=args.outputPath;delete args.outputPath
            const result=await client.callTool({name,arguments:args})
            if(name!=='wechat_download_attachment'||result.isError)return result
            const file=JSON.parse(result.content.find(c=>c.type==='text').text)
            if(!/^\/mcp\/media\/[a-f0-9-]{36}$/.test(file.downloadPath)||file.size>50*1024*1024)throw new Error('Invalid download descriptor')
            let localPath=outputPath
            if(localPath){if(typeof localPath!=='string'||!path.isAbsolute(localPath))throw new Error('outputPath must be absolute')}
            else{
                const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-mcp-'))
                const filename=path.basename(file.name.replace(/\\/g,'/')).replace(/[<>:"|?*\x00-\x1f]/g,'_')||'attachment.bin'
                localPath=path.join(directory,filename)
            }
            const destination=await fs.open(localPath,'wx',0o600)
            let completed=false
            try{
                const response=await fetch(new URL(file.downloadPath,endpoint),{headers,redirect:'error',signal:AbortSignal.timeout(120000)})
                if(!response.ok)throw new Error(`Download failed (${response.status})`)
                let size=0
                for await(const chunk of response.body){size+=chunk.length;if(size>50*1024*1024)throw new Error('Download exceeds 50 MiB');let written=0;while(written<chunk.length)written+=(await destination.write(chunk,written,chunk.length-written)).bytesWritten}
                if(size!==file.size)throw new Error('Incomplete download')
                completed=true
            }finally{await destination.close();if(!completed)await fs.unlink(localPath)}
            const content=[{type:'text',text:JSON.stringify({...file,localPath})}]
            if(/^image\/(png|jpeg|webp|gif)$/.test(file.mime)&&file.size<=10*1024*1024)content.push({type:'image',mimeType:file.mime,data:(await fs.readFile(localPath)).toString('base64')})
            return {content}
        }catch(error){return {isError:true,content:[{type:'text',text:String(error.code||error.message||'operationFailed').slice(0,200)}]}}
    })
    await server.connect(new StdioServerTransport())
    const stop=async()=>{await client.close();await server.close()}
    process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop())
}
main().catch(()=>{process.stderr.write('WeChat MCP bridge failed. Check URL, token file, tunnel and server.\n');process.exit(1)})
