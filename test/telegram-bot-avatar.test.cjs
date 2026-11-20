/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS test runner. */
const test = require('node:test'),assert = require('node:assert/strict')
const http = require('node:http'),{once} = require('node:events'),{Telegraf} = require('telegraf')
const sharp = require('sharp'),fs = require('node:fs')
const {ensureDefaultBotAvatar,defaultBotAvatar} = require('../dist/service/TelegramBotAvatar')

test('the bundled Bot avatar exactly matches the checked-in profile image',async()=>{
  const avatar = await defaultBotAvatar()
  assert.deepEqual(avatar,fs.readFileSync(require.resolve('../src/assets/bot-avatar.jpg')))
  const {format,width,height} = await sharp(avatar).metadata()
  assert.deepEqual({format,width,height},{format:'jpeg',width:320,height:320})
})

test('existing avatar, a concurrent custom avatar, or failed lookup never uploads',async()=>{
  for(const lookups of [[1],[0,1],[undefined]]) {
    let writes = 0
    const telegram = {getUserProfilePhotos:async()=>({total_count:lookups.shift()}),callApi:async()=>{writes++}}
    assert.equal(await ensureDefaultBotAvatar(telegram,99),'kept')
    assert.equal(writes,0)
  }
  const telegram = {getUserProfilePhotos:async()=>{throw new Error('mock failure')},callApi:async()=>assert.fail('must not upload')}
  await assert.rejects(ensureDefaultBotAvatar(telegram,99),/mock failure/)
})

test('empty Bot avatar is initialized once with a real multipart request',async t=>{
  const calls = []
  const server = http.createServer(async(req,res)=>{
    const chunks = [];for await(const chunk of req)chunks.push(chunk)
    const method = req.url.split('/').pop()
    calls.push({method,type:req.headers['content-type'],body:Buffer.concat(chunks)})
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify({ok:true,result:method === 'getUserProfilePhotos' ? {total_count:0,photos:[]} : true}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const {telegram} = new Telegraf('99:synthetic-only',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
  const one = ensureDefaultBotAvatar(telegram,99),two = ensureDefaultBotAvatar(telegram,99)
  assert.equal(one,two)
  assert.equal(await one,'set')
  assert.deepEqual(calls.map(call=>call.method),['getUserProfilePhotos','getUserProfilePhotos','setMyProfilePhoto'])
  for(const call of calls.slice(0,2))assert.match(call.body.toString(),/"user_id":99/)
  const upload = calls[2]
  assert.match(upload.type,/^multipart\/form-data/)
  assert.match(upload.body.toString('latin1'),/name="photo"\r\n\r\n\{"type":"static","photo":"attach:\/\/avatar"\}/)
  assert.match(upload.body.toString('latin1'),/name="avatar"; filename="wechat2tg-avatar\.jpg"/)
  assert.ok(upload.body.includes(await defaultBotAvatar()))
})