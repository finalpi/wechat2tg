import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ScanStatus, WechatyBuilder} from 'wechaty'
import {ClientFactory} from './factory/ClientFactory'
import {Markup, Telegraf} from 'telegraf'
import * as PUPPET from 'wechaty-puppet'
import {ConfigurationService} from '../service/ConfigurationService'
import * as QRCode from 'qrcode'
import {MessageService} from '../service/MessageService'
import {MessageSender} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import fs from 'node:fs'
import {Message} from '../entity/Message'
import {FormatUtils} from '../util/FormatUtils'
import {config} from '../config'

export class FileHelperClient extends AbstractClient {
    get waitingMessage(): any[] {
        return this._waitingMessage
    }

    private static instance = undefined
    private configurationService = ConfigurationService.getInstance()
    private scanMsgId = undefined
    private messageMTBotSender: MessageSender
    private pendingMessage: any[] = []
    private _waitingMessage: any[] = []
    private pendingIds: string[] = []

    static getInstance(): FileHelperClient {
        if (!FileHelperClient.instance) {
            FileHelperClient.instance = new FileHelperClient()
        }
        return FileHelperClient.instance
    }

    // 定时任务消费集合
    private runTask = async () => {
        if (this.pendingMessage.length === 0 && this.waitingMessage.length === 0) {
            setTimeout(this.runTask, 1000)
            return
        }
        this._waitingMessage = this.waitingMessage.filter(i => !this.pendingIds.includes(i.msgId))
        const messageService = MessageService.getInstance()
        // 处理等待中的消息
        const now = new Date().getTime()
        for (const waitingMessage of this.waitingMessage) {
            if (now - waitingMessage.date > 10000) {
                console.log(waitingMessage)
                // 接收失败
                const messageEntity = await messageService.getByFhMsgId(waitingMessage.msgId)
                const client = FileHelperClient.getSpyClient('botClient').client as Telegraf
                client.telegram.editMessageCaption(messageEntity.chatId, messageEntity.tgBotMsgId, undefined, FormatUtils.transformIdentityBodyStr(config.MESSAGE_DISPLAY, messageEntity.sender, '接收失败，请重新接收'), {
                    reply_markup: {
                        inline_keyboard: [[Markup.button.callback('重新接收', `fl:${messageEntity.wxMsgId}`)]]
                    },
                    parse_mode: 'HTML'
                }).then(async msgRes => {
                    this._waitingMessage = this.waitingMessage.filter(i => i !== waitingMessage)
                })
            }
        }
        for (const msg of this.pendingMessage) {
            const messageEntity = await messageService.getByFhMsgId(msg.id)
            if (messageEntity && messageEntity.tgBotMsgId > 0) {
                this.pendingMessage = this.pendingMessage.filter(item => item !== msg)
                msg.toFileBox().then(fBox => {
                    const fileName = fBox.name
                    fBox.toBuffer().then(buffer => {
                        if (buffer.length > 0) {
                            this.receiveFile(messageEntity, fileName, buffer).catch(err => {
                                console.error('接收失败', err)
                                this.pendingIds = this.pendingIds.filter(id => id !== msg.id)
                                this._waitingMessage.push({
                                    date: new Date().getTime(),
                                    msgId: msg.id
                                })
                            })
                        }
                    }).catch(err => {
                        console.error('接收失败', err)
                        this.pendingIds = this.pendingIds.filter(id => id !== msg.id)
                        this._waitingMessage.push({
                            date: new Date().getTime(),
                            msgId: msg.id
                        })
                    })
                })
            }
        }
        setTimeout(this.runTask, 1000)
    }

    constructor() {
        super()
        this.hasLogin = false
        this.hasReady = false
        this.client = WechatyBuilder.build({
            name: './storage/fileHelper',
            puppet: 'wechaty-puppet-wechat4u',
        })
        this.runTask()
        this.messageMTBotSender = SenderFactory.createSender(FileHelperClient.getSpyClient('botMTPClient').client)
        this.client.on('scan', async (qrcode: string, status: ScanStatus) => {
            this.logDebug('---------on scan---------')
            if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
                const config = await this.configurationService.getConfig()
                this.hasLogin = false
                const tgBotClient: Telegraf = FileHelperClient.getSpyClient('botClient').client
                QRCode.toBuffer(qrcode).then(buff => {
                    if (this.scanMsgId) {
                        tgBotClient.telegram.editMessageMedia(config.chatId, this.scanMsgId, undefined, {
                            type: 'photo',
                            media: {source: buff}, caption: '扫描二维码登录文件传输助手'
                        })
                    } else {
                        tgBotClient.telegram.sendPhoto(config.chatId, {source: buff}, {caption: '扫描二维码登录文件传输助手'}).then(msg => {
                            this.scanMsgId = msg.message_id
                        })
                    }
                })
            }
        })
        this.client.on('message', message => {
            this.onMessage(message)
        })
        this.client.on('login', async user => {
            const config = await this.configurationService.getConfig()
            const tgBotClient: Telegraf = FileHelperClient.getSpyClient('botClient').client
            tgBotClient.telegram.sendMessage(config.chatId, '文件传输助手登录成功')
            if (this.scanMsgId) {
                tgBotClient.telegram.deleteMessage(config.chatId, this.scanMsgId)
                this.scanMsgId = undefined
            }
            this.hasReady = true
            this.hasLogin = true
        })
        this.client.on('ready', () => {
            console.log('ready')
        })
        this.client.on('logout', () => {
            console.log('logout')
        })
        this.client.on('error', err => {
            console.log('error', err)
            if (this.hasLogin && (err.message === '重启时网络错误，60s后进行最后一次重启' || err.message.includes('同步失败'))) {
                this.restartClient()
            }
        })
        this.hasReady = true
    }

    restartClient() {
        this.hasLogin = false
        const filePath = 'storage/fileHelper.memory-card.json'
        this.client.stop().then(() => {
            fs.access(filePath, fs.constants.F_OK, async (err) => {
                if (!err) {
                    // 文件存在，删除文件
                    fs.promises.unlink(filePath).then(() => {
                        this.logDebug('delete wechat memory card success')
                    })
                }
            })
            // 两秒后自动启动
            setTimeout(() => {
                this.logInfo('start wechaty bot')
                this.client.start().then(() => {
                    // 标记为已执行
                })
            }, 2000)
        })

    }

    async login(param?: any): Promise<boolean> {
        if (!FileHelperClient.getSpyClient('fhClient')) {
            const clientFactory = new ClientFactory()
            FileHelperClient.addSpyClient({
                interfaceId: 'fhClient',
                client: clientFactory.create('fhClient')
            })
        }
        if (this.scanMsgId) {
            const tgBotClient: Telegraf = FileHelperClient.getSpyClient('botClient').client
            this.configurationService.getConfig().then(config => {
                tgBotClient.telegram.sendMessage(config.chatId, '扫描二维码登录文件传输助手', {
                    reply_parameters: {
                        message_id: this.scanMsgId
                    }
                })
            })
            return
        }
        this.hasLogin = false
        if (fs.existsSync('storage/fileHelper.memory-card.json')) {
            setTimeout(() => {
                // token 过期检测
                if (!this.hasLogin) {
                    this.restartClient()
                }
            }, 10000)
        }
        this.client.start().then(() => {
            //
        }).catch(err => {
            console.log(err)
        })
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    onMessage(msg: any): void {
        const messageType = msg.type()
        switch (messageType) {
            case PUPPET.types.Message.Video:
            case PUPPET.types.Message.Attachment:
                // 从等待列表移除
                this.pendingMessage.push(msg)
                this.pendingIds.push(msg.id)
                this._waitingMessage = this.waitingMessage.filter(i => !this.pendingIds.includes(i.msgId))
                break
        }
    }

    async receiveFile(msg: Message, fileName: string, buffer: Buffer) {
        if (msg) {
            await this.messageMTBotSender.editFile(msg.chatId + '', msg.tgBotMsgId, {
                buff: buffer,
                filename: fileName,
                fileType: 'document',
                caption: msg.sender
            }, {parse_mode: 'HTML'})
        }
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }
}