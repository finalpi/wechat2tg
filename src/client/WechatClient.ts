import {GeweBot} from 'gewechaty'
import {ClientInterface} from './base/ClientInterface'
import {MessageSender} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import {TelegramBotClient} from './TelegramBotClient'
import {ConfigurationService} from '../service/ConfigurationService'
import QRCode from 'qrcode'
import {config} from '../config'
import {TelegramGroupOperateService} from '../service/TelegramGroupOperateService'
import {BindGroupService} from '../service/BindGroupService'
import {UserMTProtoClient} from './UserMTProtoClient'
import {BindGroup} from '../entity/BindGroup'
import {FormatUtils} from '../util/FormatUtils'

export class WeChatClient implements ClientInterface{
    private readonly _client: GeweBot
    get client() {
        return this._client
    }
    private telegramBotClient: TelegramBotClient
    private botMessageSender: MessageSender
    private configurationService = ConfigurationService.getInstance()
    private groupOperate: TelegramGroupOperateService
    private bindGroupService: BindGroupService

    constructor(private readonly tgClient: TelegramBotClient) {
        this.telegramBotClient = tgClient
        this.groupOperate = new TelegramGroupOperateService(BindGroupService.getInstance(),UserMTProtoClient.getInstance().client)
        this.bindGroupService = BindGroupService.getInstance()
        this.botMessageSender = SenderFactory.createSender(tgClient.bot)
        this._client = new GeweBot({
            debug: true, // 是否开启调试模式 默认false
            base_api: config.BASE_API,
            file_api: config.FILE_API,
            proxy: config.CALLBACK_API,
        })
        this.init()
    }

    private init() {
        this._client.on('scan', qr => { // 需要用户扫码时返回对象qrcode.content为二维码内容 qrcode.url为转化好的图片地址
            this.configurationService.getConfig().then(config => {
                QRCode.toBuffer(qr.content,{
                    width: 300
                },(error, buffer) => {
                    if (!error) {
                        this.botMessageSender.sendFile(config.chatId,{
                            buff: buffer,
                            filename: 'qr.png',
                            fileType: 'photo'
                        })
                    }
                })
            })
        })

        this._client.on('all', msg => { // 如需额外的处理逻辑可以监听 all 事件 该事件将返回回调地址接收到的所有原始数据
        })

        this._client.on('message', (msg) => {
            // 此处放回的msg为Message类型 可以使用Message类的方法
            this.onMessage(msg)
        })
    }

    private async onMessage(msg) {
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
            }else {
                bindGroup.type = 0
                bindGroup.name = contact.name()
                if (alias !== bindGroup.name){
                    bindGroup.alias = await contact.alias()
                }
                bindGroup.avatarLink = await contact.avatar()
            }
            bindGroup = await this.groupOperate.createGroup(bindGroup)
        }
        // 身份
        const identity = FormatUtils.transformTitleStr(bindGroup.type === 0 ? config.CONTACT_MESSAGE_GROUP : config.ROOM_MESSAGE_GROUP, alias, contact.name(), topic)
        const message = `${identity}\n${msg.text()}`
        switch (msg.type()){
            case this._client.Message.Type.Text:
                this.botMessageSender.sendText(0 - bindGroup.chatId, message, {parse_mode: 'HTML'})
                break
            case this._client.Message.Type.Quote:
                this.botMessageSender.sendText(0 - bindGroup.chatId, message, {parse_mode: 'HTML'})
                break
        }
    }

    hasLogin(): boolean {
        throw new Error('Method not implemented.')
    }
    start(): void {
        this._client.start().then(async ({app, router}) => {
            //
            app.use(router.routes()).use(router.allowedMethods())
            console.log('登录后操作')
        })
    }
}