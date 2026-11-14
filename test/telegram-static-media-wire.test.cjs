/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),path = require('node:path'),vm = require('node:vm'),http = require('node:http')
const {once} = require('node:events'),{Telegraf} = require('telegraf')
const {image,animatedGif} = require('./helpers/telegram-media.cjs')

for(const route of ['sender','retry']){
  test(`real Bot API multipart uses sendPhoto for static stickers and sendAnimation for motion (${route})`,async t=>{
    const calls = []
    const server = http.createServer(async(request,response)=>{
      const chunks = [];for await(const chunk of request)chunks.push(chunk)
      const body = Buffer.concat(chunks).toString('latin1'),boundary = /boundary=([^;]+)/.exec(request.headers['content-type'])[1]
      const fields = {}
      for(const part of body.split(`--${boundary}`)){
        const match = /name="([^"]+)"/.exec(part)
        if(match)fields[match[1]] = {value:part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/,''),filename:/filename="([^"]+)"/.exec(part)?.[1]}
      }
      calls.push({method:request.url.split('/').pop(),fields})
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({ok:true,result:{message_id:123}}))
    })
    server.listen(0,'127.0.0.1');await once(server,'listening')
    t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
    const bot = new Telegraf('123:synthetic-test-only',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
    const exports = {},dependencies = {
      './MessageSender':{MessageSender:class {sendAction(){return undefined}}},
      '../base/BaseClient':{AbstractClient:class {static getSpyClient(){return {client:bot}}}},
      '../config':{config:{WECHAT_CUSTOM_EMOJI_ENABLED:false}},
      '../util/TelegramMedia':require('../dist/util/TelegramMedia'),
      '../util/TelegramKeyboard':require('../dist/util/TelegramKeyboard'),
      '../util/TelegramPresentation':require('./helpers/telegram-presentation')(),
      'abort-controller':require('abort-controller'),
    }
    const file = route === 'sender' ? 'message/TelegramBotApiMessageSender.js' : 'client/TelegramBotClient.js'
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),{
      exports,Buffer,console,setTimeout,clearTimeout,require:name=>dependencies[name] || {},
    },{filename:file})
    const sender = route === 'sender' ? new exports.TelegramBotApiMessageSender(bot) : Object.create(exports.TelegramBotClient.prototype)
    for(const [buff,staticImage] of [[await image('gif'),true],[await image('png'),true],[animatedGif,false]]){
      const before = calls.length
      if(route === 'sender')await sender.sendFile(-100,{buff,filename:'emoji.gif',fileType:'animation',caption:'<b>sender</b>'},
        {parse_mode:'HTML',message_thread_id:42,reply_id:91,inline_keyboard:[{text:'Open',callback_data:'test:open'}]})
      else await sender.sendWechatRetryFile(-100,buff,{fileName:'emoji.gif',fileType:'animation',caption:'<b>sender</b>',threadId:42,replyToMessageId:91})
      assert.equal(calls.length,before + 1)
      const request = calls.at(-1),field = request.fields[staticImage ? 'photo' : 'animation']
      assert.equal(request.method,staticImage ? 'sendPhoto' : 'sendAnimation')
      assert.equal(field.filename,staticImage ? 'emoji.png' : 'emoji.gif')
      assert.equal(request.fields.message_thread_id.value,'42')
      assert.equal(request.fields.caption.value,'<b>sender</b>')
      assert.deepEqual(JSON.parse(request.fields.reply_parameters.value),{message_id:91})
      if(route === 'sender')assert.equal(JSON.parse(request.fields.reply_markup.value).inline_keyboard[0][0].callback_data,'test:open')
      if(!staticImage)assert.deepEqual(Buffer.from(field.value,'latin1'),buff)
    }
  })
}