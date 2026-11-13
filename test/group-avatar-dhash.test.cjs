/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {createHash} = require('node:crypto')
const sharp = require('sharp')
const {groupAvatarDHash, groupAvatarDHashDistance, sameGroupAvatarDHash, largeGroupAvatarURL, prepareGroupAvatar} = require('../dist/util/GroupAvatar')

const grid = async alternating => {
  const pixels = Buffer.alloc(9 * 8)
  for(let y = 0; y < 8; y++)for(let x = 0; x < 9; x++)pixels[y * 9 + x] = alternating && y % 2 ? x * 28 : 255 - x * 28
  return sharp(pixels,{raw:{width:9,height:8,channels:1}}).png().toBuffer()
}

test('dHash uses exactly 64 horizontal comparisons, fixed-width hex and row-major bit order', async () => {
  assert.equal(await groupAvatarDHash(await grid(false)),'ffffffffffffffff')
  assert.equal(await groupAvatarDHash(await grid(true)),'ff00ff00ff00ff00')
  const increasing = Buffer.from(Array.from({length:72},(_,i)=>(i % 9) * 28))
  assert.equal(await groupAvatarDHash(await sharp(increasing,{raw:{width:9,height:8,channels:1}}).png().toBuffer()),'0000000000000000')
})

test('the source dHash threshold is strictly less than five, including high bits', () => {
  const base = '0000000000000000'
  for(const [hash,distance] of [[base,0],['f000000000000000',4],['f800000000000000',5],['ffffffffffffffff',64]]){
    assert.equal(groupAvatarDHashDistance(base,hash),distance)
    assert.equal(groupAvatarDHashDistance(hash,base),distance)
    assert.equal(sameGroupAvatarDHash(base,hash),distance < 5)
  }
  assert.equal(groupAvatarDHashDistance('8000000000000000','0000000000000001'),2)
  assert.equal(groupAvatarDHashDistance('Ff00fF00fF00fF00','ff00ff00ff00ff00'),0)
})

test('missing, corrupt and old MD5/SHA values cannot be mistaken for a confirmed dHash', () => {
  for(const value of [undefined,null,0,'','0'.repeat(15),'0'.repeat(17),'0'.repeat(32),'0'.repeat(64),'g'.repeat(16),' 0000000000000000',{},[]]){
    assert.equal(groupAvatarDHashDistance(value,'0000000000000000'),undefined)
    assert.equal(sameGroupAvatarDHash(value,'0000000000000000'),false)
  }
  assert.equal(sameGroupAvatarDHash('0000000000000000','0000000000000000'),true)
})

test('large image bytes with different encoding and MD5 retain a near-identical dHash', async () => {
  const original = await sharp(await grid(true)).resize(720,640,{fit:'fill',kernel:'nearest'}).png().toBuffer()
  const baseline = await groupAvatarDHash(original)
  for(const quality of [70,85,95]){
    const encoded = await sharp(original).withMetadata().jpeg({quality}).toBuffer()
    assert.notEqual(createHash('md5').update(original).digest('hex'),createHash('md5').update(encoded).digest('hex'))
    assert(sameGroupAvatarDHash(baseline,await groupAvatarDHash(encoded)))
    const prepared = await prepareGroupAvatar(encoded)
    assert.equal(prepared.dHash,await groupAvatarDHash(encoded),'persist the large source dHash, not a URL or an upload-file digest')
    assert.equal((await sharp(prepared.buffer).metadata()).width,200)
  }
})

test('auto-orientation and transparent backgrounds are normalized, while bad images reject', async () => {
  const image = await sharp(await grid(true)).resize(180,160).jpeg().withMetadata({orientation:6}).toBuffer()
  const oriented = await sharp(image).rotate().png().toBuffer()
  assert.equal(await groupAvatarDHash(image),await groupAvatarDHash(oriented))
  const transparent = await sharp({create:{width:90,height:80,channels:4,background:{r:230,g:40,b:10,alpha:0}}}).png().toBuffer()
  const white = await sharp({create:{width:90,height:80,channels:3,background:'white'}}).png().toBuffer()
  assert.equal(await groupAvatarDHash(transparent),await groupAvatarDHash(white))
  await assert.rejects(groupAvatarDHash(Buffer.from('invalid image')))
  await assert.rejects(groupAvatarDHash(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="7000"><rect width="7000" height="7000"/></svg>')))
})

test('uniform colors illustrate the requested dHash policy rather than reintroducing a color veto', async () => {
  const color = background => sharp({create:{width:90,height:80,channels:3,background}}).png().toBuffer()
  assert(sameGroupAvatarDHash(await groupAvatarDHash(await color('blue')),await groupAvatarDHash(await color('red'))))
})

test('only known WeChat thumbnail routes are upgraded to the large /0 image, with queries intact', () => {
  for(const route of ['mmhead','mmcrhead','mmopen'])for(const size of [46,64,96,132]){
    assert.equal(largeGroupAvatarURL(`https://wx.qlogo.cn/${route}/ver_1/token/${size}?a=one%2Ftwo&b=1`),`https://wx.qlogo.cn/${route}/ver_1/token/0?a=one%2Ftwo&b=1`)
  }
  for(const value of ['https://wx.qlogo.cn/mmhead/avatar/0','https://wx.qlogo.cn/mmhead/avatar.png?size=132',
    'https://wx.qlogo.cn/unknown/avatar/132','https://wx.qlogo.cn.evil.example/mmhead/a/132',
    'https://raw.githubusercontent.com/example/avatar/132','https://mmbiz.qpic.cn/image/132',
    'https://user:secret@wx.qlogo.cn/mmhead/a/132','ftp://wx.qlogo.cn/mmhead/a/132','opaque-sdk-url']){
    assert.equal(largeGroupAvatarURL(value),value)
  }
})