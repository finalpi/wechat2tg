import { TelegramClient } from './client/TelegramClient'
import { WeChatClient } from './client/WechatClient'


const bot = new TelegramClient()
bot.init()


new WeChatClient(bot)