import {Telegraf} from 'telegraf'
import {LogUtils} from '../util/LogUtil'
import {WxContactRepository} from '../repository/WxContactRepository'
import {initBot, setupUserCommand} from '../util/PageHelper'

export default class TgCommandHelper {

    public static setCommand(bot: Telegraf) {
        const commands = [
            {command: 'help', description: '帮助'},
            {command: 'start', description: '开始'},
            {command: 'login', description: '登录'},
            {command: 'flogin', description: '登录文件传输助手接收文件消息'},
            {command: 'update', description: '更新群组头像和名称'},
            {command: 'settings', description: '程序设置'},
            {command: 'user', description: '查看联系人'},
            {command: 'room', description: '查看群组'},
        ]

        bot.telegram.setMyCommands(commands).then(r => {
            LogUtils.debugLog().debug('set commands success %s', r)
        })
    }

    public static setCommandHandler(bot: Telegraf, ...commands: Array<{
        command: string,
        handler: (ctx: any) => void
    }>) {
        commands.forEach(c => {
            bot.command(c.command, c.handler)
        })
    }

    public static setSimpleCommandHandler(bot: Telegraf) {
        // this.user(bot)
        // FIXME: JUST TEST
        setupUserCommand(bot)
        initBot(bot)
    }

    private static user(bot: Telegraf) {
        bot.command('user', (ctx) => {
            const name = ctx.args[0] ? ctx.args[0] : ''
            WxContactRepository.getInstance().pageByName(name, {pageNo: 1, pageSize: 10}).then(page => {
                page.data.forEach(c => {
                    ctx.reply(`name: ${c.userName}, nickName: ${c.nickName}, userName: ${c.userName}`)
                })
            })
        })
    }
}