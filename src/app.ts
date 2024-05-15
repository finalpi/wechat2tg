import { TelegramBotClient } from './client/TelegramBotClient'
import { WeChatClient } from './client/WechatClient'


const bot = new TelegramBotClient()
bot.init()


new WeChatClient(bot)