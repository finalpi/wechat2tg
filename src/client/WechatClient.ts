import {GeweBot, Filebox, Message as WeChatMessage, WeVideo, Voice} from 'gewechaty'
import {ConfigurationService} from '../service/ConfigurationService'
import QRCode from 'qrcode'
import {config} from '../config'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {BindGroupService} from '../service/BindGroupService'
import {UserMTProtoClient} from './UserMTProtoClient'
import {BindGroup} from '../entity/BindGroup'
import {FormatUtils} from '../util/FormatUtils'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'
import {SimpleMessageSendQueueHelper} from '../util/SimpleMessageSendQueueHelper'
import {Markup, Telegraf} from 'telegraf'
import {MessageService} from '../service/MessageService'
import {Message} from '../entity/Message'
import {FileUtils} from '../util/FileUtils'
import {getGeWeChatDataSource} from '../data-sourse'
import {ConverterHelper} from '../util/FfmpegUtils'
import {MessageTypeUtils} from '../util/MessageTypeUtils'
import {EmojiConverter} from '../util/EmojiUtils'

export class WeChatClient extends AbstractClient {
    get wxInfo() {
        return this._wxInfo
    }
    private configurationService = ConfigurationService.getInstance()
    private groupOperate: TelegramGroupOperateService
    private bindGroupService: BindGroupService
    private sendQueueHelper: SimpleMessageSendQueueHelper
    private scanMsgId: number = undefined
    private messageService: MessageService
    private friendshipList = []
    private _wxInfo
    // 登陆时间
    private startTime

    private static instance = undefined

    static getInstance(): WeChatClient {
        if (!WeChatClient.instance) {
            WeChatClient.instance = new WeChatClient()
        }
        return WeChatClient.instance
    }

    private constructor() {
        super()
        this.groupOperate = new TelegramGroupOperateService(BindGroupService.getInstance(), UserMTProtoClient.getInstance().client)
        this.bindGroupService = BindGroupService.getInstance()
        this.messageService = MessageService.getInstance()
        this.client = new GeweBot({
            debug: config.DEBUG_MODE, // 是否开启调试模式 默认false
            base_api: config.BASE_API,
            file_api: config.FILE_API,
            proxy: config.CALLBACK_API,
            static: 'save-files',
            ds_path: 'storage/ds.json',
            db_path: 'storage/db/'
        })
        this.hasReady = true
        this.init()
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendTextMsg.bind(this), 617)
    }

    getFriendShipByWxId(wxId: string) {
        return this.friendshipList.find(item => item.formId === wxId)
    }

    getCardByWxId(wxId: string) {
        return this.friendshipList.find(item => item.username === wxId)
    }

    private async sendTextMsg(message: BaseMessage) {
        // 发送文本消息的方法
        const bindGroup = await this.bindGroupService.getByChatId(message.chatId)
        if (bindGroup) {
            let msgResult
            let quoteMsg: Message
            if (message.param?.replyMessageId) {
                quoteMsg = await this.messageService.getByBotMsgId(bindGroup.chatId, message.param?.replyMessageId)
            }
            if (bindGroup.type === 0) {
                const contact = await this.client.Contact.find({id: bindGroup.wxId})
                if (quoteMsg) {
                    msgResult = await contact.quoteSay(message.content, quoteMsg.wxMsgId, quoteMsg.wxSenderId, quoteMsg.content)
                } else {
                    msgResult = await contact.say(message.content)
                }
            } else {
                const room = await this.client.Room.find({id: bindGroup.wxId})
                if (quoteMsg) {
                    msgResult = await room.quoteSay(message.content, quoteMsg.wxMsgId, quoteMsg.wxSenderId, quoteMsg.content)
                } else {
                    msgResult = await room.say(message.content)
                }
            }
            // 将 msgId 更新到数据库
            const messageEntity = await this.messageService.getByBotMsgId(bindGroup.chatId, parseInt(message.id))
            if (msgResult && messageEntity) {
                messageEntity.wxMsgId = msgResult.newMsgId
                messageEntity.msgId = msgResult.msgId
                messageEntity.createTime = msgResult.createTime
                messageEntity.toWxid = msgResult.toWxid
                this.messageService.createOrUpdate(messageEntity)
            }
        }
    }

    async login(): Promise<boolean> {
        if (!WeChatClient.getSpyClient('wxClient')) {
            const clientFactory = new ClientFactory()
            WeChatClient.addSpyClient({
                interfaceId: 'wxClient',
                client: clientFactory.create('wxClient')
            })
        }
        if (this.scanMsgId) {
            const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
            this.configurationService.getConfig().then(config => {
                tgBotClient.telegram.sendMessage(config.chatId, '请扫描二维码登录,第一次登录加载时间较长，请耐心等待', {
                    reply_parameters: {
                        message_id: this.scanMsgId
                    }
                })
            })
            return
        }
        this.client.start().then(async ({app, router}) => {
            //
            app.use(router.routes()).use(router.allowedMethods())
            getGeWeChatDataSource().initialize().then(() => {
                console.log('GeWeChatDataSource initialized')
            }).catch((e) => {
                console.error('GeWeChatDataSource initialize failed', e)
            })
            this.startTime = new Date().getTime() / 1000
            this.loginSuccess()
        })
        return true
    }

    private async loginSuccess() {
        this._wxInfo = await this.client.info()
        this.hasLogin = true
        const config = await this.configurationService.getConfig()
        const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
        tgBotClient.telegram.sendMessage(config.chatId, '微信登录成功')
        if (this.scanMsgId) {
            tgBotClient.telegram.deleteMessage(config.chatId, this.scanMsgId)
            this.scanMsgId = undefined
        }

        // 登录后更新群组绑定信息
        setTimeout(async () => {
            const allBind = await this.bindGroupService.getAll()
            for (const bindGroup of allBind) {
                // 添加延迟防止接口调用过快
                setTimeout(() => {
                    this.updateGroupByChatId(bindGroup.chatId)
                }, 500)
            }
        }, 10000)
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async sendMessage(message: BaseMessage): Promise<boolean> {
        if (!this.hasReady || !this.hasLogin) {
            return
        }
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.tgBotMsgId = parseInt(message.id)
        messageEntity.wxSenderId = this._wxInfo.wxid
        messageEntity.type = message.type
        messageEntity.content = message.content
        await this.messageService.createOrUpdate(messageEntity)
        if (message.type === 0) {
            // 文本消息走队列
            this.sendQueueHelper.addMessageWithMsgId(parseInt(message.id), message)
        } else {
            // 文件消息
            const bindGroup = await this.bindGroupService.getByChatId(message.chatId)
            if (bindGroup) {
                let msgResult
                let file
                if (message.file.fileName.endsWith('.mp4')) {
                    message.file.fileName = 'video.mp4'
                    const url = FileUtils.saveFile(message.file.file, message.file.fileName)
                    // 提取视频封面
                    const ffmpegUtil = await new ConverterHelper()
                    const videoPath = `save-files/_gewetemp/${message.file.fileName}`
                    await ffmpegUtil.extractThumbnail(videoPath, `save-files/_gewetemp/${message.file.fileName}.jpg`)
                    file = new WeVideo({
                        thumbUrl: `${config.CALLBACK_API}/_gewetemp/${message.file.fileName}.jpg`, // 视频封面
                        videoUrl: url, // 视频文件url
                        videoDuration: 9, // 视频时长单位秒 似乎随便传个值就行
                    })
                } else {
                    file = Filebox.fromBuff(message.file.file, message.file.fileName)
                }
                if (bindGroup.type === 0) {
                    const contact = await this.client.Contact.find({id: bindGroup.wxId})
                    msgResult = await contact.say(file)
                } else {
                    const room = await this.client.Room.find({id: bindGroup.wxId})
                    msgResult = await room.say(file)
                }
                // 将 msgId 更新到数据库
                const messageEntity = await this.messageService.getByBotMsgId(bindGroup.chatId, parseInt(message.id))
                if (msgResult && messageEntity) {
                    messageEntity.wxMsgId = msgResult.newMsgId
                    messageEntity.msgId = msgResult.msgId
                    messageEntity.createTime = msgResult.createTime
                    messageEntity.toWxid = msgResult.toWxid
                    this.messageService.createOrUpdate(messageEntity)
                }
            }
        }
        return true
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private init() {
        this.client.on('scan', qr => { // 需要用户扫码时返回对象qrcode.content为二维码内容 qrcode.url为转化好的图片地址
            this.configurationService.getConfig().then(config => {
                QRCode.toBuffer(qr.content, {
                    width: 300
                }, (error, buffer) => {
                    if (!error) {
                        const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
                        if (this.scanMsgId) {
                            tgBotClient.telegram.editMessageMedia(config.chatId, this.scanMsgId, undefined, {
                                type: 'photo',
                                media: {source: buffer}, caption: '请扫描二维码登录,第一次登录加载时间较长，请耐心等待'
                            })
                        } else {
                            tgBotClient.telegram.sendPhoto(config.chatId, {source: buffer}, {caption: '请扫描二维码登录,第一次登录加载时间较长，请耐心等待'}).then(msg => {
                                this.scanMsgId = msg.message_id
                            })
                        }
                    }
                })
            })
        })

        this.client.on('all', msg => { // 如需额外的处理逻辑可以监听 all 事件 该事件将返回回调地址接收到的所有原始数据
        })

        this.client.on('friendship', (friendship) => {
            this.friendshipList.push(friendship)
            const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
            this.configurationService.getConfig().then(config => {
                tgBotClient.telegram.sendMessage(config.chatId, `<b>${friendship.fromName}</b> 请求添加您为好友:\n  ${friendship.hello()}`, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[Markup.button.callback('接受', `fr:${friendship.formId}`)]]
                    }
                })
            })
        })

        this.client.on('message', (msg) => {
            // 此处放回的msg为Message类型 可以使用Message类的方法
            this.onMessage(msg)
        })

        this.client.on('login', (msg) => {
            this.loginSuccess()
        })
    }

    async onMessage(msg: WeChatMessage) {
        // TODO: 只处理新消息，丢弃历史消息（未来可以增加选项更好的保存聊天记录）
        if (msg._createTime < this.startTime) {
            return
        }
        // 过滤重复消息
        const oldMsg = await this.messageService.getByWxMsgId(msg._newMsgId)
        if (oldMsg) {
            return
        }
        // 查找 group
        let wxId
        const room = await msg.room()
        const fromContact = await msg.from()
        let contact = await msg.from()
        const configuration = await this.configurationService.getConfig()
        if (msg.self()) {
            // 过滤自己发送的消息
            if (!configuration.selfMessage) {
                return
            }
            contact = await msg.to()
        }
        const alias = await contact.alias()
        let topic
        if (room) {
            //
            wxId = room.chatroomId
            topic = room.name
        } else {
            wxId = contact._wxid
        }
        const fh = await this.client.Contact.find({id: 'filehelper'})
        if (wxId === 'filehelper') {
            return
        }
        if (wxId && wxId.startsWith('gh_') && !configuration.receivePublicAccount) {
            return
        }
        // 企业微信 wxId
        if (!wxId) {
            wxId = msg.fromId
        }
        if (wxId.includes('@app')) {
            // 服务通知
            wxId = 'app'
        }
        let bindGroup = await this.bindGroupService.getByWxId(wxId)
        // 如果找不到就创建一个新的群组
        if (!bindGroup && wxId !== this._wxInfo.wxid) {
            bindGroup = new BindGroup()
            bindGroup.wxId = wxId
            bindGroup.isReceive = true
            if (room) {
                bindGroup.type = 1
                bindGroup.name = room.name
                const avatar = await room.avatar()
                bindGroup.avatarLink = avatar.url
                if (!bindGroup.name) {
                    bindGroup.name = '企业微信群'
                }
            } else {
                bindGroup.type = 0
                bindGroup.name = contact.name()
                if (alias !== bindGroup.name) {
                    bindGroup.alias = contact._alias
                }
                bindGroup.avatarLink = await contact.avatar()
                if (wxId.includes('@openim')) {
                    // 企业微信
                    if (bindGroup.name === 'no name') {
                        bindGroup.name = msg._pushContent.split(':')[0].slice(0, -1)
                    }
                    bindGroup.avatarLink = 'https://raw.githubusercontent.com/finalpi/wechat2tg/wx2tg-pad/qywx.jpg'
                }
                if (wxId === 'app') {
                    // 服务通知
                    bindGroup.name = '服务通知'
                    bindGroup.avatarLink = 'https://raw.githubusercontent.com/finalpi/wechat2tg/wx2tg-pad/fwtz.png'
                }
            }
            bindGroup = await this.groupOperate.createGroup(bindGroup)
        }
        if (!bindGroup) {
            return
        }
        // 屏蔽消息
        if (!bindGroup.isReceive) {
            return
        }
        // 身份
        let identityType
        if (bindGroup.type === 0) {
            if (wxId && wxId.startsWith('gh_')) {
                identityType = config.OFFICIAL_MESSAGE_GROUP
            } else {
                identityType = config.CONTACT_MESSAGE_GROUP
            }
        } else {
            identityType = config.ROOM_MESSAGE_GROUP
        }
        let identity
        if (wxId && wxId === 'app') {
            identity = FormatUtils.transformTitleStr(config.OFFICIAL_MESSAGE_GROUP, '', '服务通知', topic)
        } else {
            identity = FormatUtils.transformTitleStr(identityType, fromContact._alias !== fromContact.name() ? fromContact._alias : '', fromContact.name(), topic)
        }
        const messageParam: BaseMessage = {
            id: msg._newMsgId,
            senderId: contact._wxid,
            wxId: wxId,
            sender: identity,
            chatId: bindGroup.chatId,
            type: 0,
            content: msg.text() + '',
            source_type: msg.type(),
            source_text: msg.text(),
            toWxid: msg.toId,
            msgId: msg._msgId,
            createTime: msg._createTime
        }
        let referMsg
        let filebox
        let fileBuff: Buffer
        let msgJson
        let appLinkList
        const emojiConverter = new EmojiConverter()
        switch (msg.type()) {
            case this.client.Message.Type.Text:
                // 因为是html模式 原始的文本中的<>需要转义
                messageParam.content = messageParam.content.replaceAll(/</g, '&lt;')
                    .replaceAll(/>/g, '&gt;')
                // emoji 转换
                messageParam.content = emojiConverter.convert(messageParam.content, configuration)
                if (await msg.mentionSelf()) {
                    // 如果自己被 @ 了
                    const tgId = configuration.chatId
                    if (this._wxInfo) {
                        messageParam.content = messageParam.content.replaceAll(`@${this._wxInfo.nickName}`,
                            `<a href="tg://user?id=${tgId}">@${this._wxInfo.nickName}</a>`)
                        messageParam.content = messageParam.content.replaceAll('@所有人',
                            `<a href="tg://user?id=${tgId}">@所有人</a>`)
                    }
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Link:
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                msgJson = this.client.Message.getXmlToJson(msg._xml)
                appLinkList = msgJson.msg.appmsg.mmreader?.category?.item
                if (appLinkList) {
                    // 判断是否是数组，有可能是对象
                    if (Array.isArray(appLinkList)) {
                        messageParam.content = appLinkList.map((it, index) => {
                            return `<a href="${it.url}">${it.title}</a><blockquote expandable>${it.summary || it.digest}</blockquote>`
                        }).join('\n')
                    } else {
                        messageParam.content = `<a href="${appLinkList.url}">${appLinkList.title}</a><blockquote expandable>${appLinkList.summary || appLinkList.digest}</blockquote>`
                    }
                } else {
                    messageParam.content = `<a href="${msgJson.msg.appmsg.url}">${msgJson.msg.appmsg.title}</a>`
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Quote:
                // TODO: 错误
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                referMsg = await this.messageService.getByWxMsgId(msg.refer.svrid)
                // 因为是html模式 原始的文本中的<>需要转义
                messageParam.content = messageParam.content.replaceAll(/</g, '&lt;')
                    .replaceAll(/>/g, '&gt;')
                // emoji 转换
                messageParam.content = emojiConverter.convert(messageParam.content, configuration)
                if (referMsg) {
                    messageParam.param = {
                        reply_id: referMsg.tgBotMsgId
                    }
                } else {
                    // 找不到上下文
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    msgJson = this.client.Message.getXmlToJson(msg._xml)
                    if (msgJson.msg.appmsg.refermsg.content) {
                        messageParam.content = `<blockquote>${msgJson.msg.appmsg.refermsg.content}</blockquote>${messageParam.content}`
                    }
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Contact:
                // 名片消息处理
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                msgJson = this.client.Message.getXmlToJson(msg._xml)
                this.friendshipList.push(msgJson.msg)
                messageParam.type = 4
                if (msgJson.msg.bigheadimgurl) {
                    fileBuff = await FileUtils.getInstance().downloadUrl2Buffer(msgJson.msg.bigheadimgurl)
                } else {
                    fileBuff = await FileUtils.getInstance().downloadUrl2Buffer(msgJson.msg.smallheadimgurl)
                }
                messageParam.file = {
                    fileName: 'head.png',
                    file: fileBuff,
                    sendType: 'photo'
                }
                messageParam.content = `${identity} \n推荐给你一位联系人 <b>${msgJson.msg.nickname}</b>`
                messageParam.businessCardId = msgJson.msg.username
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Image:
            case this.client.Message.Type.Emoji:
                if (this.client.Message.Type.Image === msg.type()) {
                    filebox = await msg.toFileBox(1)
                    if (filebox.url === config.FILE_API) {
                        filebox = await msg.toFileBox(2)
                    }
                    if (filebox.url === config.FILE_API) {
                        filebox = await msg.toFileBox(3)
                    }
                } else if (this.client.Message.Type.Emoji === msg.type()) {
                    filebox = {
                        name: 'emoji.gif',
                        // TODO: 错误
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        url: msg.emoji.cdnurl,
                    }
                } else {
                    filebox = await msg.toFileBox()
                }
                if (!filebox || filebox.url === config.FILE_API) {
                    return
                }
                fileBuff = await FileUtils.getInstance().downloadUrl2Buffer(filebox.url)
                messageParam.type = 1
                messageParam.file = {
                    fileName: filebox.name,
                    file: fileBuff,
                    sendType: this.wxFileType2TgFileType(msg.type().toString())
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Video:
            case this.client.Message.Type.File:
                // 转发文件和视频消息到文件传输助手
                messageParam.type = 2
                if (configuration.useFileHelper && WeChatClient.getSpyClient('fhClient').hasLogin) {
                    const result = await msg.forward(fh)
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    messageParam.fhMsgId = result.newMsgId.c.join('')
                    messageParam.content = identity
                    WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                    break
                } else {
                    // 未登录
                    messageParam.type = 3
                    messageParam.content = `收到一条${msg.type()}消息，请在手机上查看`
                    WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                    break
                }
            case this.client.Message.Type.Location:
                // 位置消息处理
                messageParam.type = 5
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Transfer:
                // 转账消息处理
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                msgJson = this.client.Message.getXmlToJson(msg._xml)
                messageParam.content = `收到一条${MessageTypeUtils.getTypeName(msg.type() + '')}消息，请在手机上接收<blockquote expandable>金额：${msgJson.msg.appmsg.wcpayinfo.feedesc}\n转账备注：${msgJson.msg.appmsg.wcpayinfo.pay_memo || ''}</blockquote>`
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Revoke:
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                msgJson = this.client.Message.getXmlToJson(msg._xml)
                messageParam.content = msgJson.sysmsg.revokemsg.replacemsg
                messageParam.type = 6
                messageParam.revokeMsgId = msgJson.sysmsg.revokemsg.newmsgid
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            default:
                if (MessageTypeUtils.SKIP_TYPE_LIST.includes(msg.type() + '')) {
                    break
                }
                if (msg.type()) {
                    console.log('unknow', msg)
                    messageParam.content = `收到一条${MessageTypeUtils.getTypeName(msg.type() + '')}消息，请在手机上查看`
                    WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                }
                break
        }
    }

    private async updateGroupByChatId(chatId: number) {
        const bindItem = await this.bindGroupService.getByChatId(chatId)
        if (bindItem) {
            const telegramGroupOperateService = new TelegramGroupOperateService(this.bindGroupService, WeChatClient.getSpyClient('userMTPClient').client)
            if (bindItem.type === 0) {
                const wxContact = await WeChatClient.getSpyClient('wxClient').client.Contact.find({id: bindItem.wxId})
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
                const wxRoom = await WeChatClient.getSpyClient('wxClient').client.Room.find({id: bindItem.wxId})
                if (wxRoom) {
                    await wxRoom.sync()
                    bindItem.name = wxRoom.name
                    const avatar = await wxRoom.avatar()
                    bindItem.avatarLink = avatar.url
                    telegramGroupOperateService.updateGroup(bindItem)
                }
            }
        }
    }

    // 微信文件类型转为tg类型
    wxFileType2TgFileType(messageType: string): 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice' {
        switch (messageType) {
            case this.client.Message.Type.Emoji:
                return 'animation'
            case this.client.Message.Type.Image:
                return 'photo'
            case this.client.Message.Type.Voice:
                return 'voice'
            case this.client.Message.Type.Video:
                return 'video'
            default:
                return 'document'
        }
    }

    // 撤回消息
    async revokeMessage(message: Message) {
        return await this.client.Message.revoke({
            toWxid: message.toWxid,
            msgId: message.msgId,
            newMsgId: message.wxMsgId,
            createTime: message.createTime
        })
    }
}