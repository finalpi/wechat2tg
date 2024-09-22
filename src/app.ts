import {TelegramBotClient} from './client/TelegramBotClient'
import {LogUtils} from './util/LogUtils'

process.on('uncaughtException', (err) => {
    LogUtils.config().getLogger('error').error('wechat2Tg uncaughtException', err)
})

TelegramBotClient.getInstance().start()