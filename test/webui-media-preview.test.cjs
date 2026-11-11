/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),vm = require('node:vm'),ts = require('typescript')
const {once} = require('node:events')
const {createWebUIServer} = require('../dist/webui/server')

function frontendModule(name) {
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname,`../webui/src/lib/${name}.ts`),'utf8')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.CommonJS}}).outputText,{exports,DOMException})
  return exports
}

test('image viewer fits portrait/landscape rotations and calculates zoomed bounds',()=>{
  const {imageLayout} = frontendModule('image-viewer')
  for(const [width,height] of [[2400,800],[600,3600],[32,32]])for(const rotation of [0,90,180,270]) {
    const fit = imageLayout(width,height,800,500,1,rotation)
    assert(fit.boundsWidth <= 768 && fit.boundsHeight <= 468)
    assert.equal(Math.round(fit.width / fit.height * 1000),Math.round(width / height * 1000))
    const zoomed = imageLayout(width,height,800,500,4,rotation)
    assert.equal(zoomed.boundsWidth,fit.boundsWidth * 4)
    assert.equal(zoomed.boundsHeight,fit.boundsHeight * 4)
  }
})

test('zoomed images pan inside a fixed canvas and clamp to their rotated edges',()=>{
  const {imageLayout,clampImagePan} = frontendModule('image-viewer')
  const landscape = imageLayout(1200,700,800,500,3,0)
  const pan = clampImagePan(9999,-9999,landscape.boundsWidth,landscape.boundsHeight,800,500)
  assert.equal(pan.x,(landscape.boundsWidth - 800) / 2)
  assert.equal(pan.y,-(landscape.boundsHeight - 500) / 2)
  const fitted = imageLayout(1200,700,800,500,1,90)
  const reset = clampImagePan(pan.x,pan.y,fitted.boundsWidth,fitted.boundsHeight,800,500)
  assert.equal(Math.abs(reset.x),0);assert.equal(Math.abs(reset.y),0)
})

test('preview queue bounds concurrency, cancels queued work and recovers after errors',async()=>{
  const schedule = frontendModule('media-queue').createMediaQueue(1)
  const controller = new AbortController(),cancelled = new AbortController()
  let release,started = 0
  const first = schedule(()=>{started++;return new Promise(resolve=>{release = resolve})},controller.signal)
  await Promise.resolve()
  const second = schedule(async()=>{started++;return 2},cancelled.signal)
  const rejected = assert.rejects(second,error=>error.name === 'AbortError')
  cancelled.abort();await rejected
  assert.equal(started,1)
  release(1);assert.equal(await first,1)
  await assert.rejects(schedule(async()=>{throw Error('synthetic')},controller.signal),/synthetic/)
  assert.equal(await schedule(async()=>3,controller.signal),3)
  assert.equal(started,1,'cancelled queued downloads never start')
})

test('video thumbnails are generated once, cached and retried after a conversion failure',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'webui-thumbnail-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const id = '11111111-1111-4111-8111-111111111111',file = path.join(directory,id)
  fs.writeFileSync(file,'synthetic video')
  let calls = 0,fail = false,kind = 'video'
  const exports = {},dependencies = {
    'node:child_process':{execFile:(_bin,args,_options,callback)=>{
      calls++
      setImmediate(()=>{fs.writeFileSync(args.at(-1),'synthetic jpeg');callback(fail ? Error('synthetic conversion failure') : null)})
    }},
    'ffmpeg-static':'synthetic-ffmpeg','sharp':{},'file-box':{},'wx2tg-puppet':{},'./message-store':{},
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/webui/media.js'),'utf8'),{
    exports,Buffer,require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:require(name),
  })
  const store = {all:async()=>[{id,kind,mime:'video/mp4',name:'video.mp4',size:15}]}
  const media = new exports.WebMediaStore(store,directory)
  const thumbnails = await Promise.all([media.thumbnail(id),media.thumbnail(id)])
  assert.equal(thumbnails[0],thumbnails[1]);assert.equal(calls,1)
  assert.equal(await media.thumbnail(id),thumbnails[0]);assert.equal(calls,1)
  assert.equal(fs.readFileSync(thumbnails[0],'utf8'),'synthetic jpeg')
  fs.unlinkSync(thumbnails[0]);fail = true
  await assert.rejects(media.thumbnail(id),error=>error.code === 'mediaConversionFailed')
  assert.deepEqual(fs.readdirSync(directory),[id],'failed conversions leave no partial thumbnail')
  fail = false;await media.thumbnail(id);assert.equal(calls,3)
  kind = 'file';await assert.rejects(media.thumbnail(id),error=>error.code === 'thumbnailUnavailable')
  await assert.rejects(media.thumbnail('../outside'),error=>error.code === 'mediaMissing')
})

test('simultaneous automatic previews share a stored-message download and a failed download can be retried',async()=>{
  let downloads = 0,fail = false,release
  const waiting = new Promise(resolve=>{release = resolve})
  const rows = new Map([1,2].map(id=>[id,{id,source:'{}'}]))
  const file = {id:'11111111-1111-4111-8111-111111111111',mime:'image/png',kind:'image',name:'image.png'}
  const dependencies = {
    '../base/BaseClient':{AbstractClient:{getSpyClient:()=>null}},
    './mentions':{createGroupMentionService:()=>({})},
    'wx2tg-puppet':{Message:class {
      async toFileBox() {
        downloads++;await waiting
        if(fail)throw Error('synthetic download failure')
        return {name:'image.png',toBuffer:async()=>Buffer.from('png')}
      }
    }},
  }
  const exports = {},store = {
    byId:async id=>({...rows.get(id)}),all:async()=>[],
    run:async(_sql,args)=>{rows.get(args[1]).attachmentId = args[0]},
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/webui/messages.js'),'utf8'),{exports,require:name=>dependencies[name] || {}})
  const center = exports.createMessageCenter(store,{save:async()=>file,get:async()=>file})
  const first = center.attachment(1),second = center.attachment(1)
  release();await Promise.all([first,second]);assert.equal(downloads,1)
  await center.attachment(1);assert.equal(downloads,1)
  fail = true;await assert.rejects(center.attachment(2),/synthetic download failure/)
  fail = false;await center.attachment(2);assert.equal(downloads,3)
})

test('thumbnail endpoint requires bearer auth and serves only the stored preview',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'webui-thumbnail-http-'))
  const file = path.join(directory,'thumb.jpg'),id = '11111111-1111-4111-8111-111111111111'
  fs.writeFileSync(file,'jpeg')
  const calls = [],token = 'synthetic-preview-token'
  const server = createWebUIServer({environment:{},file:path.join(directory,'config.json'),token,mcpTokens:{read:'r'.repeat(32),write:'w'.repeat(32)},messages:{
    mediaThumbnail:async value=>{calls.push(value);return file},
  }})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})})
  const base = `http://127.0.0.1:${server.address().port}`,route = `/api/media/${id}/thumbnail`
  assert.equal((await fetch(base + route)).status,401);assert.equal(calls.length,0)
  const response = await fetch(base + route,{headers:{Authorization:`Bearer ${token}`}})
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg')
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  assert.equal(await response.text(),'jpeg');assert.deepEqual(calls,[id])
  assert.equal((await fetch(base + route,{method:'POST',headers:{Authorization:`Bearer ${token}`}})).status,404)
  assert.equal(calls.length,1)
})
