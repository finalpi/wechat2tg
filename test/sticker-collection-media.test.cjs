/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {execFileSync} = require('node:child_process')
const {convertCollectedSticker} = require('../dist/service/StickerCollectionMedia')

test('static collection preserves transparency and aspect ratio within sticker size limits', async()=>{
  const input = await sharp({create:{width:80,height:160,channels:4,background:{r:255,g:0,b:0,alpha:0.5}}}).png().toBuffer()
  const result = await convertCollectedSticker(input,'static')
  assert.equal(result.format,'static')
  assert.equal(result.trimmed,false)
  assert.ok(result.source.length <= 512 * 1024)
  const image = await sharp(result.source).metadata()
  assert.equal(image.width,512)
  assert.equal(image.height,512)
  assert.equal(image.hasAlpha,true)
  const {data} = await sharp(result.source).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(data[3],0,'padding remains transparent')
})

test('GIF becomes a silent VP9 WebM under 256 KB, max 3 seconds and 512px', async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sticker-media-test-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const input = path.join(directory,'source.gif'),output = path.join(directory,'sticker.webm')
  execFileSync(fs.existsSync(require('ffmpeg-static')) ? require('ffmpeg-static') : 'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=64x64:rate=10','-t','4',input],{timeout:15000})
  const result = await convertCollectedSticker(fs.readFileSync(input),'video')
  assert.equal(result.format,'video')
  assert.equal(result.trimmed,true)
  assert.ok(result.source.length <= 256 * 1024)
  fs.writeFileSync(output,result.source)
  let probe
  try {probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8',timeout:10000}))}
  catch(error) {assert.fail(`ffprobe failed: ${error.message}`)}
  assert.equal(probe.streams.length,1)
  assert.equal(probe.streams[0].codec_name,'vp9')
  assert.equal(probe.streams[0].width,512)
  assert.equal(probe.streams[0].height,512)
  assert.ok(Number(probe.format.duration) <= 3.01)
  assert.ok(Number(probe.format.duration) > 1)
})

test('Telegram MP4 animation converts to a VP9 video sticker',async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sticker-mp4-test-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  const input = path.join(directory,'animation.mp4')
  execFileSync(fs.existsSync(require('ffmpeg-static')) ? require('ffmpeg-static') : 'ffmpeg',[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=96x64:rate=12',
    '-t','1','-c:v','libx264','-pix_fmt','yuv420p','-threads','1',input,
  ],{timeout:15000})
  const result = await convertCollectedSticker(fs.readFileSync(input),'video')
  assert.equal(result.format,'video')
  assert.ok(result.source.length <= 256 * 1024)
  const codec = execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','csv=p=0','-i','pipe:0'],
    {input:result.source,encoding:'utf8',timeout:10000})
  assert.equal(codec.trim(),'vp9')
})

test('TGS, oversized input and forged video playlists fail without flattening', async()=>{
  await assert.rejects(convertCollectedSticker(Buffer.from('fake'),'animated'),/TGS/)
  await assert.rejects(convertCollectedSticker(Buffer.alloc(20 * 1024 * 1024 + 1),'static'),/20 MB/)
  await assert.rejects(convertCollectedSticker(Buffer.from('ffconcat version 1.0\nfile /etc/passwd'),'video'),/不支持此动图格式/)
})