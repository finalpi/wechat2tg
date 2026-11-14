/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict'),sharp = require('sharp')
const {prepareTelegramMedia} = require('../dist/util/TelegramMedia')
const {image,animatedGif,animatedPng,pngChunk} = require('./helpers/telegram-media.cjs')
const media = buff=>({buff,filename:'wechat-sticker.gif',fileType:'animation',caption:'<b>原发送者</b>'})

for(const format of ['png','jpeg','webp','gif']){
  test(`static ${format} with a misleading .gif name becomes a real PNG photo without mutating the source`,async()=>{
    const input = media(await image(format)),before = Buffer.from(input.buff)
    const result = await prepareTelegramMedia(input),metadata = await sharp(result.buff).metadata()
    assert.equal(result.fileType,'photo');assert.equal(result.filename,'wechat-sticker.png')
    assert.equal(result.caption,input.caption);assert.equal(metadata.format,'png')
    assert.equal(metadata.width,16);assert.equal(metadata.height,12);assert.equal(metadata.hasAlpha,false)
    assert.equal(input.fileType,'animation');assert.equal(input.filename,'wechat-sticker.gif');assert.deepEqual(input.buff,before)
  })
}

test('real multi-frame GIF/WebP and APNG are never flattened to their first frame',async()=>{
  assert.equal((await sharp(animatedGif).metadata()).pages,2)
  const webp = await sharp(animatedGif,{animated:true}).webp({lossless:true}).toBuffer()
  assert.equal((await sharp(webp).metadata()).pages,2)
  const apng = await animatedPng()
  assert.equal((await sharp(apng).metadata()).format,'png')
  for(const buff of [animatedGif,webp,apng]){
    const input = media(buff)
    assert.equal(await prepareTelegramMedia(input),input)
    assert.equal(input.fileType,'animation')
  }
})

test('PNG animation checks use chunk structure rather than matching image metadata text',async()=>{
  const png = await image('png')
  const annotated = Buffer.concat([png.subarray(0,33),pngChunk('tEXt',Buffer.from('comment\0acTL is just text here')),png.subarray(33)])
  assert.equal((await prepareTelegramMedia(media(annotated))).fileType,'photo')
})

test('transparent static stickers flatten onto white and orientation is applied',async()=>{
  const transparent = await prepareTelegramMedia(media(await image('png',{background:'#00000000'})))
  const pixels = await sharp(transparent.buff).raw().toBuffer()
  assert(pixels.every(value=>value === 255))
  const rotated = await sharp(await image('jpeg')).withMetadata({orientation:6}).jpeg().toBuffer()
  const result = await prepareTelegramMedia(media(rotated)),metadata = await sharp(result.buff).metadata()
  assert.equal(metadata.width,12);assert.equal(metadata.height,16)
})

test('large static stickers resize inside photo limits without enlarging small images',async()=>{
  const result = await prepareTelegramMedia(media(await image('png',{width:1600,height:1200})))
  const metadata = await sharp(result.buff).metadata()
  assert.equal(metadata.width,1280);assert.equal(metadata.height,960)
  assert(result.buff.length < 5 * 1024 * 1024)
})

test('unrecognized, truncated, oversize and invalid-aspect inputs retain the original route and bytes',async()=>{
  const png = await image('png')
  const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);png.copy(oversized)
  for(const buff of [Buffer.from('not an image'),Buffer.from('GIF89a'),png.subarray(0,png.length - 5),
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.from('0000ftypisom'),oversized,
    await image('png',{width:640,height:1})]){
    const input = media(buff);assert.equal(await prepareTelegramMedia(input),input)
  }
})

test('ordinary photos, documents and videos are not reclassified by sticker normalization',async()=>{
  const buff = await image('gif')
  for(const fileType of ['photo','document','video','voice','audio']){
    const input = {...media(buff),fileType};assert.equal(await prepareTelegramMedia(input),input)
  }
})