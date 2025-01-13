import * as QRCode from 'qrcode'
import {TelegramBotClient} from './TelegramBotClient'
import {EmojiConverter} from '../util/EmojiUtils'
import {MemberCacheType} from '../model/TgCache'
import {SimpleMessage, SimpleMessageSender} from '../model/Message'
import {TalkerEntity} from '../model/TalkerCache'
import {UniqueIdGenerator} from '../util/IdUtils'
import {NotionMode, VariableType} from '../model/Settings'
import {FriendshipItem} from '../model/FriendshipItem'
import {MessageUtils} from '../util/MessageUtils'
import * as fs from 'fs'
import {RoomItem} from '../model/RoomItem'
import {ContactItem} from '../model/ContactItem'
import BaseClient from '../base/BaseClient'
import {MessageService} from '../service/MessageService'
import {CacheHelper} from '../util/CacheHelper'
import {SimpleMessageSendQueueHelper} from '../util/SimpleMessageSendQueueHelper'
import {SenderFactory} from '../message/SenderFactory'
import {Snowflake} from 'nodejs-snowflake'
import {Markup} from 'telegraf'
import {parseAppmsgMessagePayload} from '../util/message-appmsg'
import {Api} from 'telegram'
import messages = Api.messages
import {ImageUtils} from '../util/ImageUtils'
import {SpeechService} from '../service/SpeechService'
import {OpenAIService} from '../service/OpenAIService'
import {config} from '../config'
import {GeweBot, Filebox, UrlLink, WeVideo, Voice, MiniApp, AppMsg, Contact, Room, Message, MessageType} from 'gewechaty'

export class WeChatClient extends BaseClient {


    private readonly _client: GeweBot
    private readonly _tgClient: TelegramBotClient
    private scanMsgId: number | undefined
    private _started = false
    private loadMsg: number | undefined
    private readyCount = 0
    private snowflakeUtil = new Snowflake()
    private _openAIService?: OpenAIService
    private sendQueueHelper: SimpleMessageSendQueueHelper

    constructor(private readonly tgClient: TelegramBotClient) {
        super()
        this._client = new GeweBot({
            debug: true, // 是否开启调试模式 默认false
            base_api: 'http://192.168.1.245:2531/v2/api',
            file_api: 'http://192.168.1.245:2532/download',
        })
        this.scan = this.scan.bind(this)
        this.message = this.message.bind(this)
        this.start = this.start.bind(this)
        this.friendship = this.friendship.bind(this)
        this.init = this.init.bind(this)
        this.logout = this.logout.bind(this)
        this.login = this.login.bind(this)
        this.onReady = this.onReady.bind(this)
        this.onStop = this.onStop.bind(this)
        this.roomTopic = this.roomTopic.bind(this)
        this.roomJoin = this.roomJoin.bind(this)
        this.roomLeave = this.roomLeave.bind(this)
        this.roomInvite = this.roomInvite.bind(this)
        this.error = this.error.bind(this)
        this.init()
        this._tgClient = tgClient
        this._contactMap = new Map<number, Set<ContactItem>>([
            [0, new Set<ContactItem>()],
            [1, new Set<ContactItem>()],
            [2, new Set<ContactItem>()],
            [3, new Set<ContactItem>()]
        ])
        if (config.OPENAI_API_KEY) {
            this._openAIService = new OpenAIService(config.OPENAI_API_KEY, config.OPENAI_HOST, config.OPENAI_MODEL)
        }
    }

    private _contactMap: Map<number, Set<ContactItem>> | undefined

    public get contactMap(): Map<number, Set<ContactItem>> | undefined {
        return this._contactMap
    }

    public set contactMap(contactMap: Map<number, Set<ContactItem>> | undefined) {
        this._contactMap = contactMap
    }

    private _roomList: RoomItem[] = []

    get roomList(): RoomItem[] {
        return this._roomList
    }

    set roomList(value: RoomItem[]) {
        this._roomList = value
    }

    private _selectedContact: Contact [] = []

    get selectedContact(): Contact[] {
        return this._selectedContact
    }

    set selectedContact(value: Contact[]) {
        this._selectedContact = value
    }

    private _selectedRoom: Room [] = []

    get selectedRoom(): Room[] {
        return this._selectedRoom
    }

    set selectedRoom(value: Room[]) {
        this._selectedRoom = value
    }

    private _memberCache: MemberCacheType[] = []

    get memberCache(): MemberCacheType[] {
        return this._memberCache
    }

    set memberCache(value: MemberCacheType[]) {
        this._memberCache = value
    }

    private _cacheMemberDone = false

    get cacheMemberDone(): boolean {
        return this._cacheMemberDone
    }

    set cacheMemberDone(value: boolean) {
        this._cacheMemberDone = value
    }

    private _cacheMemberSendMessage = false

    get cacheMemberSendMessage(): boolean {
        return this._cacheMemberSendMessage
    }

    set cacheMemberSendMessage(value: boolean) {
        this._cacheMemberSendMessage = value
    }

    private _friendShipList: FriendshipItem[] = []

    get friendShipList(): FriendshipItem[] {
        return this._friendShipList
    }

    set friendShipList(value: FriendshipItem[]) {
        this._friendShipList = value
    }

    public get client() {
        return this._client
    }

    public addMessage(sayable: Message | Contact | Room, msg: string | Filebox, extra: {
        msg_id: number,
        chat_id: number,
        afterSend?: () => Promise<void>
    }): void {
        this.sendQueueHelper.addMessageWithMsgId(extra.msg_id, sayable, msg, extra)
    }

    // TODO: 请在接口中定义方法
    public sendMessage(sayable: Message | Contact | Room, msg: string | Filebox, extra: {
        msg_id: number,
        chat_id: number
    }): Promise<void | Message> {
        const msgText = msg instanceof Filebox ? msg.name : msg.toString()
        return new Promise((resolve, reject) => {
            sayable.say(msg).then(msg => {
                // 保存到undo消息缓存
                if (msg) {
                    // 更新消息插入返回的微信消息id
                    MessageService.getInstance().updateMessageByChatMsg({
                        chat_id: extra.chat_id.toString(),
                        msg_text: msgText,
                        tg_msg_id: extra.msg_id ? extra.msg_id : undefined,
                    }, {
                        telegram_message_id: extra.msg_id,
                        type: msg instanceof Filebox ? 0 : 7,
                        sender_id: sayable.id,
                        wechat_message_id: msg.id,
                        send_by: msg.talker().name()
                    })
                    CacheHelper.getInstances().addUndoMessage({
                        chat_id: extra.chat_id,
                        wx_msg_id: msg.id,
                        msg_id: extra.msg_id,
                    })

                    if (this.tgClient.setting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                        // 配置了能编辑消息
                        if (this.tgClient.tgUserClientLogin) {
                            MessageService.getInstance().findMessageByTelegramMessageId(extra.msg_id, extra.chat_id).then(item => {
                                if (item && item.telegram_user_message_id) {
                                    this.tgClient.tgUserClient?.editMessage({
                                        ...extra,
                                        msg_id: item.telegram_user_message_id,
                                    }, `${msgText}  ✅`)
                                } else {
                                    this.sendMessageToTg({
                                        body: this.t('common.sendSuccess'),
                                        replay_msg_id: extra.msg_id,
                                        chatId: extra.chat_id
                                    })
                                }
                            })
                        } else {
                            this.sendMessageToTg({
                                body: this.t('common.sendSuccess'),
                                replay_msg_id: extra.msg_id,
                                chatId: extra.chat_id
                            })
                        }
                    }
                }
                resolve(msg)
            }).catch(e => {
                if (this.tgClient.tgUserClientLogin) {
                    MessageService.getInstance().findMessageByTelegramMessageId(extra.msg_id, extra.chat_id).then(item => {
                        if (item && item.telegram_user_message_id) {
                            this.tgClient.tgClient?.editMessage({
                                ...extra,
                                msg_id: item.telegram_user_message_id,
                            }, `${msgText}  ❌`)
                        } else {
                            this.sendMessageToTg({
                                body: this.t('common.sendFail'),
                                replay_msg_id: extra.msg_id,
                                chatId: extra.chat_id
                            })
                        }
                    })
                } else {
                    this.sendMessageToTg({
                        body: this.t('common.sendFail'),
                        replay_msg_id: extra.msg_id,
                        chatId: extra.chat_id
                    })
                }

                reject(e)
            })
        })
    }

    public async start() {
        if (this._client === null) {
            return
        }
        // if(this._client.ready().then())
        if (!this._started) {
            // if (this.client.ready().then(() => {
            //     console.log('fuck lao wang +++ ',this.client.currentUser.wechaty.state)
            // }))
            this._client.start().then(() => {
                this._started = true
                this.logInfo('Wechat client start!')

                this.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendMessage.bind(this), 617)
                this.tgClient.sendQueueHelper = new SimpleMessageSendQueueHelper(this.sendMessageToTg.bind(this), 733)
            })
        } else {
            this.logInfo('Wechat client already started!')
            return new Error('Wechat client already started!')
        }
    }

    // public async stop() {
    //     this.client.currentUser.wechaty.stop()
    //     this._started = false
    //     // await this._client.stop().then(() => this._started = false)
    // }

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
        // this._client.logout()
        this.logInfo('on logout ....')
        this.clearCache().then(() => {
            this.logInfo('logout do clearCache ... ')
        })
        // this._client.reset().then()
        if (this._started) {
            this._started = false
            // 被挤下线,需要重新登录，需要重启 wechaty，不然不会清空缓存
            this.resetValue()
        }
    }

    public resetValue() {
        this.readyCount = 0
        this.tgClient.reset()
    }

    public async reloadContactCache() {
        this._contactMap = new Map<number, Set<ContactItem>>([
            [0, new Set<ContactItem>()],
            [1, new Set<ContactItem>()],
            [2, new Set<ContactItem>()],
            [3, new Set<ContactItem>()]
        ])
        return this.cacheMember()
    }

    public editSendFailButton(chatId: number, tg_msg_id: number, caption: string) {
        this.tgClient.bot.telegram.editMessageCaption(chatId, tg_msg_id, undefined, caption, {
            reply_markup: {
                inline_keyboard: [[Markup.button.callback(this.t('common.reReceive'), 'resendFile')]]
            }
        })
    }

    public getSendTgFileMethodString(messageType: number): 'animation' | 'document' | 'audio' | 'photo' | 'video' | 'voice' {
        switch (messageType) {
            case MessageType.Image:
                return 'photo'
            case PUPPET.types.Message.Emoticon:
                return 'photo'
            case PUPPET.types.Message.Audio:
                return 'audio'
            case 34:
                return 'voice'
            case PUPPET.types.Message.Video:
                return 'video'
            default:
                return 'document'
        }
    }

    private init() {
        if (this._client === null) return
        this._client.on('login', this.login)
            .on('scan', this.scan)
            .on('message', this.message)
            .on('logout', this.logout)
            .on('stop', this.onStop)
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
        this.tgClient.sendQueueHelper.addMessageWithMsgId(Number(this.snowflakeUtil.getUniqueID()),
            {
                sender: this.t('wechat.unknownUser'),
                body: this.t('wechat.roomInvite'),
                id: roomInvitation.id,
                chatId: this.tgClient.chatId
            })
    }

    private error(error: Error) {
        this.logError('error:', error)
    }

    private friendship(friendship: FriendshipInterface) {
        const contact = friendship.contact()
        const hello = friendship.hello()
        if (friendship.type() === FriendshipImpl.Type.Receive) {
            const id = UniqueIdGenerator.getInstance().generateId('friendship-accept')
            this._friendShipList.push(new FriendshipItem(id, friendship))
            this._tgClient.bot.telegram.sendMessage(
                this._tgClient.chatId, `👤${contact.name()}${this.t('wechat.requestAddFriend')}\n${hello}`,
                {
                    reply_markup: {
                        inline_keyboard:
                            [
                                [
                                    {text: this.t('common.accept'), callback_data: `${id}`},
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

    private roomJoin(room: Room, inviteeList: Contact[], inviter: Contact) {
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

    private roomLeave(room: Room, leaverList: Contact[]) {
        leaverList.forEach(leaver => {
            if (leaver.self()) {
                this._roomList = this._roomList.filter(it => it.id != room.id)
            }
        })
    }

    private async roomTopic(room: Room, topic: string, oldTopic: string, changer: Contact) {
        const item = this._roomList.find(it => it.room.id === room.id)
        if (item) {
            if (item.room.payload?.topic !== topic) {
                this._roomList[this._roomList.indexOf(item)].room.sync()
            }
        }
        // 如果绑定了群组,则更新群组名称和数据库的名称
        const bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(room.id)
        if (bindItem) {
            bindItem.name = topic
            this._tgClient.bindItemService.updateBindItem(bindItem.chat_id + '', bindItem)
            await this.tgClient.bot.telegram.setChatTitle(bindItem.chat_id, topic)
        }
    }

    private onStop() {
        this.logInfo('on stop...')
        this.tgClient.stop()
    }

    private onReady() {
        this.logDebug('Wechat client ready!')
        this.readyCount++
        if (this.readyCount >= 3) {
            // 尝试重启
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, this.t('wechat.loginOutDate'))
            this.resetValue()
            return
        }
        this.cacheMember().then(() => {
            this.cacheMemberDone = true
            if (!this.cacheMemberSendMessage) {
                this.cacheMemberSendMessage = true
                this._tgClient.bot.telegram.editMessageText(this._tgClient.chatId, this.loadMsg, undefined, this.t('wechat.contactFinished')).then(msg => {
                    const b = this.tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)
                    if (b && !this.tgClient.tgUserClientLogin) {
                        // 启动bot
                        this.tgClient.loginUserClient()
                    }
                    setTimeout(() => {
                        if (this.loadMsg) {
                            this._tgClient.bot.telegram.deleteMessage(this._tgClient.chatId, this.loadMsg)
                        }
                    }, 10 * 1000)
                })
            }
            this.logDebug('cache member done!')
        })
    }

    private login() {
        if (this._client.isLoggedIn) {
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, this.t('wechat.loginSuccess')).then(msg => {
                setTimeout(() => {
                    this.tgClient.bot.telegram.deleteMessage(this.tgClient.chatId, msg.message_id)
                }, 10000)
                // this._client.Contact.findAll()
                // this._client.Room.findAll()
                // this._client.Room.find({id: ''})
                // 重新登陆就要等待加载
                this.cacheMemberDone = false
                this.cacheMemberSendMessage = false


                this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, this.t('wechat.loadingMembers')).then(value => {
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
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, this.t('wechat.loginFail'))
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
                    tgBot.telegram.editMessageMedia(this._tgClient.chatId, this.scanMsgId, undefined, {
                        type: 'photo',
                        media: {source: buff}, caption: this.t('common.scanLogin')
                    })
                } else {
                    tgBot.telegram.sendPhoto(this._tgClient.chatId, {source: buff}, {caption: this.t('common.scanLogin')}).then(msg => {
                        this.scanMsgId = msg.message_id
                    })
                }
            })
        } else {
            this.logDebug('StarterBot', 'onScan: %s(%s)', ScanStatus[status], status)
        }
    }

    private async message(message: Message) {
        const talker = message.talker()
        const [roomEntity] = await Promise.all([message.room()])
        const messageType = message.type()
        const alias = await talker.alias()
        let showSender: string = alias ? `[${alias}] ${talker.name()}` : talker.name()
        // 生成自定义msgId
        const uniqueId = Number(this.snowflakeUtil.getUniqueID())

        const roomTopic = await roomEntity?.topic() || ''
        let bindItem = undefined
        const mentionSelf = this.mentionSelf(message.text())
        if (roomEntity) {
            // 黑白名单过滤
            const blackFind = this._tgClient.setting.getVariable(VariableType.SETTING_BLACK_LIST).find(item => item.name === roomTopic)
            const whiteFind = this._tgClient.setting.getVariable(VariableType.SETTING_WHITE_LIST).find(item => item.name === roomTopic)
            if (this._tgClient.setting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                if (blackFind && !mentionSelf) {
                    return
                }
            } else { // 白名单模式
                if (!whiteFind && !mentionSelf) {
                    return
                }
            }

            if (message.self()) {
                // 过滤掉自己所发送的消息 和没有绑定的群组才转发
                if (this._tgClient.setting.getVariable(VariableType.SETTING_FORWARD_SELF)) {
                    // FIXME: 临时方案
                    await new Promise(resolve => setTimeout(resolve, 200))
                    if (CacheHelper.getInstances().getUndoMessageByWxMsgId(message.id)) {
                        return
                    }
                    // bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(message.listener().id)
                } else {
                    return
                }
            }
            // 在缓存中查找群组 bindId已弃用
            const roomItemFind = this._roomList.find(i => i.room.id === roomEntity.id)
            let bindId
            if (!roomItemFind) {
                // 找不到该群组,直接将群组加进缓存生成新id
                bindId = UniqueIdGenerator.getInstance().generateId('room')
                this._roomList.push({
                    id: bindId,
                    room: roomEntity
                })
            } else {
                bindId = roomItemFind.id
            }
            bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(roomEntity.id)
            if (!bindItem && this.cacheMemberDone && this._tgClient.tgUserClientLogin && message.text() !== '' && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)) {
                bindItem = await this._tgClient.tgUserClient?.createGroup({
                    type: 1,
                    room: roomEntity,
                    bindId: bindId
                })
            }
        } else {
            // 自己发送的消息
            if (message.self()) {
                if (message.type() === PUPPET.types.Message.Recalled) {
                    return
                }
                // 过滤掉自己所发送的消息 和没有绑定的群组才转发
                if (this._tgClient.setting.getVariable(VariableType.SETTING_FORWARD_SELF)) {
                    // FIXME: 临时方案
                    await new Promise(resolve => setTimeout(resolve, 200))
                    if (CacheHelper.getInstances().getUndoMessageByWxMsgId(message.id)) {
                        return
                    }
                    bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(message.listener().id)
                } else {
                    return
                }
            } else {
                bindItem = await this._tgClient.bindItemService.getBindItemByWechatId(talker.id)
            }
            // 在缓存中查找公众号
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
            if (!bindItem && this.cacheMemberDone && this._tgClient.tgUserClientLogin && message.text() !== '' && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_GROUP)) {
                if (message.self()) {
                    bindItem = await this._tgClient.tgUserClient?.createGroup({
                        type: 0,
                        contact: message.to(),
                        bindId: bindId
                    })
                } else if (talker?.type() === PUPPET.types.Contact.Official && !this._tgClient.setting.getVariable(VariableType.SETTING_BLOCK_OFFICIAL_ACCOUNT)) {
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
        let identityStr = SimpleMessageSender.getTitle(message, bindItem ? true : false)
        const sendMessageBody: SimpleMessage = {
            sender: showSender,
            body: `${this.t('wechat.getOne')} ${this.t('wechat.messageType.unknown')}`,
            room: roomTopic,
            type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
            id: message.id,
            chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
            message: message,
            send_id: talker.id,
        }
        if (message.self()) {
            if (message.type() === PUPPET.types.Message.Recalled) {
                return
            }
            // 过滤掉自己所发送的消息
            if (this._tgClient.setting.getVariable(VariableType.SETTING_FORWARD_SELF)) {
                let toSender = ''
                const to = message.listener()
                if (to) {
                    toSender = !to.payload?.alias ? `${to?.name()}` : `[${to.payload?.alias}] ${to?.name()}`
                } else {
                    toSender = message.room()?.payload?.topic ? `${message.room()?.payload?.topic}` : '未知群组'
                }
                if (!bindItem) {
                    identityStr = roomEntity ? `👤${this.t('wechat.me')}->🌐${roomTopic}: ` : `👤${this.t('wechat.me')} -> 👤${toSender} : `
                }
                const meTitle = `${this.t('wechat.me')} -> ${toSender}`
                sendMessageBody.sender = meTitle
                showSender = meTitle
            }
        }
        // 过滤公众号消息
        if (talker?.type() === PUPPET.types.Contact.Official) {
            if (this._tgClient.currentOrder && this._tgClient.currentOrder === talker.payload.name) {
                this._tgClient.currentOrder = undefined
            } else {
                if (this._tgClient.setting.getVariable(VariableType.SETTING_BLOCK_OFFICIAL_ACCOUNT)) {
                    return
                }
            }
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

        const sendMessageWhenNoAvatar = (name?: string) => {
            const warpName = name ? name : this.t('common.unknown')
            this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                sender: showSender,
                body: `${this.t('wechat.getOne')} 👤${warpName} ${this.t('wechat.messageType.card')}, ${this.t('wechat.plzViewOnPhone')}`,
                type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                room: roomTopic,
                id: message.id,
                chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                message: message,
                send_id: talker.id,
            })
        }

        switch (messageType) {
            case PUPPET.types.Message.Unknown:
                // console.log(talker.name(), ': 发送了unknown message...')
                if (message.text() !== '') {
                    this.logDebug('unknown message:', message.text())
                }
                if (message.text() === `${this.t('wechat.get')}${this.t('wechat.messageType.redPacket')}, ${this.t('wechat.plzViewOnPhone')}`) {
                    sendMessageBody.body = `${this.t('wechat.get')}${this.t('wechat.messageType.redPacket')}, ${this.t('wechat.plzViewOnPhone')}`
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, sendMessageBody)
                } else if (message.text() === 'webwxvoipnotifymsg') {
                    sendMessageBody.body = `${this.t('wechat.get')}${this.t('wechat.audioOrVideo')}, ${this.t('wechat.plzViewOnPhone')}`
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, sendMessageBody)
                } else {
                    sendMessageBody.body = message.text().length > 4000 ? message.text().substring(0, 4000) : message.text()
                    if (sendMessageBody.body === '') {
                        return
                    }
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, sendMessageBody)
                }
                break
            case PUPPET.types.Message.Text: {

                let messageTxt = message.text()
                // 因为是html模式 原始的文本中的<>需要转义
                messageTxt = messageTxt.replaceAll(/</g, '&lt;')
                    .replaceAll(/>/g, '&gt;')
                if (messageTxt) {
                    if (mentionSelf) {
                        const tgId = this._tgClient.chatId
                        if (tgId) {
                            const me = this.client.currentUser
                            if (me.payload) {
                                messageTxt = messageTxt.replaceAll(`@${me.payload.name}`,
                                    `<a href="tg://user?id=${tgId}">@${me.payload.name}</a>`)
                                messageTxt = messageTxt.replaceAll('@所有人',
                                    `<a href="tg://user?id=${tgId}">@${this.t('wechat.all')}</a>`)
                            }
                        }
                    }
                    // console.log('showSender is :', showSender, 'talker id is :', talker.id, 'message text is ', messageTxt,)
                    // 地址 只有个人发送的才会有这个连接的文本出现
                    if (messageTxt.endsWith('pictype=location')) {
                        const locationText = `${this.t('wechat.messageType.location')}: <code>${message.text().split('\n')[0].replace(':', '')}</code>`
                        this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                            sender: showSender,
                            body: locationText,
                            room: roomTopic,
                            type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                            id: message.id,
                            not_escape_html: true,
                            chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                            message: message,
                            send_id: talker.id,
                        })
                        return
                    }
                    // 表情转换
                    const emojiConverter = new EmojiConverter()
                    const convertedText = emojiConverter.convert(messageTxt)
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                        sender: showSender,
                        body: convertedText,
                        room: roomTopic,
                        type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                        id: message.id,
                        chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                        message: message,
                        send_id: talker.id,
                    })
                }
            }
                break
            case PUPPET.types.Message.Contact:
                // 收到名片消息
                MessageUtils.messageTextToContact(message.text()).then(res => {
                    const shareContactCaption = `${this.t('wechat.getOne')} 👤${res.nickname} 的名片消息, ${this.t('wechat.plzViewOnPhone')}\n${identityStr}`
                    if (res.bigheadimgurl) {
                        Filebox.fromUrl(res.bigheadimgurl).toBuffer().then(avatarBuff => {
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
            case PUPPET.types.Message.Emoticon: // 处理表情消息的逻辑
                if (this._tgClient.setting.getVariable(VariableType.SETTING_BLOCK_EMOTICON)) {
                    break
                }
            case PUPPET.types.Message.Attachment:
            case PUPPET.types.Message.Image:
            case PUPPET.types.Message.Audio:
            case PUPPET.types.Message.Video:
                if (messageType === PUPPET.types.Message.Attachment && !message.payload?.filename) {
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                        sender: showSender,
                        body: `[${this.t('wechat.messageType.setMsg')}]${this.t('wechat.plzViewOnPhone')}`,
                        room: roomTopic,
                        type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                        id: message.id,
                        chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                        message: message,
                        send_id: talker.id,
                    })
                    break
                }
                this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                    sender: showSender,
                    body: '',
                    room: roomTopic,
                    type: talker?.type() === PUPPET.types.Contact.Official ? 1 : 0,
                    id: message.id,
                    chatId: bindItem ? bindItem.chat_id : this.tgClient.chatId,
                    message: message,
                    send_id: talker.id,
                }, message, identityStr)
                break
            case PUPPET.types.Message.MiniProgram: // 处理小程序消息的逻辑
                sendMessageBody.body = `${this.t('wechat.getOne')}${this.t('wechat.messageType.miniProgram')}`
                this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, sendMessageBody)
                break
            case PUPPET.types.Message.RedEnvelope: // 处理红包消息的逻辑 12
                break
            case PUPPET.types.Message.Url: // 处理链接消息的逻辑
                parseAppmsgMessagePayload(message.text()).then(res => {
                    if (res.items && res.items.length > 0) {
                        sendMessageBody.body = res.items.map((it, index) => {
                            return `<a href="${it.url}">${it.title}</a> <blockquote expandable>${it.summary} ...</blockquote>`
                        }).join('\n')
                    } else {
                        sendMessageBody.body = `<a href="${res.url}">${res.title}</a> <blockquote expandable>${res.des} ...</blockquote>`
                    }
                    this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                        ...sendMessageBody,
                        not_escape_html: true
                    })
                })
                // message.toUrlLink().then(url => {
                //     sendMessageBody.body = `${this.t('wechat.messageType.url')}: ${url.description()} <a href="${url.url()}">${url.title()}</a>`
                //     this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, {
                //         ...sendMessageBody,
                //         not_escape_html: true
                //     })
                // })
                break
            case PUPPET.types.Message.Transfer: // 处理转账消息的逻辑 11
                sendMessageBody.body = `${this.t('wechat.getOne')}${this.t('wechat.messageType.transfer')}`
                this.tgClient.sendQueueHelper.addMessageWithMsgId(uniqueId, sendMessageBody)
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
                // this.sendMessageToTg(sendMessageBody)
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

    private mentionSelf(text: string) {
        if (text.includes('@所有人')) {
            return true
        }
        const me = this.client.currentUser
        if (text.includes(`@${me.payload?.name}`)) {
            return true
        }
        return false
    }

    private async recallMessage(sendMessageBody: SimpleMessage) {
        if (sendMessageBody.message) {
            const msgidMatch = sendMessageBody.message.text().match(/<msgid>(.*?)<\/msgid>/)
            if (msgidMatch) {
                const msgid = msgidMatch[1]
                const item = await MessageService.getInstance().findMessageByWechatMessageId(msgid)
                if (item) {
                    this._tgClient.bot.telegram.sendMessage(item.chat_id, this.t('wechat.recallMessage'), {
                        reply_parameters: {
                            message_id: item.telegram_message_id
                        }
                    })
                } else {
                    sendMessageBody.body = this.t('wechat.recallMessage')
                    this.sendMessageToTg(sendMessageBody)
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

    private clearCache() {
        return new Promise(resolve => {
            const filePath = 'storage/wechat_bot.memory-card.json'
            fs.rm(filePath, err => {
                this.contactMap?.get(ContactImpl.Type.Individual)?.clear()
                this.contactMap?.get(ContactImpl.Type.Official)?.clear()
                this.cacheMemberDone = false
                this.cacheMemberSendMessage = false
                this._roomList = []
                this.tgClient.selectedMember = []
                this.tgClient.flagPinMessageType = ''
                this.tgClient.findPinMessage()
                if (this.scanMsgId) {
                    this._tgClient.bot.telegram.deleteMessage(this._tgClient.chatId, this.scanMsgId)
                }
                resolve(true)
            })
        })
    }

    private sentMessageWhenFileToLage(Filebox: FileboxInterface, message: SimpleMessage): boolean {
        // 配置了tg api可以往下走发送
        if (!this.tgClient.tgClient && Filebox.size > 1024 * 1024 * 50) {
            this.sendMessageToTg(message)
            return true
        }
        return false
    }

    private async sendMessageToTg(tgMessage: SimpleMessage, message?: Message, identityStr?: string) {
        if (message) {
            this.sendFileToTg(message, identityStr, tgMessage)
        } else {
            this.sendTextToTg(tgMessage)
        }
    }

    private async sendTextToTg(message: SimpleMessage) {
        // AI 自动回复
        if (config.OPENAI_API_KEY && !message.message.self() && message.message.type() === PUPPET.types.Message.Text) {
            const requestOpenAI = () => {
                this._openAIService.callOpenAI(message.body + '').then(res => {
                    if (res) {
                        message.message.say(res)
                    }
                })
            }
            if (message.message.room() && this.tgClient.setting.getVariable(VariableType.SETTING_FORWARD_OPENAI_ROOM)) {
                requestOpenAI()
            } else if (!message.message.room() && message.message.talker().type() === 1 && this.tgClient.setting.getVariable(VariableType.SETTING_FORWARD_OPENAI_CONTACT)) {
                requestOpenAI()
            }
        }
        const html = SimpleMessageSender.send(message) + ''
        const maxLength = 9000

        if (html.length > 9000) {
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
                await this._tgClient.bot.telegram.sendMessage(message.chatId, sendMsg, {
                    parse_mode: 'HTML',
                    reply_parameters: message.replay_msg_id ? {
                        message_id: message.replay_msg_id
                    } : undefined
                }).then(res => {
                    if (message.message && message.id && i === 0) {
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
                    // group deleted
                    if (e.response.error_code === 403) {
                        this._tgClient.bindItemService.removeBindItemByChatId(parseInt(message.chatId + ''))
                        this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, SimpleMessageSender.send(message), {
                            parse_mode: 'HTML'
                        }).then(res => {
                            if (message.id) {
                                this._tgClient.messageMap.set(res.message_id, message.id)
                            }
                        })
                    }
                    // Telegram Too Many Requests
                    if (e.response.error_code === 429) {
                        setTimeout(() => {
                            // this._tgClient.bot.telegram.sendMessage(message.chatId,
                            //     SimpleMessageSender.send(
                            //         {
                            //             body: this.t('common.tooManyRequests', e.response.parameters.retry_after),
                            //             chatId: message.chatId,
                            //         }))
                            this.logError(this.t('common.tooManyRequests', e.response.parameters.retry_after))
                            this.tgClient.sendQueueHelper.addMessageWithMsgId(Number(this.snowflakeUtil.getUniqueID()),
                                message)
                        }, e.response.parameters.retry_after * 1000 || 20000)
                    }
                })
            }
        } else {
            await this._tgClient.bot.telegram.sendMessage(message.chatId, html, {
                parse_mode: 'HTML',
                reply_parameters: message.replay_msg_id ? {
                    message_id: message.replay_msg_id
                } : undefined,
                ...message.extraReplyMessage
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
                // group deleted
                if (e.response.error_code === 403) {
                    this._tgClient.bindItemService.removeBindItemByChatId(parseInt(message.chatId + ''))
                    this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, SimpleMessageSender.send(message), {
                        parse_mode: 'HTML'
                    }).then(res => {
                        if (message.id) {
                            this._tgClient.messageMap.set(res.message_id, message.id)
                        }
                    })
                }
                // Telegram Too Many Requests
                if (e.response.error_code === 429) {
                    setTimeout(() => {
                        // this._tgClient.bot.telegram.sendMessage(message.chatId,
                        //     SimpleMessageSender.send(
                        //         {
                        //             body: this.t('common.tooManyRequests', e.response.parameters.retry_after),
                        //             chatId: message.chatId,
                        //         }))
                        this.logError(this.t('common.tooManyRequests', e.response.parameters.retry_after))
                        this.tgClient.sendQueueHelper.addMessageWithMsgId(Number(this.snowflakeUtil.getUniqueID()),
                            message)
                    }, e.response.parameters.retry_after * 1000 || 20000)
                }
            })
        }
    }

    private async sendFileToTg(message: Message, identityStr: string, tgMessage: SimpleMessage) {
        // 先发送一个临时文件
        let sender = new SenderFactory().createSender(this._tgClient.bot)
        let messageType: PUPPET.types.Message | number = message.type()
        // 语音文件无法编辑, 所以所有音频文件不进行编辑
        if (messageType === PUPPET.types.Message.Audio) {
            if (tgMessage.message && tgMessage.id) {
                // 语音文件特殊处理
                message.toFilebox().then(fBox => {
                    let fileName = fBox.name
                    // 如果是语音文件 替换后缀方便直接播放
                    if (fileName.endsWith('.sil')) {
                        fileName = fileName.replace('.sil', '.mp3')
                        messageType = 34
                    }
                    fBox.toBuffer().then(buffer => {
                        sender.sendFile(tgMessage.chatId, {
                            buff: buffer,
                            filename: fileName,
                            caption: this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_TRANSCRIPT)
                                ? `${identityStr}${this.t('wechat.transcripting')}`
                                : `${identityStr}`,
                            fileType: this.getSendTgFileMethodString(messageType),
                        }, {parse_mode: 'HTML'}).then(res => {
                            MessageService.getInstance().addMessage({
                                wechat_message_id: tgMessage.id,
                                chat_id: tgMessage.chatId ? tgMessage.chatId + '' : '',
                                telegram_message_id: parseInt(res.message_id + ''),
                                type: tgMessage.message.type(),
                                msg_text: tgMessage.body + '',
                                send_by: tgMessage.sender ? tgMessage.sender : '',
                                create_time: new Date().getTime(),
                            })
                            if (this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_TRANSCRIPT)) {
                                this.logInfo('audio file to buffer success')
                                SpeechService.getInstance().getTranscript(buffer).then(audioTranscript => {
                                    this.logDebug('audioTranscript text: ', audioTranscript)
                                    sender.editAudio(tgMessage.chatId, res.message_id, `${identityStr}\n${audioTranscript}`)
                                }).catch((reason) => {
                                    this.logInfo('audioTranscript error: ', reason)
                                    sender.editAudio(tgMessage.chatId, res.message_id, `${identityStr}\n${this.t('wechat.audioTranscriptFailed')}, ${this.t('wechat.plzViewOnPhone')}`)
                                })
                            }
                        }).catch((reason) => {
                            this.logInfo('send file error:', reason)
                            this.sendMessageToTg({
                                ...tgMessage,
                                body: `${this.t('wechat.get')}[${this.getMessageName(message.type())}]${this.t('common.error')}, ${this.t('wechat.plzViewOnPhone')}`
                            })
                        })
                    })
                }).catch((reason) => {
                    this.logInfo('file to buffer error:', reason)
                    this.sendMessageToTg({
                        ...tgMessage,
                        body: `${this.t('wechat.get')}[${this.getMessageName(message.type())}]${this.t('common.error')}, ${this.t('wechat.plzViewOnPhone')}`
                    })
                })
            }
        } else {
            sender.sendFile(tgMessage.chatId, {
                buff: Buffer.from('0'),
                filename: 'temp_file',
                caption: this.t('wechat.receivingFile'),
                fileType: 'document'
            }).then(tempRes => {
                if (tgMessage.message && tgMessage.id) {
                    MessageService.getInstance().addMessage({
                        wechat_message_id: tgMessage.id,
                        chat_id: tgMessage.chatId ? tgMessage.chatId + '' : '',
                        telegram_message_id: parseInt(tempRes.message_id + ''),
                        type: tgMessage.message.type(),
                        msg_text: tgMessage.body + '',
                        send_by: tgMessage.sender ? tgMessage.sender : '',
                        create_time: new Date().getTime(),
                    })
                    message.toFilebox().then(fBox => {
                        const fileName = fBox.name
                        // 配置了tg api尝试发送大文件
                        if (this.sentMessageWhenFileToLage(fBox, {
                            ...tgMessage,
                            body: `[${this.getMessageName(messageType)}]${this.t('common.large')}, ${this.t('wechat.plzViewOnPhone')}`
                        })) {
                            return
                        }
                        fBox.toBuffer().then(async buff => {
                            // buff无内容说明不支持,直接发送失败
                            if (buff.length === 0) {
                                this.tgClient.bot.telegram.editMessageCaption(tgMessage.chatId, Number(tempRes.message_id), undefined, `${this.t('wechat.get')}[${this.getMessageName(message.type())}]${this.t('common.error')}, ${this.t('wechat.plzViewOnPhone')}`)
                                return
                            }
                            // 配置了 tg api 尝试发送大文件
                            if (this.tgClient.tgClient && fBox.size > 1024 * 1024 * 50) {
                                sender = new SenderFactory().createSender(this._tgClient.tgClient.client)
                            }

                            if (fileName.endsWith('.gif')) {
                                messageType = PUPPET.types.Message.Attachment
                            }
                            if (this.tgClient.setting.getVariable(VariableType.SETTING_COMPRESSION)) { // 需要判断类型压缩
                                // 压缩图片
                                const imageUtils = new ImageUtils()
                                switch (messageType) {
                                    case PUPPET.types.Message.Image:
                                    case PUPPET.types.Message.Audio:
                                    case PUPPET.types.Message.Video:
                                    case PUPPET.types.Message.Emoticon:
                                    case PUPPET.types.Message.Attachment:
                                        sender.editFile(tgMessage.chatId, tempRes.message_id, {
                                            buff: messageType === PUPPET.types.Message.Image ? await imageUtils.compressPicture(buff) : buff,
                                            filename: fileName,
                                            fileType: this.getSendTgFileMethodString(messageType),
                                            caption: identityStr
                                        }, {parse_mode: 'HTML'}).catch(e => {
                                            // sender.sendText(tgMessage.chatId, this.t('wechat.fileReceivingFailed'), {reply_id: parseInt(tempRes.message_id + '')})
                                            this.editSendFailButton(Number(tgMessage.chatId), Number(tempRes.message_id), this.t('wechat.fileReceivingFailed'))
                                        })
                                        break
                                }
                            } else { // 不需要判断类型压缩 直接发送文件
                                sender.editFile(tgMessage.chatId, tempRes.message_id, {
                                    buff: buff,
                                    filename: fileName,
                                    fileType: 'document',
                                    caption: identityStr
                                }, {parse_mode: 'HTML'}).catch(e => {
                                    // sender.sendText(tgMessage.chatId, this.t('wechat.fileReceivingFailed'), {reply_id: parseInt(tempRes.message_id + '')})
                                    this.editSendFailButton(Number(tgMessage.chatId), Number(tempRes.message_id), this.t('wechat.fileReceivingFailed'))
                                })
                            }
                        })
                    }).catch(e => {
                        // this.sendMessageToTg({
                        //     ...tgMessage,
                        //     body: `${this.t('wechat.get')}[${this.getMessageName(message.type())}]${this.t('common.error')}, ${this.t('wechat.plzViewOnPhone')}`
                        // })
                        this.editSendFailButton(Number(tgMessage.chatId), Number(tempRes.message_id), `${this.t('wechat.get')}[${this.getMessageName(message.type())}]${this.t('common.error')}, ${this.t('wechat.plzViewOnPhone')}`)
                    })
                }
            }).catch(e => {
                if (e.response.error_code === 403) {
                    this.tgClient.bindItemService.removeBindItemByChatId(tgMessage.chatId)
                    tgMessage.chatId = this.tgClient.chatId
                    this.sendMessageToTg(tgMessage, message, identityStr)
                    return
                }
                this.logError('send file error:', e)
                this.sendMessageToTg({
                    ...tgMessage,
                    body: `[${this.getMessageName(messageType)}]${this.t('wechat.forwardFail')}, ${this.t('wechat.plzViewOnPhone')}`
                })
            })
        }
    }

    private getMessageName(messageType: number): string {
        switch (messageType) {
            case MessageType.Unknown:
                return this.t('wechat.messageType.unknown')
            case PUPPET.types.Message.Text:
                return this.t('wechat.messageType.text')
            case PUPPET.types.Message.Contact:
                return this.t('wechat.messageType.card')
            case PUPPET.types.Message.Attachment:
                return this.t('wechat.messageType.file')
            case PUPPET.types.Message.Image:
                return this.t('wechat.messageType.image')
            case PUPPET.types.Message.Audio:
                return this.t('wechat.messageType.voice')
            case PUPPET.types.Message.Video:
                return this.t('wechat.messageType.video')
            case PUPPET.types.Message.Emoticon:
                return this.t('wechat.messageType.emoticon')
            case PUPPET.types.Message.MiniProgram:
                return this.t('wechat.messageType.miniProgram')
            case PUPPET.types.Message.RedEnvelope:
                return this.t('wechat.messageType.redPacket')
            case PUPPET.types.Message.Url:
                return this.t('wechat.messageType.url')
            case PUPPET.types.Message.Transfer:
                return this.t('wechat.messageType.transfer')
            case PUPPET.types.Message.Recalled:
                return this.t('wechat.messageType.recalled')
            case PUPPET.types.Message.GroupNote:
                return this.t('wechat.messageType.groupNote')
            case PUPPET.types.Message.ChatHistory:
                return this.t('wechat.messageType.chatHistory')
            case PUPPET.types.Message.Post:
                return this.t('wechat.messageType.post')
            case PUPPET.types.Message.Location:
                return this.t('wechat.messageType.location')
            default:
                return this.t('wechat.messageType.unknown')
        }
    }
}