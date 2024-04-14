import * as QRCode from 'qrcode';
import {ScanStatus, WechatyBuilder} from "wechaty";
import * as PUPPET from 'wechaty-puppet';
import {ContactInterface, MessageInterface, WechatyInterface} from 'wechaty/impls';
import {TelegramClient} from './TelegramClient';
import * as fs from 'fs';


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
        // 手动绑定方法的上下文
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
        this._client.on('login', () => this.login())
            .on('scan', this.scan)
            .on('message', this.message)
            .start().then(() => console.log('wechat client start....'))
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

        const talker = message.talker();
        // attachment handle
        if (message.type() === PUPPET.types.Message.Attachment) {
            const path = `save-files/${talker.id}`
            if (!fs.existsSync(path)) {
                fs.mkdirSync(path, {recursive: true});
            }
            message.toFileBox().then(fBox => {
                const saveFile = `${path}/${fBox.name}`
                fBox.toFile(saveFile, true)
                fBox.toBuffer().then(buff => {
                    const tgClient = this._tgClient
                    tgClient.bot.telegram.sendDocument(
                        tgClient.chatId, {source: buff, filename: fBox.name})
                })
            })

        }
        let messageTxt = message.text()

        // just test  when send ding repaly dong
        if (message.type() === PUPPET.types.Message.Text &&
            talker && messageTxt.includes('ding')) {
            message.say('dong')
            console.log(this._client.Contact)
        }
        const showSender = await talker.alias() || talker.name()

        // 每个第一次发消息的用户缓存头像
        // const handle = talker.handle()

        console.log('showSender is :', showSender, 'talker id is :', talker.id, 'message type is', message.type())


        const avatarPath = `avatar/${talker.id}`
        if (!fs.existsSync(avatarPath)) {
            fs.mkdirSync(avatarPath, {recursive: true});
        }
        talker.avatar().then(fb => fb.toFile(avatarPath + '/avatar.jpg', true))


        if (messageTxt) {
            messageTxt = message.type() === PUPPET.types.Message.Text
                ? messageTxt : `收到${message.type()}类型的消息`;
            this._tgClient.sendMessage({sender: showSender, body: messageTxt})
        }

    }
}
