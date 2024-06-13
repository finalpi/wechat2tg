import * as QRCode from 'qrcode'
import {ScanStatus, WechatyBuilder} from 'wechaty'
import * as PUPPET from 'wechaty-puppet'
import {
    ContactImpl,
    ContactInterface,
    FriendshipImpl,
    FriendshipInterface,
    MessageInterface,
    RoomInterface,
    RoomInvitationInterface,
    WechatyInterface
} from 'wechaty/impls'
import {TelegramBotClient} from './TelegramBotClient'
import {EmojiConverter} from '../utils/EmojiUtils'
import {MemberCacheType} from '../models/TgCache'
import {SimpleMessage} from '../models/Message'
import {TalkerEntity} from '../models/TalkerCache'
import {UniqueIdGenerator} from '../utils/IdUtils'
import {NotionMode, VariableType} from '../models/Settings'
import {FriendshipItem} from '../models/FriendshipItem'
import {MessageUtils} from '../utils/MessageUtils'
import {FileBox, type FileBoxInterface} from 'file-box'
import * as fs from 'fs'
import {CustomFile} from 'telegram/client/uploads'
import {RoomItem} from '../models/RoomItem'
import {ContactItem} from '../models/ContactItem'
import TelegramError from 'telegraf/src/core/network/error'
import BaseClient from '../base/BaseClient'
import {MessageService} from '../service/MessageService'


export class WeChatClient extends BaseClient {


    constructor(private readonly tgClient: TelegramBotClient) {
        super()
        this._client = WechatyBuilder.build({
            name: './storage/wechat_bot',
            puppet: 'wechaty-puppet-wechat4u',
        })
        this._tgClient = tgClient
        this._contactMap = new Map<number, Set<ContactItem>>([
            [0, new Set<ContactItem>()],
            [1, new Set<ContactItem>()],
            [2, new Set<ContactItem>()],
            [3, new Set<ContactItem>()]
        ])

        this.scan = this.scan.bind(this)
        this.message = this.message.bind(this)
        this.start = this.start.bind(this)
        this.friendship = this.friendship.bind(this)
        this.init = this.init.bind(this)
        this.logout = this.logout.bind(this)
        this.login = this.login.bind(this)
        this.onReady = this.onReady.bind(this)
        this.roomTopic = this.roomTopic.bind(this)
        this.roomJoin = this.roomJoin.bind(this)
        this.roomLeave = this.roomLeave.bind(this)
        this.roomInvite = this.roomInvite.bind(this)
        this.error = this.error.bind(this)
    }

    private readonly _client: WechatyInterface
    private readonly _tgClient: TelegramBotClient

    private _contactMap: Map<number, Set<ContactItem>> | undefined
    private _roomList: RoomItem[] = []

    private _selectedContact: ContactInterface [] = []
    private _selectedRoom: RoomInterface [] = []
    private _memberCache: MemberCacheType[] = []
    private scanMsgId: number | undefined

    private _started = false
    private _cacheMemberDone = false
    private _cacheMemberSendMessage = false
    private _friendShipList: FriendshipItem[] = []
    private loadMsg: number | undefined
    private readyCount = 0

    public get contactMap(): Map<number, Set<ContactItem>> | undefined {
        return this._contactMap
    }

    public set contactMap(contactMap: Map<number, Set<ContactItem>> | undefined) {
        this._contactMap = contactMap
    }

    get friendShipList(): FriendshipItem[] {
        return this._friendShipList
    }

    set friendShipList(value: FriendshipItem[]) {
        this._friendShipList = value
    }

    get cacheMemberSendMessage(): boolean {
        return this._cacheMemberSendMessage
    }

    set cacheMemberSendMessage(value: boolean) {
        this._cacheMemberSendMessage = value
    }

    get cacheMemberDone(): boolean {
        return this._cacheMemberDone
    }

    set cacheMemberDone(value: boolean) {
        this._cacheMemberDone = value
    }

    get memberCache(): MemberCacheType[] {
        return this._memberCache
    }

    set memberCache(value: MemberCacheType[]) {
        this._memberCache = value
    }

    get roomList(): RoomItem[] {
        return this._roomList
    }

    set roomList(value: RoomItem[]) {
        this._roomList = value
    }

    get selectedRoom(): RoomInterface[] {
        return this._selectedRoom
    }

    set selectedRoom(value: RoomInterface[]) {
        this._selectedRoom = value
    }

    get selectedContact(): ContactInterface[] {
        return this._selectedContact
    }

    set selectedContact(value: ContactInterface[]) {
        this._selectedContact = value
    }

    public get client() {
        return this._client
    }

    public async start() {
        this.init()
        if (this._client === null) {
            return
        }
        // if(this._client.ready().then())
        if (!this._started) {
            await this._client.start().then(() => {
                this._started = true
                this.logInfo('Wechat client start!')
            })
        } else {
            this.logInfo('Wechat client already started!')
            return new Error('Wechat client already started!')
        }
    }

    private init() {
        if (this._client === null) return
        this._client.on('login', this.login)
            .on('scan', this.scan)
            .on('message', this.message)
            .on('logout', this.logout)
            .on('stop', () => this.logInfo('on stop...'))
            .on('post', () => this.logInfo('on post...'))
            .on('room-join', this.roomJoin)
            .on('room-topic', this.roomTopic)
            .on('room-leave', this.roomLeave)
            .on('room-invite', this.roomInvite)
            .on('friendship', this.friendship)
            .on('ready', this.onReady)
            .on('error', this.error)
    }

    private roomInvite(roomInvitation: RoomInvitationInterface) {
        this._tgClient.sendMessage({
            sender: '未知用户 type 没有',
            body: '邀请你加入群聊(无法获取用户名和群名)',
            id: roomInvitation.id,
            chatId: this.tgClient.chatId
        })
    }

    private error(error: Error) {
        this.logDebug('error:', error)
    }

    private friendship(friendship: FriendshipInterface) {
        const contact = friendship.contact()
        const hello = friendship.hello()
        if (friendship.type() === FriendshipImpl.Type.Receive) {
            const id = UniqueIdGenerator.getInstance().generateId('friendship-accept')
            this._friendShipList.push(new FriendshipItem(id, friendship))
            this._tgClient.bot.telegram.sendMessage(
                this._tgClient.chatId, `👤${contact.name()}请求添加您为好友:\n${hello}`,
                {
                    reply_markup: {
                        inline_keyboard:
                            [
                                [
                                    {text: '接受', callback_data: `${id}`},
                                ]
                            ]
                    }
                })
        }
        if (friendship.type() === FriendshipImpl.Type.Confirm) {
            const type = contact.type()
            const id = UniqueIdGenerator.getInstance().generateId('contact')
            switch (type) {
                case ContactImpl.Type.Unknown:
                    this.contactMap?.get(ContactImpl.Type.Unknown)?.add({id: id, contact: contact})
                    break
                case ContactImpl.Type.Individual:
                    this.contactMap?.get(ContactImpl.Type.Individual)?.add({id: id, contact: contact})
                    break
                case ContactImpl.Type.Official:
                    this.contactMap?.get(ContactImpl.Type.Official)?.add({id: id, contact: contact})
                    break
                case ContactImpl.Type.Corporation:
                    this.contactMap?.get(ContactImpl.Type.Corporation)?.add({id: id, contact: contact})
                    break
            }
        }
    }

    private roomJoin(room: RoomInterface, inviteeList: ContactInterface[], inviter: ContactInterface) {
        inviteeList.forEach(item => {
            if (item.self()) {
                const item = this._roomList.find(it => it.id === room.id)
                if (!item) {
                    const id = UniqueIdGenerator.getInstance().generateId('room')
                    this.roomList.push({room: room, id: id})
                }
            }
        })
    }

    private roomLeave(room: RoomInterface, leaverList: ContactInterface[]) {
        leaverList.forEach(leaver => {
            if (leaver.self()) {
                this._roomList = this._roomList.filter(it => it.id != room.id)
            }
        })
    }

    private roomTopic(room: RoomInterface, topic: string, oldTopic: string, changer: ContactInterface) {
        const item = this._roomList.find(it => it.room.id === room.id)
        if (item) {
            if (item.room.payload?.topic !== topic) {
                this._roomList[this._roomList.indexOf(item)].room.sync()
            }
        }
    }

    private onReady() {
        this.logDebug('Wechat client ready!')
        this.readyCount++
        if(this.readyCount >= 3) {
            // 尝试重启
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '登录状态过期,重启bot')
            this.resetValue()
            return
        }
        this.cacheMember().then(() => {
            this.cacheMemberDone = true
            if (!this.cacheMemberSendMessage) {
                this.cacheMemberSendMessage = true
                this._tgClient.bot.telegram.editMessageText(this._tgClient.chatId, this.loadMsg, undefined, '联系人加载完成').then(msg => {
                    setTimeout(() => {
                        if (this.loadMsg) {
                            this._tgClient.bot.telegram.deleteMessage(this._tgClient.chatId, this.loadMsg)
                            const b = this.tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)
                            if (b && !this.tgClient.tgUserClientLogin) {
                                // 启动bot
                                this.tgClient.loginUserClient()
                            }
                        }
                    }, 10 * 1000)
                })
            }
            this.logDebug('cache member done!')
        })
    }

    public async stop() {
        await this._client.stop().then(() => this._started = false)
        // console.log('stop ... ')
    }

    public restart() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this._client.restart().then(() => {
            this.logDebug('restart ... ')
        })
    }

    public reset() {
        // this._client.reset().then(() => {
        this.logInfo('reset ... ')
        // })
        this._client.logout()
    }

    public async logout() {
        // this._client.logout();
        // this._client.reset().then()

        this.resetValue()
    }

    private login() {
        if (this._client.isLoggedIn) {
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '微信登录成功!').then(msg => {
                setTimeout(() => {
                    this.tgClient.bot.telegram.deleteMessage(this.tgClient.chatId, msg.message_id)
                }, 10000)
                // this._client.Contact.findAll()
                // this._client.Room.findAll()
                // this._client.Room.find({id: ''})
                // 重新登陆就要等待加载
                this.cacheMemberDone = false
                this.cacheMemberSendMessage = false


                this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '正在加载联系人...').then(value => {
                    this.loadMsg = value.message_id
                })
            })
            // // 登陆后就缓存所有的联系人和房间
            // this._tgClient.setAllMemberCache().then(() => {
            //     this._tgClient.calcShowMemberList()
            // });
            if (this.scanMsgId) {
                this._tgClient.bot.telegram.deleteMessage(this._tgClient.chatId, this.scanMsgId)
                this.scanMsgId = undefined
            }
        } else {
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '登录失败!')
        }
    }

    // scan qrcode login
    private scan(qrcode: string, status: ScanStatus) {
        this.logDebug('---------on scan---------')
        this.readyCount = 0
        if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
            const qrcodeImageUrl = encodeURIComponent(qrcode)
            this.logDebug('StarterBot', 'onScan: %s(%s) - %s', ScanStatus[status], status, qrcodeImageUrl)
            const tgBot = this._tgClient.bot
            QRCode.toBuffer(qrcode).then(buff => {
                if (this.scanMsgId) {
                    tgBot.telegram.editMessageMedia(this._tgClient.chatId,this.scanMsgId,undefined,{type: 'photo',
                        media: {source:buff},caption: '请扫码登陆:'})
                }else {
                    tgBot.telegram.sendPhoto(this._tgClient.chatId,{source: buff}, {caption: '请扫码登陆:'}).then(msg => {
                        this.scanMsgId = msg.message_id
                    })
                }
            })
        } else {
            this.logDebug('StarterBot', 'onScan: %s(%s)', ScanStatus[status], status)
        }
    }

    private async message(message: MessageInterface) {
        const talker = message.talker()
        const [roomEntity] = await Promise.all([message.room()])
        const messageType = message.type()

        const alias = await talker.alias()
        let showSender: string = alias ? `[${alias}] ${talker.name()}` : talker.name()

        const roomTopic = await roomEntity?.topic() || ''
        let bindItem = undefined
        if (roomEntity) {
            // 黑白名单过滤
            const blackFind = this._tgClient.setting.getVariable(VariableType.SETTING_BLACK_LIST).find(item => item.name === roomTopic)
            const whiteFind = this._tgClient.setting.getVariable(VariableType.SETTING_WHITE_LIST).find(item => item.name === roomTopic)
            const mentionSelf = await message.mentionSelf()
            if (this._tgClient.setting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                if (blackFind && !mentionSelf) {
                    return
                }
            } else { // 白名单模式
                if (!whiteFind && !mentionSelf) {
                    return
                }
            }
            // 找到bindId
            let bindId
            for (const roomItem of this._roomList) {
                if (roomItem.room.id === roomEntity.id) {
                    bindId = roomItem.id
                    break
                }
            }
            if (!bindId) {
                // 找不到该群组,直接将群组加进缓存生成新id
                bindId = UniqueIdGenerator.getInstance().generateId('room')
                this._roomList.push({
                    id: bindId,
                    room: roomEntity
                })
            }
            bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(roomEntity.id)
            if (!bindItem && this._tgClient.tgUserClientLogin && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)) {
                bindItem = await this._tgClient.tgUserClient?.createGroup({
                    type: 1,
                    room: roomEntity,
                    bindId: bindId
                })
            }
        } else {
            bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(talker.id)
            // 找到bindId
            let bindId
            if (talker?.type() === PUPPET.types.Contact.Official) {
                const official = this.contactMap?.get(ContactImpl.Type.Official)
                if (official) {
                    for (const contactItem of official) {
                        if (contactItem.contact.id === talker.id) {
                            bindId = contactItem.id
                            break
                        }
                    }
                }
                if (!bindId) {
                    bindId = UniqueIdGenerator.getInstance().generateId('contact')
                    official?.add({
                        id: bindId,
                        contact: talker
                    })
                }
            } else {
                const individual = this.contactMap?.get(ContactImpl.Type.Individual)
                if (individual) {
                    for (const contactItem of individual) {
                        if (contactItem.contact.id === talker.id) {
                            bindId = contactItem.id
                            break
                        }
                    }
                }
                if (!bindId) {
                    bindId = UniqueIdGenerator.getInstance().generateId('contact')
                    individual?.add({
                        id: bindId,
                        contact: talker
                    })
                }
            }
            if (!bindItem && this._tgClient.tgUserClientLogin && !message.self() && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)) {
                if (talker?.type() === PUPPET.types.Contact.Official && !this._tgClient.setting.getVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT)) {
                    bindItem = await this._tgClient.tgUserClient?.createGroup({
                        type: 0,
                        contact: talker,
                        bindId: bindId
                    })
                } else if (talker?.type() !== PUPPET.types.Contact.Official) {
                    bindItem = await this._tgClient.tgUserClient?.createGroup({
                        type: 0,
                        contact: talker,
                        bindId: bindId
                    })
                }
            }
        }
        let identityStr = roomEntity ? `🌐${roomTopic} --- 👤${showSender} : ` : `👤${showSender} : `
        if (talker?.type() === PUPPET.types.Contact.Official) {
            identityStr = `📣${showSender} : `
        }
        const sendMessageBody: SimpleMessage = {
            sender: showSender,
            body: '收到一条 未知消息类型',
            room: roomTopic,
            type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
            id: message.id,
            chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
            message: message
        }

        if (message.self()) {
            // 过滤掉自己所发送的消息 和没有绑定的群组才转发
            if (this._tgClient.setting.getVariable(VariableType.SETTING_FORWARD_SELF) && !bindItem) {
                // 不转发文件
                if (messageType === PUPPET.types.Message.Attachment
                    || messageType === PUPPET.types.Message.Audio
                    || messageType === PUPPET.types.Message.Image
                    || messageType === PUPPET.types.Message.Video) {
                    return
                }
                let toSender = ''
                const to = message.listener()
                if (to) {
                    toSender = !to.payload?.alias ? `${to?.name()}` : `[${to.payload?.alias}] ${to?.name()}`
                } else {
                    toSender = message.room()?.payload?.topic ? `${message.room()?.payload?.topic}` : '未知群组'
                }
                identityStr = roomEntity ? `👤我->🌐${roomTopic}: ` : `👤我 -> 👤${toSender} : `
                const meTitle = `‍我 -> ${toSender}`
                sendMessageBody.sender = meTitle
                showSender = meTitle
            } else {
                return
            }
        }
        // 过滤公众号消息
        if (this._tgClient.setting.getVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT) &&
            talker?.type() === PUPPET.types.Contact.Official) {
            return
        }

        // 添加用户至最近联系人
        let count = 0
        while (!talker.isReady() && count < 5) {
            talker.sync().catch(() => this.logDebug('sync error'))
            count++
        }
        // 自动设置回复人
        const type = talker.type()
        if (!message.self() && !bindItem) {
            if (this._tgClient.setting && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_SWITCH) && type === PUPPET.types.Contact.Individual) {
                this._tgClient.setCurrentSelectContact(message)
            }

            // 设置最近联系人列表
            if (type === PUPPET.types.Contact.Individual) {
                const recentUsers = this._tgClient.recentUsers
                // 如果不存在该联系人
                const recentUser = recentUsers.find(item => (roomEntity && roomEntity.id) === item.talker?.id || (!roomEntity && talker.id === item.talker?.id))
                if (!recentUser) {
                    // 如果最近联系人数量大于5,则移除掉多余的联系人
                    if (recentUsers.length >= 5) {
                        recentUsers.pop()
                    }
                    const idInstance = UniqueIdGenerator.getInstance()
                    if (roomEntity) {
                        // 房间
                        recentUsers.unshift(new TalkerEntity('‍🌐' + roomTopic, 0, idInstance.generateId('recent'), roomEntity))
                    } else {
                        // 个人
                        recentUsers.unshift(new TalkerEntity('👤' + talker.name(), 1, idInstance.generateId('recent'), talker))
                    }
                } else {
                    // 找到元素在数组中的索引
                    const index = recentUsers.indexOf(recentUser)

                    // 如果元素存在于数组中
                    if (index !== -1) {
                        // 将元素从原索引位置删除
                        recentUsers.splice(index, 1)
                        // 将元素放在数组最前面
                        recentUsers.unshift(recentUser)
                    }
                }
            }
        }
        //
        if (bindItem) {
            await this._tgClient.bot.telegram.getChat(bindItem.chat_id)
        }

        const sendMessageWhenNoAvatar = (name?: string) => {
            this._tgClient.sendMessage({
                sender: showSender,
                body: `收到一条 👤${name ? name : '未知'} 的名片消息,请在手机上查看`,
                type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                room: roomTopic,
                id: message.id,
                chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                message: message
            })
        }

        switch (messageType) {
            case PUPPET.types.Message.Unknown:
                // console.log(talker.name(), ': 发送了unknown message...')

                if (message.text() === '收到红包，请在手机上查看') {
                    sendMessageBody.body = '收到红包，请在手机上查看'
                    this._tgClient.sendMessage(sendMessageBody)
                }
                if (message.text() === 'webwxvoipnotifymsg') {
                    sendMessageBody.body = '收到视频或语音通话,请在手机上处理'
                    this._tgClient.sendMessage(sendMessageBody)
                }
                break
            case PUPPET.types.Message.Text: {

                const messageTxt = message.text()

                if (messageTxt) {
                    // console.log('showSender is :', showSender, 'talker id is :', talker.id, 'message text is ', messageTxt,)
                    // 地址 只有个人发送的才会有这个连接的文本出现
                    if (messageTxt.endsWith('pictype=location')) {
                        const locationText = `位置信息: <code>${message.text().split('\n')[0].replace(':', '')}</code>`
                        this._tgClient.sendMessage({
                            sender: showSender,
                            body: locationText,
                            room: roomTopic,
                            type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                            id: message.id,
                            not_escape_html: true,
                            chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                            message: message
                        })
                        return
                    }
                    // 表情转换
                    const emojiConverter = new EmojiConverter()
                    const convertedText = emojiConverter.convert(messageTxt)
                    this._tgClient.sendMessage({
                        sender: showSender,
                        body: convertedText,
                        room: roomTopic,
                        type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                        id: message.id,
                        chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                        message: message
                    })
                }
            }
                break
            case PUPPET.types.Message.Contact:
                // 收到名片消息
                MessageUtils.messageTextToContact(message.text()).then(res => {
                    const shareContactCaption = `收到一条 👤${res.nickname} 的名片消息,请在手机上查看\n${identityStr}`
                    if (res.bigheadimgurl) {
                        FileBox.fromUrl(res.bigheadimgurl).toBuffer().then(avatarBuff => {
                            this._tgClient.bot.telegram.sendPhoto(
                                bindItem ? bindItem.chat_id : this.tgClient.chatId, {source: avatarBuff}, {caption: shareContactCaption}).then(msg => {
                                MessageService.getInstance().addMessage({
                                    wechat_message_id: message.id,
                                    chat_id: bindItem ? bindItem.chat_id + '' : this.tgClient.chatId + '',
                                    telegram_message_id: msg.message_id,
                                    type: message.type(),
                                    msg_text: shareContactCaption + '',
                                    send_by: identityStr,
                                    create_time: new Date().getTime()
                                })
                            }).catch(e => {
                                if (e.response.error_code === 403 && bindItem) {
                                    this.tgClient.bindItemService.removeBindItemByChatId(bindItem.chat_id)
                                    this._tgClient.bot.telegram.sendPhoto(
                                        this.tgClient.chatId, {source: avatarBuff}, {caption: shareContactCaption}).then(msg => {
                                        MessageService.getInstance().addMessage({
                                            wechat_message_id: message.id,
                                            chat_id: this.tgClient.chatId + '',
                                            telegram_message_id: msg.message_id,
                                            type: message.type(),
                                            msg_text: shareContactCaption + '',
                                            send_by: identityStr,
                                            create_time: new Date().getTime()
                                        })
                                    })
                                    return
                                }
                            })
                        }).catch(() => {
                            sendMessageWhenNoAvatar(res.nickname)
                        })
                    } else {
                        sendMessageWhenNoAvatar(res.nickname)
                    }
                }).catch(() => {
                    sendMessageWhenNoAvatar()
                })
                // console.log('contact message', message)
                break
            case PUPPET.types.Message.Attachment:
            case PUPPET.types.Message.Image:
            case PUPPET.types.Message.Audio:
            case PUPPET.types.Message.Emoticon: // 处理表情消息的逻辑
            case PUPPET.types.Message.Video:
                await this.sendFileToTg(message, identityStr, {
                    sender: showSender,
                    body: '',
                    room: roomTopic,
                    type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                    id: message.id,
                    chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                    message: message
                })
                break
            case PUPPET.types.Message.MiniProgram: // 处理小程序消息的逻辑
                sendMessageBody.body = '收到一条小程序消息'
                this._tgClient.sendMessage(sendMessageBody)
                break
            case PUPPET.types.Message.RedEnvelope: // 处理红包消息的逻辑 12
                break
            case PUPPET.types.Message.Url: // 处理链接消息的逻辑
                message.toUrlLink().then(url => {
                    sendMessageBody.body = `链接消息：${url.description()} <a href="${url.url()}">${url.title()}</a>`
                    this._tgClient.sendMessage({...sendMessageBody, not_escape_html: true})
                })
                break
            case PUPPET.types.Message.Transfer: // 处理转账消息的逻辑 11
                sendMessageBody.body = '收到一条转账消息'
                this._tgClient.sendMessage(sendMessageBody)
                break
            case PUPPET.types.Message.Recalled: // 处理撤回消息的逻辑
                this.recallMessage(sendMessageBody)
                break
            case PUPPET.types.Message.GroupNote:
                // 处理群公告消息的逻辑
                break
            case PUPPET.types.Message.ChatHistory:  // ChatHistory(19)
                break
            case PUPPET.types.Message.Post: // 处理帖子消息的逻辑
                // sendMessageBody.body = `收到一条暂不支持的消息类型: ${messageType}`
                // this._tgClient.sendMessage(sendMessageBody)
                break
            case PUPPET.types.Message.Location: // 处理位置消息的逻辑
                break
            default:
                break
        }


        // 发现好像不需要缓存头像而且每次重新登陆返回的id不同
        // const avatarPath = `avatar/${talker.id}`
        // if (!fs.existsSync(avatarPath)) {
        //     fs.mkdirSync(avatarPath, {recursive: true});
        // }
        // talker.avatar().then(fb => fb.toFile(avatarPath + '/avatar.jpg', true))

    }

    private async recallMessage(sendMessageBody: SimpleMessage) {
        if (sendMessageBody.message){
            const msgidMatch = sendMessageBody.message.text().match(/<msgid>(.*?)<\/msgid>/)
            if (msgidMatch) {
                const msgid = msgidMatch[1]
                const item = await MessageService.getInstance().findMessageByWechatMessageId(msgid)
                if (item) {
                    this._tgClient.bot.telegram.sendMessage(item.chat_id,`${sendMessageBody.sender}撤回了一条消息`,{
                        reply_parameters: {
                            message_id: item.telegram_message_id
                        }
                    })
                }else {
                    sendMessageBody.body = '撤回了一条消息'
                    this._tgClient.sendMessage(sendMessageBody)
                }
            }
        }
    }

    private async cacheMember() {
        const contactList = await this._client.Contact.findAll()
        // 不知道是什么很多空的 过滤掉没名字和不是朋友的
        const filter = contactList.filter(it => it.name() && it.friend())
        for (const item of contactList) {
            let count = 0
            while (item.payload?.alias === item.name() && count < 5) {
                await item.sync()
                count++
            }
        }
        filter.forEach(it => {
            const type = it.type()
            const id = UniqueIdGenerator.getInstance().generateId('contact')
            switch (type) {
                case ContactImpl.Type.Unknown:
                    this.contactMap?.get(ContactImpl.Type.Unknown)?.add({id: id, contact: it})
                    break
                case ContactImpl.Type.Individual:
                    this.contactMap?.get(ContactImpl.Type.Individual)?.add({id: id, contact: it})
                    break
                case ContactImpl.Type.Official:
                    this.contactMap?.get(ContactImpl.Type.Official)?.add({id: id, contact: it})
                    break
                case ContactImpl.Type.Corporation:
                    this.contactMap?.get(ContactImpl.Type.Corporation)?.add({id: id, contact: it})
                    break
            }
        })

        // 缓存到客户端的实例
        // 一起获取群放到缓存
        const room = await this._client.Room.findAll()
        for (const it of room) {
            const l = await it.memberAll()
            if (l.length > 0) {
                const id = UniqueIdGenerator.getInstance().generateId('room')
                this._roomList.push({room: it, id: id})
            }
        }
        this.tgClient.bindItemService.updateItem(this.roomList, this.contactMap)
    }

    private resetValue() {
        this.readyCount = 0
        const filePath = 'storage/wechat_bot.memory-card.json'
        fs.access(filePath, fs.constants.F_OK, async (err) => {
            if (!err) {
                // 文件存在，删除文件
                await fs.promises.unlink(filePath)
            }
            this.contactMap?.get(ContactImpl.Type.Individual)?.clear()
            this.contactMap?.get(ContactImpl.Type.Official)?.clear()
            this.cacheMemberDone = false
            this.cacheMemberSendMessage = false
            this._roomList = []
            this.tgClient.selectedMember = []
            this.tgClient.flagPinMessageType = ''
            this.tgClient.findPinMessage()
            this.tgClient.reset()
        })
    }

    private sentMessageWhenFileToLage(fileBox: FileBoxInterface, message: SimpleMessage): boolean {
        // 配置了tg api可以往下走发送
        if (!this.tgClient.tgClient && fileBox.size > 1024 * 1024 * 50) {
            this._tgClient.sendMessage(message)
            return true
        }
        return false
    }

    private async sendFileToTg(message: MessageInterface, identityStr: string, tgMessage: SimpleMessage) {
        const messageType = message.type()
        message.toFileBox().then(fBox => {
            // 配置了tg api尝试发送大文件
            if (this.sentMessageWhenFileToLage(fBox, {
                ...tgMessage,
                body: `[${this.getMessageName(messageType)}]过大,请在微信上查收`
            })) {
                return
            }
            let fileName = fBox.name
            // 如果是语音文件 替换后缀方便直接播放
            if (fileName.endsWith('.sil')) {
                fileName = fileName.replace('.sil', '.mp3')
            }
            fBox.toBuffer().then(async buff => {
                // 配置了 tg api 尝试发送大文件
                if (this.tgClient.tgClient && buff.length > 1024 * 1024 * 50) {
                    if (buff.length > -1) {
                        this.tgClient.tgClient.client?.sendFile(this.tgClient.chatId, {
                            workers: 3,
                            file: new CustomFile(fileName, buff.length, '', buff),
                            forceDocument: !this.tgClient.setting.getVariable(VariableType.SETTING_COMPRESSION),
                            caption: identityStr,
                        }).catch((e) => {
                            this.logError('send file error:', e)
                            this._tgClient.sendMessage({
                                ...tgMessage,
                                body: `[${this.getMessageName(messageType)}]转发失败, 请在微信上查收`
                            })
                        })
                    } else {
                        this._tgClient.sendMessage({
                            ...tgMessage,
                            body: `[${this.getMessageName(messageType)}]转发失败, 请在微信上查收`
                        })
                    }
                    return
                }

                if (this.tgClient.setting.getVariable(VariableType.SETTING_COMPRESSION)) { // 需要判断类型压缩
                    //
                    switch (messageType) {
                        case PUPPET.types.Message.Image:
                        case PUPPET.types.Message.Audio:
                        case PUPPET.types.Message.Video:
                        case PUPPET.types.Message.Emoticon:
                        case PUPPET.types.Message.Attachment:
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            this.tgClient.bot.telegram[this.getSendTgFileMethodString(messageType)](
                                tgMessage.chatId, {source: buff, filename: fileName}, {
                                    caption: identityStr
                                }).then((msg: { message_id: number }) => {
                                if (tgMessage.message && tgMessage.id) {
                                    MessageService.getInstance().addMessage({
                                        wechat_message_id: tgMessage.id,
                                        chat_id: tgMessage.chatId ? tgMessage.chatId + '' : '',
                                        telegram_message_id: msg.message_id,
                                        type: tgMessage.message.type(),
                                        msg_text: tgMessage.body + '',
                                        send_by: tgMessage.sender ? tgMessage.sender : '',
                                        create_time: new Date().getTime()
                                    })
                                }
                            }).catch((e: TelegramError) => {
                                if (e.response.error_code === 403) {
                                    this.tgClient.bindItemService.removeBindItemByChatId(tgMessage.chatId)
                                    tgMessage.chatId = this.tgClient.chatId
                                    this.sendFileToTg(message, identityStr, tgMessage)
                                    return
                                }
                               this.logError('send file error:', e)
                                this._tgClient.sendMessage({
                                    ...tgMessage,
                                    body: `[${this.getMessageName(messageType)}]转发失败, 请在微信上查收`
                                })
                            })
                            break
                    }
                } else { // 不需要判断类型压缩 直接发送文件
                    this.tgClient.bot.telegram.sendDocument(
                        tgMessage.chatId, {source: buff, filename: fileName}, {
                            caption: identityStr
                        }).then(msg => {
                        if (tgMessage.message && tgMessage.id) {
                            MessageService.getInstance().addMessage({
                                wechat_message_id: tgMessage.id,
                                chat_id: tgMessage.chatId ? tgMessage.chatId + '' : '',
                                telegram_message_id: msg.message_id,
                                type: tgMessage.message.type(),
                                msg_text: tgMessage.body + '',
                                send_by: tgMessage.sender ? tgMessage.sender : '',
                                create_time: new Date().getTime()
                            })
                        }
                    }).catch(e => {
                        if (e.response.error_code === 403) {
                            this.tgClient.bindItemService.removeBindItemByChatId(tgMessage.chatId)
                            tgMessage.chatId = this.tgClient.chatId
                            this.sendFileToTg(message, identityStr, tgMessage)
                            return
                        }
                       this.logError('sendDocument error:', e)
                        this._tgClient.sendMessage({
                            ...tgMessage,
                            body: `[${this.getMessageName(messageType)}]转发失败, 请在微信上查收`
                        })
                    })
                }
            })
        }).catch(() => {
            this._tgClient.sendMessage({
                ...tgMessage,
                body: `接收[${this.getMessageName(message.type())}]错误, 请在微信上查收`
            })
        })
    }

    private getSendTgFileMethodString(messageType: number): string {
        switch (messageType) {
            case PUPPET.types.Message.Image:
                return 'sendPhoto'
            case PUPPET.types.Message.Audio:
                return 'sendVoice'
            case PUPPET.types.Message.Video:
                return 'sendVideo'
            default:
                return 'sendDocument'
        }
    }

    private getMessageName(messageType: number): string {
        switch (messageType) {
            case PUPPET.types.Message.Unknown:
                return '未知消息'
            case PUPPET.types.Message.Text:
                return '文本消息'
            case PUPPET.types.Message.Contact:
                return '名片消息'
            case PUPPET.types.Message.Attachment:
                return '文件'
            case PUPPET.types.Message.Image:
                return '图片'
            case PUPPET.types.Message.Audio:
                return '音频'
            case PUPPET.types.Message.Video:
                return '视频'
            case PUPPET.types.Message.Emoticon:
                return '表情消息'
            case PUPPET.types.Message.MiniProgram:
                return '小程序消息'
            case PUPPET.types.Message.RedEnvelope:
                return '红包消息'
            case PUPPET.types.Message.Url:
                return '链接消息'
            case PUPPET.types.Message.Transfer:
                return '转账消息'
            case PUPPET.types.Message.Recalled:
                return '撤回消息'
            case PUPPET.types.Message.GroupNote:
                return '群公告消息'
            case PUPPET.types.Message.ChatHistory:
                return '聊天记录消息'
            case PUPPET.types.Message.Post:
                return '帖子消息'
            case PUPPET.types.Message.Location:
                return '位置消息'
            default:
                return '未知消息'
        }
    }
}