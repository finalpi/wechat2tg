import * as QRCode from 'qrcode';
import {ScanStatus, WechatyBuilder} from "wechaty";
import * as PUPPET from 'wechaty-puppet';
import {
    ContactInterface,
    FriendshipImpl,
    FriendshipInterface,
    MessageInterface,
    RoomInterface,
    WechatyInterface
} from 'wechaty/impls';
import {TelegramClient} from './TelegramClient';
import {EmojiConverter} from "../utils/EmojiUtils";
import * as console from "node:console";
import {MemberCacheType} from "../models/TgCache";
import {SimpleMessage} from "../models/Message";
import {TalkerEntity} from "../models/TalkerCache";
import {UniqueIdGenerator} from "../utils/IdUtils"
import {NotionMode, VariableType} from "../models/Settings";
import {FmtString} from "telegraf/format";

// import type {FriendshipInterface} from "wechaty/src/user-modules/mod";


export class WeChatClient {
    get memberCache(): MemberCacheType[] {
        return this._memberCache;
    }

    set memberCache(value: MemberCacheType[]) {
        this._memberCache = value;
    }

    get roomList(): RoomInterface[] {
        return this._roomList;
    }

    set roomList(value: RoomInterface[]) {
        this._roomList = value;
    }

    get selectedRoom(): RoomInterface[] {
        return this._selectedRoom;
    }

    set selectedRoom(value: RoomInterface[]) {
        this._selectedRoom = value;
    }

    get selectedContact(): ContactInterface[] {
        return this._selectedContact;
    }

    set selectedContact(value: ContactInterface[]) {
        this._selectedContact = value;
    }

    private readonly _tgClient: TelegramClient;

    constructor(private readonly tgClient: TelegramClient) {
        this._client = WechatyBuilder.build({
            name: './storage/wechat_bot',
            puppet: 'wechaty-puppet-wechat4u',
            puppetOptions: {
                uos: true
            }
        })
        this._tgClient = tgClient;
        this._contactMap = new Map<number, ContactInterface[]>([
            [0, []],
            [1, []],
            [2, []],
            [3, []]
        ]);

        this.scan = this.scan.bind(this);
        this.message = this.message.bind(this);
        this.start = this.start.bind(this);
        this.friendship = this.friendship.bind(this);
        this.init = this.init.bind(this);
        this.logout = this.logout.bind(this);
        this.login = this.login.bind(this);
    }

    private readonly _client: WechatyInterface;

    public get client() {
        return this._client;
    }

    private _contactMap: Map<number, ContactInterface[]> | undefined;
    private _roomList: RoomInterface[] = [];

    private _selectedContact: ContactInterface [] = [];
    private _selectedRoom: RoomInterface [] = [];
    private _memberCache: MemberCacheType[] = [];
    private scanMsgId: number | undefined = undefined

    private _started = false;

    public get contactMap(): Map<number, ContactInterface[]> | undefined {
        return this._contactMap;
    }

    public set contactMap(contactMap: Map<number, ContactInterface[]> | undefined) {
        this._contactMap = contactMap;
    }

    public async start() {
        this.init();
        if (this._client === null) return;
        // if(this._client.ready().then())
        if (!this._started) {
            await this._client.start().then(() => {
                this._started = true;
                console.log('Wechat client start!')
            })
        } else {
            console.log('Wechat client already started!')
            return new Error('Wechat client already started!')
        }
    }

    private init() {
        if (this._client === null) return;
        this._client.on('login', this.login)
            .on('scan', this.scan)
            .on('message', this.message)
            .on('logout', () => console.log('on logout...'))
            .on('stop', () => console.log('on stop...'))
            .on('friendship', this.friendship)
            .on('error', this.error);
    }

    private error(error: Error) {
        console.error('error:', error)
    }

    private friendship(friendship: FriendshipInterface) {
        if (friendship.type() === FriendshipImpl.Type.Receive) {
            const contact = friendship.contact()
            const hello = friendship.hello()
            const friendshipId = friendship.id;
            this._tgClient.bot.telegram.sendMessage(
                this._tgClient.chatId, `收到好友请求: ${contact.name()} \n 验证消息: ${hello}`,
                {
                    reply_markup: {
                        inline_keyboard:
                            [
                                [
                                    {text: '接受', callback_data: `friendship-accept-${friendshipId}`},
                                    {text: '拒绝', callback_data: `friendship-reject-${friendshipId}`},
                                ]
                            ]
                    }
                })
        }
    }

    public async stop() {
        await this._client.stop().then(() => this._started = false);
        // console.log('stop ... ')
    }

    public restart() {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this._client.restart().then(() => {
            console.log('restart ... ')
        })
    }

    public reset() {
        this._client.reset().then(() => {
            console.log('reset ... ')
        })
    }

    public async logout() {
        this._client.logout();
        // this._client.reset().then()
        console.log('logout ... ')
    }

    private login() {
        if (this._client.isLoggedIn) {
            this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '登录成功!')
            // 登陆后就缓存所有的联系人和房间
            this._tgClient.setAllMemberCache().then(() => {
                this._tgClient.calcShowMemberList()
            });
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
        console.log('---------scan login---------')
        if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
            const qrcodeImageUrl = encodeURIComponent(qrcode)

            console.info('StarterBot', 'onScan: %s(%s) - %s', ScanStatus[status], status, qrcodeImageUrl)

            // console.log(this._bot)
            const tgBot = this._tgClient.bot
            // tgBot.telegram.sendMessage(this._tgClient.chatId, '请扫码登陆')
            // console.log('chat id is : {}', this._tgClient.chatId)
            // if (!this._started) {
            QRCode.toBuffer(qrcode).then(buff =>
                tgBot.telegram.sendPhoto(this._tgClient.chatId, {source: buff}, {caption: '请扫码登陆:'})).then(msg => {
                if (this.scanMsgId) {
                    tgBot.telegram.deleteMessage(this._tgClient.chatId, this.scanMsgId)
                }
                this.scanMsgId = msg.message_id
            })
            // }

        } else {
            console.info('StarterBot', 'onScan: %s(%s)', ScanStatus[status], status)
        }
    }

    private async message(message: MessageInterface) {
        // 过滤掉自己所发送的消息
        if (message.self()) {
            return
        }
        // 过滤公众号消息
        if (this._tgClient.setting.getVariable(VariableType.SETTING_ACCEPT_OFFICIAL_ACCOUNT) &&
            message.from()?.type() === PUPPET.types.Contact.Official) {
            return
        }
        // 添加用户至最近联系人
        const [roomEntity] = await Promise.all([message.room()])
        const talker = message.talker();
        if (!talker.isReady()){
            await talker.sync()
        }
        const roomTopic = await roomEntity?.topic() || '';
        // 黑白名单过滤
        if (roomEntity) {
            const blackFind = this._tgClient.setting.getVariable(VariableType.SETTING_BLACK_LIST).find(item => item.name === roomTopic);
            const whiteFind = this._tgClient.setting.getVariable(VariableType.SETTING_WHITE_LIST).find(item => item.name === roomTopic);
            if (this._tgClient.setting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                if (blackFind) {
                    return
                }
            } else {
                if (!whiteFind && !await message.mentionSelf()) {
                    return
                }
            }
        }
        // 自动设置回复人
        const type = talker.type()
        if (this._tgClient.setting && this._tgClient.setting.getVariable(VariableType.SETTING_AUTO_SWITCH) && type === PUPPET.types.Contact.Individual) {
            this._tgClient.setCurrentSelectContact(message);
        }

        const recentUsers = this._tgClient.recentUsers
        // 如果不存在该联系人
        const recentUser = recentUsers.find(item => (roomEntity && roomEntity.id) === item.talker?.id || (!roomEntity && talker.id === item.talker?.id))
        if (!recentUser) {
            // 如果最近联系人数量大于5,则移除掉多余的联系人
            if (recentUsers.length >= 5) {
                recentUsers.pop()
            }
            const idInstance = UniqueIdGenerator.getInstance();
            if (roomEntity) {
                // 房间
                recentUsers.unshift(new TalkerEntity(roomTopic, 0, idInstance.generateId("recent"), roomEntity))
            } else {
                // 个人
                recentUsers.unshift(new TalkerEntity(talker.name(), 1, idInstance.generateId("recent"), talker))
            }
        } else {
            // 找到元素在数组中的索引
            const index = recentUsers.indexOf(recentUser);

            // 如果元素存在于数组中
            if (index !== -1) {
                // 将元素从原索引位置删除
                recentUsers.splice(index, 1);
                // 将元素放在数组最前面
                recentUsers.unshift(recentUser);
            }
        }


        // console.info('message:', message)
        // attachment handle
        const messageType = message.type();


        const alias = await talker.alias();
        const showSender: string = alias ? `[${alias}] ${talker.name()}` : talker.name();

        const topic = await roomEntity?.topic();
        // todo: 优化
        // const mediaCaption=
        const identityStr = roomEntity ? `${topic} --- ${showSender} : ` : `${showSender} : `;
        const sendMessageBody: SimpleMessage = {
            sender: showSender,
            body: '收到一条 未知消息类型',
            room: roomTopic,
            id: message.id
        }

        switch (messageType) {
            case PUPPET.types.Message.Unknown:
                console.log(talker.name(), ': 发送了unknown message...')

                if (message.text() === '收到红包，请在手机上查看') {
                    sendMessageBody.body = '收到红包，请在手机上查看'
                    this._tgClient.sendMessage(sendMessageBody)
                }
                if (message.text() === 'webwxvoipnotifymsg') {
                    sendMessageBody.body = '收到视频或语音通话,请在手机上处理'
                    this._tgClient.sendMessage(sendMessageBody)
                }
                break;
            case PUPPET.types.Message.Text: {

                const messageTxt = message.text()

                if (messageTxt) {
                    // console.log('showSender is :', showSender, 'talker id is :', talker.id, 'message text is ', messageTxt,)
                    // 表情转换
                    const emojiConverter = new EmojiConverter();
                    const convertedText = emojiConverter.convert(messageTxt);
                    this._tgClient.sendMessage({
                        sender: showSender,
                        body: convertedText,
                        room: roomTopic,
                        id: message.id
                    })
                }
            }
                break;
            case PUPPET.types.Message.Contact:
                console.log('contact message')
                break;
            case PUPPET.types.Message.Attachment: {
                message.toFileBox().then(fBox => {
                    // 这里可以保存一份在本地 但是没有映射关系没法知道是谁的
                    fBox.toBuffer().then(buff => {

                        // 语音文件 .sil直接重命名为mp3 可以直接播放
                        const fileName = fBox.name;

                        const tgClient = this._tgClient
                        tgClient.bot.telegram.sendDocument(
                            tgClient.chatId, {source: buff, filename: fileName}, {
                                caption: identityStr
                            })
                    })
                })
                break;
            }
            case PUPPET.types.Message.Image: {
                message.toFileBox().then(fBox => {
                    // 这里可以保存一份在本地 但是没有映射关系没法知道是谁的
                    fBox.toBuffer().then(buff => {
                        const fileName = fBox.name;

                        const tgClient = this._tgClient
                        tgClient.bot.telegram.sendPhoto(
                            tgClient.chatId, {source: buff, filename: fileName}, {caption: identityStr})
                    })
                })
                break;
            }
            case PUPPET.types.Message.Audio: {
                message.toFileBox().then(fBox => {
                    // 这里可以保存一份在本地 但是没有映射关系没法知道是谁的
                    fBox.toBuffer().then(buff => {
                        let fileName = fBox.name;
                        const tgClient = this._tgClient
                        tgClient.bot.telegram.sendVoice(
                            tgClient.chatId, {source: buff, filename: fileName}, {caption: identityStr}).catch(res => {
                            if (fileName.endsWith('.sil')) {
                                fileName = fileName.replace('.sil', '.mp3')
                            }
                            // 如果用户不接收语音则发送文件
                            tgClient.bot.telegram.sendDocument(tgClient.chatId, {
                                source: buff,
                                filename: fileName
                            }, {caption: identityStr})
                        })
                    })
                })
                break;
            }
            case PUPPET.types.Message.Video: {
                message.toFileBox().then(fBox => {
                    // 这里可以保存一份在本地 但是没有映射关系没法知道是谁的
                    fBox.toBuffer().then(buff => {
                        const fileName = fBox.name;

                        const tgClient = this._tgClient
                        tgClient.bot.telegram.sendVideo(
                            tgClient.chatId, {source: buff, filename: fileName}, {caption: identityStr})
                    })
                })
                break;
            }
            case PUPPET.types.Message.Emoticon: // 处理表情消息的逻辑
                this._tgClient.sendMessage({
                    sender: showSender,
                    body: "[动画表情]",
                    room: roomTopic,
                    id: message.id
                })
                break;
            case PUPPET.types.Message.Location: // 处理位置消息的逻辑
            case PUPPET.types.Message.MiniProgram: // 处理小程序消息的逻辑
            case PUPPET.types.Message.RedEnvelope: // 处理红包消息的逻辑 12
            case PUPPET.types.Message.Url: // 处理链接消息的逻辑
            case PUPPET.types.Message.Post: // 处理帖子消息的逻辑
                sendMessageBody.body = `收到一条暂不支持的消息类型: ${messageType}`
                this._tgClient.sendMessage(sendMessageBody)
                break;
            case PUPPET.types.Message.Transfer: // 处理转账消息的逻辑 11
                sendMessageBody.body = '收到一条转账消息'
                this._tgClient.sendMessage(sendMessageBody)
                break;
            case PUPPET.types.Message.Recalled: // 处理撤回消息的逻辑
                sendMessageBody.body = '撤回了一条消息'
                this._tgClient.sendMessage(sendMessageBody)
                break;
            case PUPPET.types.Message.GroupNote:
                // 处理群公告消息的逻辑
                break;
            default:
                break;
        }


        // 发现好像不需要缓存头像而且每次重新登陆返回的id不同
        // const avatarPath = `avatar/${talker.id}`
        // if (!fs.existsSync(avatarPath)) {
        //     fs.mkdirSync(avatarPath, {recursive: true});
        // }
        // talker.avatar().then(fb => fb.toFile(avatarPath + '/avatar.jpg', true))

    }
}
