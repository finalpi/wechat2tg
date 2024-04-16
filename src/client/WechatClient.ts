import * as QRCode from 'qrcode';
import {ScanStatus, WechatyBuilder} from "wechaty";
import * as PUPPET from 'wechaty-puppet';
import {ContactInterface, FriendshipImpl, FriendshipInterface, MessageInterface, WechatyInterface} from 'wechaty/impls';
import {TelegramClient} from './TelegramClient';

// import type {FriendshipInterface} from "wechaty/src/user-modules/mod";


export class WeChatClient {
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
    }

    private readonly _client: WechatyInterface;

    public get client() {
        return this._client;
    }

    private _contactMap: Map<number, ContactInterface[]> | undefined;

    public get contactMap(): Map<number, ContactInterface[]> | undefined {
        return this._contactMap;
    }

    public set contactMap(contactMap: Map<number, ContactInterface[]> | undefined) {
        this._contactMap = contactMap;
    }

    public async init() {
        if (this._client === null) return;
        await this._client.on('login', () => this.login())
            .on('scan', this.scan)
            .on('message', this.message)
            .on('logout', this.logout)
            .on('stop', this.stop)
            .on('friendship', this.friendship)
            .on('error', this.error)
            .start();
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
        await this._client.stop();
        this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '微信客户端已停止!')
    }

    public async logout() {
        await this._client.logout();
        this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '登出成功!')
    }

    private login() {
        this._tgClient.bot.telegram.sendMessage(this._tgClient.chatId, '登陆成功!')
    }

    // scan qrcode login
    private scan(qrcode: string, status: ScanStatus) {
        console.log('---------scan login---------')
        if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
            const qrcodeImageUrl = encodeURIComponent(qrcode)

            console.info('StarterBot', 'onScan: %s(%s) - %s', ScanStatus[status], status, qrcodeImageUrl)

            // console.log(this._bot)
            const tgBot = this._tgClient.bot
            tgBot.telegram.sendMessage(this._tgClient.chatId, '请扫码登陆')
            // console.log('chat id is : {}', this._tgClient.chatId)
            QRCode.toBuffer(qrcode).then(buff =>
                tgBot.telegram.sendPhoto(this._tgClient.chatId, {source: buff}))

        } else {
            console.info('StarterBot', 'onScan: %s(%s)', ScanStatus[status], status)
        }
    }

    private async message(message: MessageInterface) {

        // console.info('message:', message)
        const talker = message.talker();
        // attachment handle
        const messageType = message.type();

        const roomTopic = await message.room()?.topic() || '';
        const showSender = (await talker.alias() + ' (' +talker.name() || talker.name());

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

                // console.log('showSender is :', showSender, 'talker id is :', talker.id, 'message type is', messageType)

                if (messageTxt) {
                    this._tgClient.sendMessage({sender: showSender, body: messageTxt, room: roomTopic, id: message.id})
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
