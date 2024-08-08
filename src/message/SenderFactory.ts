import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {Telegraf} from 'telegraf'
import {MessageSender} from './MessageSender'
import {TelegramApiMessageSender} from './TelegramApiMessageSender'
import {TelegramBotApiMessageSender} from './TelegramBotApiMessageSender'

export class SenderFactory {
    createSender(bot: GramClient | Telegraf): MessageSender {
        if (bot instanceof GramClient) {
            return new TelegramApiMessageSender(bot)
        } else if (bot instanceof Telegraf) {
            return new TelegramBotApiMessageSender(bot)
        }
    }
}