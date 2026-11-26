/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node:test entry point. */
const test = require('node:test')
const assert = require('node:assert/strict')
const {createServer} = require('node:http')
const {createHash} = require('node:crypto')
const {Readable} = require('node:stream')
const {decodeFileResponse,downloadWechatMedia,fileMessageRequest,storedFileTalker} = require('../dist/util/WechatFileDownload')

const id = '9007199254740993123',account = 'self',peer = 'peer'
const xml = '<msg><appmsg><type>6</type><title>A &amp; B</title><appattach><totallen>90000000</totallen></appattach></appmsg></msg>'

test('large direct, room and reconstructed attachments put an exact numeric int64 and the peer on the HTTP wire',async()=>{
  const requests = []
  const server = createServer(async(req,res)=>{
    let body = '';for await(const chunk of req)body += chunk
    requests.push({url:req.url,body})
    res.end(JSON.stringify({Code:-8,Success:false,Message:'private diagnostic'}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try {
    for(const [conversation,sender,to,expected] of [[peer,account,peer,peer],[peer,peer,account,peer],['room@chatroom','member','room@chatroom','room@chatroom'],[undefined,peer,account,peer],[peer,peer,peer,peer]]){
      const talker = storedFileTalker(account,conversation,sender,to)
      await assert.rejects(downloadWechatMedia({type:()=>'file',_xml:talker.endsWith('@chatroom') ? 'member:\n' + xml : xml,newMsgId:id,_msgId:'42'},account,talker,`http://127.0.0.1:${server.address().port}/api`),/微信大文件下载失败/)
      const request = requests.at(-1)
      assert.equal(request.url,'/api/Tools/DownloadFileMessage')
      assert.match(request.body,/"NewMsgID":9007199254740993123[,}]/)
      const fields = JSON.parse(request.body)
      assert.deepEqual([fields.Talker,fields.Wxid,fields.Xml,fields.MsgID],[expected,account,xml,42])
    }
    for(const bad of [Number(id),'9223372036854775808','0','1.23','1,"Talker":"other"'])assert.throws(()=>fileMessageRequest(account,peer,bad,xml))
    assert.throws(()=>fileMessageRequest(account,'',id,xml))
  }finally{await new Promise(resolve=>server.close(resolve))}
})

test('streaming file response validates length/MD5 across arbitrary base64 and JSON chunk boundaries',async()=>{
  const bytes = Buffer.from('synthetic archive bytes'),md5 = createHash('md5').update(bytes).digest('hex')
  const encode = obj=>Readable.from([...JSON.stringify(obj)].map(s=>Buffer.from(s)))
  for(const key of ['FileData','Image']){
    const result = {Data:{debug:{Image:'no'},[key]:bytes.toString('base64')},Code:0,Success:true}
    assert.deepEqual(await decodeFileResponse(encode(result),{size:bytes.length,md5}),bytes)
    await assert.rejects(decodeFileResponse(encode(result),{size:bytes.length,md5:'0'.repeat(32)}),/MD5/)
    await assert.rejects(decodeFileResponse(encode(result),{size:bytes.length + 1}))
    await assert.rejects(decodeFileResponse(encode({...result,Success:false}),{size:bytes.length}))
  }
  for(const data of [{debug:{Image:'YQ=='}},{Image:'y?=='},{FileData:'YQ'},{Image:'YQ==Yg=='}])await assert.rejects(decodeFileResponse(encode({Code:0,Success:true,Data:data}),{size:1}))
})