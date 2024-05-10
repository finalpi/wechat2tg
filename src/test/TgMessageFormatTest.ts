import {Markup, Telegraf} from 'telegraf'
import {config} from '../config'

const bot = new Telegraf(config.BOT_TOKEN)

bot.use(Telegraf.log())

bot.command('md1', (ctx) => {
    ctx.reply('Okok[苦涩]',{
        parse_mode: 'HTML',
    })
})

bot.launch()