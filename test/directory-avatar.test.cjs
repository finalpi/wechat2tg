/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const {once} = require('node:events')
const sharp = require('sharp')
const {Telegram} = require('telegraf')
const {renderDirectoryAvatar,createDirectoryAvatar,DETAIL_AVATAR_SIZE} = require('../dist/util/DirectoryAvatar')
const {replyDirectoryText} = require('../dist/util/DirectoryPageDelivery')

const redAvatar = ()=>sharp({create:{width:96,height:96,channels:4,background:'#ff0000'}}).png().toBuffer()

test('profile portrait is a circular crop without a name banner or stretched canvas', async () => {
  const image = await renderDirectoryAvatar(await redAvatar())
  const {data,info} = await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true})
  assert.equal(info.width,DETAIL_AVATAR_SIZE)
  assert.equal(info.height,DETAIL_AVATAR_SIZE)
  const pixel = (x,y)=>Array.from(data.subarray((y * info.width + x) * 4,(y * info.width + x) * 4 + 4))
  for(const [x,y] of [[0,0],[255,0],[0,255],[255,255]])assert.deepEqual(pixel(x,y),[255,255,255,255])
  assert.deepEqual(pixel(128,128),[255,0,0,255])
  let red = 0
  for(let y = 0;y < info.height;y++)for(let x = 0;x < info.width;x++){
    const offset = (y * info.width + x) * 4
    if(data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 0)red++
  }
  assert(red > info.width * info.height * 0.77 && red < info.width * info.height * 0.80,'only the circle contains the portrait')
})

test('profile renderer rejects invalid or oversized images and non-allowlisted avatar sources', async () => {
  await assert.rejects(renderDirectoryAvatar(Buffer.from('not an image')))
  const oversized = await sharp({create:{width:2001,height:2000,channels:3,background:'red'}}).png().toBuffer()
  await assert.rejects(renderDirectoryAvatar(oversized),/pixel limit/i)
  await assert.rejects(createDirectoryAvatar('http://127.0.0.1/private'),error=>error.code === 'avatarUnavailable')
})

test('actual Telegraf sends the detail image as multipart with a parseable rich_message field', {timeout:10000}, async t => {
  const requests = []
  const server = http.createServer(async(req,res)=>{
    const parts = []
    for await(const part of req)parts.push(part)
    requests.push({url:req.url,headers:req.headers,body:Buffer.concat(parts)})
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({ok:true,result:{message_id:9}}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const telegram = new Telegram('123:synthetic',{apiRoot:`http://127.0.0.1:${server.address().port}`})
  const controller = new AbortController()
  const timer = setTimeout(()=>controller.abort(),5000)
  t.after(()=>{clearTimeout(timer);controller.abort()})
  const callApi = telegram.callApi.bind(telegram)
  telegram.callApi = (method,payload)=>callApi(method,payload,{signal:controller.signal})
  const image = await renderDirectoryAvatar(await redAvatar())
  const ctx = {telegram,chat:{id:-100},callbackQuery:{message:{message_id:1,chat:{id:-100},message_thread_id:77,rich_message:{blocks:[]}}},reply:async()=>{throw Error('unexpected fallback')}}
  const markup = {inline_keyboard:[[{text:'返回列表',callback_data:'back'}]]}
  assert.equal(await replyDirectoryText(ctx,'群内名称：小王',markup,{image,label:'头像'}),true)
  assert.equal(requests.length,1)
  const request = requests[0],body = request.body.toString('utf8')
  assert(request.url.endsWith('/sendRichMessage'))
  assert.match(request.headers['content-type'],/^multipart\/form-data; boundary=/)
  const json = body.match(/name="rich_message"\r\n\r\n([^\r]+)\r\n/)
  assert(json,'rich_message must be JSON text, not an unsupported nested file object')
  const rich = JSON.parse(json[1])
  assert.equal(rich.blocks[1].type,'details')
  assert.equal(rich.blocks[1].summary,'头像')
  assert.equal(rich.blocks[1].is_open,undefined)
  assert.equal(rich.blocks[1].blocks[0].photo.media,'attach://profile_avatar')
  assert.equal(rich.blocks[1].blocks[0].caption,undefined)
  assert.equal(rich.blocks.filter(block=>block.type === 'photo').length,0)
  assert.match(body,/name="profile_avatar"; filename="profile-avatar.png"/)
  assert(request.body.includes(image))
  assert.match(body,/name="message_thread_id"\r\n\r\n77\r\n/)
})