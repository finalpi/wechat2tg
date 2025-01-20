import {GeweBot,Filebox} from 'gewechaty'
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
import {Telegraf} from 'telegraf'
import {MessageService} from '../service/MessageService'
import {Message} from '../entity/Message'
import {FileUtils} from '../util/FileUtils'

export class WeChatClient extends AbstractClient {
    private configurationService = ConfigurationService.getInstance()
    private groupOperate: TelegramGroupOperateService
    private bindGroupService: BindGroupService
    private sendQueueHelper: SimpleMessageSendQueueHelper
    private scanMsgId: number = undefined
    private messageService: MessageService
    private wxInfo

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
            debug: true, // 是否开启调试模式 默认false
            base_api: config.BASE_API,
            file_api: config.FILE_API,
            proxy: config.CALLBACK_API,
            static: 'save-files',
            ds_path: 'storage/ds.json'
        })
        this.hasReady = true
        this.init()
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendTextMsg.bind(this), 617)
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
                }else {
                    msgResult = await contact.say(message.content)
                }
            } else {
                const room = await this.client.Room.find({id: bindGroup.wxId})
                if (quoteMsg) {
                    msgResult = await room.quoteSay(message.content, quoteMsg.wxMsgId, quoteMsg.wxSenderId, quoteMsg.content)
                }else {
                    msgResult = await room.say(message.content)
                }
            }
            // 将 msgId 更新到数据库
            const messageEntity = await this.messageService.getByBotMsgId(bindGroup.chatId, parseInt(message.id))
            if (msgResult && messageEntity) {
                messageEntity.wxMsgId = msgResult.newMsgId
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
        this.client.start().then(async ({app, router}) => {
            //
            app.use(router.routes()).use(router.allowedMethods())
            this.wxInfo = await this.client.info()
            this.hasLogin = true
            const config = await this.configurationService.getConfig()
            const tgBotClient: Telegraf = WeChatClient.getSpyClient('botClient').client
            tgBotClient.telegram.sendMessage(config.chatId, '微信登录成功')
            if (this.scanMsgId) {
                tgBotClient.telegram.deleteMessage(config.chatId, this.scanMsgId)
            }
        })
        return true
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
        messageEntity.wxSenderId = this.wxInfo.wxid
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
                if (bindGroup.type === 0) {
                    const contact = await this.client.Contact.find({id: bindGroup.wxId})
                    msgResult = await contact.say(Filebox.fromBuff(message.file.file,message.file.fileName))
                } else {
                    const room = await this.client.Room.find({id: bindGroup.wxId})
                    msgResult = await room.say(Filebox.fromBuff(message.file.file,message.file.fileName))
                }
                // 将 msgId 更新到数据库
                const messageEntity = await this.messageService.getByBotMsgId(bindGroup.chatId, parseInt(message.id))
                if (msgResult && messageEntity) {
                    messageEntity.wxMsgId = msgResult.newMsgId
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

        this.client.on('message', (msg) => {
            // 此处放回的msg为Message类型 可以使用Message类的方法
            this.onMessage(msg)
        })
    }

    async onMessage(msg) {
        // 查找 group
        let wxId
        const room = await msg.room()
        const fromContact = await msg.from()
        let contact = await msg.from()
        if (msg.self()) {
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
        let bindGroup = await this.bindGroupService.getByWxId(wxId)
        // 如果找不到就创建一个新的群组
        if (!bindGroup && wxId !== this.wxInfo.wxid) {
            bindGroup = new BindGroup()
            bindGroup.wxId = wxId
            if (room) {
                bindGroup.type = 1
                bindGroup.name = room.name
                const avatar = await room.avatar()
                bindGroup.avatarLink = avatar.url
            } else {
                bindGroup.type = 0
                bindGroup.name = contact.name()
                if (alias !== bindGroup.name) {
                    bindGroup.alias = await contact.alias()
                }
                bindGroup.avatarLink = await contact.avatar()
            }
            bindGroup = await this.groupOperate.createGroup(bindGroup)
        }
        if (!bindGroup) {
            return
        }
        // 身份
        const identity = FormatUtils.transformTitleStr(bindGroup.type === 0 ? config.CONTACT_MESSAGE_GROUP : config.ROOM_MESSAGE_GROUP, await fromContact.alias(), fromContact.name(), topic)
        const messageParam: BaseMessage = {
            id: msg._newMsgId,
            senderId: contact._wxid,
            wxId: wxId,
            sender: identity,
            chatId: bindGroup.chatId,
            type: 0,
            content: msg.text()
        }
        let referMsg
        let filebox
        let fileBuff: Buffer
        switch (msg.type()) {
            case this.client.Message.Type.Text:
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Quote:
                referMsg = await this.messageService.getByWxMsgId(msg.refer.svrid)
                if (referMsg) {
                    messageParam.param = {
                        reply_id: referMsg.tgBotMsgId
                    }
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Voice:
            case this.client.Message.Type.Image:
            case this.client.Message.Type.Emoji:
                if (this.client.Message.Type.Image === msg.type()) {
                    filebox = await msg.toFileBox(1)
                }else if (this.client.Message.Type.Emoji === msg.type()) {
                    filebox = {
                        name: 'emoji.gif',
                        url: msg.emoji.cdnurl,
                    }
                } else {
                    filebox = await msg.toFileBox()
                }
                fileBuff = await FileUtils.getInstance().downloadUrl2Buffer(filebox.url)
                messageParam.type = 1
                messageParam.file = {
                    fileName: filebox.name,
                    file: fileBuff,
                    sendType: this.wxFileType2TgFileType(msg.type())
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            default:
                if (msg.type()) {
                    console.log('unknow',msg)
                    messageParam.content = `收到一条${msg.type()}消息，请在手机上查看`
                    WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                }
                break
        }
    }


    // 微信文件类型转为tg类型
    wxFileType2TgFileType(messageType: string): 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice'  {
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
}