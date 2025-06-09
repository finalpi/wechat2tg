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
            {command: 'logout', description: '退出登录并清空缓存'},
            // {command: 'flogin', description: '登录文件传输助手接收文件消息'},
            {command: 'update', description: '更新群组头像和名称'},
            {command: 'add', description: '根据手机号添加好友，在后面加上你需要添加用户的手机号'},
            {command: 'message', description: '是否接收该群组消息'},
            {command: 'forward', description: '是否转发群组内其他人的消息'},
            {command: 'revoke', description: '撤回消息'},
            {command: 'settings', description: '程序设置'},
            {command: 'user', description: '查看联系人'},
            {command: 'room', description: '查看微信群'},
            {command: 'getqr', description: '获取我的二维码名片'},
            {command: 'unbind', description: '解绑群组'},
            {command: 'quit', description: '退出并解绑群组'},
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
        // setupUserCommand(bot)
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