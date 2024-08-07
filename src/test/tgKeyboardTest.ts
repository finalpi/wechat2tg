import {Markup, Telegraf} from 'telegraf'
import {config} from '../config'

const bot = new Telegraf(config.BOT_TOKEN)

bot.use(Telegraf.log())

let page1Number = 0

// 假设你有一个包含数据的数组
const data = [
    {id: '@1e3aed3e5b94ba04a83243830cbb0522f89df2aaa08721ee2bad25be2d17f907', name: '&＃x2F_|'},
    {id: '@1', name: 'Item 1'},
    {id: '@2', name: 'Item 2'},
    {id: '@3', name: 'Item 3'},
    {id: '@4', name: 'Item 4'},
    {id: '@5', name: 'Item 5'},
    {id: '@6', name: 'Item 6'},
    {id: '@7', name: 'Item 7'},
    {id: '@8', name: 'Item 8'},
    {id: '@9', name: 'Item 9'},
    {id: '@10', name: 'Item 10'},
    {id: '@11', name: 'Item 11'},
    {id: '@12', name: 'Item 12'},
    {id: '@13', name: 'Item 13'},
]

function pageDataButtons(source: { id: string, name: string }[], page: number, pageSize: number, lines: number) {
    const start = page * pageSize
    const end = start + pageSize
    const slice = source.slice(start, end)

    const nextButton = Markup.button.callback('下一页', `next-${page}`)
    const pervButton = Markup.button.callback('上一页', `perv-${page}`)

    const buttons = []
    for (let i = 0; i < slice.length; i += lines) {
        const row = []
        for (let j = i; j < i + lines && j < slice.length; j++) {
            const id = slice[j].id
            const asciiId = utf8ToAscii(id)
            row.push(Markup.button.callback(slice[j].name, asciiId))
        }
        buttons.push(row)
    }
    // console.warn('buttons', buttons)
    if (start == 0) {
        buttons.push([nextButton])
    } else if (end < source.length) {
        buttons.push([pervButton, nextButton])
    } else {
        buttons.push([pervButton])
    }
    console.log(buttons)
    return buttons
}

bot.command('page', (ctx) => {
    ctx.replyWithHTML('<b>请选择联系人: </b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            ...pageDataButtons(data, page1Number, 4, 2),
        ])
    })
})

bot.action(/(next-|perv-)(\d+)/, (ctx) => {
    page1Number = parseInt(ctx.match[2])
    // let callback = Markup.button.callback('张三', '@1');
    const nextPageNum = ctx.match[1] === 'next-' ? page1Number += 1 : page1Number -= 1
    ctx.editMessageReplyMarkup({
        inline_keyboard: [
            ...pageDataButtons(data, nextPageNum, 4, 2)
        ]
    })
    // ctx.replyWithHTML('<b>请选择联系人: </b>',);
})

bot.action(/@/, (ctx) => {
    return ctx.reply('你选择了' + ctx.match.input)
})

bot.command('onetime', (ctx) =>
    ctx.reply('One time keyboard', Markup
        .keyboard(['/simple', '/inline', '/pyramid'])
        .oneTime()
        .resize()
    )
)

bot.command('custom', async (ctx) => {
    return await ctx.reply('Custom buttons keyboard', Markup
        .keyboard([
            ['🔍 Search', '😎 Popular'], // Row1 with 2 buttons
            ['☸ Setting', '📞 Feedback'], // Row2 with 2 buttons
            ['📢 Ads', '⭐️ Rate us', '👥 Share'] // Row3 with 3 buttons
        ])
        .oneTime()
        .resize()
    )
})

bot.hears('🔍 Search', ctx => ctx.reply('Yay!'))
bot.hears('📢 Ads', ctx => ctx.reply('Free hugs. Call now!'))

bot.command('special', (ctx) => {
    return ctx.reply(
        'Special buttons keyboard',
        Markup.keyboard([
            Markup.button.contactRequest('Send contact'),
            Markup.button.locationRequest('Send location')
        ]).resize()
    )
})

bot.command('pyramid', (ctx) => {
    return ctx.reply(
        'Keyboard wrap',
        Markup.keyboard(['one', 'two', 'three', 'four', 'five', 'six'], {
            wrap: (btn, index, currentRow) => currentRow.length >= (index + 1) / 2
        })
    )
})

bot.command('simple', (ctx) => {
    return ctx.replyWithHTML(
        '<b>Coke</b> or <i>Pepsi?</i>',
        Markup.keyboard(['Coke', 'Pepsi'])
    )
})

bot.command('inline', (ctx) => {
    return ctx.reply('<b>Coke</b> or <i>Pepsi?</i>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            Markup.button.callback('Coke', 'Coke'),
            Markup.button.callback('Pepsi', 'Pepsi')
        ])
    })
})

bot.command('inline2', (ctx) => {
    ctx.reply('Hi there!', {
        reply_markup: {
            inline_keyboard: [
                /* Inline buttons. 2 side-by-side */
                [{text: 'Button 1', callback_data: 'btn-1'}, {text: 'Button 2', callback_data: 'btn-2'}],

                /* One button */
                [{text: 'Next', callback_data: 'next2'}],

                /* Also, we can have URL buttons. */
                [{text: 'Open in browser', url: 'telegraf.org'}]
            ]
        }
    })
})

bot.command('random', (ctx) => {
    return ctx.reply(
        'random example',
        Markup.inlineKeyboard([
            Markup.button.callback('Coke', 'Coke'),
            Markup.button.callback('Dr Pepper', 'Dr Pepper', Math.random() > 0.5),
            Markup.button.callback('Pepsi', 'Pepsi')
        ])
    )
})

bot.command('caption', (ctx) => {
    return ctx.replyWithPhoto({url: 'https://picsum.photos/200/300/?random'},
        {
            caption: 'Caption',
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                Markup.button.callback('Plain', 'plain'),
                Markup.button.callback('Italic', 'italic')
            ])
        }
    )
})

bot.hears(/\/wrap (\d+)/, (ctx) => {
    return ctx.reply(
        'Keyboard wrap',
        Markup.keyboard(['one', 'two', 'three', 'four', 'five', 'six'], {
            columns: parseInt(ctx.match[1])
        })
    )
})

bot.action('Dr Pepper', (ctx, next) => {
    return ctx.reply('👍').then(() => next())
})

bot.action('plain', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.editMessageCaption('Caption', Markup.inlineKeyboard([
        Markup.button.callback('Plain', 'plain'),
        Markup.button.callback('Italic', 'italic')
    ]))
})

bot.action('italic', async (ctx) => {
    await ctx.answerCbQuery()
    await ctx.editMessageCaption('_Caption_', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            Markup.button.callback('Plain', 'plain'),
            Markup.button.callback('* Italic *', 'italic')
        ])
    })
})

bot.action(/.+/, (ctx) => {
    return ctx.answerCbQuery(`Oh, ${ctx.match[0]}! Great choice`)
})

bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))


// 将UTF-8字符串转换为ASCII编码
function utf8ToAscii(str: string) {
    let asciiStr = ''
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i)
        if (charCode < 128) {
            asciiStr += str[i]
        } else {
            asciiStr += '\\u' + charCode.toString(16).padStart(4, '0')
        }
    }
    return asciiStr
}

// 将ASCII编码转换为UTF-8字符串
function asciiToUtf8(str: string) {
    return str.replace(/\\u([a-fA-F0-9]{4})/g, function (match, grp) {
        return String.fromCharCode(parseInt(grp, 16))
    })
}