import {TelegramBotClient} from './client/TelegramBotClient'
import {WeChatClient} from './client/WechatClient'


const bot = TelegramBotClient.getInstance()
bot.init()


new WeChatClient(bot)