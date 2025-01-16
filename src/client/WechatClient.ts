import {GeweBot} from 'gewechaty'
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

export class WeChatClient extends AbstractClient {
    private configurationService = ConfigurationService.getInstance()
    private groupOperate: TelegramGroupOperateService
    private bindGroupService: BindGroupService
    private sendQueueHelper: SimpleMessageSendQueueHelper
    private scanMsgId: number = undefined
    private messageService: MessageService

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
        })
        this.init()
        this.sendQueueHelper = new SimpleMessageSendQueueHelper(async (message: BaseMessage) => {
            // 发送文本消息的方法
            const bindGroup = await this.bindGroupService.getByChatId(parseInt(message.senderId))
            if (bindGroup) {
                let msgResult
                if (bindGroup.type === 0) {
                    const contact = await this.client.Contact.find({id: bindGroup.wxId})
                    msgResult = await contact.say(message.content)
                } else {
                    const room = await this.client.Room.find({id: bindGroup.wxId})
                    msgResult = await room.say(message.content)
                }
                // 将 msgId 更新到数据库
                const messageEntity = await this.messageService.getByBotMsgId(bindGroup.chatId, message.id)
                if (msgResult && messageEntity) {
                    messageEntity.wxMsgId = msgResult.newMsgId
                    this.messageService.createOrUpdate(messageEntity)
                }
            }
        }, 617)
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
            console.log('登录后操作')
        })
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    async sendMessage(message: BaseMessage): Promise<boolean> {
        const messageEntity = new Message()
        messageEntity.chatId = message.chatId
        messageEntity.tgBotMsgId = message.id
        messageEntity.type = message.type
        await this.messageService.createOrUpdate(messageEntity)
        if (message.type === 0) {
            // 文本消息走队列
            this.sendQueueHelper.addMessageWithMsgId(message.id, message)
        } else {
            // 文件消息
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
                                media: {source: buffer}, caption: '请扫描二维码登录'
                            })
                        } else {
                            tgBotClient.telegram.sendPhoto(config.chatId, {source: buffer}, {caption: '请扫描二维码登录'}).then(msg => {
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
        const contact = await msg.from()
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
        if (!bindGroup) {
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
        // 身份
        const identity = FormatUtils.transformTitleStr(bindGroup.type === 0 ? config.CONTACT_MESSAGE_GROUP : config.ROOM_MESSAGE_GROUP, alias, contact.name(), topic)
        const messageParam: BaseMessage = {
            id: msg._newMsgId,
            senderId: wxId,
            sender: identity,
            chatId: bindGroup.chatId,
            type: 0,
            content: msg.text()
        }
        let referMsg
        switch (msg.type()) {
            case this.client.Message.Type.Text:
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
            case this.client.Message.Type.Quote:
                messageParam.content = msg.trueText
                referMsg = await this.messageService.getByWxMsgId(msg.refer.svrid)
                if (referMsg) {
                    messageParam.param = {
                        reply_id: referMsg.tgBotMsgId
                    }
                }
                WeChatClient.getSpyClient('botClient').sendMessage(messageParam)
                break
        }
    }

    hasLogin(): boolean {
        throw new Error('Method not implemented.')
    }
}