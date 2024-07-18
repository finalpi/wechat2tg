import {TelegramBotClient} from './client/TelegramBotClient.js'
import {LogUtils} from './utils/LogUtils.js'

process.on('uncaughtException', (err) => {
    LogUtils.config().getLogger('error').error('wechat2Tg uncaughtException', err)
})

const bot = TelegramBotClient.getInstance()
bot.init()