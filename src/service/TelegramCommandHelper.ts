import {Telegraf} from 'telegraf'
import {LogUtils} from '../util/LogUtil'
import {WxContactRepository} from '../repository/WxContactRepository'
import {initBot, setupUserCommand} from '../util/PageHelper'
import I18n from '../i18n'

export default class TgCommandHelper {

    public static setCommand(bot: Telegraf) {
        const i18n = I18n.getInstance()

        const commands = [
            {command: 'help', description: i18n.t('command.help')},
            {command: 'start', description: i18n.t('command.start')},
            {command: 'login', description: i18n.t('command.login')},
            {command: 'logout', description: i18n.t('command.logout')},
            // {command: 'flogin', description: i18n.t('command.flogin')},
            {command: 'update', description: i18n.t('command.update')},
            {command: 'add', description: i18n.t('command.add')},
            {command: 'message', description: i18n.t('command.message')},
            {command: 'forward', description: i18n.t('command.forward')},
            {command: 'revoke', description: i18n.t('command.revoke')},
            {command: 'settings', description: i18n.t('command.settings')},
            {command: 'user', description: i18n.t('command.user')},
            {command: 'room', description: i18n.t('command.room')},
            {command: 'getqr', description: i18n.t('command.getqr')},
            {command: 'unbind', description: i18n.t('command.unbind')},
            {command: 'quit', description: i18n.t('command.quit')},
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