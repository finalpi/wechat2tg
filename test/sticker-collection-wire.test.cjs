/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),http = require('node:http')
const {once} = require('node:events'),{Telegraf} = require('telegraf'),sharp = require('sharp')
const {installStickerCollection} = require('../dist/service/StickerCollectionTelegram')

test('real Telegraf downloads, converts and uploads a sticker with correct multipart and pack API payloads', async t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'sticker-wire-')),calls = []
  const image = await sharp({create:{width:32,height:64,channels:4,background:'#ff0000'}}).png().toBuffer()
  const server = http.createServer(async(request,response)=>{
    if(request.url.startsWith('/file/')) {response.writeHead(200,{'content-type':'image/png'});response.end(image);return}
    const chunks = [];for await(const chunk of request)chunks.push(chunk)
    const body = Buffer.concat(chunks),method = request.url.split('/').pop()
    const multipart = request.headers['content-type']?.startsWith('multipart/')
    let data
    try {data = multipart ? body.toString('latin1') : JSON.parse(body.toString())}
    catch {response.writeHead(400);response.end();return}
    calls.push({method,data,multipart})
    if(method === 'getStickerSet') {
      response.writeHead(400,{'content-type':'application/json'})
      response.end(JSON.stringify({ok:false,error_code:400,description:'Bad Request: STICKERSET_INVALID'}));return
    }
    const result = method === 'getFile' ? {file_id:'original',file_unique_id:'original',file_path:'test.png'}
      : method === 'uploadStickerFile' ? {file_id:'uploaded-file',file_unique_id:'uploaded-unique'}
        : method === 'sendMessage' ? {message_id:101,date:100,chat:{id:7,type:'private'}} : true
    response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,result}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})})
  const bot = new Telegraf('99:synthetic-only',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
  bot.botInfo = {id:99,is_bot:true,first_name:'test',username:'collection_test_bot'}
  installStickerCollection(bot,{directory,owner:async()=>7,allowed:async chat=>chat === 7,now:()=>100000})
  let forwarded = false
  bot.use(()=>{forwarded = true})
  await bot.handleUpdate({update_id:1,message:{message_id:100,date:101,from:{id:7,is_bot:false,first_name:'owner'},chat:{id:7,type:'private'},text:'收藏',reply_to_message:{message_id:12,date:100,chat:{id:7,type:'private'},photo:[{file_id:'original',file_unique_id:'original',width:32,height:64}]}}})
  assert.equal(forwarded,false)
  const upload = calls.find(c=>c.method === 'uploadStickerFile')
  assert.ok(upload?.multipart)
  assert.match(upload.data,/name="sticker_format"\r\n\r\nstatic/)
  assert.match(upload.data,/name="user_id"\r\n\r\n7/)
  assert.match(upload.data,/filename="sticker.png"/)
  const create = calls.find(c=>c.method === 'createNewStickerSet')
  assert.equal(create.data.user_id,7)
  assert.equal(create.data.stickers[0].sticker,'uploaded-file')
  assert.equal(create.data.stickers[0].format,'static')
  const sent = calls.find(c=>c.method === 'sendMessage')
  assert.match(sent.data.text,/https:\/\/t.me\/addstickers\//)
  assert.equal(sent.data.reply_parameters.message_id,12)
})