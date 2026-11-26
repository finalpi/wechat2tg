/* eslint-disable @typescript-eslint/no-var-requires */
const test = require('node:test'),assert = require('node:assert/strict')
const {createServer} = require('node:http'),{createHash} = require('node:crypto'),{Readable} = require('node:stream'),{once} = require('node:events')
const {downloadWechatMedia,readBinaryFile} = require('../dist/util/WechatFileDownload')
const size = 289403338
function message(bytes,md5){return {type:()=>'file',newMsgId:'9012345678901234567',_xml:`<msg><appmsg><title>test.dmg</title><md5>${md5}</md5><appattach><totallen>${bytes}</totallen></appattach></appmsg></msg>`}}
async function withServer(handler,fn){
  const server = createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening')
  try {await fn(`http://127.0.0.1:${server.address().port}`)} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
test('unsupported server, bad HTTP length, and a busy binary lane fail without a retry storm',async()=>{
  const replies = [[200,'application/json',2],[200,'application/octet-stream',2],[503,'text/plain',2],[503,'text/plain',2]]
  const md5 = '0'.repeat(32),accepts = []
  await withServer((req,res)=>{accepts.push(req.headers.accept);const [status,type,len] = replies.shift();res.writeHead(status,{'Content-Type':type,'Content-Length':len});res.end('{}')},async url=>{
    for(const reason of [/服务端未返回完整文件/,/长度不符/,/通道忙/])await assert.rejects(downloadWechatMedia(message(size,md5),'account','peer',url),reason)
    await assert.rejects(downloadWechatMedia(message(1024 ** 3,md5),'account','peer',url),/通道忙/)
  });assert.deepEqual(accepts,Array(4).fill('application/octet-stream'))
})
test('binary file reader refuses truncation, excess bytes and checksum mismatches',async()=>{
  const data = Buffer.from('synthetic'),md5 = createHash('md5').update(data).digest('hex')
  for(const [length,hash] of [[data.length - 1,md5],[data.length + 1,md5],[data.length,'0'.repeat(32)]])await assert.rejects(readBinaryFile(Readable.from([data]),length,hash))
  assert.deepEqual(await readBinaryFile(Readable.from([data.subarray(0,3),data.subarray(3)]),data.length,md5),data)
})
for(const legacy of [false,true])test(`${legacy ? 'legacy JSON' : 'binary'} HTTP attachment at 276 MiB matches length and MD5`,{skip:process.env.TEST_LARGE_WECHAT_FILE !== '1'},async()=>{
  const piece = Buffer.alloc(3 * 128 * 1024,0x42),digest = createHash('md5')
  function* chunks(){for(let i = 0;i < size;i += piece.length)yield piece.subarray(0,Math.min(piece.length,size - i))}
  for(const bytes of chunks())digest.update(bytes)
  const md5 = digest.digest('hex')
  function* json(){yield '{"Code":0,"Success":true,"Data":{"FileData":"';for(const bytes of chunks())yield bytes.toString('base64');yield '"}}'}
  await withServer((req,res)=>{assert.equal(req.headers.accept,'application/octet-stream');if(legacy){res.setHeader('Content-Type','application/json');Readable.from(json()).pipe(res)}else{res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size});Readable.from(chunks()).pipe(res)}},async url=>{
    const box = await downloadWechatMedia(message(size,md5),'account','peer',url),bytes = await box.toBuffer()
    assert.equal(bytes.length,size);assert.equal(createHash('md5').update(bytes).digest('hex'),md5)
  })
})