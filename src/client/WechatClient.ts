import {Emoji, Voice, WxBot} from 'wx2tg-puppet'
import {Message as WxMessage} from 'wx2tg-puppet'
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
import {getChatHistory, getMiniprogram} from '../util/handleMsg'
import {WeVideo} from 'wx2tg-puppet'
import {FileBox} from 'file-box'
import I18n from '../i18n'

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
    // 正在创建的群组 Map，用于防止并发创建重复群组
    private creatingGroups: Map<string, Promise<BindGroup>> = new Map()

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
        this.client = new WxBot({
            baseUrl: config.BASE_API,
            databasePath: 'storage/db/puppet.db',
            deviceType: config.DEVICE_TYPE,
            mode: config.MODE,
            callbackPort: parseInt(config.CALLBACK_PORT),
            ProxyIp: config.WX_PROXY_HOST,
            ProxyUser: config.WX_PROXY_USERNAME,
            ProxyPassword: config.WX_PROXY_PASSWORD
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
            try {
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
                        if (message.content.startsWith('@all')) {
                            message.content = message.content.replace('@all', '')
                            msgResult = await room.say(message.content, '@all')
                        } else {
                            msgResult = await room.say(message.content)
                        }
                    }
                }
            }catch (e) {
                this.logger.error(e)
                const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
                tgBotClient.telegram.sendMessage(message.chatId, '消息发送失败！',{
                    reply_parameters: {
                        message_id: parseInt(message.id)
                    }
                })
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
        this.client.start().then(async () => {
            getGeWeChatDataSource().initialize().then(() => {
                console.log('DataSource initialized')
            }).catch((e) => {
                console.error('DataSource initialize failed', e)
            })
            this.startTime = new Date().getTime() / 1000
        })
        return true
    }

    async loginSuccess() {
        this._wxInfo = await this.client.info()
        this.hasLogin = true
        const config = await this.configurationService.getConfig()
        const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
        const i18n = I18n.getInstance()
        tgBotClient.telegram.sendMessage(config.chatId, i18n.t('wechat.login_success'))
        if (this.scanMsgId) {
            tgBotClient.telegram.deleteMessage(config.chatId, this.scanMsgId)
            this.scanMsgId = undefined
        }

        // 登录后更新群组绑定信息
        // 修复错误绑定的群聊信息
        await this.bindGroupService.fixGroup()
        if (config.syncWechat) {
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
    }

    async logout(): Promise<boolean> {
        this.hasLogin = false
        return true
    }

    async sendMessage(message: BaseMessage): Promise<boolean> {
        if (!this.hasReady || !this.hasLogin) {
            return
        }
        try {
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
                        message.file.fileName = new Date().getTime() + 'video.mp4'
                        const url = FileUtils.saveFile(message.file.file, message.file.fileName)
                        // 提取视频封面
                        const ffmpegUtil = await new ConverterHelper()
                        const videoPath = `save-files/_temp/${message.file.fileName}`
                        await ffmpegUtil.extractThumbnail(videoPath, `save-files/_temp/${message.file.fileName}.jpg`)
                        const fbv = FileBox.fromBuffer(message.file.file, message.file.fileName)
                        const fbt = FileBox.fromFile(`save-files/_temp/${message.file.fileName}.jpg`, message.file.fileName + '.jpg')
                        file = new WeVideo({
                            thumbBase64: await fbt.toBase64(), // 视频封面
                            videoBase64: await fbv.toBase64(), // 视频文件url
                            videoDuration: message.file.duration || 9, // 视频时长单位秒 似乎随便传个值就行
                        })
                    } else if(message.file.fileName.startsWith('语音') && message.file.fileName.endsWith('mp3')){
                        const fbv = FileBox.fromBuffer(message.file.file, message.file.fileName)
                        file = new Voice({
                            voiceBase64: await fbv.toBase64(),
                            voiceDuration: message.file.duration * 1000 || 9000,
                            type: 2
                        })
                    }else if(message.file.fileName.endsWith('.gif')) {
                        const fbe = FileBox.fromBuffer(message.file.file, message.file.fileName)
                        file = new Emoji({
                            emojiBase64: await fbe.toBase64()
                        })
                    } else {
                        file = FileBox.fromBuffer(message.file.file, message.file.fileName)
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
        }catch (e) {
            this.logger.error(e)
            const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
            tgBotClient.telegram.sendMessage(message.chatId, '消息发送失败！',{
                reply_parameters: {
                    message_id: parseInt(message.id)
                }
            })
        }
        return true
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private init() {
        const i18n = I18n.getInstance()

        this.client.on('scan', qr => { // 需要用户扫码时返回对象qrcode.content为二维码内容 qrcode.url为转化好的图片地址
            this.hasLogin = false
            this.configurationService.getConfig().then(config => {
                QRCode.toBuffer(qr.content, {
                    width: 300
                }, (error, buffer) => {
                    if (!error) {
                        const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
                        if (this.scanMsgId) {
                            tgBotClient.telegram.editMessageMedia(config.chatId, this.scanMsgId, undefined, {
                                type: 'photo',
                                media: {source: buffer}, caption: i18n.t('wechat.scan_qr_code')
                            })
                        } else {
                            tgBotClient.telegram.sendPhoto(config.chatId, {source: buffer}, {caption: i18n.t('wechat.scan_qr_code')}).then(msg => {
                                this.scanMsgId = msg.message_id
                            })
                        }
                    }
                })
            })
        })

        this.client.on('loginFail', content => {
            this.configurationService.getConfig().then(config => {
                const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
                const i18n = I18n.getInstance()
                if (content.msg.includes('请提交验证码后登录')) {
                    tgBotClient.telegram.sendMessage(config.chatId, i18n.t('wechat.login_fail'))
                }
            })
        })

        this.client.on('all', msg => { // 如需额外的处理逻辑可以监听 all 事件 该事件将返回回调地址接收到的所有原始数据
        })

        this.client.on('friendship', (friendship) => {
            this.friendshipList.push(friendship)
            const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
            this.configurationService.getConfig().then(config => {
                tgBotClient.telegram.sendMessage(config.chatId,
                    i18n.t('wechat.friend_request', {
                        name: `<b>${friendship.fromName}</b>`,
                        hello: friendship.hello()
                    }), {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[Markup.button.callback(i18n.t('wechat.accept'), `fr:${friendship.formId}`)]]
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

    async onMessage(msg: WxMessage) {
        // TODO: 只处理新消息，丢弃历史消息（未来可以增加选项更好的保存聊天记录）
        if (msg.date() < this.startTime) {
            return
        }
        // 过滤重复消息
        const oldMsg = await this.messageService.getByWxMsgId(msg.newMsgId)
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
        if (wxId === 'filehelper') {
            return
        }
        if (wxId && wxId.startsWith('gh_') && !configuration.receivePublicAccount) {
            return
        }
        // 公众号仅接收通知消息模式
        if (wxId && wxId.startsWith('gh_') && configuration.onlyReceiveOfficialNotify) {
            const sourceText = msg.text()
            if (sourceText && !sourceText.includes('<notify_msg')) {
                return
            }
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
            // 检查是否正在创建该群组
            if (this.creatingGroups.has(wxId)) {
                // 等待正在进行的创建操作完成
                bindGroup = await this.creatingGroups.get(wxId)
            } else {
                // 创建新的群组
                const createPromise = (async () => {
                    try {
                        // 再次检查数据库，防止在等待期间已经被创建
                        let existingGroup = await this.bindGroupService.getByWxId(wxId)
                        if (existingGroup) {
                            return existingGroup
                        }

                        const newBindGroup = new BindGroup()
                        newBindGroup.wxId = wxId
                        newBindGroup.isReceive = true
                        if (room) {
                            newBindGroup.type = 1
                            newBindGroup.name = room.name
                            newBindGroup.alias = room.remark
                            const avatar = await room.avatar()
                            newBindGroup.avatarLink = avatar.url
                            if (!newBindGroup.name) {
                                newBindGroup.name = '未命名群聊'
                            }
                        } else {
                            newBindGroup.type = 0
                            newBindGroup.name = contact.name()
                            if (alias !== newBindGroup.name) {
                                newBindGroup.alias = contact._alias
                            }
                            newBindGroup.avatarLink = await contact.avatar()
                            if (wxId.includes('@openim')) {
                                // 企业微信
                                if (newBindGroup.name === 'no name') {
                                    newBindGroup.name = msg._pushContent.split(':')[0].slice(0, -1)
                                }
                                newBindGroup.avatarLink = 'https://raw.githubusercontent.com/finalpi/wechat2tg/wx2tg-pad/qywx.jpg'
                            }
                            if (wxId === 'app') {
                                // 服务通知
                                newBindGroup.name = I18n.getInstance().t('wechat.service_notification')
                                newBindGroup.avatarLink = 'https://raw.githubusercontent.com/finalpi/wechat2tg/wx2tg-pad/fwtz.png'
                            }
                        }
                        return await this.groupOperate.createGroup(newBindGroup)
                    } finally {
                        // 创建完成后从 Map 中移除
                        this.creatingGroups.delete(wxId)
                    }
                })()
                
                this.creatingGroups.set(wxId, createPromise)
                bindGroup = await createPromise
            }
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
            id: msg.newMsgId,
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
            case WxMessage.Type.Text:
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
            case WxMessage.Type.Link:
                msgJson = WxMessage.getXmlToJson(msg._xml)
                appLinkList = msgJson.msg.appmsg.mmreader?.category?.item
                if (appLinkList) {
                    // 判断是否是数组，有可能是对象
                    if (Array.isArray(appLinkList)) {
                        messageParam.content = appLinkList.map((it, index) => {
                            return `<a href="${it.url}">${it.title}</a><blockquote>${it.summary || it.digest}</blockquote>`
                        }).join('\n')
                    } else {
                        messageParam.content = `<a href="${appLinkList.url}">${appLinkList.title}</a><blockquote>${appLinkList.summary || appLinkList.digest}</blockquote>`
                    }
                } else {
                    messageParam.content = `<a href="${msgJson.msg.appmsg.url}">${msgJson.msg.appmsg.title}</a>`
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.Quote:
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
                    msgJson = WxMessage.getXmlToJson(msg._xml)
                    if (msgJson.msg.appmsg.refermsg.content) {
                        let quoteContent = msgJson.msg.appmsg.refermsg.content
                        if (msgJson.msg.appmsg.refermsg.type === 49) {
                            // 解决嵌套引用
                            const newJson = WxMessage.getXmlToJson(msgJson.msg.appmsg.refermsg.content)
                            quoteContent = newJson.msg.appmsg.title
                        }
                        messageParam.content = `<blockquote>${quoteContent}</blockquote>${messageParam.content}`
                    }
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.Contact:
                // 名片消息处理
                msgJson = WxMessage.getXmlToJson(msg._xml)
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
            case WxMessage.Type.Image:
            case WxMessage.Type.Video:
            case WxMessage.Type.Emoji:
            case WxMessage.Type.File:
            case WxMessage.Type.Voice:
                filebox = await msg.toFileBox()
                if (!filebox) {
                    return
                }
                fileBuff = await filebox.toBuffer()
                messageParam.type = 1
                messageParam.file = {
                    fileName: filebox.name,
                    file: fileBuff,
                    sendType: this.wxFileType2TgFileType(msg.type().toString())
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.Location:
                // 位置消息处理
                messageParam.type = 5
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.Transfer:
                // 转账消息处理
                msgJson = WxMessage.getXmlToJson(msg._xml)
                messageParam.content = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]<blockquote>金额：${msgJson.msg.appmsg.wcpayinfo.feedesc}\n转账备注：${msgJson.msg.appmsg.wcpayinfo.pay_memo || ''}</blockquote>`
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.Revoke:
                msgJson = WxMessage.getXmlToJson(msg._xml)
                messageParam.content = msgJson.sysmsg.revokemsg.replacemsg
                messageParam.type = 6
                messageParam.revokeMsgId = msgJson.sysmsg.revokemsg.newmsgid
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.ChatHistroy:
                msgJson = WxMessage.getXmlToJson(msg._xml)
                const recordJson = WxMessage.getXmlToJson(msgJson.msg.appmsg.recorditem)
                const chatHistory = await getChatHistory(recordJson, msg, WxMessage.Type)
                messageParam.content = chatHistory
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case WxMessage.Type.MiniApp:
                msgJson = WxMessage.getXmlToJson(msg._xml)
                const miniProgram = await getMiniprogram(msgJson, msg)
                messageParam.content = miniProgram
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            default:
                if (MessageTypeUtils.SKIP_TYPE_LIST.includes(msg.type() + '')) {
                    break
                }
                if (msg.type()) {
                    console.log('unknow', msg)
                    messageParam.content = `[${MessageTypeUtils.getTypeName(msg.type() + '')}]`
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
                    bindItem.alias = wxRoom.remark
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
            case WxMessage.Type.Emoji:
                return 'animation'
            case WxMessage.Type.Image:
                return 'photo'
            case WxMessage.Type.Voice:
                return 'voice'
            case WxMessage.Type.Video:
                return 'video'
            default:
                return 'document'
        }
    }

    // 撤回消息
    async revokeMessage(message: Message) {
        return await WxMessage.revoke({
            toWxid: message.toWxid,
            msgId: parseInt(message.msgId),
            newMsgId: parseInt(message.wxMsgId),
            createTime: message.createTime
        })
    }
}