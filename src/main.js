import TelegramBot from 'node-telegram-bot-api'
import { wechatBot } from './wechaty/WechatyUtils.js'
import QRCode from 'qrcode'
import fs from 'fs'
import { loadConfig, saveConfig } from './cache/CacheUtil.js'
import dotenv from 'dotenv'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { FileBox } from 'file-box'

dotenv.config()

const BOT_TOKEN = process.env.BOT_TOKEN
const PROTOCOL = process.env.PROTOCOL
const HOST = process.env.HOST
const PORT = process.env.PORT
const USERNAME = process.env.USERNAME
const PASSWORD = process.env.PASSWORD

const proxyConfig = {
  host: HOST, // 代理服务器的主机名或 IP 地址
  port: PORT, // 代理服务器的端口号
  username: USERNAME, // 如果代理需要身份验证，可以设置用户名
  password: PASSWORD, // 如果代理需要身份验证，可以设置密码
  protocol: PROTOCOL // 协议类型:http,https,socks5
}

const info = {
  hostname: HOST,
  port: PORT,
  userId: USERNAME,
  password: PASSWORD
}

// 使用SocksProxyAgent设置代理
const agent = new SocksProxyAgent(info)

let telegramBot
// 创建 Bot 实例，并传入代理配置
if (HOST !== null && HOST !== '' && PORT !== null && PORT !== '' & PROTOCOL != null && PROTOCOL === 'socks5') {
  telegramBot = new TelegramBot(BOT_TOKEN, {
    polling: true,
    request: {
      agent,
      retryAfter: 5000
    }
  })
} else if (HOST != null && HOST !== '' && PORT != null && PORT !== '' & PROTOCOL != null && (PROTOCOL === 'http' || PROTOCOL === 'https')) {
  telegramBot = new TelegramBot(BOT_TOKEN, {
    polling: true,
    request: {
      proxy: `${proxyConfig.protocol}://${proxyConfig.username}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`,
      retryAfter: 5000
    }
  })
} else {
  telegramBot = new TelegramBot(BOT_TOKEN, {
    polling: true,
    request: {
      retryAfter: 5000
    }
  })
}

telegramBot.on('polling_error', (error) => {
  console.log(new Date().toLocaleString(),error.code);  // => 'EFATAL'
});

// 登陆二维码链接
let loginQrCode = ''
// 缓存配置
let cache = await loadConfig()
// 初始化时间
const startDate = new Date()
// 发送者数组
const sender = []
// 自动回复开关
let autoReply = cache.autoReply
if (autoReply === undefined) {
  autoReply = false
  saveConfig('autoReply', autoReply)
}
// 自动回复联系人
let autoTalker

// 登录过期检测
let expireDetection

// 首次检测flag
let startFlag = true

// 群消息搜索开关
let groupSwitch = false

// 群组列表
let addGroupList = []

function expireFunction1 () {
  expireDetection = setInterval(() => {
    if (!wechatBot.isLoggedIn && startFlag) {
      telegramBot.sendMessage(cache.chatId, '程序加载成功,请登陆!')
      startFlag = false
      clearInterval(expireDetection)
    }
  }, 10000)
}

function expireFunction2 () {
  expireDetection = setInterval(() => {
    if (!wechatBot.isLoggedIn) {
      telegramBot.sendMessage(cache.chatId, '登录已过期,请重新登录!')
      clearInterval(expireDetection)
    }
  }, 10000)
}

expireFunction1()

// 已登录指令数组
const commands = [
  { command: 'login', description: '获取微信登陆二维码' },
  { command: 'reply', description: '回复消息' },
  { command: 'auto', description: '自动回复开关' },
  { command: 'group', description: '设置群消息白名单' },
  { command: 'cgroup', description: '取消群消息白名单' }
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
    if (cache.chatId !== '' && wechatBot.isLoggedIn) {
      telegramBot.sendMessage(cache.chatId, '登陆成功!')
    }
    expireFunction2()
  })
  .on('message', async message => {
    // 获取发送者
    const talkerContact = message.talker()
    let msgStr = talkerContact.name() + ':\n'
    const fromRoom = message.room()
    // 群聊未提及消息不转发,以及自己发送的消息不转发
    if (message.self() || (fromRoom != null && !await message.mentionSelf() && (fromRoom != null && cache.whiteList !== undefined && !cache.whiteList.includes(await fromRoom.topic()))) || message.date() < startDate || talkerContact.type() === 2) {
      return
    }
    if (fromRoom != null) {
      msgStr = talkerContact.name() + '(' + await fromRoom.topic() + '):\n'
      // 保存发送者
      const element = {
        name: await fromRoom.topic(),
        type: 0,
        id: fromRoom.id,
        talker: fromRoom
      }
      const index = sender.findIndex(e => e.id === element.id)
      if (index !== -1) {
        sender.splice(index, 1)
        sender.unshift(element)
      } else {
        sender.unshift(element)
      }
      autoTalker = element.talker
    } else {
      // 保存发送者
      const element = {
        name: talkerContact.name(),
        type: 1,
        id: talkerContact.id,
        talker: talkerContact
      }
      const index = sender.findIndex(e => e.id === element.id)
      if (index !== -1) {
        sender.splice(index, 1)
        sender.unshift(element)
      } else {
        sender.unshift(element)
      }
      autoTalker = element.talker
    }
    if (message.type() === wechatBot.Message.Type.Text) {
      // 文字消息处理
      //处理换行符和表情
      let text = message.text().replace(/<br\/>/g, "\n").replace(/<img[^>]*text="\[([^\]]+)\]_web"[^>]*>/g, '($1)');
      telegramBot.sendMessage(cache.chatId, msgStr + text)
    } else if (message.type() === wechatBot.Message.Type.Image) {
      // 图片消息处理
      const image = message.toImage()
      const fileBox = await image.artwork()
      const fileName = fileBox.name
      await fileBox.toFile(fileName, true)
      telegramBot.sendPhoto(cache.chatId, fileName, { caption: msgStr }).then(() => {
        fs.unlink(fileName, (err) => {
          if (err) throw err
          console.log('已成功删除文件')
        })
      })
    } else if (message.type() === wechatBot.Message.Type.Audio) {
      // 语音消息处理
      const fileBox = await message.toFileBox()
      const fileName = fileBox.name
      await fileBox.toFile(fileName, true)
      telegramBot.sendVoice(cache.chatId, fileName, { caption: msgStr }).then(() => {
        fs.unlink(fileName, (err) => {
          if (err) throw err
          console.log('已成功删除文件')
        })
      })
    } else if (message.type() === wechatBot.Message.Type.Video) {
      // 视频消息处理
      const fileBox = await message.toFileBox()
      const fileName = fileBox.name
      await fileBox.toFile(fileName, true)
      telegramBot.sendVideo(cache.chatId, fileName, { caption: msgStr }).then(() => {
        fs.unlink(fileName, (err) => {
          if (err) throw err
          console.log('已成功删除文件')
        })
      })
    } else if (message.type() === wechatBot.Message.Type.Attachment) {
      // 附件处理
      const fileBox = await message.toFileBox()
      const fileName = fileBox.name
      telegramBot.sendMessage(cache.chatId, msgStr + '[文件]' + fileName)
    }
  })

wechatBot.start()

let errorFlag = false

wechatBot.on('error', async (e) => {
  if (!errorFlag) {
    errorFlag = true
    telegramBot.sendMessage(cache.chatId, '遇到未知错误程序终止:' + e)
  }
})

// 监听 'login' 指令
telegramBot.onText(/\/login/, (msg) => {
  // 将scan回调的二维码文件发给用户
  const chatId = msg.chat.id
  // 保存chatId到配置文件
  saveConfig('chatId', chatId).then(async () => {
    cache = await loadConfig()
  })
  QRCode.toFile(msg.chat.id + 'qrCode.png', loginQrCode, () => {
    telegramBot.sendPhoto(chatId, fs.createReadStream(msg.chat.id + 'qrCode.png'), { caption: '扫描二维码登陆' })
  })
})

// 监听 'reply' 指令
telegramBot.onText(/\/reply/, (msg) => {
  const chatId = msg.chat.id
  if (sender.length === 0) {
    telegramBot.sendMessage(chatId, '目前没有可回复的成员')
    return
  }
  const keyboard = []
  sender.slice(0, 5).forEach(item => {
    const iItem = []
    iItem.push({ text: item.name.substring(0, 20), callback_data: item.type + ':' + item.name.substring(0, 20) })
    keyboard.push(iItem)
  })

  const options = {
    reply_markup: {
      inline_keyboard: keyboard
    }
  }

  telegramBot.sendMessage(chatId, '请选择回复成员', options)
})

// 监听 'autoReply' 指令
telegramBot.onText(/\/auto/, (msg) => {
  const chatId = msg.chat.id

  if (autoReply) {
    autoReply = false
    telegramBot.sendMessage(chatId, '关闭自动回复')
    replyOpen = false
  } else {
    autoReply = true
    telegramBot.sendMessage(chatId, '开启自动回复')
  }
  saveConfig('autoReply', autoReply)
})

/**
 * 点击事件接受
 */
let replyOpen = false
let talker
telegramBot.on('callback_query', async (callbackQuery) => {
  const data = callbackQuery.data
  if (data.includes('#101@')) {
    cache = await loadConfig()
    const dataList = data.split('#101@')
    const topic = await addGroupList[dataList[1]].topic()
    if (cache.whiteList === undefined) {
      saveConfig('whiteList', topic)
    } else if (!cache.whiteList.includes(topic)) {
      saveConfig('whiteList', cache.whiteList + ',' + topic)
    }
    cache = await loadConfig()
    telegramBot.sendMessage(cache.chatId, '成功添加群:' + topic + '到白名单')
  } else if (data.includes('#102@')) {
    cache = await loadConfig()
    const dataList = data.split('#102@')
    const whiteList = cache.whiteList.split(',')
    whiteList.splice(dataList[1] ,1)
    const listStr = whiteList.join(',')
    saveConfig('whiteList', listStr)
    cache = await loadConfig()
    telegramBot.sendMessage(cache.chatId, '操作成功')
  } else {
    const dataArr = data.split(':')
    if (dataArr[0] === '0') {
      const index = sender.findIndex(e => e.name.includes(dataArr[1]))
      if (index !== -1) {
        const item = sender[index]
        talker = wechatBot.Room.load(item.id)
        if (autoReply) {
          autoTalker = wechatBot.Room.load(item.id)
          telegramBot.sendMessage(cache.chatId, '当前回复用户:' + autoTalker.name())
        }
      }
    } else {
      const index = sender.findIndex(e => e.name.includes(dataArr[1]))
      if (index !== -1) {
        const item = sender[index]
        talker = item.talker
        if (autoReply) {
          autoTalker = item.talker
          telegramBot.sendMessage(cache.chatId, '当前回复用户:' + autoTalker.name())
        }
      }
    }
    replyOpen = true
    telegramBot.sendMessage(cache.chatId, '请输入要回复的消息')
  }
})

/**
 * 回复消息
 */
telegramBot.on('message', async (msg) => {
  if (msg.text && msg.text.indexOf('/') !== -1) {
    return
  }
  if (groupSwitch) {
    groupSwitch = false
    const roomList = await wechatBot.Room.findAll({ topic: msg.text })
    if (roomList.length === 0) {
      telegramBot.sendMessage(cache.chatId, '未找到群组')
      return
    }
    const keyboard = []
    for (let i = 0; i < roomList.length; i++) {
      const title = await roomList[i].topic()
      const iItem = []
      iItem.push({ text: title.substring(0, 20), callback_data: '#101@' + i })
      keyboard.push(iItem)
    }

    const options = {
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
    addGroupList = roomList
    telegramBot.sendMessage(cache.chatId, '请选择群组', options)
    return
  }
  if (!replyOpen && !autoReply) {
    return
  }
  if (autoReply) {
    talker = autoTalker
  }
  if (talker === undefined) {
    return
  }
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id
    telegramBot.downloadFile(fileId, './').then(async (filePath) => {
      const fileBox = FileBox.fromFile(filePath)
      await talker.say(fileBox)
      fs.unlink(filePath, (err) => {
        if (err) throw err
        console.log('已成功删除文件')
      })
    })
  }

  if (msg.sticker) {
    const fileId = msg.sticker.file_id
    telegramBot.downloadFile(fileId, './').then(async (filePath) => {
      const fileBox = FileBox.fromFile(filePath)
      await talker.say(fileBox)
      fs.unlink(filePath, (err) => {
        if (err) throw err
        console.log('已成功删除文件')
      })
    })
  }

  if (msg.text) {
    await talker.say(msg.text)
  }
  replyOpen = false
  telegramBot.sendMessage(cache.chatId, '回复成功')
})

// 监听 '群消息白名单' 指令
telegramBot.onText(/\/group/, (msg) => {
  const chatId = msg.chat.id
  groupSwitch = true
  telegramBot.sendMessage(chatId, '请输入需要加入白名单的群名称')
})

// 监听 '取消群消息白名单' 指令
telegramBot.onText(/\/cgroup/, (msg) => {
  const chatId = msg.chat.id
  const whiteList = cache.whiteList.split(',')
  const keyboard = []
  for (let i = 0; i < whiteList.length; i++) {
    const iItem = []
    iItem.push({ text: whiteList[i], callback_data: '#102@' + i })
    keyboard.push(iItem)
  }

  const options = {
    reply_markup: {
      inline_keyboard: keyboard
    }
  }
  telegramBot.sendMessage(chatId, '请选择需要取消白名单的群名称', options)
})
