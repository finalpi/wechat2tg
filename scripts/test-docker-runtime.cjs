/* eslint-disable @typescript-eslint/no-var-requires */
// Runs inside the final image, without credentials, host volumes or external services.
const assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path')
const {createRequire} = require('node:module'),{spawnSync} = require('node:child_process')
const {once} = require('node:events'),{gzipSync} = require('node:zlib')
const app = createRequire('/app/package.json')
const run = (command,args)=>{
  const result = spawnSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:1024 * 1024})
  assert.equal(result.status,0,`${command}: ${result.error?.message || result.stderr || result.stdout}`)
  return result.stdout
}
async function main(){
  for(const name of ['typescript','vite','react','react-dom','lucide-react','tailwindcss','playwright-core','eslint']){
    assert(!fs.existsSync(`/app/node_modules/${name}`),`development dependency shipped: ${name}`)
  }
  for(const name of ['src','webui','test','vendor','.env'])assert(!fs.existsSync(`/app/${name}`),`unnecessary/private input shipped: ${name}`)
  assert(!fs.existsSync('/root/.npm/_cacache'),'npm download cache shipped')
  for(const command of ['gcc','g++','make','python3'])assert.notEqual(spawnSync('which',[command]).status,0,`compiler/build tool shipped: ${command}`)
  for(const name of ['wx2tg-puppet','telegraf','typeorm','@modelcontextprotocol/sdk/server/index.js'])app(name)
  assert.equal(app('./package.json').version,fs.readFileSync('/app/VERSION','utf8').trim())
  assert(fs.existsSync('/app/dist/app.js'))
  assert(fs.existsSync('/app/scripts/wechat-mcp.cjs'))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'wx2tg-runtime-'))
  let server
  try {
    const sqlite3 = app('sqlite3')
    const db = await new Promise((resolve,reject)=>{const db = new sqlite3.Database(':memory:',error=>error ? reject(error) : resolve(db))})
    assert.equal(await new Promise((resolve,reject)=>db.get('SELECT 42 AS value',(error,row)=>error ? reject(error) : resolve(row.value))),42)
    await new Promise((resolve,reject)=>db.close(error=>error ? reject(error) : resolve()))
    const sharp = app('sharp')
    const png = await sharp({create:{width:32,height:32,channels:3,background:'#6688aa'}}).png().toBuffer()
    assert.equal((await sharp(png).metadata()).width,32)
    const {sandbox} = app('./dist/automation/sandbox')
    const plan = await sandbox('export default function(e,api){api.log("runtime-ok")}',{}, {},[])
    assert.deepEqual(plan.logs,['runtime-ok'])
    run(app('ffmpeg-static'),['-version'])
    run('ffmpeg',['-version']);run('ffprobe',['-version'])
    const wav = path.join(directory,'tone.wav'),silk = path.join(directory,'tone.silk'),mp3 = path.join(directory,'tone.mp3')
    run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-ar','24000','-ac','1',wav])
    const WxVoice = app('wx-voice'),voice = new WxVoice(directory)
    const convert = (method,input,output,options)=>new Promise((resolve,reject)=>{
      const fail = error=>{clearTimeout(timer);voice.removeListener('error',fail);reject(error)}
      const timer = setTimeout(()=>fail(new Error(`voice ${method} timed out`)),10000)
      voice.once('error',fail)
      voice[method](input,output,options,result=>{
        clearTimeout(timer);voice.removeListener('error',fail)
        if(!result)return reject(new Error(`voice ${method} failed`))
        resolve(result)
      })
    })
    await convert('encode',wav,silk,{format:'silk'})
    await convert('decode',silk,mp3,{format:'mp3'})
    assert(fs.statSync(mp3).size > 0)
    const tgs = path.join(directory,'sticker.tgs'),gif = path.join(directory,'sticker.gif')
    fs.writeFileSync(tgs,gzipSync(JSON.stringify({v:'5.5.2',fr:10,ip:0,op:2,w:32,h:32,nm:'synthetic',ddd:0,assets:[],layers:[{ddd:0,ind:1,ty:1,nm:'solid',sr:1,ks:{o:{a:0,k:100},r:{a:0,k:0},p:{a:0,k:[0,0,0]},a:{a:0,k:[0,0,0]},s:{a:0,k:[100,100,100]}},sw:32,sh:32,sc:'#6688aa',ip:0,op:2,st:0,bm:0}]})))
    run('bash',['/usr/bin/lottie_to_gif.sh','--output',gif,'--width','32','--height','32','--fps','10',tgs])
    assert.equal((await sharp(gif).metadata()).format,'gif')
    const {createWebUIServer} = app('./dist/webui/server')
    const token = 'synthetic-container-smoke-token'
    server = createWebUIServer({environment:{},file:path.join(directory,'settings.json'),token})
    server.listen(0,'127.0.0.1');await once(server,'listening')
    const origin = `http://127.0.0.1:${server.address().port}`
    for(const route of ['/chat','/manage','/sw.js','/manifest.webmanifest'])assert.equal((await fetch(origin + route)).status,200,route)
    const html = await (await fetch(origin + '/chat')).text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match=>match[1])
    assert(assets.some(asset=>asset.endsWith('.js')),'missing Vite JavaScript')
    assert(assets.some(asset=>asset.endsWith('.css')),'missing Vite CSS')
    for(const asset of assets)assert.equal((await fetch(origin + asset)).status,200,asset)
    assert(fs.readdirSync('/app/dist/webui/public/emoji').some(name=>/\.(png|webp)$/.test(name)))
    assert.equal((await fetch(origin + '/api/config',{headers:{Authorization:`Bearer ${token}`}})).status,200)
    console.log('Runtime smoke passed: production-only dependencies, SQLite, sharp, QuickJS worker, FFmpeg, SILK roundtrip, TGS/GIF, WebUI/PWA and authenticated config; no real accounts.')
  } finally {
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
    fs.rmSync(directory,{recursive:true,force:true})
  }
}
main().catch(error=>{console.error(error);process.exitCode = 1})