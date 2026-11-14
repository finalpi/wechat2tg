/* eslint-disable @typescript-eslint/no-var-requires */
const {test} = require('node:test'),assert = require('node:assert/strict')
const fs = require('node:fs'),os = require('node:os'),path = require('node:path'),vm = require('node:vm'),http = require('node:http')
const {once} = require('node:events'),{Telegraf} = require('telegraf')
const {TelegramDisplayPolicy} = require('../dist/util/TelegramDisplayPolicy')
const {WECHAT_CUSTOM_EMOJI} = require('../dist/util/WechatCustomEmojiData')
const plain = value=>JSON.parse(JSON.stringify(value))
function load(file,dependencies){
  const exports = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),{
    exports,Buffer,setTimeout,clearTimeout,console,require:name=>{
      assert(Object.hasOwn(dependencies,name),`Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  },{filename:file})
  return exports
}
function multipartFields(request,body){
  const boundary = /boundary=([^;]+)/.exec(request.headers['content-type'])[1]
  const fields = {}
  for(const part of body.toString('utf8').split(`--${boundary}`)){
    const match = /name="([^"]+)"/.exec(part)
    if(match)fields[match[1]] = part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/,'')
  }
  for(const key of ['reply_markup','reply_parameters'])if(fields[key])fields[key] = JSON.parse(fields[key])
  return fields
}

for(const missingEmojiEntities of [false,true]){
  test(`real Telegraf photo wire keeps the red-packet button${missingEmojiEntities ? ' through accepted-caption repair' : ''}`,async t=>{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'red-packet-wire-'))
    const policy = new TelegramDisplayPolicy(path.join(directory,'display.json'),'enhanced')
    const calls = []
    const [alias,emoji] = Object.entries(WECHAT_CUSTOM_EMOJI)[0]
    const server = http.createServer(async(request,response)=>{
      const chunks = [];for await(const chunk of request)chunks.push(chunk)
      const body = Buffer.concat(chunks)
      calls.push({method:request.url.split('/').pop(),fields:request.headers['content-type'].startsWith('multipart/') ? multipartFields(request,body) : JSON.parse(body)})
      response.writeHead(200,{'content-type':'application/json'})
      response.end(JSON.stringify({ok:true,result:{message_id:123,date:0,chat:{id:-100,type:'supergroup'},caption:missingEmojiEntities ? emoji.emoji : 'red packet',caption_entities:[]}}))
    })
    server.listen(0,'127.0.0.1');await once(server,'listening')
    t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true})})
    const bot = new Telegraf('123:synthetic-test-only',{telegram:{apiRoot:`http://127.0.0.1:${server.address().port}`}})
    const {TelegramBotApiMessageSender} = load('message/TelegramBotApiMessageSender.js',{
      './MessageSender':{MessageSender:class {sendAction(){return undefined}}},
      '../config':{config:{WECHAT_CUSTOM_EMOJI_ENABLED:missingEmojiEntities}},
      '../util/TelegramKeyboard':require('../dist/util/TelegramKeyboard'),
      '../util/TelegramMedia':require('../dist/util/TelegramMedia'),
      '../util/TelegramPresentation':require('./helpers/telegram-presentation')({policy}),
      'abort-controller':require('abort-controller'),
    })
    const token = '0123456789abcdef0123456789abcdef',registrations = []
    const {decorateRedPacketMessage} = load('util/RedPacketMessage.js',{
      './FormatUtils':{FormatUtils:{escapeHtml:value=>value}},
      './WechatRedPacket':require('../dist/util/WechatRedPacket'),
      '../service/RedPacketService':{redPacketButtonText:require('../dist/service/RedPacketService').redPacketButtonText,redPacketService:()=>({register:async input=>{registrations.push(input);return {token,canOpen:true,state:'ready'}}})},
    })
    const source = '<msg><appmsg><type>2001</type><wcpayinfo><receivertitle>恭喜发财，大吉大利</receivertitle><paymsgid>synthetic123</paymsgid><nativeurl>wxpay://c2cbizmessagehandler/hongbao/receivehongbao?sendid=synthetic123</nativeurl><senderc2cshowsourceurl>https://wx.gtimg.com/banner.png</senderc2cshowsourceurl><recshowsourceurl>https://wx.gtimg.com/unopened.png</recshowsourceurl><detailshowsourceurl>https://wx.gtimg.com/opened.png</detailshowsourceurl></wcpayinfo></appmsg></msg>'
    const message = {id:'test-message',chatId:-100,threadId:42,conversationWxId:'test@chatroom',param:{reply_id:91}}
    await decorateRedPacketMessage(message,source,'synthetic-self',true)
    assert.equal(registrations.length,1)
    assert.equal(message.redPacket.coverUrl,'https://wx.gtimg.com/unopened.png')
    assert.equal(message.content,'恭喜发财，大吉大利','only the blessing, with no instructions or extra notice')
    const keyboard = {inline_keyboard:[[{text:'拆红包',callback_data:`rpo:${token}`}]]}
    const sender = new TelegramBotApiMessageSender(bot)
    const result = await sender.sendFile(message.chatId,{buff:Buffer.from('synthetic-photo-bytes'),filename:'packet.jpg',fileType:'photo',caption:missingEmojiEntities ? alias : message.content},
      {...message.param,message_thread_id:message.threadId,parse_mode:'HTML'})
    assert.deepEqual(plain(result),{message_id:123})
    assert.equal(calls.length,missingEmojiEntities ? 2 : 1)
    assert.equal(calls[0].method,'sendPhoto')
    assert.equal(calls[0].fields.chat_id,'-100')
    assert.equal(calls[0].fields.message_thread_id,'42')
    assert.deepEqual(calls[0].fields.reply_parameters,{message_id:91})
    assert.deepEqual(calls[0].fields.reply_markup,keyboard)
    assert.equal(calls[0].fields.photo,'synthetic-photo-bytes')
    if(missingEmojiEntities){
      assert.equal(calls[1].method,'editMessageCaption')
      assert.equal(calls[1].fields.message_id,123)
      assert.deepEqual(calls[1].fields.reply_markup,keyboard)
      assert(!calls[1].fields.caption.includes('<tg-emoji'))
    }
  })
}