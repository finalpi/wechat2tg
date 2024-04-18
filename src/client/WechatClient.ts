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
import {Markup} from "telegraf";

// import type {FriendshipInterface} from "wechaty/src/user-modules/mod";


export class WeChatClient {
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
            name: 'wechat_bot',
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

    private _selectedContact: ContactInterface [] = [];
    private _selectedRoom: RoomInterface [] = [];

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
                    tgBot.telegram.sendPhoto(this._tgClient.chatId, {source: buff}, {caption: '请扫码登陆:'}))
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
        // console.info('message:', message)
        const talker = message.talker();
        // attachment handle
        const messageType = message.type();

        const roomTopic = await message.room()?.topic() || '';

        const alias = await talker.alias();
        const showSender = alias ? `[${alias}] ${talker.name()}` : talker.name();
        switch (messageType) {
            case PUPPET.types.Message.Unknown:
                console.log('unknown message')
                break;
            case PUPPET.types.Message.Text: {

                const messageTxt = message.text()

                // just test  when send ding repaly dong
                // if (messageType === PUPPET.types.Message.Text &&
                //     talker && messageTxt.includes('ding')) {
                //     message.say('dong')
                //     console.log(this._client.Contact)
                // }


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
            case PUPPET.types.Message.Attachment: // 下面的基本是文件类型处理 没有展示发送人 没保存消息id和tg的映射
            case PUPPET.types.Message.Image:      // 所以不支持回复
            case  PUPPET.types.Message.Audio:
            case  PUPPET.types.Message.Video: {

                // const path = `save-files/${talker.id}`
                //
                // if (!fs.existsSync(path)) {
                //     fs.mkdirSync(path, {recursive: true});
                // }

                message.toFileBox().then(fBox => {
                    // 这里可以保存一份在本地 但是没有映射关系没法知道是谁的
                    // const saveFile = `${path}/${fBox.name}`
                    // fBox.toFile(saveFile, true)


                    fBox.toBuffer().then(buff => {

                        // 语音文件 .sil直接重命名为mp3 可以直接播放
                        let fileName = fBox.name;
                        if (fileName.endsWith('.sil')) {
                            fileName = fileName.replace('.sil', '.mp3')
                        }

                        const tgClient = this._tgClient
                        tgClient.bot.telegram.sendDocument(
                            tgClient.chatId, {source: buff, filename: fileName})
                    })
                })
            }
                break;
            case PUPPET.types.Message.Emoticon:
                console.log('emoticon message')
                this._tgClient.sendMessage({
                    sender: showSender,
                    body: '收到一条 Emoticon 类型的消息',
                    room: roomTopic,
                    id: message.id
                })
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
