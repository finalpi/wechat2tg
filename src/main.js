import TelegramBot from 'node-telegram-bot-api'
import { wechatBot } from './wechaty/WechatyUtils.js'
import QRCode from 'qrcode';
import fs from 'fs';
import {loadConfig, saveConfig} from "./cache/CacheUtil.js";
import dotenv from 'dotenv';

dotenv.config()

const BOT_TOKEN = process.env.BOT_TOKEN
const PROTOCOL=process.env.PROTOCOL;
const HOST=process.env.HOST;
const PORT=process.env.PORT;
const USERNAME=process.env.USERNAME;
const PASSWORD=process.env.PASSWORD;

// 设置代理配置
const proxyConfig = {
    host: HOST, // 代理服务器的主机名或 IP 地址
    port: PORT, // 代理服务器的端口号
    username: USERNAME, // 如果代理需要身份验证，可以设置用户名
    password: PASSWORD, // 如果代理需要身份验证，可以设置密码
    protocol: PROTOCOL //协议类型:http,https,socks5
}
let telegramBot
// 创建 Bot 实例，并传入代理配置
if (HOST != null && HOST != '' && PORT != null && PORT != '' & PROTOCOL != null && PROTOCOL != ''){
    telegramBot = new TelegramBot(BOT_TOKEN, {
        polling: true,
        request: {
            proxy: `${proxyConfig.protocol}://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`,
            retryAfter: 5000
        }
    })
}else {
    telegramBot = new TelegramBot(BOT_TOKEN, {
        polling: true
    })
}

// 登陆二维码链接
let loginQrCode = ''
//缓存配置
let cache = await loadConfig()
//初始化时间
let startDate = new Date()

//登录过期检测
let expireDetection;
function expireFunction1(){
    expireDetection = setInterval(()=>{
        if (!wechatBot.logonoff()){
            telegramBot.sendMessage(cache.chatId,"程序加载成功,请登陆!")
            clearInterval(expireDetection)
        }
    }, 10000);
}

function expireFunction2(){
    expireDetection = setInterval(()=>{
        if (!wechatBot.logonoff()){
            telegramBot.sendMessage(cache.chatId,"登录已过期,请重新登录!")
            clearInterval(expireDetection)
        }
    }, 10000);
}

expireFunction1()

// 已登录指令数组
const commands = [
    { command: 'login', description: '获取微信登陆二维码' },
]

telegramBot.setMyCommands(commands)
    .then(() => {
        console.log('Bot 指令设置成功')
    })
    .catch((error) => {
        console.error('设置 Bot 指令失败：', error)
    })


// wechaty实例创建
wechatBot
  .on('scan', (qrcode, status) => {
    loginQrCode = qrcode
  })
  .on('login', user => {
      if (cache.chatId != ''){
          telegramBot.sendMessage(cache.chatId,"登陆成功!")
      }
      expireFunction2()
  })
  .on('message', async message => {
      //获取发送者
      const talkerContact = message.talker()
      let msgStr = talkerContact.name() + "___(" + await talkerContact.alias() + "):\n"
      const fromRoom = message.room()
      if (fromRoom != null){
          msgStr = talkerContact.name() + "___(" + await fromRoom.topic() + "):\n"
      }
      //群聊未提及消息不转发,以及自己发送的消息不转发
      if (message.self() || (fromRoom != null && ! await message.mentionSelf()) || message.date() < startDate){
          return
      }
      if (message.type() === wechatBot.Message.Type.Text) {
          //文字消息处理
          telegramBot.sendMessage(cache.chatId,msgStr + message.text())
      }else if (message.type() === wechatBot.Message.Type.Image){
          //图片消息处理
          const image = message.toImage()
          const fileBox = await image.artwork()
          const fileName = fileBox.name
          await fileBox.toFile(fileName,true)
          telegramBot.sendPhoto(cache.chatId,fileName,{caption: msgStr}).then(()=>{
              fs.unlink(fileName, (err) => {
                  if (err) throw err;
                  console.log('已成功删除文件');
              });
          })
      }else if (message.type() === wechatBot.Message.Type.Audio){
          //语音消息处理
          const fileBox = await message.toFileBox()
          const fileName = fileBox.name
          await fileBox.toFile(fileName,true)
          telegramBot.sendVoice(cache.chatId,fileName,{caption: msgStr}).then(()=>{
              fs.unlink(fileName, (err) => {
                  if (err) throw err;
                  console.log('已成功删除文件');
              });
          })
      }else if (message.type() === wechatBot.Message.Type.Video){
          //视频消息处理
          const fileBox = await message.toFileBox()
          const fileName = fileBox.name
          await fileBox.toFile(fileName,true)
          telegramBot.sendVideo(cache.chatId,fileName,{caption: msgStr}).then(()=>{
              fs.unlink(fileName, (err) => {
                  if (err) throw err;
                  console.log('已成功删除文件');
              });
          })
      }
  })

wechatBot.start()

// 监听 'login' 指令
telegramBot.onText(/\/login/, (msg) => {
  //将scan回调的二维码文件发给用户
    const chatId = msg.chat.id;
    //保存chatId到配置文件
    saveConfig("chatId",chatId).then(async ()=>{
        cache = await loadConfig()
    })
    QRCode.toFile(msg.chat.id + 'qrCode.png', loginQrCode, (err, data) => {
        telegramBot.sendPhoto(chatId, fs.createReadStream(msg.chat.id + 'qrCode.png'), {caption: '扫描二维码登陆'});
    })
})

