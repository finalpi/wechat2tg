import {TelegramClient as GramClient} from 'telegram/client/TelegramClient.js'
import {Telegraf} from 'telegraf'
import {MessageSender} from './MessageSender.js'
import {TelegramApiMessageSender} from './TelegramApiMessageSender.js'
import {TelegramBotApiMessageSender} from './TelegramBotApiMessageSender.js'

export class SenderFactory {
    createSender(bot: GramClient | Telegraf): MessageSender {
        if (bot instanceof GramClient) {
            return new TelegramApiMessageSender(bot)
        } else if (bot instanceof Telegraf) {
            return new TelegramBotApiMessageSender(bot)
        }
    }
}