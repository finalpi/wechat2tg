import * as QRCode from 'qrcode';
import { ScanStatus, WechatyBuilder } from "wechaty";
import * as PUPPET from 'wechaty-puppet';
import { MessageInterface, WechatyInterface } from 'wechaty/impls';
import { TelegramClient } from './TelegramClient';
import * as fs from 'fs';


export class WeChatClient {
    private readonly _client: WechatyInterface;
    private readonly _tgClient: TelegramClient;

    constructor (private readonly tgClient: TelegramClient) {
        this._client = WechatyBuilder.build({
            name: 'wechat_bot',
            puppet: 'wechaty-puppet-wechat4u',
            puppetOptions: {
                uos: true
            }
        })
        this._tgClient = tgClient;
        // 手动绑定方法的上下文
        this.scan = this.scan.bind(this);
        this.message = this.message.bind(this);
    }


    public async init() {
        if (this._client === null) return;
        this._client.on('login', () => console.log('login....'))
            .on('scan', this.scan)
            .on('message', this.message)
            .start()
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
                tgBot.telegram.sendPhoto(this._tgClient.chatId, { source: buff }))

        } else {
            console.info('StarterBot', 'onScan: %s(%s)', ScanStatus[status], status)
        }
    }

    private message(message: MessageInterface) {

        const talker = message.talker();
        // attachment handle
        if (message.type() === PUPPET.types.Message.Attachment) {
            const path = `save-files/${talker.id}`
            if (!fs.existsSync(path)) {
                fs.mkdirSync(path, { recursive: true });
            }
            message.toFileBox().then(fBox => {
                const saveFile = `${path}/${fBox.name}`
                fBox.toFile(saveFile)
                fBox.toBuffer().then(buff => {
                    const tgClient = this._tgClient
                    tgClient.bot.telegram.sendDocument(
                        tgClient.chatId, { source: buff, filename: fBox.name })
                })
            })

        }
        const messageTxt = message.text()
        // just test  when send ding repaly dong
        if (message.type() === PUPPET.types.Message.Text &&
            talker && messageTxt.includes('ding')) {
            message.say('dong')
        }
        if (messageTxt) {
            this._tgClient.sendMessage({ sender: talker.name(), body: messageTxt })
        }

    }
}