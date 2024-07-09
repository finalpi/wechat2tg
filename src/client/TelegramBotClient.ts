import {Context, Markup, NarrowedContext, session, Telegraf} from 'telegraf'
import {WeChatClient} from './WechatClient'
import {config} from '../config'
import {SimpleMessage, SimpleMessageSender} from '../models/Message'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import * as tg from 'telegraf/src/core/types/typegram'
import {message} from 'telegraf/filters'
import {FileBox, FileBoxType} from 'file-box'
import * as fs from 'node:fs'
import {NotionListType, NotionMode, StorageSettings, VariableContainer, VariableType} from '../models/Settings'
import {ConverterHelper} from '../utils/FfmpegUtils'
import {SelectedEntity} from '../models/TgCache'
import {TalkerEntity} from '../models/TalkerCache'
import {UniqueIdGenerator} from '../utils/IdUtils'
import {Page} from '../models/Page'
import {FileUtils} from '../utils/FileUtils'
import {ContactImpl, ContactInterface, MessageInterface, RoomInterface} from 'wechaty/impls'
import {CacheHelper} from '../utils/CacheHelper'
import * as PUPPET from 'wechaty-puppet'
import {TelegramClient} from './TelegramClient'
import {BindItemService} from '../service/BindItemService'
import {RoomItem} from '../models/RoomItem'
import {ContactItem} from '../models/ContactItem'
import {BindItem} from '../models/BindItem'
import {UserAuthParams} from 'telegram/client/auth'
import {EventEmitter} from 'node:events'
import {TelegramUserClient} from './TelegramUserClient'
import BaseClient from '../base/BaseClient'
import {MessageService} from '../service/MessageService'
import {MessageSender} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import {LockUtil} from '../utils/LockUtil'

export class TelegramBotClient extends BaseClient {
    get tgUserClient(): TelegramUserClient | undefined {
        return this._tgUserClient
    }

    get tgUserClientLogin(): boolean {
        return this._tgUserClientLogin
    }

    set tgUserClientLogin(value: boolean) {
        this._tgUserClientLogin = value
    }

    get bindItemService(): BindItemService {
        return this._bindItemService
    }

    get tgClient(): TelegramClient | undefined {
        return this._tgClient
    }

    private static instance: TelegramBotClient

    static getInstance(): TelegramBotClient {
        if (!TelegramBotClient.instance) {
            TelegramBotClient.instance = new TelegramBotClient()
        }
        return TelegramBotClient.instance
    }

    private _weChatClient: WeChatClient
    private _tgClient: TelegramClient | undefined
    private _tgUserClient: TelegramUserClient | undefined
    private _tgUserClientLogin = false
    private readonly _bot: Telegraf
    private _chatId: number | string
    private _ownerId: number
    private loginCommandExecuted = false
    private static PAGE_SIZE = 18
    private static LINES = 2
    private _selectedMember: SelectedEntity [] = []
    private _flagPinMessageType = ''
    private calcShowMemberListExecuted = false
    private selectRoom: ContactInterface | RoomInterface | undefined
    private _recentUsers: TalkerEntity [] = []
    private wechatStartFlag = false
    private searchList: any[] = []
    private botStartTime = new Date()
    private waitInputCommand: string | undefined = undefined
    private phoneNumber: string | undefined = undefined
    private password: string | undefined = undefined
    private phoneCode = ''
    private lock = new LockUtil()

    private forwardSetting: VariableContainer = new VariableContainer()

    private eventEmitter: EventEmitter

    // key this message id value weChat message id
    private _messageMap = new Map<number, string>()
    // 当前回复用户
    private _currentSelectContact: ContactInterface | RoomInterface | undefined
    // 置顶消息
    private pinnedMessageId: number | undefined
    private readonly _bindItemService: BindItemService
    private addBlackOrWhite: any[] = []
    private telegramApiSender: MessageSender
    private telegramBotApiSender: MessageSender


    private constructor() {
        super()
        this._weChatClient = new WeChatClient(this)
        this._bot = new Telegraf(config.BOT_TOKEN)
        this._bindItemService = new BindItemService(this._bot, this._weChatClient.client)
        this._chatId = 0
        this._ownerId = 0
        this._chatId = 0
        this.telegramBotApiSender = new SenderFactory().createSender(this._bot)
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: httpAgent
                }
            })
        } else {
            this._bot = new Telegraf(config.BOT_TOKEN)
        }
        // this._messageMap
        this.onWeChatLogout = this.onWeChatLogout.bind(this)
        this.onWeChatStop = this.onWeChatStop.bind(this)
        this.eventEmitter = new EventEmitter()

    }

    public get messageMap(): Map<number, string> {
        return this._messageMap
    }

    public set messageMap(value: Map<number, string>) {
        this._messageMap = value
    }

    public get bot(): Telegraf {
        return this._bot
    }

    public get setting(): VariableContainer {
        return this.forwardSetting
    }

    public get chatId(): number | string {
        return this._chatId
    }

    public get currentSelectContact(): ContactInterface | RoomInterface | undefined {
        return this._currentSelectContact
    }

    public async setCurrentSelectContact(value: MessageInterface | undefined) {
        if (value) {
            const room = value.room()
            if (room) {
                this.setPin('room', await room.topic())
                this.selectRoom = room
            } else {
                this._currentSelectContact = value.talker()
                const talker = value.talker()
                const alias = await talker.alias()
                if (alias) {
                    this.setPin('user', alias)
                } else {
                    this.setPin('user', talker.name())
                }
            }
        }
    }

    public get weChatClient(): WeChatClient {
        return this._weChatClient
    }

    get flagPinMessageType(): string {
        return this._flagPinMessageType
    }

    set flagPinMessageType(value: string) {
        this._flagPinMessageType = value
    }

    get selectedMember(): SelectedEntity[] {
        return this._selectedMember
    }

    set selectedMember(value: SelectedEntity[]) {
        this._selectedMember = value
    }

    get recentUsers(): TalkerEntity[] {
        return this._recentUsers
    }


    public init() {
        const bot = this._bot

        bot.use(session())

        // 加载转发配置
        this.loadForwardSettings()

        // language
        const language = this.forwardSetting.getVariable(VariableType.SETTING_LANGUAGE)
        this.setLanguage(language)

        // 初始化配置
        this.forwardSetting.writeToFile()

        const commands = [
            {command: 'help', description: this.t('command.description.help')},
            {command: 'start', description: this.t('command.description.start')},
            {command: 'login', description: this.t('command.description.login')},
            {command: 'user', description: this.t('command.description.user')},
            {command: 'room', description: this.t('command.description.room')},
            {command: 'recent', description: this.t('command.description.recent')},
            {command: 'settings', description: this.t('command.description.settings')},
            {command: 'check', description: this.t('command.description.check')},
            {command: 'bind', description: this.t('command.description.bind')},
            {command: 'unbind', description: this.t('command.description.unbind')},
            {command: 'cgdata', description: this.t('command.description.cgdata')},
            {command: 'reset', description: this.t('command.description.reset')},
            {command: 'stop', description: this.t('command.description.stop')},
            {command: 'lang', description: this.t('command.description.lang')},
        ]
        if (config.API_ID && config.API_HASH) {
            // 启动tg client
            if (!this._tgClient) {
                this._tgClient = TelegramClient.getInstance()
                this._tgUserClient = TelegramUserClient.getInstance()
                this.telegramApiSender = new SenderFactory().createSender(this._tgClient.client)
            }
            // 设置command
            commands.push({command: 'autocg', description: this.t('command.description.autocg')})
        } else {
            this.forwardSetting.setVariable(VariableType.SETTING_AUTO_GROUP, false)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
        }
        bot.telegram.setMyCommands(commands)

        bot.command('autocg', ctx => {
            if (!config.API_ID || !config.API_HASH) {
                ctx.reply(this.t('command.autocg.configApi'))
                return
            }
            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('common.plzLoginWeChat'))
                return
            }
            const b = this.forwardSetting.getVariable(VariableType.SETTING_AUTO_GROUP)
            const state = b ? this.t('common.open') : this.t('common.close')
            ctx.reply(`${this.t('command.autocg.configApi')}(${state}):`, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: this.t('common.clickChange'), callback_data: VariableType.SETTING_AUTO_GROUP},
                        ]
                    ]
                }
            })
        })

        bot.help((ctx) => ctx.replyWithMarkdownV2(this.t('command.helpText')))

        bot.start(ctx => {
            ctx.reply(this.t('command.startText'), Markup.removeKeyboard())
        })

        bot.on(message('group_chat_created'), ctx => {
            if (this._tgUserClientLogin) {
                return
            }
            ctx.reply(this.t('common.plzLoginWeChat'))
        })

        bot.on(message('left_chat_member'), ctx => {
            if (ctx.message.left_chat_member.id === ctx.botInfo.id) {
                this.bindItemService.removeBindItemByChatId(ctx.message.chat.id)
            }
        })

        bot.on(message('new_chat_members'), ctx => {
            for (const newChatMember of ctx.message.new_chat_members) {
                if (newChatMember.id === ctx.botInfo.id) {
                    ctx.reply(this.t('common.plzLoginWeChat'))
                }
            }
        })

        // 此方法需要放在所有监听方法之前,先拦截命令做处理
        bot.use(async (ctx, next) => {
            if (ctx.message) {
                const messageDate = new Date(ctx.message?.date * 1000)
                if (messageDate.getTime() < this.botStartTime.getTime()) {
                    return
                }
            }
            if (!this._chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === this._chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.callbackQuery && ctx.callbackQuery.from.id === this._chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && !ctx.callbackQuery && !ctx.message) {
                return
            }

            if (ctx.chat && this._chatId === ctx.chat.id) {
                return next() // 如果用户授权，则继续处理下一个中间件或命令
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            if (ctx.message && !ctx.message.from.is_bot) {
                return ctx.reply('Sorry, you are not authorized to interact with this bot.') // 如果用户未授权，发送提示消息
            }
        })

        // 重启时判断是否有主人,如果存在主人则自动登录微信
        const variables = this.forwardSetting.getAllVariables()
        if (variables.chat_id && variables.chat_id !== '') {
            this._chatId = variables.chat_id
            // this._bot.telegram.sendMessage(this._chatId, `程序开始初始化...`)
            // 找到置顶消息
            this.findPinMessage()
            if (!this.wechatStartFlag) {
                this.wechatStartFlag = true
                this._weChatClient.start().then(() => {

                    // 标记为已执行
                    this.loginCommandExecuted = true


                    this.logDebug('自动启动微信bot')
                }).catch(() => {
                    this.logError('自动启动失败')
                })
            }
        }

        bot.settings(ctx => {

            ctx.reply(this.t('command.settingsText'), {
                reply_markup: this.getSettingButton()
            })
        })

        // 数字键盘点击
        bot.action(/num-(\d+)/, ctx => {
            const match = ctx.match[1]
            if (match !== '100') {
                this.phoneCode = this.phoneCode + match
            } else {
                this.phoneCode = this.phoneCode.substring(0, this.phoneCode.length - 1)
            }
            let inputCode = this.phoneCode
            if (this.phoneCode.length < 5) {
                for (let i = 0; i < 5 - this.phoneCode.length; i++) {
                    inputCode = inputCode + '_ '
                }
            }
            ctx.editMessageText(this.t('command.autocg.inputVerificationCode', inputCode), {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: '1', callback_data: 'num-1'},
                            {text: '2', callback_data: 'num-2'},
                            {text: '3', callback_data: 'num-3'},
                        ],
                        [
                            {text: '4', callback_data: 'num-4'},
                            {text: '5', callback_data: 'num-5'},
                            {text: '6', callback_data: 'num-6'},
                        ],
                        [
                            {text: '7', callback_data: 'num-7'},
                            {text: '8', callback_data: 'num-8'},
                            {text: '9', callback_data: 'num-9'},
                        ],
                        [
                            {text: '0', callback_data: 'num-0'},
                            {text: 'Del', callback_data: 'num-100'},
                        ]
                    ]
                }
            })
            ctx.answerCbQuery()
        })

        // 好友请求处理
        bot.action(/friendship-accept/, async ctx => {
            this.logDebug('接受到 好友请求', ctx.match.input)
            const friend = this._weChatClient.friendShipList.find(item => item.id === ctx.match.input)?.friendship
            if (!friend) {
                ctx.deleteMessage().then(() => ctx.reply(this.t('wechat.friendExpired')))
                ctx.answerCbQuery()
                return
            } else {
                await friend.accept()
                ctx.deleteMessage().then(() => ctx.reply(this.t('wechat.addSuccess')))
            }
            ctx.answerCbQuery()
        })

        // 开启自动群组
        bot.action(VariableType.SETTING_AUTO_GROUP, async ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_AUTO_GROUP)
            const answerText = b ? this.t('common.open') : this.t('common.close')
            this.forwardSetting.setVariable(VariableType.SETTING_AUTO_GROUP, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageText(this.t('command.autocg.modelAutoCreate', b ? this.t('common.open') : this.t('common.close')), {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: this.t('common.clickChange'), callback_data: VariableType.SETTING_AUTO_GROUP},
                        ]
                    ]
                }
            })
            if (b) {
                // 登陆tg user client
                if (!this.tgUserClientLogin) {
                    await this.loginUserClient()
                }
            }
            return ctx.answerCbQuery(answerText)
        })

        // 通知模式
        bot.action(VariableType.SETTING_NOTION_MODE, ctx => {
            // 黑名单
            if (this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                this.forwardSetting.setVariable(VariableType.SETTING_NOTION_MODE, NotionMode.WHITE)
            } else {
                this.forwardSetting.setVariable(VariableType.SETTING_NOTION_MODE, NotionMode.BLACK)
            }
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())

            // 点击后持久化
            this.forwardSetting.writeToFile()
            ctx.answerCbQuery()
        })

        // 修改回复设置
        bot.action(VariableType.SETTING_REPLY_SUCCESS, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS)
            const answerText = b ? this.t('common.open') : this.t('common.close')
            this.forwardSetting.setVariable(VariableType.SETTING_REPLY_SUCCESS, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())

            return ctx.answerCbQuery(answerText)
        })

        // 自动切换设置
        bot.action(VariableType.SETTING_AUTO_SWITCH, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_AUTO_SWITCH)
            const answerText = b ? this.t('common.open') : this.t('common.close')
            this.forwardSetting.setVariable(VariableType.SETTING_AUTO_SWITCH, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())
            return ctx.answerCbQuery(answerText)
        })

        // 接受公众号消息
        bot.action(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT)
            const answerText = b ? this.t('common.close') : this.t('common.open')
            this.forwardSetting.setVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())
            return ctx.answerCbQuery(answerText)
        })

        // 接受公众号消息
        bot.action(VariableType.SETTING_FORWARD_SELF, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_FORWARD_SELF)
            const answerText = b ? this.t('common.open') : this.t('common.close')
            this.forwardSetting.setVariable(VariableType.SETTING_FORWARD_SELF, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())
            return ctx.answerCbQuery(answerText)
        })

        // 媒体质量压缩
        bot.action(VariableType.SETTING_COMPRESSION, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_COMPRESSION)
            const answerText = b ? this.t('common.open') : this.t('common.close')
            this.forwardSetting.setVariable(VariableType.SETTING_COMPRESSION, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup(this.getSettingButton())
            return ctx.answerCbQuery(answerText)
        })

        // 白名单设置
        bot.action(VariableType.SETTING_WHITE_LIST, ctx => {
            // 当前白名单
            ctx.editMessageText(this.t('telegram.btn.whiteListManager'), Markup.inlineKeyboard([
                [Markup.button.callback(this.t('telegram.btn.addWhiteList'), 'listAdd-')],
                [Markup.button.callback(this.t('telegram.btn.whiteList'), 'whiteList-1')]
            ]))
            ctx.answerCbQuery()
        })

        // 白名单列表
        bot.action(/whiteList-(\d+)/, ctx => {
            const pageNum = parseInt(ctx.match[1])
            // 获取黑名单或者白名单的列表
            const list = this.forwardSetting.getVariable(VariableType.SETTING_WHITE_LIST)
            if (!list || list.length === 0) {
                ctx.reply(this.t('telegram.msg.emptyWhiteList'))
                ctx.answerCbQuery()
                return
            }
            this.replyWhiteBtn(list, pageNum, ctx)
            ctx.answerCbQuery()
        })

        // 白名单移除
        bot.action(/whiteListRemove-(\d+)/, ctx => {
            const id = parseInt(ctx.match[1])
            // 获取黑名单或者白名单的列表
            const list = this.forwardSetting.getVariable(VariableType.SETTING_WHITE_LIST).filter(item => {
                return item.id !== id + ''
            })
            this.forwardSetting.setVariable(VariableType.SETTING_WHITE_LIST, list)
            this.forwardSetting.writeToFile()
            ctx.answerCbQuery(this.t('telegram.msg.removeSuccess'))
            this.replyWhiteBtn(list, 1, ctx)
        })

        // 黑名单设置
        bot.action(VariableType.SETTING_BLACK_LIST, ctx => {
            // 当前黑名单
            ctx.editMessageText(this.t('telegram.btn.blackListManager'), Markup.inlineKeyboard([
                [Markup.button.callback(this.t('telegram.btn.addBlackList'), 'listAdd-')],
                [Markup.button.callback(this.t('telegram.btn.blackList'), 'blackList-1')]
            ]))
            ctx.answerCbQuery()
        })

        // 黑名单列表
        bot.action(/blackList-(\d+)/, ctx => {
            const pageNum = parseInt(ctx.match[1])
            // 获取黑名单或者白名单的列表
            const list = this.forwardSetting.getVariable(VariableType.SETTING_BLACK_LIST)
            if (!list || list.length === 0) {
                ctx.reply(this.t('telegram.msg.emptyBlackList'))
                ctx.answerCbQuery()
                return
            }
            this.replyEditBlackBtn(list, pageNum, ctx)
            ctx.answerCbQuery()
        })

        // 黑名单移除
        bot.action(/blackListRemove-(\d+)/, ctx => {
            const id = parseInt(ctx.match[1])
            // 获取黑名单或者白名单的列表
            const list = this.forwardSetting.getVariable(VariableType.SETTING_BLACK_LIST).filter(item => {
                return item.id !== id + ''
            })
            this.forwardSetting.setVariable(VariableType.SETTING_BLACK_LIST, list)
            this.forwardSetting.writeToFile()
            ctx.answerCbQuery(this.t('telegram.msg.removeSuccess'))
            this.replyEditBlackBtn(list, 1, ctx)

        })

        // 黑白名单添加
        bot.action(/listAdd-/, ctx => {
            ctx.reply(this.t('telegram.msg.addListName')).then(() => {
                this.waitInputCommand = 'listAdd'
            })
            ctx.answerCbQuery()
        })


        bot.command('reset', (ctx) => {
            this._weChatClient.resetValue()
            ctx.reply(this.t('command.resetText'))
        })

        bot.command('cgdata', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindItem = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
                if (!bindItem) {
                    return ctx.reply(this.t('command.cgdata.notBind'))
                }
                // 获取群组管理员列表
                const administrators = await ctx.telegram.getChatAdministrators(ctx.chat.id)

                // 检查机器人是否在管理员列表中
                const botId = ctx.botInfo.id
                const isAdmin = administrators.some(admin => admin.user.id === botId)

                if (!isAdmin) {
                    return ctx.reply(this.t('command.cgdata.notAdmin'))
                }
                if (bindItem.type === 0) {
                    const contact = this.getContactByBindItem(bindItem)
                    if (contact) {
                        await ctx.telegram.setChatTitle(ctx.chat.id, `${bindItem.alias}[${bindItem.name}]`)
                        // 获取头像
                        contact.avatar().then(fbox => {
                            fbox.toBuffer().then(async buff => {
                                await ctx.telegram.setChatPhoto(ctx.chat.id, {
                                    source: buff
                                })
                            })
                        })
                    }
                } else {
                    await ctx.telegram.setChatTitle(ctx.chat.id, bindItem.name)
                }
            } else {
                return ctx.reply(this.t('common.onlyInGroup'))
            }
        })

        bot.command('bind', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindItem = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
                if (bindItem) {
                    if (bindItem.type === 0) {
                        ctx.reply(`${this.t('command.bind.currentBindUser')}${bindItem.alias}[${bindItem.name}]`)
                    } else {
                        ctx.reply(`${this.t('command.bind.currentBindGroup')}${bindItem.alias}[${bindItem.name}]`)
                    }
                } else {
                    ctx.reply(this.t('command.bind.noBinding'))
                }
            } else {
                ctx.reply(this.t('common.onlyInGroup'))
            }
        })

        bot.command('unbind', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.bindItemService.removeBindItemByChatId(ctx.chat.id)
                ctx.reply(this.t('command.unbindText'))
            } else {
                ctx.reply(this.t('common.onlyInGroup'))
            }
        })

        bot.command('login', async ctx => {
            this.getUserId()
            if (!this.wechatStartFlag) {
                this.wechatStartFlag = true
                this._weChatClient.start().then(() => {


                    // 第一次输入的人当成bot的所有者
                    this.loadOwnerChat(ctx)

                    // 标记为已执行
                    this.loginCommandExecuted = true

                }).catch(() => {
                    ctx.reply(this.t('command.login.fail'))
                })
            }
        })

        bot.command('stop', this.onWeChatStop)

        bot.command('check', ctx => {
            if (this.wechatStartFlag && this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('command.check.onLine'))
            } else {
                ctx.reply(this.t('command.check.offLine'))
            }
        })

        // select language
        bot.command('lang', ctx => {
            ctx.reply(this.t('command.langText'), {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {text: '中文', callback_data: 'lang-zh'},
                            {text: 'English', callback_data: 'lang-en'}
                        ]
                    ]
                }
            })
        })

        bot.action(/lang-/, async ctx => {
            this.setLanguage(ctx.match.input.slice(5))
            await bot.telegram.setMyCommands(commands)
            this.forwardSetting.setVariable(VariableType.SETTING_LANGUAGE, ctx.match.input.slice(5))
            this.forwardSetting.writeToFile()
            ctx.reply(this.t('common.setSuccess'))
            ctx.answerCbQuery()
        })

        // 选择群聊
        const currentSelectRoomMap = new Map<string, RoomItem>()
        let searchRooms: RoomItem [] = []

        bot.command('room', async ctx => {
            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                await ctx.reply(this.t('common.plzLoginWeChat'))
                return
            }

            if (!this._weChatClient.cacheMemberDone) {
                await ctx.reply(this.t('command.user.onLoading'))
                return
            }

            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/room\s+([\p{L}\p{N}_]+)/u)
            if (match) {
                const topic = match[1]  // 提取用户名
                const filterRoom = this._weChatClient.roomList.filter(room => {
                    // const roomName = ;
                    return room.room.payload?.topic?.includes(topic)
                })
                if (filterRoom && filterRoom.length > 0) {
                    const buttons: tg.InlineKeyboardButton[][] = []
                    this.searchList = []
                    filterRoom.forEach(item => {
                        const id = UniqueIdGenerator.getInstance().generateId('search')
                        this.searchList.push({
                            id: id,
                            contact: item.room,
                            type: 1
                        })
                    })
                    const page = new Page(this.searchList, 1, TelegramBotClient.PAGE_SIZE)
                    const pageList = page.getList(1)
                    for (let i = 0; i < pageList.length; i += 2) {
                        const item = pageList[i].contact
                        const buttonRow = [Markup.button.callback(`🌐${await item.topic()}`, `${pageList[i].id}`)]
                        if (i + 1 < pageList.length) {
                            const item1 = pageList[i + 1].contact
                            buttonRow.push(Markup.button.callback(`🌐${await item1.topic()}`, `${pageList[i + 1].id}`))
                        }
                        buttons.push(buttonRow)
                    }
                    if (page.hasNext()) {
                        buttons.push([Markup.button.callback(this.t('common.nextPage'), 'search-2')])
                    }
                    ctx.reply(this.t('command.room.plzSelect'), Markup.inlineKeyboard(buttons))
                } else {
                    ctx.reply(this.t('command.room.notFound') + topic)
                }
                return
            }

            const count = 0
            searchRooms = this._weChatClient.roomList
            this.generateRoomButtons(searchRooms, currentSelectRoomMap, count).then(buttons => {
                if (buttons.length === 0) {
                    ctx.reply(this.t('command.room.notFound'))
                } else {
                    ctx.reply(this.t('command.room.plzSelect'), {
                        ...Markup.inlineKeyboard(buttons)
                    })
                }
            })
        })

        bot.action(/room-index-\d+/, async (ctx) => {
            // this.logDebug(ctx.match.input)
            const room = currentSelectRoomMap.get(ctx.match.input)
            const roomTopic = await room?.room?.topic()
            if (ctx.chat && ctx.chat.type.includes('group') && room) {
                // 群组绑定
                this.bindItemService.bindGroup(roomTopic ? roomTopic : '', ctx.chat?.id, 1, room.id, '', room.room.id, '')
                ctx.deleteMessage()
                ctx.answerCbQuery()
                return
            }
            this.selectRoom = room?.room
            ctx.deleteMessage()
            this.setPin('room', roomTopic)
            ctx.answerCbQuery()
        })

        bot.action(/room-next-\d+/, async (ctx) => {
            const nextPage = parseInt(ctx.match.input.slice(10))
            this.generateRoomButtons(searchRooms, currentSelectRoomMap, nextPage).then(buttons => {
                ctx.editMessageReplyMarkup({
                    inline_keyboard: buttons
                })
            })
            await ctx.answerCbQuery()
        })

        let currentSearchWord = ''

        bot.command('user', async ctx => {

            // wait all contact loaded
            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('command.user.onLoading'))
                return
            }

            if (!this.loginCommandExecuted) {
                await ctx.reply(this.t('command.user.onLogin'))
                return
            }

            if (!this._weChatClient.cacheMemberDone) {
                await ctx.reply(this.t('command.user.onLoading'))
                return
            }

            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/user\s+([\p{L}\p{N}_]+)/u)
            if (match) {
                const username = match[1]  // 提取用户名
                const individual = this._weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                const official = this._weChatClient.contactMap?.get(ContactImpl.Type.Official)
                const individualFilter: ContactInterface[] = []
                individual?.forEach(item => {
                    const alias = item.contact.payload?.alias
                    if (alias?.includes(username)) {
                        individualFilter.push(item.contact)
                        return
                    }
                    if (item.contact.name().includes(username)) {
                        individualFilter.push(item.contact)
                    }
                })
                const officialFilter: ContactInterface[] = []
                official?.forEach(item => {
                    const alias = item.contact.payload?.alias
                    if (alias?.includes(username)) {
                        officialFilter.push(item.contact)
                        return
                    }
                    if (item.contact.name().includes(username)) {
                        officialFilter.push(item.contact)
                    }
                })
                if ((individualFilter && individualFilter.length > 0) || (officialFilter && officialFilter.length > 0)) {
                    const buttons: tg.InlineKeyboardButton[][] = []
                    this.searchList = [];
                    [...officialFilter, ...individualFilter].forEach(item => {
                        const id = UniqueIdGenerator.getInstance().generateId('search')
                        this.searchList.push({
                            id: id,
                            contact: item,
                            type: 0
                        })
                    })
                    const page = new Page(this.searchList, 1, TelegramBotClient.PAGE_SIZE)
                    const pageList = page.getList(1)
                    for (let i = 0; i < pageList.length; i += 2) {
                        const item = pageList[i].contact
                        const buttonRow: tg.InlineKeyboardButton[] = []
                        if (item.payload?.type === PUPPET.types.Contact.Official) {
                            buttonRow.push(Markup.button.callback(`📣${item.name()}`, `${pageList[i].id}`))
                        } else {
                            if (item.payload?.alias) {
                                buttonRow.push(Markup.button.callback(`👤${item.payload?.alias}[${item.name()}]`, `${pageList[i].id}`))
                            } else {
                                buttonRow.push(Markup.button.callback(`👤${item.name()}`, `${pageList[i].id}`))
                            }
                        }
                        if (i + 1 < pageList.length) {
                            const item1 = pageList[i + 1].contact
                            if (item1.payload?.type === PUPPET.types.Contact.Official) {
                                buttonRow.push(Markup.button.callback(`📣${item1.name()}`, `${pageList[i + 1].id}`))
                            } else {
                                if (item1.payload?.alias) {
                                    buttonRow.push(Markup.button.callback(`👤${item1.payload?.alias}[${item1.name()}]`, `${pageList[i + 1].id}`))
                                } else {
                                    buttonRow.push(Markup.button.callback(`👤${item1.name()}`, `${pageList[i + 1].id}`))
                                }
                            }
                        }
                        buttons.push(buttonRow)
                    }
                    if (page.hasNext()) {
                        buttons.push([Markup.button.callback(this.t('common.nextPage'), 'search-2')])
                    }
                    ctx.reply(this.t('command.user.plzSelect'), Markup.inlineKeyboard(buttons))
                } else {
                    ctx.reply(this.t('command.user.notFound') + username)
                }
                return
            }

            if (ctx.message.text) {
                currentSearchWord = ctx.message.text.split(' ')[1]
            } else {
                currentSearchWord = ''
            }


            // Create inline keyboard
            const inlineKeyboard = Markup.inlineKeyboard([
                // Markup.button.callback('未知', 'UNKNOWN'),
                Markup.button.callback(this.t('command.user.individual'), 'INDIVIDUAL'),
                Markup.button.callback(this.t('command.user.official'), 'OFFICIAL'),
                // Markup.button.callback('公司', 'CORPORATION')
            ])

            // Send message with inline keyboard
            ctx.reply(this.t('command.user.plzSelectType'), inlineKeyboard)

        })

        bot.action(/search-(\d+)/, async (ctx) => {
            const buttons: tg.InlineKeyboardButton[][] = []
            const page = parseInt(ctx.match[1])
            const page1 = new Page(this.searchList, page, TelegramBotClient.PAGE_SIZE)
            const pageList = page1.getList(page)
            for (let i = 0; i < pageList.length; i += 2) {
                const type = pageList[i].type
                if (type === 1) {
                    const item = pageList[i].contact
                    const buttonRow = [Markup.button.callback(`🌐${await item.topic()}`, `${pageList[i].id}`)]
                    if (i + 1 < pageList.length) {
                        const item1 = pageList[i + 1].contact
                        buttonRow.push(Markup.button.callback(`🌐${await item1.topic()}`, `${pageList[i + 1].id}`))
                    }
                    buttons.push(buttonRow)
                } else {
                    const item = pageList[i].contact
                    const buttonRow: tg.InlineKeyboardButton[] = []
                    if (item.payload?.type === PUPPET.types.Contact.Official) {
                        buttonRow.push(Markup.button.callback(`📣${item.name()}`, `${pageList[i].id}`))
                    } else {
                        if (item.payload?.alias) {
                            buttonRow.push(Markup.button.callback(`👤${item.payload?.alias}[${item.name()}]`, `${pageList[i].id}`))
                        } else {
                            buttonRow.push(Markup.button.callback(`👤${item.name()}`, `${pageList[i].id}`))
                        }
                    }
                    if (i + 1 < pageList.length) {
                        const item1 = pageList[i + 1].contact
                        if (item1.payload?.type === PUPPET.types.Contact.Official) {
                            buttonRow.push(Markup.button.callback(`📣${item1.name()}`, `${pageList[i + 1].id}`))
                        } else {
                            if (item1.payload?.alias) {
                                buttonRow.push(Markup.button.callback(`👤${item1.payload?.alias}[${item1.name()}]`, `${pageList[i + 1].id}`))
                            } else {
                                buttonRow.push(Markup.button.callback(`👤${item1.name()}`, `${pageList[i + 1].id}`))
                            }
                        }
                    }
                    buttons.push(buttonRow)
                }
            }
            const lastButton = []
            if (page1.hasLast()) {
                lastButton.push(Markup.button.callback(this.t('common.prevPage'), `search-${page - 1}`))
            }
            if (page1.hasNext()) {
                lastButton.push(Markup.button.callback(this.t('common.nextPage'), `search-${page + 1}`))
            }
            buttons.push(lastButton)
            ctx.editMessageText(this.t('common.chooseGroup'), Markup.inlineKeyboard(buttons))
            ctx.answerCbQuery()
        })

        bot.action(/search/, async ctx => {
            const element = this.searchList.find(item => item.id === ctx.match.input)
            ctx.deleteMessage()
            if (element) {
                if (element.contact?.payload.type === PUPPET.types.Contact.Official) {
                    if (ctx.chat && ctx.chat.type.includes('group')) {
                        // 群组绑定
                        const contactList = this.weChatClient.contactMap?.get(ContactImpl.Type.Official)
                        if (contactList) {
                            for (const contactListElement of contactList) {
                                if (contactListElement.contact.id === element.contact.id) {
                                    this.bindItemService.bindGroup(element.contact.payload?.name ? element.contact.payload?.name : '', ctx.chat?.id, 0, contactListElement.id, element.contact.payload?.alias ? element.contact.payload?.alias : '', element.contact.id, element.contact.payload?.avatar ? element.contact.payload?.avatar : '')
                                    break
                                }
                            }
                        }
                        ctx.answerCbQuery()
                        return
                    }
                    this._currentSelectContact = element.contact
                    this.setPin('official', element.contact.name())
                    ctx.answerCbQuery()
                    return
                }
                if (element.type === 0) {
                    const talker = element.contact
                    const alias = await talker.alias()
                    if (ctx.chat && ctx.chat.type.includes('group')) {
                        // 群组绑定
                        const contactList = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                        if (contactList) {
                            for (const contactListElement of contactList) {
                                if (contactListElement.contact.id === talker.id) {
                                    this.bindItemService.bindGroup(talker.payload?.name ? talker.payload?.name : '', ctx.chat?.id, 0, contactListElement.id, talker.payload?.alias ? talker.payload?.alias : '', talker.id, talker.payload?.avatar ? talker.payload?.avatar : '')
                                    break
                                }
                            }
                        }
                        ctx.answerCbQuery()
                        return
                    }
                    this._currentSelectContact = element.contact
                    if (alias) {
                        this.setPin('user', alias)
                    } else {
                        this.setPin('user', talker.name())
                    }
                } else {
                    const room = element.contact
                    const roomTopic = await room.topic()
                    if (ctx.chat && ctx.chat.type.includes('group')) {
                        // 群组绑定
                        const roomItem = this.weChatClient.roomList.find(item => item.room.id === room.id)
                        if (roomItem) {
                            this.bindItemService.bindGroup(roomTopic ? roomTopic : '', ctx.chat?.id, 1, roomItem.id, '', room.id, '')
                        }
                        ctx.answerCbQuery()
                        return
                    }
                    this.setPin('room', roomTopic)
                    this.selectRoom = room
                }
            }
            ctx.answerCbQuery()
        })

        bot.command('recent', async ctx => {
            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('common.plzLoginWeChat'))
                return
            }

            if (this.recentUsers.length == 0) {
                ctx.reply(this.t('command.recent.noUsers'))
                return
            }

            const buttons: tg.InlineKeyboardButton[][] = []
            this.recentUsers.forEach(item => {
                buttons.push([Markup.button.callback(item.name, item.id)])
            })
            const inlineKeyboard = Markup.inlineKeyboard(buttons)
            ctx.reply(this.t('command.recent.plzSelect'), inlineKeyboard)
        })

        bot.action(/.*recent.*/, async (ctx) => {
            const data = this.recentUsers.find(item => item.id === ctx.match.input)
            if (data) {
                if (data.type === 0) {
                    if (ctx.chat && ctx.chat.type.includes('group')) {
                        // 群组绑定
                        const roomItem = this.weChatClient.roomList.find(item => item.room.id === data.talker?.id)
                        const roomTopic = await roomItem?.room.topic()
                        if (roomItem && data.talker) {
                            this.bindItemService.bindGroup(roomTopic ? roomTopic : '', ctx.chat?.id, 1, roomItem.id, '', data.talker.id, '')
                        }
                        ctx.deleteMessage()
                        ctx.answerCbQuery()
                        return
                    }
                    this.selectRoom = data.talker
                } else {
                    if (ctx.chat && ctx.chat.type.includes('group')) {
                        const talker = data.talker as ContactInterface
                        // 用户绑定
                        if (talker) {
                            let list
                            if (talker?.type() !== PUPPET.types.Contact.Official) {
                                list = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                            } else {
                                list = this.weChatClient.contactMap?.get(ContactImpl.Type.Official)
                            }
                            if (list) {
                                for (const listElement of list) {
                                    if (listElement.contact.id === talker.id) {
                                        this.bindItemService.bindGroup(talker.payload?.name ? talker.payload?.name : '', ctx.chat?.id, 0, listElement.id, talker.payload?.alias ? talker.payload?.alias : '', talker.id, talker.payload?.avatar ? talker.payload?.avatar : '')
                                        break
                                    }
                                }
                            }
                        }
                        ctx.deleteMessage()
                        ctx.answerCbQuery()
                        return
                    }
                    this._currentSelectContact = data.talker
                }
                this.setPin(data.type === 0 ? 'room' : 'user', data.name)
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })

        bot.action(/addBlackOrWhite-(\d+)/, (ctx) => {
            const buttons: tg.InlineKeyboardButton[][] = []
            const page = parseInt(ctx.match[1])
            const page1 = new Page(this.addBlackOrWhite, page, TelegramBotClient.PAGE_SIZE)
            const pageList = page1.getList(page)
            for (let i = 0; i < pageList.length; i += 2) {
                const buttonRow = [Markup.button.callback(`🌐${pageList[i].text}`, `${pageList[i].id}`)]
                if (i + 1 < pageList.length) {
                    buttonRow.push(Markup.button.callback(`🌐${pageList[i + 1].text}`, `${pageList[i + 1].id}`))
                }
                buttons.push(buttonRow)
            }
            const lastButton = []
            if (page1.hasLast()) {
                lastButton.push(Markup.button.callback(this.t('common.prevPage'), `addBlackOrWhite-${page - 1}`))
            }
            if (page1.hasNext()) {
                lastButton.push(Markup.button.callback(this.t('common.nextPage'), `addBlackOrWhite-${page + 1}`))
            }
            buttons.push(lastButton)
            ctx.editMessageText(this.t('common.chooseGroup'), Markup.inlineKeyboard(buttons))
            ctx.answerCbQuery()
        })

        bot.action(/.*addBlackOrWhite.*/, (ctx) => {
            const data = this.addBlackOrWhite.find(item => item.id === ctx.match.input)
            if (data) {
                this.addToWhiteOrBlackList(data.text)
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })

        bot.action(/^[0-9a-z]+/, async (ctx) => {
            this.logDebug('点击了用户', ctx.match.input)
            ctx.deleteMessage()
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const id = ctx.match.input !== 'filehelper' ? '@' + ctx.match.input : 'filehelper'
                const contact = await this._weChatClient.client.Contact.find({id: id})
                // 用户绑定
                if (contact) {
                    let list
                    if (contact?.type() !== PUPPET.types.Contact.Official) {
                        list = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                    } else {
                        list = this.weChatClient.contactMap?.get(ContactImpl.Type.Official)
                    }
                    if (list) {
                        for (const listElement of list) {
                            if (listElement.contact.id === contact.id) {
                                this.bindItemService.bindGroup(contact.payload?.name ? contact.payload?.name : '', ctx.chat?.id, 0, listElement.id, contact.payload?.alias ? contact.payload?.alias : '', contact.id, contact.payload?.avatar ? contact.payload?.avatar : '')
                                break
                            }
                        }
                    }
                }
                ctx.answerCbQuery()
                return
            }
            const id = ctx.match.input !== 'filehelper' ? '@' + ctx.match.input : 'filehelper'
            this._currentSelectContact = await this._weChatClient.client.Contact.find({id: id})
            const reply = await this._currentSelectContact?.alias() || this._currentSelectContact?.name()
            if (this._currentSelectContact?.type() === PUPPET.types.Contact.Official) {
                this.setPin('official', reply ? reply : '')
            } else {
                this.setPin('user', reply ? reply : '')
            }
            ctx.answerCbQuery()
        })

        bot.on(message('text'), async ctx => {
            const text = ctx.message.text // 获取消息内容
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            const chatId = ctx.chat.id
            const msgId = ctx.message.message_id
            // 处理等待用户输入的指令
            if (await this.dealWithCommand(ctx, text)) {
                return
            }

            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('common.plzLoginWeChat'))
                return
            }
            // 获取锁
            await this.lock.acquire()
            // 如果是回复的消息 优先回复该发送的消息
            if (replyMessageId) {
                // 假设回复消息是撤回命令 撤回web协议获取不到消息id 放弃 更新上游代码可获取了
                if (text === '&rm') {
                    this.undoMessage(replyMessageId, ctx)
                    this.lock.release()
                    return
                }
                const messageItem = await MessageService.getInstance().findMessageByTelegramMessageId(replyMessageId, chatId)
                const weChatMessageId = messageItem?.wechat_message_id
                // 设置别名(不可用)
                // if (text.startsWith('&alias') && weChatMessageId) {
                // this.setAlias(weChatMessageId, text, ctx)
                // return
                // }

                if (weChatMessageId) {
                    // 添加或者移除名单
                    this.weChatClient.client.Message.find({id: weChatMessageId}).then(message => {
                        if (!message) {
                            ctx.reply(this.t('common.sendFail'), {
                                reply_parameters: {
                                    message_id: msgId
                                }
                            })
                            this.lock.release()
                            return
                        }
                        this.weChatClient.addMessage(message, text, {
                            chat_id: chatId,
                            msg_id: msgId
                        })
                    })
                }
                this.lock.release()
                return
            }

            // 如果是群组消息的情况
            if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === this._chatId) {
                const bindItem = await this.bindItemService.getBindItemByChatId(chatId)
                if (bindItem) {
                    if (bindItem.type === 0) {
                        const contact = this.getContactByBindItem(bindItem)
                        if (contact) {
                            this.weChatClient.addMessage(contact, text, {
                                chat_id: chatId,
                                msg_id: msgId
                            })
                        }
                    } else {
                        const room = this.getRoomByBindItem(bindItem)
                        if (room) {
                            this.weChatClient.addMessage(room, text, {
                                chat_id: chatId,
                                msg_id: msgId
                            })
                        }
                    }
                } else {
                    await ctx.reply(this.t('common.sendFailNoBind'), {
                        reply_parameters: {
                            message_id: msgId
                        }
                    })
                }
                this.lock.release()
                return
            }

            // 当前有回复的'个人用户' 并且是选择了用户的情况下
            if (this._flagPinMessageType === 'user' && this._currentSelectContact) {
                this.weChatClient.addMessage(this._currentSelectContact, text, {
                    chat_id: chatId,
                    msg_id: msgId
                })
                this.lock.release()
                return
            }

            // 当前有回复的'群' 并且是选择了群的情况下
            if (this._flagPinMessageType === 'room' && this.selectRoom) {
                this.weChatClient.addMessage(this.selectRoom, text, {
                    chat_id: chatId,
                    msg_id: msgId
                })
                this.lock.release()
                return
            }
            this.lock.release()
            return
        })

        bot.on(message('voice'), ctx =>
            this.handleFileMessage.call(this, ctx, 'voice'))

        bot.on(message('audio'), ctx =>
            this.handleFileMessage.call(this, ctx, 'audio'))

        bot.on(message('video'), ctx =>
            this.handleFileMessage.call(this, ctx, 'video'))

        bot.on(message('document'), ctx =>
            this.handleFileMessage.call(this, ctx, 'document'))

        bot.on(message('photo'), ctx =>
            this.handleFileMessage.call(this, ctx, 'photo'))

        bot.on(message('sticker'), ctx => {
            if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
                ctx.reply(this.t('common.plzLoginWeChat'))
                return
            }
            const fileId = ctx.message.sticker.file_id
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                const uniqueId = ctx.message.sticker.file_unique_id
                // 判断文件夹是否存在
                if (!fs.existsSync('save-files')) {
                    fs.mkdirSync('save-files')
                }
                const href = fileLink.href
                const fileName = `${uniqueId}-${href.substring(href.lastIndexOf('/') + 1, href.length)}`
                const saveFile = `save-files/${fileName}`
                const gifFile = `save-files/${fileName.slice(0, fileName.lastIndexOf('.'))}.gif`

                let lottie_config = {
                    width: 200,
                    height: 200
                }

                if (saveFile.endsWith('.tgs')) {
                    lottie_config = {
                        width: 200,
                        height: ctx.message.sticker.height / ctx.message.sticker.width * lottie_config.width
                    }
                }

                // gif 文件存在
                if (fs.existsSync(gifFile)) {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                } else {
                    // 尝试使用代理下载tg文件
                    if (config.HOST !== '') {
                        FileUtils.downloadWithProxy(fileLink.toString(), saveFile).then(() => {
                            this.sendGif(saveFile, gifFile, ctx, lottie_config)
                        }).catch(() => ctx.reply(this.t('common.sendFailMsg', this.t('common.saveOrgFileError'))))
                    } else {
                        FileBox.fromUrl(fileLink.toString()).toFile(saveFile).then(() => {
                            this.sendGif(saveFile, gifFile, ctx, lottie_config)
                        }).catch(() => ctx.reply(this.t('common.sendFailMsg', this.t('common.saveOrgFileError'))))
                    }
                }
            }).catch(e => {
                ctx.reply(this.t('common.sendFailMsg', this.t('common.fileLarge')), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        })

        // const unknownPage = 0;
        const individualPage = 0
        const officialPage = 0

        bot.action('INDIVIDUAL', ctx => {
            this.pageContacts(ctx, [...this._weChatClient.contactMap?.get(ContactImpl.Type.Individual) || []].map(item => item.contact), individualPage, currentSearchWord)
            ctx.answerCbQuery()
        })
        bot.action('OFFICIAL', ctx => {
            this.pageContacts(ctx, [...this._weChatClient.contactMap?.get(ContactImpl.Type.Official) || []].map(item => item.contact), officialPage, currentSearchWord)
            ctx.answerCbQuery()
        })
        this.botLaunch(bot)
    }

    private setAlias(weChatMessageId: string, text: string, ctx: any) {
        this.weChatClient.client.Message.find({id: weChatMessageId}).then(msg => {
            msg?.talker()?.alias(text.substring(6).trimStart()).then(async () => {
                const cacheContacts = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                if (cacheContacts) {
                    for (const item of cacheContacts) {
                        if (item.contact.id === msg?.talker()?.id) {
                            await item.contact.alias(text.substring(6).trimStart())
                            await item.contact.sync()
                            break
                        }
                    }
                }
                ctx.reply(this.t('telegram.msg.updateAliasSuccess'))
            })
        }).catch(() => {
            ctx.reply(this.t('telegram.msg.updateAliasFail'))
        })
        return
    }

    /**
     * 撤回消息
     * @param replyMessageId
     * @param ctx
     * @private
     */
    private undoMessage(replyMessageId: number, ctx: any) {
        const undoMessageCache = CacheHelper.getInstances().getUndoMessage({
            chat_id: ctx.message?.chat.id, msg_id: replyMessageId
        })
        if (undoMessageCache) {
            // 撤回消息
            this.weChatClient.client.Message.find({id: undoMessageCache.wx_msg_id})
                .then(message => {
                    message?.recall().then((res) => {
                        if (res) {
                            ctx.reply(this.t('telegram.msg.recallSuccess'), {
                                reply_parameters: {
                                    message_id: replyMessageId
                                }
                            })
                            CacheHelper.getInstances().removeUndoMessage(message.id)
                        } else {
                            ctx.reply(this.t('telegram.msg.recallFail'), {
                                reply_parameters: {
                                    message_id: replyMessageId
                                }
                            })
                        }

                    }).catch((e) => {
                        this.logError(this.t('telegram.msg.recallFail'), e)
                        ctx.reply(this.t('telegram.msg.recallFail'), {
                            reply_parameters: {
                                message_id: replyMessageId
                            }
                        })
                    })
                })
        } else {
            ctx.reply(this.t('telegram.msg.recallNotDone'), {
                reply_parameters: {
                    message_id: replyMessageId
                }
            })
        }
        return
    }

    private replyWhiteBtn(list: NotionListType[], pageNum: number, ctx: any) {
        const page = new Page(list, pageNum, TelegramBotClient.PAGE_SIZE)
        const buttons = []
        const pageList = page.getList(pageNum)
        for (let i = 0; i < pageList.length; i += 2) {
            const buttonRow = [Markup.button.callback(`🌐${pageList[i].name}`, `whiteListRemove-${pageList[i].id}`)]
            if (i + 1 < pageList.length) {
                buttonRow.push(Markup.button.callback(`🌐${pageList[i + 1].name}`, `whiteListRemove-${pageList[i + 1].id}`))
            }
            buttons.push(buttonRow)
        }
        buttons.push([Markup.button.callback(this.t('common.prevPage'), `whiteList-${pageNum - 1}`, !page.hasLast()), Markup.button.callback(this.t('common.nextPage'), `whiteList-${pageNum + 1}`, !page.hasNext())])
        ctx.editMessageText(this.t('telegram.msg.removeWhiteList'), Markup.inlineKeyboard(buttons))
    }

    private replyEditBlackBtn(list: NotionListType[], pageNum: number, ctx: any) {
        const page = new Page(list, pageNum, TelegramBotClient.PAGE_SIZE)
        const buttons = []
        const pageList = page.getList(pageNum)
        for (let i = 0; i < pageList.length; i += 2) {
            const buttonRow = [Markup.button.callback(`🌐${pageList[i].name}`, `blackListRemove-${pageList[i].id}`)]
            if (i + 1 < pageList.length) {
                buttonRow.push(Markup.button.callback(`🌐${pageList[i + 1].name}`, `blackListRemove-${pageList[i + 1].id}`))
            }
            buttons.push(buttonRow)
        }
        buttons.push([Markup.button.callback(this.t('common.prevPage'), `blackList-${pageNum - 1}`, !page.hasLast()), Markup.button.callback(this.t('common.nextPage'), `blackList-${pageNum + 1}`, !page.hasNext())])
        ctx.editMessageText(this.t('common.blackListRemove'), Markup.inlineKeyboard(buttons))
    }

    public async loginUserClient() {
        const logger = this._log
        const authParams: UserAuthParams = {
            onError(err: Error): Promise<boolean> | void {
                logger.error('UserClient error:', err)
            },
            phoneNumber: async () =>
                new Promise((resolve) => {
                    this.bot.telegram.sendMessage(this.chatId, this.t('common.loginHint')).then(res => {
                        this.waitInputCommand = 'phoneNumber'
                        const intervalId = setInterval(() => {
                            if (this.phoneNumber) {
                                const phoneNumber = this.phoneNumber
                                this.phoneNumber = undefined
                                clearInterval(intervalId)
                                this._bot.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneNumber)
                            }
                        }, 1000)
                    })
                }),
            password: async (hint?: string) =>
                new Promise((resolve) => {
                    this.bot.telegram.sendMessage(this.chatId, this.t('common.tgLoginInputPassword')).then(res => {
                        this.waitInputCommand = 'password'
                        const intervalId = setInterval(() => {
                            if (this.password) {
                                const password = this.password
                                this.password = undefined
                                clearInterval(intervalId)
                                this._bot.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(password)
                            }
                        }, 1000)
                    })
                }),
            phoneCode: async (isCodeViaApp?) =>
                new Promise((resolve) => {
                    this.bot.telegram.sendMessage(this.chatId, this.t('common.tgLoginVerifyCode'), {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {text: '1', callback_data: 'num-1'},
                                    {text: '2', callback_data: 'num-2'},
                                    {text: '3', callback_data: 'num-3'}
                                ],
                                [
                                    {text: '4', callback_data: 'num-4'},
                                    {text: '5', callback_data: 'num-5'},
                                    {text: '6', callback_data: 'num-6'}
                                ],
                                [
                                    {text: '7', callback_data: 'num-7'},
                                    {text: '8', callback_data: 'num-8'},
                                    {text: '9', callback_data: 'num-9'}
                                ],
                                [
                                    {text: '0', callback_data: 'num-0'},
                                    {text: 'Del', callback_data: 'num--1'},
                                ]
                            ]
                        }
                    }).then(res => {
                        const intervalId = setInterval(() => {
                            if (this.phoneCode && this.phoneCode.length === 5) {
                                const phoneCode = this.phoneCode
                                this.phoneCode = ''
                                clearInterval(intervalId)
                                this._bot.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneCode)
                            }
                        }, 1000)
                    })
                }),
        }
        this._tgUserClient?.start(authParams)
    }

    public getRoomByBindItem(bindItem: BindItem) {
        const room = this.weChatClient.roomList.find(value => value.id === bindItem.bind_id)
        if (room) {
            return room.room
        }
        return null
    }

    public getContactByBindItem(bindItem: BindItem) {
        let findItem: ContactItem | undefined = undefined
        const individual = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
        if (individual) {
            for (const contactItem of individual) {
                if (contactItem.id === bindItem.bind_id) {
                    findItem = contactItem
                    break
                }
            }
        }
        const official = this.weChatClient.contactMap?.get(ContactImpl.Type.Official)
        if (!findItem) {
            if (official) {
                for (const contactItem of official) {
                    if (contactItem.id === bindItem.bind_id) {
                        findItem = contactItem
                        break
                    }
                }
            }
        }
        if (findItem) {
            return findItem.contact
        }
        return null
    }

    private async botLaunch(bot: Telegraf, retryCount = 5) {
        try {
            await bot.launch()
            this.logDebug('Telegram Bot started')
        } catch (error) {
            this.logError('Telegram Bot start failed', error)
            if (retryCount > 0) {
                this.logDebug(`Retrying launch... (${retryCount} attempts left)`)
                await this.botLaunch(bot, retryCount - 1)
            } else {
                this.logError('Maximum retry attempts reached. Unable to start bot.')
            }
        }
    }

    private async sendGif(saveFile: string, gifFile: string, ctx: any,
                          lottie_config?: {
                              width: number,
                              height: number
                          }) {
        try {
            if (!fs.existsSync(gifFile)) {
                if (saveFile.endsWith('.tgs')) {
                    await new ConverterHelper().tgsToGif(saveFile, gifFile, lottie_config)
                } else {
                    await new ConverterHelper().webmToGif(saveFile, gifFile)
                }
            }
            if (!fs.existsSync(gifFile)) {
                await ctx.reply(this.t('common.sendFail') + this.t('common.transFail'), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
                return
            }
            const fileBox = FileBox.fromFile(gifFile)
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            // 如果是回复的消息 优先回复该发送的消息
            if (replyMessageId) {
                // try get weChat cache message id
                const messageItem = await MessageService.getInstance().findMessageByTelegramMessageId(replyMessageId, ctx.chat.id)
                const weChatMessageId = messageItem.wechat_message_id
                if (weChatMessageId) {
                    // 添加或者移除名单

                    this.weChatClient.client.Message.find({id: weChatMessageId}).then(message => {
                        if (!message) {
                            ctx.reply(this.t('common.sendFail'), {
                                reply_parameters: {
                                    message_id: ctx.message.message_id
                                }
                            })
                            return
                        }
                        this.weChatClient.addMessage(message, fileBox, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                    })
                }
                return
            }
            // 如果是群组消息的情况
            if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === this._chatId) {
                const bindItem = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
                if (bindItem) {
                    if (bindItem.type === 0) {
                        const findItem: ContactInterface | undefined = undefined
                        const individual = this.weChatClient.contactMap?.get(ContactImpl.Type.Individual)
                        individual?.forEach(value => {
                            if (value.id === bindItem.bind_id) {
                                this.weChatClient.addMessage(value.contact, fileBox, {
                                    chat_id: ctx.chat.id,
                                    msg_id: ctx.message.message_id
                                })
                                return
                            }
                        })
                        const official = this.weChatClient.contactMap?.get(ContactImpl.Type.Official)
                        if (!findItem) {
                            official?.forEach(value => {
                                if (value.id === bindItem.bind_id) {
                                    this.weChatClient.addMessage(value.contact, fileBox, {
                                        chat_id: ctx.chat.id,
                                        msg_id: ctx.message.message_id
                                    })
                                    return
                                }
                            })
                        }
                    } else {
                        const room = this.weChatClient.roomList.find(value => value.id === bindItem.bind_id)
                        if (room) {
                            this.weChatClient.addMessage(room.room, fileBox, {
                                chat_id: ctx.chat.id,
                                msg_id: ctx.message.message_id
                            })
                        }
                    }
                } else {
                    await ctx.reply(this.t('common.sendFailNoBind'), {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    })
                }
            } else {
                if (this._flagPinMessageType && this._flagPinMessageType === 'user') {
                    if (this._currentSelectContact) {
                        this.weChatClient.addMessage(this._currentSelectContact, fileBox, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                    }
                } else {
                    if (this.selectRoom) {
                        this.weChatClient.addMessage(this.selectRoom, fileBox, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                    }
                }
            }
        } catch (e) {
            this.logError('发送失败', e)
            await ctx.reply(this.t('common.sendFail'), {
                reply_parameters: {
                    message_id: ctx.message.message_id
                }
            })
        }

    }

    public onMessage() {
        return
    }

    public async sendMessage(message: SimpleMessage) {
        if (message.chatId !== this.chatId) {
            // 说明是群组消息,不加群组前缀
            message.room = undefined
        }
        this.bot.telegram.sendMessage(message.chatId, SimpleMessageSender.send(message), {
            parse_mode: 'HTML',
            reply_parameters: message.replay_msg_id ? {
                message_id: message.replay_msg_id
            } : undefined
        }).then(res => {
            if (message.message && message.id) {
                MessageService.getInstance().addMessage({
                    wechat_message_id: message.id,
                    chat_id: message.chatId ? message.chatId + '' : '',
                    telegram_message_id: res.message_id,
                    type: message.message.type(),
                    msg_text: message.body + '',
                    send_by: message.sender ? message.sender : '',
                    create_time: new Date().getTime(),
                    sender_id: message.send_id,
                })
            }
        }).catch(e => {
            this.logError(e.message)
            if (e.response.error_code === 403) {
                // group deleted
                this.bindItemService.removeBindItemByChatId(parseInt(message.chatId + ''))
                this.bot.telegram.sendMessage(this.chatId, SimpleMessageSender.send(message), {
                    parse_mode: 'HTML'
                }).then(res => {
                    if (message.id) {
                        this.messageMap.set(res.message_id, message.id)
                    }
                })
            }
            if (e.response.error_code === 429) {
                // many request
                setTimeout(() => {
                    this.sendMessage(message)
                }, 1000)
            }
        })
    }

    public saveMessage(tgMessageId: number, wechatMessageId: string) {
        this.messageMap.set(tgMessageId, wechatMessageId)
    }

    private async pageContacts(ctx: NarrowedContext<Context<tg.Update>, tg.Update>, source: ContactInterface[] | undefined, pageNumber: number, currentSearchWord: string) {


        if (!source) {
            await ctx.reply(this.t('telegram.msg.noContacts'))
        }
        source = await TelegramBotClient.filterByNameAndAlias(currentSearchWord, source)

        let buttons: tg.InlineKeyboardButton[][] = await this.pageDataButtons(source, pageNumber,
            TelegramBotClient.PAGE_SIZE, TelegramBotClient.LINES)

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this

        if (pageNumber != 0) {
            this._bot.action(/(&page:1-next-|&page:1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: '&page:1-next-'})
                ctu.answerCbQuery()
            })

            this._bot.action(/(&page:2-next-|&page:2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: '&page:2-next-'})
                ctu.answerCbQuery()
            })
        } else {
            const thatContactMap = that.weChatClient.contactMap

            let source1: ContactInterface[] | undefined = [...thatContactMap?.get(1) || []].map(item => item.contact)
            let source2: ContactInterface[] | undefined = [...thatContactMap?.get(2) || []].map(item => item.contact)

            source1 = await TelegramBotClient.filterByNameAndAlias(currentSearchWord, source1)
            source2 = await TelegramBotClient.filterByNameAndAlias(currentSearchWord, source2)


            this._bot.action(/(&page:1-next-|&page:1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source1, code: '&page:1-next-'})
                ctu.answerCbQuery()
            })

            this._bot.action(/(&page:2-next-|&page:2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source2, code: '&page:2-next-'})
                ctu.answerCbQuery()
            })
        }

        ctx.editMessageText(this.t('telegram.msg.selectContacts'), {
            ...Markup.inlineKeyboard(buttons),
        })

    }

    private async toButtons({ctu, source, code}: { ctu: any, source: ContactInterface[] | undefined, code: string }) {
        let pageNumber = parseInt(ctu.match[2])
        // const prefix = ctx.match[0].slice(0, 1)
        const direction = ctu.match[1]

        let nextPageNum = 0

        nextPageNum = direction === code ? pageNumber += 1 : pageNumber -= 1
        // 修改 prefix1 对应的变量 todo
        ctu.editMessageReplyMarkup({
            inline_keyboard:
                [...await this.pageDataButtons(source, nextPageNum, TelegramBotClient.PAGE_SIZE, TelegramBotClient.LINES)]
        })
        return await this.pageDataButtons(source, pageNumber, TelegramBotClient.PAGE_SIZE, TelegramBotClient.LINES)
    }

    private static async filterByNameAndAlias(currentSearchWord: string, source: ContactInterface[] | undefined): Promise<ContactInterface[] | undefined> {
        if (currentSearchWord && currentSearchWord.length > 0 && source) {
            return (await Promise.all(
                source.map(async it => {
                    const alias = await it.alias()
                    if (it.name().includes(currentSearchWord) || (alias && alias.includes(currentSearchWord))) {
                        return it
                    } else {
                        return null
                    }
                })
            )).filter(it => it !== null) as ContactInterface[]
        }
        return source
    }

    private async pageDataButtons(source: ContactInterface[] | undefined, page: number, pageSize: number, lines: number) {
        if (source === undefined) {
            return []
        }
        const start = page * pageSize
        const end = start + pageSize
        const slice = source.slice(start, end)

        const type = source[0]?.type()

        const nextButton = Markup.button.callback(this.t('common.nextPage'), `&page:${type}-next-${page}`)
        const pervButton = Markup.button.callback(this.t('common.prevPage'), `&page:${type}-perv-${page}`)

        const buttons = []
        for (let i = 0; i < slice.length; i += lines) {
            const row = []
            for (let j = i; j < i + lines && j < slice.length; j++) {
                const alias = await slice[j].alias()
                if (!slice[j].isReady()) {
                    await slice[j].sync()
                }
                row.push(Markup.button.callback(alias ? `[${alias}] ${slice[j].name()}` : slice[j].name(), slice[j].id.replace(/@/, '')))
            }
            buttons.push(row)
        }
        // console.warn('buttons', buttons)

        if (buttons.length > 0) {
            if (page > 0 && end < source.length) {
                buttons.push([pervButton, nextButton])
            } else {
                if (page > 0) {
                    buttons.push([pervButton])
                }
                if (end < source.length) {
                    buttons.push([nextButton])
                }
            }
        }

        return buttons
    }

    private loadOwnerChat(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {
        try {

            const ownerFile = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.OWNER_FILE_NAME}`
            // 检查存储文件夹是否存在，不存在则创建
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(ownerFile)
            }

            // 检查所有者文件是否存在
            if (fs.existsSync(ownerFile)) {
                // 读取文件并设置所有者和聊天 ID
                const ownerData = fs.readFileSync(ownerFile, 'utf8')
                const {owner_id, chat_id} = JSON.parse(ownerData)
                this._ownerId = owner_id ? owner_id : ctx.from?.id
                this._chatId = chat_id ? chat_id : ctx.chat?.id
            } else {
                // 创建并写入新的所有者文件
                const ownerData = {
                    owner_id: ctx.from?.id,
                    chat_id: ctx.message?.chat.id
                }
                fs.writeFileSync(ownerFile, JSON.stringify(ownerData, null, 2))
                this._ownerId = typeof ownerData.owner_id === 'number' ? ownerData.owner_id : 0
                this._chatId = typeof ownerData.chat_id === 'number' ? ownerData.chat_id : 0
            }

        } catch (error) {
            this.logError('Error loading owner data:', error)
        }
    }


    private loadForwardSettings() {
        // 没有就创建
        try {
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(StorageSettings.STORAGE_FOLDER)
            }
            const variableContainer = new VariableContainer()
            variableContainer.parseFromFile()
            this.forwardSetting = variableContainer
        } catch (error) {
            this.logError('Error loading owner data:', error)

        }

    }

    public getUserId() {
        this._bot.telegram.getChat(this._chatId).then(value => {
            console.log(value)
        })
    }

    public async findPinMessage() {
        //找到pin消息
        const chatInfo = await this._bot.telegram.getChat(this.chatId)
        if (chatInfo.pinned_message) {
            this.pinnedMessageId = chatInfo.pinned_message.message_id
            this._bot.telegram.editMessageText(this.chatId, this.pinnedMessageId, undefined, this.t('common.emptyReply')).then((res) => {
                if (typeof res !== 'boolean') {
                    this._bot.telegram.pinChatMessage(this._chatId, res.message_id)
                }
            }).catch(e => {
                //名字相同不用管
                if (e.response.error_code === 400) {
                    return
                }
                this._bot.telegram.sendMessage(this._chatId, this.t('common.emptyReply')).then(msg => {
                    this._bot.telegram.pinChatMessage(this._chatId, msg.message_id).then(() => {
                        this.pinnedMessageId = msg.message_id
                    })
                })
            })
        } else {
            // 发送消息并且pin
            this._bot.telegram.sendMessage(this._chatId, this.t('common.emptyReply')).then(msg => {
                this._bot.telegram.pinChatMessage(this._chatId, msg.message_id)
                this.pinnedMessageId = msg.message_id
            })
        }
    }

    private setPin(type: string, name: string | undefined) {
        // 判断是否是群组
        let str = ''
        if (type === 'user') {
            str = `${this.t('telegram.msg.currentReply'), this.t('wechat.user')}:👤 ${name}`
            this._flagPinMessageType = type
        } else if (type === 'room') {
            str = `${this.t('telegram.msg.currentReply'), this.t('wechat.room')}:🌐 ${name}`
            this._flagPinMessageType = type
        } else if (type === 'official') {
            str = `${this.t('telegram.msg.currentReply'), this.t('wechat.official')}:📣 ${name}`
            this._flagPinMessageType = 'user'
        }
        if (this.pinnedMessageId) {
            // 修改pin的内容
            // let editMessageSuccess = true;
            this._bot.telegram.editMessageText(this._chatId, this.pinnedMessageId, undefined, str).then(async (res) => {
                if (typeof res !== 'boolean') {
                    this._bot.telegram.pinChatMessage(this._chatId, res.message_id)
                }
            }).catch(e => {
                // 名字相同不用管
                // pin消息被删除了
                // 发送消息并且pin
                if (e.response.error_code === 400) {
                    return
                }
            })
        } else {
            // 发送消息并且pin
            this._bot.telegram.sendMessage(this._chatId, str).then(msg => {
                this._bot.telegram.pinChatMessage(this._chatId, msg.message_id).then(() => {
                    this.pinnedMessageId = msg.message_id
                })
            })
        }
    }


    public onWeChatLogout(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {

        this._weChatClient.logout().then(() => {
            ctx.reply(this.t('wechat.logoutSuccess')).then(() => this.loginCommandExecuted = false)
        }).catch(() => ctx.reply(this.t('wechat.logoutFail')))
    }

    public onWeChatStop(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {
        this.wechatStartFlag = false
        this._weChatClient.stop().then(() => {
            ctx.reply(this.t('command.stop.success')).then(() => this.loginCommandExecuted = false)
            const filePath = 'storage/wechat_bot.memory-card.json'
            fs.access(filePath, fs.constants.F_OK, async (err) => {
                if (!err) {
                    // 文件存在，删除文件
                    await fs.promises.unlink(filePath)
                }
                this._weChatClient = new WeChatClient(this)
            })
        }).catch(() => ctx.reply(this.t('command.stop.fail')))
    }

    private async generateRoomButtons(rooms: RoomItem[], currentSelectRoomMap: Map<string, RoomItem>, page: number) {
        const size = TelegramBotClient.PAGE_SIZE
        const lineSize = TelegramBotClient.LINES
        const buttons: tg.InlineKeyboardButton[][] = []
        const currentIndex = size * page
        const nextIndex = size * (page + 1)
        const slice = rooms.slice(currentIndex, nextIndex)

        for (let i = 0; i < slice.length; i += lineSize) {
            const row = []
            for (let j = i; j < i + lineSize && j < slice.length; j++) {
                const keyboard = {
                    text: `🌐${await slice[j].room?.topic()}`,
                    data: 'room-index-' + j
                }
                currentSelectRoomMap.set(keyboard.data, slice[j])
                row.push(Markup.button.callback(keyboard.text, keyboard.data))
            }
            buttons.push(row)
        }

        const nextButton = Markup.button.callback(this.t('common.nextPage'), 'room-next-' + (page + 1))
        const prevButton = Markup.button.callback(this.t('common.prevPage'), 'room-next-' + (page - 1))

        if (buttons.length > 0) {
            if (page > 0 && nextIndex < rooms.length) {
                buttons.push([prevButton, nextButton])
            } else {
                if (page > 0) {
                    buttons.push([prevButton])
                }
                if (nextIndex < rooms.length) {
                    buttons.push([nextButton])
                }
            }
        }

        return buttons
    }

    private addToWhiteOrBlackList(text: string) {
        if (this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
            const blackList = this.forwardSetting.getVariable(VariableType.SETTING_BLACK_LIST)
            const find = blackList.find(item => item.name === text)
            // 计算id
            let id = 1
            if (blackList.length > 0) {
                id = parseInt(blackList[blackList.length - 1].id) + 1
            }
            if (!find) {
                blackList.push({id: id + '', name: text})
                this.bot.telegram.sendMessage(this.chatId, this.t('common.addSuccess'))
            }
        } else {
            const whiteList = this.forwardSetting.getVariable(VariableType.SETTING_WHITE_LIST)
            const find = whiteList.find(item => item.name === text)
            // 计算id
            let id = 1
            if (whiteList.length > 0) {
                id = parseInt(whiteList[whiteList.length - 1].id) + 1
            }
            if (!find) {
                whiteList.push({id: id + '', name: text})
                this.bot.telegram.sendMessage(this.chatId, this.t('common.addSuccess'))
            }
        }
        this.forwardSetting.writeToFile()
    }

    private getSettingButton() {
        return {
            inline_keyboard: [
                [Markup.button.callback(this.t('command.setting.messageMode', this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK ? this.t('command.setting.blackMode') : this.t('command.setting.whiteMode')), VariableType.SETTING_NOTION_MODE),],
                [Markup.button.callback(this.t('command.setting.messageFallback', this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS) ? this.t('common.open') : this.t('common.close')), VariableType.SETTING_REPLY_SUCCESS),],
                [Markup.button.callback(this.t('command.setting.autoSwitchContact', this.forwardSetting.getVariable(VariableType.SETTING_AUTO_SWITCH) ? this.t('common.open') : this.t('common.close')), VariableType.SETTING_AUTO_SWITCH),],
                [Markup.button.callback(this.t('command.setting.receiveOfficial', this.forwardSetting.getVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT) ? this.t('common.close') : this.t('common.open')), VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT),],
                [Markup.button.callback(this.t('command.setting.forwardSelf', this.forwardSetting.getVariable(VariableType.SETTING_FORWARD_SELF) ? this.t('common.open') : this.t('common.close')), VariableType.SETTING_FORWARD_SELF),],
                [Markup.button.callback(this.t('command.setting.mediaQualityCompression', this.forwardSetting.getVariable(VariableType.SETTING_COMPRESSION) ? this.t('common.open') : this.t('common.close')), VariableType.SETTING_COMPRESSION),],
                [this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.WHITE ?
                    Markup.button.callback(this.t('command.setting.whiteGroup'), VariableType.SETTING_WHITE_LIST) :
                    Markup.button.callback(this.t('command.setting.blackGroup'), VariableType.SETTING_BLACK_LIST)]
            ],
        }
    }

    public async reset() {
        await this._weChatClient.stop()
        this._weChatClient = new WeChatClient(this)
        setTimeout(() => {
            this.wechatStartFlag = true
            this._weChatClient.start().then(() => {
                // 标记为已执行
                this.loginCommandExecuted = true
            })
        }, 2000)
    }

    public async stop() {
        await this._weChatClient.stop()
        this._weChatClient = new WeChatClient(this)
    }

    private async handleFileMessage(ctx: any, fileType: string | 'audio' | 'video' | 'document' | 'photo' | 'voice') {
        if (!this.wechatStartFlag || !this._weChatClient.client.isLoggedIn) {
            ctx.reply(this.t('common.plzLoginWeChat'))
            return
        }
        if (ctx.message[fileType]) {
            let fileId = ctx.message[fileType].file_id
            let fileSize = ctx.message[fileType].file_size
            const fileName = ctx.message[fileType].file_name
            if (!fileId) {
                fileId = ctx.message[fileType][ctx.message[fileType].length - 1].file_id
                fileSize = ctx.message[fileType][ctx.message[fileType].length - 1].file_size
            }
            if (fileSize && fileSize > 20971520) {
                if (this.tgClient) {
                    // 配置了大文件发送则发送大文件
                    this.tgClient.downloadFile(ctx.message.message_id, ctx.chat.id).then(buff => {
                        if (buff) {
                            const fileBox = FileBox.fromBuffer(Buffer.from(buff), fileName)
                            this.sendFile(ctx, fileBox)
                        } else {
                            ctx.reply(this.t('common.sendFailFailMsg', this.t('common.emptyFile')), {
                                reply_parameters: {
                                    message_id: ctx.message.message_id
                                }
                            })
                        }
                    }).catch(err => {
                        this.logError('use telegram api download file error: ', err)
                        ctx.reply(this.t('common.sendFailFailMsg'), {
                            reply_parameters: {
                                message_id: ctx.message.message_id
                            }
                        })
                    })
                    return
                }
                ctx.reply(this.t('common.sendFailFailMsg', this.t('common.fileLarge')), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
                return
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                let fileBox
                if (fileType === 'voice') {
                    const nowShangHaiZh = new Date().toLocaleString('zh', {
                        timeZone: 'Asia/ShangHai'
                    }).toString().replaceAll('/', '-')
                    fileBox = FileBox.fromUrl(fileLink.toString(), {name: `语音-${nowShangHaiZh.toLocaleLowerCase()}.mp3`})
                } else {
                    fileBox = FileBox.fromUrl(fileLink.toString(), ctx.message[fileType].file_name)
                }
                this.sendFile(ctx, fileBox, fileLink.toString())
            }).catch(() => {
                ctx.reply(this.t('common.sendFailFailMsg'), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        }
    }

    private async sendFile(ctx: any, fileBox: FileBox, fileLink?: string) {
        if (config.PROTOCOL !== '' && config.HOST !== '' && config.PORT !== '' && fileBox.type === FileBoxType.Url && fileLink) {
            // 使用代理的情况
            const savePath = `./save-files/${fileBox.name}`
            FileUtils.downloadWithProxy(fileLink, savePath).then(() => {
                this.sendFile(ctx, FileBox.fromFile(savePath, fileBox.name), savePath)
            }).catch(() => ctx.reply(this.t('common.sendFailMsg', this.t('common.saveOrgFileError'))))
            return
        }
        const replyMessageId = ctx.update.message['reply_to_message']?.message_id
        // 如果是回复的消息 优先回复该发送的消息
        if (replyMessageId) {
            // try get weChat cache message id
            const messageItem = await MessageService.getInstance().findMessageByTelegramMessageId(replyMessageId, ctx.chat.id)
            const weChatMessageId = messageItem.wechat_message_id
            if (weChatMessageId) {
                // 添加或者移除名单
                this.weChatClient.client.Message.find({id: weChatMessageId}).then(message => {
                    if (!message) {
                        ctx.reply(this.t('common.sendFail'), {
                            reply_parameters: {
                                message_id: ctx.message.message_id
                            }
                        })
                        return
                    }
                    this.weChatClient.addMessage(message, fileBox, {
                        chat_id: ctx.chat.id,
                        msg_id: ctx.message.message_id
                    })
                    //     .then(msg => {
                    //     if (fileBox.type === FileBoxType.File && fileLink) {
                    //         FileUtils.deleteFile(fileLink)
                    //     }
                    // })
                    const text = ctx.message.caption
                    if (text) {
                        this.weChatClient.addMessage(message, text, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                    }
                })
            }
            return
        }
        // 如果是群组消息的情况
        if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === this._chatId) {
            const bindItem = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
            if (bindItem) {
                if (bindItem.type === 0) {
                    const contact = this.getContactByBindItem(bindItem)
                    if (contact) {
                        this.weChatClient.addMessage(contact, fileBox, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                        //     .then(msg => {
                        //     if (fileBox.type === FileBoxType.File && fileLink) {
                        //         FileUtils.deleteFile(fileLink)
                        //     }
                        // })
                        const text = ctx.message.caption
                        if (text) {
                            this.weChatClient.addMessage(contact, text, {
                                chat_id: ctx.chat.id,
                                msg_id: ctx.message.message_id
                            })
                        }
                    }
                } else {
                    const room = this.getRoomByBindItem(bindItem)
                    if (room) {
                        this.weChatClient.addMessage(room, fileBox, {
                            chat_id: ctx.chat.id,
                            msg_id: ctx.message.message_id
                        })
                        //     .then(msg => {
                        //     if (fileBox.type === FileBoxType.File && fileLink) {
                        //         FileUtils.deleteFile(fileLink)
                        //     }
                        // })
                        const text = ctx.message.caption
                        if (text) {
                            this.weChatClient.addMessage(room, text, {
                                chat_id: ctx.chat.id,
                                msg_id: ctx.message.message_id
                            })
                        }
                    }
                }
            } else {
                await ctx.reply(this.t('common.sendFailNoBind'), {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            }
            return
        }
        if (this._flagPinMessageType && this._flagPinMessageType === 'user') {
            if (this._currentSelectContact) {
                this.weChatClient.addMessage(this._currentSelectContact, fileBox, {
                    chat_id: ctx.chat.id,
                    msg_id: ctx.message.message_id
                })
                //     .then(msg => {
                //     if (fileBox.type === FileBoxType.File && fileLink) {
                //         FileUtils.deleteFile(fileLink)
                //     }
                // })
                const text = ctx.message.caption
                if (text) {
                    this.weChatClient.addMessage(this._currentSelectContact, text, {
                        chat_id: ctx.chat.id,
                        msg_id: ctx.message.message_id
                    })
                }
            }
        } else {
            if (this.selectRoom) {
                this.weChatClient.addMessage(this.selectRoom, fileBox, {
                    chat_id: ctx.chat.id,
                    msg_id: ctx.message.message_id
                })
                //     .then(msg => {
                //     if (fileBox.type === FileBoxType.File && fileLink) {
                //         FileUtils.deleteFile(fileLink)
                //     }
                // })
                const text = ctx.message.caption
                if (text) {
                    this.weChatClient.addMessage(this.selectRoom, text, {
                        chat_id: ctx.chat.id,
                        msg_id: ctx.message.message_id
                    })
                }
            }
        }
    }

    private async dealWithCommand(ctx: Context, text: string) {
        if (this.waitInputCommand === 'phoneNumber') {
            this.waitInputCommand = undefined
            // 等待输入手机号
            this.phoneNumber = text
            await ctx.deleteMessage()
            return true
        }

        if (this.waitInputCommand === 'password') {
            this.waitInputCommand = undefined
            // 等待输入密码
            this.password = text
            await ctx.deleteMessage()
            return true
        }

        if (this.waitInputCommand === 'listAdd') {
            this.waitInputCommand = undefined
            // 黑白名单添加
            const roomList = this._weChatClient.roomList.filter(room => {
                // const roomName = ;
                return room.room.payload?.topic?.includes(text)
            })
            if (roomList.length === 0) {
                ctx.reply(this.t('common.notFoundGroup'))
            } else {
                const buttons: tg.InlineKeyboardButton[][] = []
                roomList.forEach(item => {
                    const id = UniqueIdGenerator.getInstance().generateId('addBlackOrWhite')
                    this.addBlackOrWhite.push({
                        id: id,
                        text: item.room.payload?.topic
                    })
                })
                const page1 = new Page(this.addBlackOrWhite, 1, TelegramBotClient.PAGE_SIZE)
                const pageList = page1.getList(1)
                for (let i = 0; i < pageList.length; i += 2) {
                    const buttonRow = [Markup.button.callback(`🌐${pageList[i].text}`, `${pageList[i].id}`)]
                    if (i + 1 < pageList.length) {
                        buttonRow.push(Markup.button.callback(`🌐${pageList[i + 1].text}`, `${pageList[i + 1].id}`))
                    }
                    buttons.push(buttonRow)
                }
                if (page1.hasNext()) {
                    buttons.push([Markup.button.callback(this.t('common.nextPage'), 'addBlackOrWhite-2')])
                }
                ctx.reply(this.t('common.chooseGroup'), Markup.inlineKeyboard(buttons))
            }
            return true
        }
        return false
    }

}