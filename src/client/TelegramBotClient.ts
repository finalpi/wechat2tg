import {Context, Markup, session, Telegraf} from 'telegraf'
import {config, useProxy} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import * as fs from 'node:fs'
import {ConfigurationService} from '../service/ConfigurationService'
import {UserAuthParams} from 'telegram/client/auth'
import {message} from 'telegraf/filters'
import {BindGroupService} from '../service/BindGroupService'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'
import {Configuration} from '../entity/Configuration'
import {SimpleMessageSendQueueHelper} from '../util/SimpleMessageSendQueueHelper'
import {MessageSender, Option} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import {FormatUtils} from '../util/FormatUtils'
import {Message} from '../entity/Message'
import {MessageService} from '../service/MessageService'
import {FileUtils} from '../util/FileUtils'
import sharp from 'sharp'
import {ConverterHelper} from '../util/FfmpegUtils'
import * as path from 'node:path'
import TgCommandHelper from '../service/TelegramCommandHelper'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {WxContactRepository} from '../repository/WxContactRepository'
import {KeyboardPageUtils} from '../util/KeyboardPageUtils'
import {BindGroup} from '../entity/BindGroup'
import {WxRoomRepository} from '../repository/WxRoomRepository'
import {WeChatClient} from './WechatClient'
import {FileHelperClient} from './FileHelperClient'
import {handleSticker} from '../util/handleSticker'
import { UrlLink } from 'wx2tg-puppet'

export class TelegramBotClient extends AbstractClient {
    async login(): Promise<boolean> {
        if (!TelegramBotClient.getSpyClient('botClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'botClient',
                client: clientFactory.create('botClient')
            })
        }
        this.startTime = new Date()
        const config = await this.configurationService.getConfig()
        const bot: Telegraf = this.client
        bot.use(session())
        // 此方法需要放在所有监听方法之前,先拦截命令做处理鉴权
        bot.use(async (ctx, next) => {
            const chatId = config.chatId
            if (ctx.message) {
                const messageDate = new Date(ctx.message?.date * 1000)
                if (messageDate.getTime() < this.startTime.getTime()) {
                    return
                }
            }
            if (!chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.message && ctx.message.from.id === chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && ctx.callbackQuery && ctx.callbackQuery.from.id === chatId) {
                return next()
            }

            if (ctx.chat && ctx.chat.type.includes('group') && !ctx.callbackQuery && !ctx.message) {
                return
            }

            // const bind = await this.bindItemService.getBindItemByChatId(ctx.chat.id)
            if (ctx.chat && (chatId === ctx.chat.id)) {
                return next() // 如果用户授权，则继续处理下一个中间件或命令
            }

            if (!ctx.chat?.type.includes('group') && ctx.message && !ctx.message.from.is_bot) {
                return ctx.reply('Sorry, you are not authorized to interact with this bot.') // 如果用户未授权，发送提示消息
            }
        })
        this.onBotCommand(bot)
        this.onMessage(bot)
        this.onBotAction(bot)
        await this.botLaunch(bot)
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async sendMessage(message: BaseMessage): Promise<boolean> {
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.wxMsgId = message.id
        messageEntity.type = message.type
        messageEntity.wxSenderId = message.senderId
        messageEntity.content = message.content
        messageEntity.fhMsgId = message.fhMsgId
        messageEntity.source_type = message.source_type
        messageEntity.source_text = message.source_text
        messageEntity.sender = message.sender
        messageEntity.toWxid = message.toWxid
        messageEntity.msgId = message.msgId
        messageEntity.createTime = message.createTime
        await this.messageService.createOrUpdate(messageEntity)
        // 文本消息放进队列发送
        if (message.type === 0) {
            // 文本消息走队列
            this.sendQueueHelper.addMessageWithMsgId(parseInt(message.id), message)
        } else if (message.type === 1) {
            // 图片消息逻辑
            this.messageSender.sendFile(message.chatId, {
                buff: message.file.file,
                filename: message.file.fileName,
                fileType: message.file.sendType,
                caption: message.sender
            }, {
                parse_mode: 'HTML'
            }).then(msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                this.dealException(e, message)
            })
        } else if (message.type === 2) {
            this.messageSender.sendFile(message.chatId, {
                buff: Buffer.from('0'),
                filename: 'temp_file',
                caption: '文件接收中',
                fileType: 'document'
            }).then(async msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
                // 文件传输助手添加等待中的状态
                const client = TelegramBotClient.getSpyClient('fhClient') as FileHelperClient
                client.waitingMessage.push({
                    date: new Date().getTime(),
                    msgId: message.fhMsgId
                })
            }).catch(e => {
                this.dealException(e, message)
            })
        } else if (message.type === 3) {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            client.telegram.sendMessage(message.chatId, FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, message.content), {
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback('使用文件传输助手接收', `fl:${messageEntity.wxMsgId}`)]]
                },
                parse_mode: 'HTML'
            }).then(async msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                this.dealException(e, message)
            })
        } else if (message.type === 4) {
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            // 名片消息
            client.telegram.sendPhoto(message.chatId, {source: message.file.file, filename: message.file.fileName}, {
                caption: message.content,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback('添加为好友', `af:${message.businessCardId}`)]]
                },
            }).then(async msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                this.dealException(e, message)
            })
        } else if (message.type === 5) {
            // 位置消息处理
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const msgJson = TelegramBotClient.getSpyClient('wxClient').client.Message.getXmlToJson(message.source_text)
            client.telegram.sendLocation(message.chatId, parseFloat(msgJson.msg.location.x), parseFloat(msgJson.msg.location.y), {
                reply_markup: {
                    inline_keyboard: [[Markup.button.callback(msgJson.msg.location.poiname || msgJson.msg.location.label, 'null')]]
                }
            }).then(async msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                this.dealException(e, message)
            })
        } else if (message.type === 6) {
            const revokeMsg = await this.messageService.getByWxMsgId(message.revokeMsgId)
            const client = TelegramBotClient.getSpyClient('botClient').client as Telegraf
            let param = undefined
            if (revokeMsg) {
                param = {
                    reply_parameters: {
                        message_id: revokeMsg.tgBotMsgId
                    }
                }
            }
            client.telegram.sendMessage(message.chatId, message.content, param).then(async msgRes => {
                messageEntity.tgBotMsgId = parseInt(msgRes.message_id + '')
                this.messageService.createOrUpdate(messageEntity)
            }).catch(e => {
                this.dealException(e, message)
            })
        }
        return true
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance = undefined
    private sendQueueHelper: SimpleMessageSendQueueHelper
    private configurationService = ConfigurationService.getInstance()
    private bindGroupService: BindGroupService
    private messageService: MessageService
    private chatId: number
    // 等待命令输入
    private waitInputCommand: string | undefined = undefined
    private phoneNumber: string | undefined = undefined
    private password: string | undefined = undefined
    private phoneCode = ''
    private messageSender: MessageSender
    // bot 启动时间
    private startTime: Date
    config: Configuration | undefined

    static getInstance(): TelegramBotClient {
        if (!TelegramBotClient.instance) {
            TelegramBotClient.instance = new TelegramBotClient()
        }
        return TelegramBotClient.instance
    }

    private constructor() {
        super()
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info)
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            this.client = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: httpAgent
                }
            })
        } else {
            this.client = new Telegraf(config.BOT_TOKEN)
        }
        this.hasReady = true
        // 加载配置
        this.configurationService.getConfig().then(config => {
            this.chatId = config.chatId
            this.config = config
        })
        this.bindGroupService = BindGroupService.getInstance()
        this.messageService = MessageService.getInstance()
        // 判断文件夹是否存在
        if (!fs.existsSync('save-files')) {
            fs.mkdirSync('save-files')
        }
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendTextMsg.bind(this), 617)
        this.messageSender = SenderFactory.createSender(this.client)
    }

    private async sendTextMsg(message: BaseMessage) {
        // 发送文本消息的方法
        const bindGroup = await this.bindGroupService.getByWxId(message.wxId)
        if (!bindGroup) {
            return
        }
        const sendTextFormat = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, message.content)
        const option: Option = {
            parse_mode: 'HTML'
        }
        if (message.param?.reply_id) {
            option.reply_id = message.param.reply_id
        }
        let newMsg
        // 长文本分片发送
        const html = message.content
        const maxLength = 9000
        if (html.length > maxLength) {
            // 分割长文本,分多次发送
            const result = []
            let currentLength = 0
            let currentChunk = ''

            // 使用正则表达式匹配HTML标签
            const regex = /(<[^>]+>|[^<]+)/g
            let match

            while ((match = regex.exec(html)) !== null) {
                const chunk = match[0] // 获取当前匹配的片段
                const chunkLength = chunk.length

                // 检查当前片段加上当前块的长度是否超过最大长度
                if (currentLength + chunkLength > maxLength) {
                    // 如果超过最大长度，先将当前块存入结果
                    result.push(currentChunk)
                    // 重置当前块和当前长度
                    currentChunk = ''
                    currentLength = 0
                }

                // 将当前片段添加到当前块
                currentChunk += chunk
                currentLength += chunkLength
            }

            // 添加最后一块（如果有）
            if (currentChunk) {
                result.push(currentChunk)
            }

            for (let i = 0; i < result.length; i++) {
                let sendMsg = result[i]
                if (result.length > 1) {
                    sendMsg = `<b>part${i + 1}:</b>` + sendMsg
                }
                const sendTextFormat = FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, message.sender, sendMsg)
                if (i == 0) {
                    newMsg = await this.messageSender.sendText(bindGroup.chatId, sendTextFormat, option).catch(async e => {
                        await this.dealException(e, message)
                    })
                } else {
                    await this.messageSender.sendText(bindGroup.chatId, sendTextFormat, option).catch(async e => {
                        await this.dealException(e, message)
                    })
                }
            }
        } else {
            newMsg = await this.messageSender.sendText(bindGroup.chatId, sendTextFormat, option).catch(async e => {
                await this.dealException(e, message)
            })
        }

        // 更新chatId
        const messageEntity = await this.messageService.getByWxMsgId(message.id)
        if (newMsg && messageEntity) {
            messageEntity.tgBotMsgId = parseInt(newMsg.message_id + '')
            this.messageService.createOrUpdate(messageEntity)
        }
        return
    }

    private async dealException(e, message: BaseMessage) {
        console.error(e)
        if (e.response.error_code === 403) {
            this.bindGroupService.removeByChatIdOrWxId(message.chatId, message.senderId)
            const config = await this.configurationService.getConfig()
            message.chatId = config.botId
            this.sendTextMsg(message)
        }
        // Telegram Too Many Requests
        else if (e.response.error_code === 429) {
            setTimeout(() => {
                // this._tgClient.bot.telegram.sendMessage(message.chatId,
                //     SimpleMessageSender.send(
                //         {
                //             body: this.t('common.tooManyRequests', e.response.parameters.retry_after),
                //             chatId: message.chatId,
                //         }))
                this.logError(e.response.parameters.retry_after)
                this.sendMessage(message)
            }, e.response.parameters.retry_after * 1000 || 20000)
        }
    }

    private onBotAction(bot: Telegraf) {
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
            ctx.editMessageText(`请输入你收到的验证码: ${inputCode}`, {
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

        bot.action(/^fl:/, async ctx => {
            if (!TelegramBotClient.getSpyClient('fhClient').hasLogin) {
                ctx.sendMessage('请先在 bot 中使用 /flogin 指令登录文件传输助手')
                ctx.answerCbQuery()
                return
            }

            const msg = await this.messageService.getByBotMsgId(ctx.chat.id, ctx.msgId)
            if (msg) {
                ctx.deleteMessage()
                this.downloadFileByFileHelper(msg)
            }

            ctx.answerCbQuery()
        })

        bot.action(/^af:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            const friend = wxClient.getCardByWxId(wxId)
            if (friend) {
                friend.v3 = friend.username
                TelegramBotClient.getSpyClient('wxClient').client.Friendship.add(friend, '你好')
                ctx.reply('好友请求已发送')
            } else {
                ctx.reply('名片已过期')
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })

        bot.action(/^message/, async ctx => {
            const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
            if (bindGroup) {
                bindGroup.isReceive = !bindGroup.isReceive
                await this.bindGroupService.createOrUpdate(bindGroup)
                ctx.editMessageReplyMarkup({
                    inline_keyboard: [[{
                        text: `状态：${bindGroup.isReceive ? '接收消息' : '屏蔽消息'}`,
                        callback_data: 'message'
                    }]]
                })
            }
            ctx.answerCbQuery()
        })

        bot.action(/^forward/, async ctx => {
            const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
            if (bindGroup) {
                bindGroup.isForwardOthers = !bindGroup.isForwardOthers
                await this.bindGroupService.createOrUpdate(bindGroup)
                ctx.editMessageReplyMarkup({
                    inline_keyboard: [[{
                        text: `状态：${bindGroup.isForwardOthers ? '转发' : '不转发'}`,
                        callback_data: 'forward'
                    }]]
                })
            }
            ctx.answerCbQuery()
        })

        bot.action(/^st:/, async ctx => {
            const booleanKey = ctx.match.input.split(':')[1]
            const config = await this.configurationService.getConfig()
            config[booleanKey] = !config[booleanKey]
            await this.configurationService.saveConfig(config)
            ctx.editMessageReplyMarkup(await this.getSettingButton())
            ctx.answerCbQuery()
        })

        bot.action(/^us:page-/, async ctx => {
            const pageNum = ctx.match.input.split('-')[1]
            const data = TelegramBotClient.getSpyClient('wxClient').client.db.findAllContacts()
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.userName
                }
            })
            const page = new KeyboardPageUtils(dataMap, parseInt(pageNum), 'us')
            ctx.editMessageReplyMarkup(page.getMarkup())
            ctx.answerCbQuery()
        })

        bot.action(/^us:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const contact = await TelegramBotClient.getSpyClient('wxClient').client.Contact.find({id: wxId})
            if (contact) {
                if (ctx.chat && ctx.chat.type.includes('group')) {
                    await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, wxId)
                    // 群组中使用，重新绑定
                    const group = new BindGroup()
                    group.chatId = ctx.chat.id
                    group.wxId = wxId
                    group.type = 0
                    group.name = contact.name()
                    await this.bindGroupService.createOrUpdate(group)
                    this.updateGroupByChatId(group.chatId)
                    ctx.reply('绑定成功')
                } else {
                    // bot中使用，创建新的群组
                    const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
                    let bindGroup = new BindGroup()
                    bindGroup.wxId = wxId
                    bindGroup.name = contact.name()
                    bindGroup.avatarLink = await contact.avatar()
                    bindGroup.type = 0
                    const alias = await contact.alias()
                    if (alias !== bindGroup.name) {
                        bindGroup.alias = alias
                    }
                    bindGroup = await telegramGroupOperateService.createGroup(bindGroup)
                    const inviteLink = await ctx.telegram.exportChatInviteLink(bindGroup.chatId)
                    if (inviteLink) {
                        ctx.reply('创建群组成功', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{text: '打开群组 🚀', url: inviteLink}]
                                ]
                            }
                        })
                    }
                }
            }
            ctx.answerCbQuery()
        })

        bot.action(/^ro:page-/, async ctx => {
            const pageNum = ctx.match.input.split('-')[1]
            const data = TelegramBotClient.getSpyClient('wxClient').client.db.findAllRooms()
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.chatroomId
                }
            })
            const page = new KeyboardPageUtils(dataMap, parseInt(pageNum), 'ro')
            ctx.editMessageReplyMarkup(page.getMarkup())
            ctx.answerCbQuery()
        })

        bot.action(/^ro:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const room = await TelegramBotClient.getSpyClient('wxClient').client.Room.find({id: wxId})
            if (room) {
                if (ctx.chat && ctx.chat.type.includes('group')) {
                    await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, wxId)
                    // 群组中使用，重新绑定
                    const group = new BindGroup()
                    group.chatId = ctx.chat.id
                    group.wxId = wxId
                    group.type = 1
                    group.name = room.name
                    await this.bindGroupService.createOrUpdate(group)
                    this.updateGroupByChatId(group.chatId)
                    ctx.reply('绑定成功')
                } else {
                    // bot中使用，创建新的群组
                    const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
                    let bindGroup = new BindGroup()
                    bindGroup.wxId = wxId
                    bindGroup.name = room.name
                    const avatar = await room.avatar()
                    bindGroup.avatarLink = avatar.url
                    bindGroup.type = 1
                    bindGroup = await telegramGroupOperateService.createGroup(bindGroup)
                    const inviteLink = await ctx.telegram.exportChatInviteLink(bindGroup.chatId)
                    if (inviteLink) {
                        ctx.reply('创建群组成功', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{text: '打开群组 🚀', url: inviteLink}]
                                ]
                            }
                        })
                    }
                }
            }
            ctx.answerCbQuery()
        })

        bot.action(/^fr:/, async ctx => {
            const wxId = ctx.match.input.split(':')[1]
            const wxClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            const friend = wxClient.getFriendShipByWxId(wxId)
            if (friend) {
                friend.accept()
                ctx.reply('添加成功')
            } else {
                ctx.reply('好友请求已过期')
            }
            ctx.deleteMessage()
            ctx.answerCbQuery()
        })
    }

    async downloadFileByFileHelper(msg: Message) {
        this.messageSender.sendFile(msg.chatId, {
            buff: Buffer.from('0'),
            filename: 'temp_file',
            caption: '文件接收中',
            fileType: 'document'
        }).then(async msgRes => {
            msg.tgBotMsgId = parseInt(msgRes.message_id + '')
            const wxClient = TelegramBotClient.getSpyClient('wxClient').client
            const result = await wxClient.Message.forwardTo(msg.source_text, 'filehelper', msg.source_type)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            msg.fhMsgId = result.newMsgId.c.join('')
            this.messageService.createOrUpdate(msg)
            // 文件传输助手添加等待中的状态
            const client = TelegramBotClient.getSpyClient('fhClient') as FileHelperClient
            client.waitingMessage.push({
                date: new Date().getTime(),
                msgId: msg.fhMsgId
            })
        })
    }

    onMessage(bot: Telegraf) {
        bot.on(message('text'), async ctx => {
            // 识别文本类型
            let text
            let linkTitle
            let linkUrl
            let linkDesc
            text = ctx.message.text
            if (ctx.message && 'entities' in ctx.message) {
                const msgEntities = ctx.message.entities as any[]
                if (msgEntities && msgEntities.length > 0) {
                    let entity = msgEntities[0]
                    for (const item of msgEntities) {
                        // 只处理第一个链接
                        if (item.type === 'text_link' || item.type === 'url') {
                            entity = item
                            break
                        }
                    }

                    if (entity.type === 'text_link' && entity.url) {
                        linkTitle = ctx.message.text
                        linkUrl = entity.url
                        linkDesc = ''
                    } else if (entity.type === 'url') {
                        linkTitle = '非公众号链接'
                        linkUrl = ctx.message.text.substring(
                            entity.offset,
                            entity.offset + entity.length
                        )
                        linkDesc = linkUrl
                    }

                    if (linkTitle && linkUrl) {
                        text = new UrlLink({
                            title: linkTitle,
                            desc: linkDesc,
                            thumbUrl: 'https://raw.githubusercontent.com/hououinkami/docker/refs/heads/main/wx2tg/wechat.png',
                            linkUrl: linkUrl,
                        })
                    }
                }
            }
            // 处理完毕
            const messageId = ctx.message.message_id
            const chatId = ctx.chat.id
            const exist = await this.bindGroupService.getByChatId(chatId)
            // 处理等待用户输入的指令
            if (await this.dealWithCommand(ctx, text)) {
                return
            }
            if (!exist) {
                // 未绑定消息直接返回
                return
            }
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            // 其他 bot 的命令会进来，不处理
            if (typeof text === 'string' && text.startsWith('/')) {
                return
            }
            const message: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: text,
                type: 0
            }
            if (replyMessageId) {
                message.param = {
                    replyMessageId: replyMessageId
                }
            }
            // 发送消息到微信
            TelegramBotClient.getSpyClient('wxClient').sendMessage(message)
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

        bot.on(message('sticker'), async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            const chatId = ctx.chat.id
            const exist = await this.bindGroupService.getByChatId(chatId)
            if (!exist) {
                // 未绑定消息直接返回
                return
            }
            const fileId = ctx.message.sticker.file_id
            // 使用md5发送贴纸
            const messageId = ctx.message.message_id
            const stickerMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: '',
                type: 0
            }
            const stickerEmoji = await handleSticker(ctx)
            if (stickerEmoji) {
                stickerMessage.content = stickerEmoji
                TelegramBotClient.getSpyClient('wxClient').sendMessage(stickerMessage)
                return
            } else {
                console.log('TG贴纸ID:', ctx.message.sticker.file_id)
            }
            // 若匹配不到md5则使用静态图片形式发送
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                const uniqueId = ctx.message.sticker.file_unique_id
                const href = fileLink.href
                const fileName = `${uniqueId}-${href.substring(href.lastIndexOf('/') + 1, href.length)}`
                const saveFile = `save-files/${fileName}`
                const gifFile = `save-files/${fileName.slice(0, fileName.lastIndexOf('.'))}.gif`

                const lottie_config = {
                    width: 128,
                    height: 128
                }
                // 微信不能发超过1Mb的gif文件
                if (saveFile.endsWith('.tgs')) {
                    lottie_config.width = 512
                    lottie_config.height = 512
                }

                // gif 文件存在
                if (fs.existsSync(gifFile)) {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                } else if (!fs.existsSync(saveFile)) {
                    FileUtils.downloadWithProxy(fileLink.toString(), saveFile).then(() => {
                        this.sendGif(saveFile, gifFile, ctx, lottie_config)
                    }).catch(() => ctx.reply('发送失败'))
                } else {
                    this.sendGif(saveFile, gifFile, ctx, lottie_config)
                }
            }).catch(e => {
                ctx.reply('发送失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        })

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
                } else if (saveFile.endsWith('.webm')) {
                    await new ConverterHelper().webmToGif(saveFile, gifFile)
                } else if (saveFile.endsWith('.webp')) {
                    await new ConverterHelper().webpToGif(saveFile, gifFile)
                }
            }
            if (!fs.existsSync(gifFile)) {
                await ctx.reply('表情转换失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
                return
            }
            const messageId = ctx.message.message_id
            const chatId = ctx.chat.id
            const baseMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: '',
                type: 1
            }
            const buffer = fs.readFileSync(gifFile)

            // 提取文件名
            const fileName = path.basename(gifFile)
            baseMessage.content = fileName
            baseMessage.file = {
                fileName: fileName,
                file: Buffer.from(buffer),
            }
            TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
        } catch (e) {
            this.logError('发送失败')
            await ctx.reply('发送失败', {
                reply_parameters: {
                    message_id: ctx.message.message_id
                }
            })
        }

    }

    private async handleFileMessage(ctx: any, fileType: string | 'audio' | 'video' | 'document' | 'photo' | 'voice') {
        if (!TelegramBotClient.getSpyClient('wxClient').hasReady || !TelegramBotClient.getSpyClient('wxClient').hasLogin) {
            ctx.reply('请先登录微信')
            return
        }
        const messageId = ctx.message.message_id
        const chatId = ctx.chat.id
        const exist = await this.bindGroupService.getByChatId(chatId)
        if (!exist) {
            // 未绑定消息直接返回
            return
        }
        const baseMessage: BaseMessage = {
            id: messageId + '',
            senderId: '',
            wxId: '',
            sender: '{me}',
            chatId: chatId,
            content: '',
            type: 1
        }
        if (ctx.message[fileType]) {
            let fileId = ctx.message[fileType].file_id
            let fileSize = ctx.message[fileType].file_size
            let fileName = ctx.message[fileType].file_name || ''
            if (!fileName && fileType === 'photo') {
                fileName = new Date().getTime() + '.png'
            }
            if (!fileName && fileType === 'video') {
                fileName = new Date().getTime() + '.mp4'
            }
            if (!fileId) {
                fileId = ctx.message[fileType][ctx.message[fileType].length - 1].file_id
                fileSize = ctx.message[fileType][ctx.message[fileType].length - 1].file_size
            }
            if (fileSize && fileSize > 20971520) {
                // 配置了大文件发送则发送大文件
                FileUtils.getInstance().downloadLargeFile(ctx.message.message_id, ctx.chat.id).then(buff => {
                    if (buff) {
                        baseMessage.content = fileName
                        baseMessage.file = {
                            fileName: fileName,
                            file: Buffer.from(buff),
                        }
                        TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                    } else {
                        ctx.reply('发送失败', {
                            reply_parameters: {
                                message_id: ctx.message.message_id
                            }
                        })
                    }
                }).catch(err => {
                    this.logError('use telegram api download file error: ' + err)
                    ctx.reply('发送失败', {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    })
                })
                return
            }
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            ctx.telegram.getFileLink(fileId).then(async fileLink => {
                FileUtils.downloadBufferWithProxy(fileLink.toString()).then(buffer => {
                    // 如果图片大小小于100k,则添加元数据使其大小达到100k,否则会被微信压缩质量
                    if (fileSize && fileSize < 100 * 1024 && (fileType === 'photo' || (fileName.endsWith('jpg') || fileName.endsWith('jpeg') || fileName.endsWith('png')))) {
                        baseMessage.content = fileName
                        // 构造包含无用信息的 EXIF 元数据
                        const exifData = {
                            IFD0: {
                                // 添加一个长字符串作为无用信息
                                ImageDescription: '0'.repeat(110_000 - Buffer.byteLength(buffer))
                            }
                        }

                        // 保存带有新元数据的图片
                        sharp(buffer)
                            .toFormat('png')
                            .withMetadata({exif: exifData})
                            .toBuffer()
                            .then(buff => {
                                baseMessage.file = {
                                    fileName: fileName,
                                    file: buff,
                                }
                                TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                            }).catch((err) => {
                            ctx.reply('发送失败')
                        })
                        return
                    }
                    if (fileType === 'voice') {
                        fileName = `语音-${new Date().getTime()}.mp3`
                    }
                    baseMessage.content = fileName
                    baseMessage.file = {
                        fileName: fileName,
                        file: buffer,
                    }
                    TelegramBotClient.getSpyClient('wxClient').sendMessage(baseMessage)
                }).catch(() => ctx.reply('发送失败'))
            }).catch(reason => {
                ctx.reply('发送失败', {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
            })
        }
        // 带有文本的消息单独发送文本
        if (ctx.text) {
            const textMessage: BaseMessage = {
                id: messageId + '',
                senderId: '',
                wxId: '',
                sender: '{me}',
                chatId: chatId,
                content: ctx.text,
                type: 0
            }
            TelegramBotClient.getSpyClient('wxClient').sendMessage(textMessage)
        }
    }

    private onBotCommand(bot: Telegraf) {
        TgCommandHelper.setCommand(bot)
        TgCommandHelper.setSimpleCommandHandler(bot)

        bot.start(ctx => {
            ctx.reply('请输入 /login 登陆,或者输入 /help 查看帮助\n请注意执行/login 后你就是该机器的所有者', Markup.removeKeyboard())
        })

        bot.help((ctx) => ctx.replyWithMarkdownV2(`**欢迎使用微信消息转发bot**

[本项目](https://github.com/finalpi/wechat2tg)是基于 gewechty 开发的 pad 协议实现微信消息的收发。
**本项目仅用于技术研究和学习，不得用于非法用途。**

1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录。
2\\. 使用 /user 或者 /room 命令搜索联系人或者群聊（可以加名称或者备注,例如"/user 张"可以搜索名称或备注含有"张"的用户）。
3\\. /settings 打开设置。
4\\. 更多功能请查看 github 仓库（For more features, please check the GitHub repository README）。`))

        bot.command('login', async ctx => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                return ctx.reply('该命令无法在群组中使用')
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient')
            if (wxClient && wxClient.hasLogin) {
                return ctx.reply('已登录，请勿重复登录')
            }
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // todo 先判断是否登录 TG user client
            this.loginUserClient()
        })

        bot.command('flogin', async ctx => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                return ctx.reply('该命令无法在群组中使用')
            }
            const fhClient = TelegramBotClient.getSpyClient('fhClient')
            if (fhClient && fhClient.hasLogin) {
                return ctx.reply('已登录，请勿重复登录')
            }
            // 首次登录设置主人 chatId
            const config = await this.configurationService.getConfig()
            if (!config.chatId || config.chatId === 0) {
                config.chatId = ctx.chat.id
                this.chatId = ctx.chat.id
                await this.configurationService.saveConfig(config)
            }
            // 登录文件传输助手客户端
            this.loginFileHelperClient()
        })

        bot.command('settings', async ctx => {
            ctx.sendMessage('程序设置:', {
                reply_markup: await this.getSettingButton()
            })
        })

        bot.command('update', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.updateGroupByChatId(ctx.chat.id)
            } else {
                return ctx.reply('仅支持群组中使用')
            }
        })

        bot.command('unbind', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                await this.bindGroupService.removeByChatIdOrWxId(ctx.chat.id, undefined)
                ctx.reply('解绑成功')
            } else {
                return ctx.reply('仅支持群组中使用')
            }
        })

        bot.command('message', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
                if (!bindGroup) {
                    ctx.reply('该群组暂未绑定')
                    return
                }
                ctx.reply('是否接收该群组消息', {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: `当前状态：${bindGroup.isReceive ? '接收消息' : '屏蔽消息'}`,
                                callback_data: 'message'
                            }
                        ]]
                    }
                })
            } else {
                return ctx.reply('仅支持群组中使用')
            }
        })

        bot.command('forward', async (ctx) => {
            if (ctx.chat && ctx.chat.type.includes('group')) {
                const bindGroup = await this.bindGroupService.getByChatId(ctx.chat.id)
                if (!bindGroup) {
                    ctx.reply('该群组暂未绑定')
                    return
                }
                ctx.reply('是否转发群组内其他人的消息', {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: `当前状态：${bindGroup.isForwardOthers ? '转发' : '不转发'}`,
                                callback_data: 'forward'
                            }
                        ]]
                    }
                })
            } else {
                return ctx.reply('仅支持群组中使用')
            }
        })

        bot.command('add', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/add\s+([\p{L}\p{N}_]+)/u)
            if (match && match.length > 1) {
                const contact = await TelegramBotClient.getSpyClient('wxClient').client.Friendship.search(match[1])
                if (!contact.v3) {
                    return ctx.reply('没有搜索到该用户')
                }
                TelegramBotClient.getSpyClient('wxClient').client.Friendship.add(contact, '你好')
                ctx.reply('好友请求已发送')
            } else {
                ctx.reply('请在 /add 命令后面加上你要添加的联系人的手机号，例如：/add 18888888888')
            }
        })

        bot.command('user', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/user\s+([\p{L}\p{N}_]+)/u)
            let data
            if (match) {
                const userName = match[1]
                data = await WxContactRepository.getInstance().getByNickNameOrRemark(userName)
            } else {
                data = await WxContactRepository.getInstance().getAll()
            }
            if (!data || data.length === 0) {
                ctx.reply('未查找到联系人')
                return
            }
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.userName
                }
            })
            const page = new KeyboardPageUtils(dataMap, 1, 'us')
            if (match) {
                page.pageSize = 999
            }
            let text
            if (ctx.chat && ctx.chat.type.includes('group')) {
                text = '绑定联系人'
            } else {
                text = '创建联系人群组'
            }
            ctx.reply(text, {
                reply_markup: page.getMarkup()
            })
        })

        bot.command('room', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            // 获取消息文本
            const messageText = ctx.update.message.text

            // 正则表达式用来分离命令后面的参数
            const match = messageText.match(/\/room\s+([\p{L}\p{N}_]+)/u)
            let data
            if (match) {
                const userName = match[1]
                data = await WxRoomRepository.getInstance().getByNickNameOrRemark(userName)
            } else {
                data = await WxRoomRepository.getInstance().getAll()
            }
            if (!data || data.length === 0) {
                ctx.reply('未查找到群组')
                return
            }
            const dataMap = data.map(item => {
                return {
                    remark: item.remark ? item.remark : item.nickName,
                    action: item.chatroomId
                }
            })
            const page = new KeyboardPageUtils(dataMap, 1, 'ro')
            if (match) {
                page.pageSize = 999
            }
            let text
            if (ctx.chat && ctx.chat.type.includes('group')) {
                text = '绑定微信群'
            } else {
                text = '创建微信群群组'
            }
            ctx.reply(text, {
                reply_markup: page.getMarkup()
            })
        })

        bot.command('revoke', async ctx => {
            const replyMessageId = ctx.update.message['reply_to_message']?.message_id
            if (!replyMessageId) {
                return ctx.reply('请回复需要撤回的消息')
            }
            const msg = await this.messageService.getByBotMsgId(ctx.chat.id, replyMessageId)
            if (!msg) {
                return ctx.reply('撤回失败')
            }
            const wxClient: WeChatClient = TelegramBotClient.getSpyClient('wxClient') as WeChatClient
            if (wxClient.wxInfo.wxid !== msg.wxSenderId) {
                return ctx.reply('撤回失败,无法撤回其他人发送的消息')
            }
            await wxClient.revokeMessage(msg)
            ctx.reply('撤回请求已发送')
        })

        bot.command('getqr', async ctx => {
            if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
                ctx.reply('请先登录微信')
                return
            }
            const wxClient = TelegramBotClient.getSpyClient('wxClient').client
            const qr = await wxClient.qrcode()
            const base64Data = qr.qrCode.replace(/^data:image\/\w+;base64,/, '')
            const imageBuffer = Buffer.from(base64Data, 'base64')
            ctx.replyWithPhoto({source: imageBuffer})
        })
    }

    private async updateGroupByChatId(chatId: number) {
        const bindItem = await this.bindGroupService.getByChatId(chatId)
        if (bindItem) {
            const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, TelegramBotClient.getSpyClient('userMTPClient').client)
            if (bindItem.type === 0) {
                const wxContact = await TelegramBotClient.getSpyClient('wxClient').client.Contact.find({id: bindItem.wxId})
                if (wxContact) {
                    await wxContact.sync()
                    bindItem.name = wxContact.name()
                    bindItem.avatarLink = await wxContact.avatar()
                    const alias = await wxContact.alias()
                    if (alias !== bindItem.name) {
                        bindItem.alias = alias
                    }
                    telegramGroupOperateService.updateGroup(bindItem)
                }
            } else {
                const wxRoom = await TelegramBotClient.getSpyClient('wxClient').client.Room.find({id: bindItem.wxId})
                if (wxRoom) {
                    await wxRoom.sync()
                    bindItem.name = wxRoom.name
                    bindItem.alias = wxRoom.remark
                    const avatar = await wxRoom.avatar()
                    bindItem.avatarLink = avatar.url
                    telegramGroupOperateService.updateGroup(bindItem)
                }
            }
        } else {
            this.messageSender.sendText(chatId, '当前未绑定联系人或微信群')
        }
    }

    private async getSettingButton() {
        const settings = await this.configurationService.getSetting()
        const inline_keyboard = []
        const keys = settings.keys()
        for (const key of keys) {
            inline_keyboard.push([Markup.button.callback(`${settings.get(key).description}(${settings.get(key).options.get(settings.get(key).value)})`, `st:${key}`)])
        }
        return {
            inline_keyboard: inline_keyboard,
        }
    }

    private loginWechatClient() {
        if (!TelegramBotClient.getSpyClient('wxClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'wxClient',
                client: clientFactory.create('wxClient')
            })
        }
        if (!TelegramBotClient.getSpyClient('wxClient').hasLogin) {
            TelegramBotClient.getSpyClient('wxClient').login()
        }
    }

    private loginFileHelperClient() {
        // if (!TelegramBotClient.getSpyClient('fhClient')) {
        //     const clientFactory = new ClientFactory()
        //     TelegramBotClient.addSpyClient({
        //         interfaceId: 'fhClient',
        //         client: clientFactory.create('fhClient')
        //     })
        // }
        // if (!TelegramBotClient.getSpyClient('fhClient').hasLogin) {
        //     TelegramBotClient.getSpyClient('fhClient').login()
        // }
    }

    private loginMTPClient() {
        if (!TelegramBotClient.getSpyClient('botMTPClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'botMTPClient',
                client: clientFactory.create('botMTPClient')
            })
        }
        if (!TelegramBotClient.getSpyClient('botMTPClient').hasLogin) {
            TelegramBotClient.getSpyClient('botMTPClient').login()
        }
    }

    public async loginUserClient() {
        if (!TelegramBotClient.getSpyClient('userMTPClient')) {
            const clientFactory = new ClientFactory()
            TelegramBotClient.addSpyClient({
                interfaceId: 'userMTPClient',
                client: clientFactory.create('userMTPClient')
            })
        }
        const authParams: UserAuthParams = {
            onError(err: Error): Promise<boolean> | void {
                console.error(err)
            },
            phoneNumber: async () =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请先登录 Telegram 客户端，请输入你的 Telegram 账户的手机号码（需要带国家区号，例如：+8613355558888）').then(res => {
                        this.waitInputCommand = 'phoneNumber'
                        const intervalId = setInterval(() => {
                            if (this.phoneNumber) {
                                const phoneNumber = this.phoneNumber
                                this.phoneNumber = undefined
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneNumber)
                            }
                        }, 1000)
                    })
                }),
            password: async (hint?: string) =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请输入你的二步验证密码:').then(res => {
                        this.waitInputCommand = 'password'
                        const intervalId = setInterval(() => {
                            if (this.password) {
                                const password = this.password
                                this.password = undefined
                                clearInterval(intervalId)
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(password)
                            }
                        }, 1000)
                    })
                }),
            phoneCode: async (isCodeViaApp?) =>
                new Promise((resolve) => {
                    this.client.telegram.sendMessage(this.chatId, '请输入你收到的验证码:_ _ _ _ _\n', {
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
                                this.client.telegram.deleteMessage(this.chatId, res.message_id)
                                resolve(phoneCode)
                            }
                        }, 1000)
                    })
                }),
        }
        if (!TelegramBotClient.getSpyClient('userMTPClient').hasLogin) {
            TelegramBotClient.getSpyClient('userMTPClient').login(authParams).then(login => {
                if (login) {
                    this.client.telegram.sendMessage(this.chatId, 'Telegram 客户端登录成功！')
                    this.loginWechatClient()
                }
            })
        }
    }


    private async botLaunch(bot: Telegraf, retryCount = 5) {
        if (retryCount >= 0) {
            bot.launch(() => {
                // 保存 botID
                this.configurationService.getConfig().then(config => {
                    if (!config.botId || config.botId == 0) {
                        const botId = this.client.botInfo.id
                        config.botId = botId
                        this.configurationService.saveConfig(config)
                    }
                    this.hasLogin = true
                    if (config.chatId > 0) {
                        this.loginUserClient()
                        // 登录 botMTP 客户端
                        this.loginMTPClient()
                        if (config.useFileHelper) {
                            this.loginFileHelperClient()
                        }
                    }
                })
            }).then(() => {
                // 启动后做的事情
            }).catch(error => {
                this.botLaunch(bot, retryCount - 1)
            })
        }
        process.once('SIGINT', () => bot.stop('SIGINT'))
        process.once('SIGTERM', () => bot.stop('SIGTERM'))
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
        return false
    }

}