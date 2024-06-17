import {TelegramBotClient} from './client/TelegramBotClient'
import {WeChatClient} from './client/WechatClient'
import {LogUtils} from './utils/LogUtils'

process.on('uncaughtException', (err) => {
    LogUtils.config().getLogger('error').error('wechat2Tg uncaughtException', err)
})

const bot = TelegramBotClient.getInstance()
bot.init()