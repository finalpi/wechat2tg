import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ScanStatus, WechatyBuilder} from 'wechaty'
import {ClientFactory} from './factory/ClientFactory'
import {Telegraf} from 'telegraf'
import * as PUPPET from 'wechaty-puppet'
import {ConfigurationService} from '../service/ConfigurationService'
import * as QRCode from 'qrcode'
import {MessageService} from '../service/MessageService'
import {MessageSender} from '../message/MessageSender'
import {SenderFactory} from '../message/SenderFactory'
import fs from 'node:fs'

export class FileHelperClient extends AbstractClient {
    private static instance = undefined
    private configurationService = ConfigurationService.getInstance()
    private scanMsgId = undefined
    private messageMTBotSender: MessageSender

    static getInstance(): FileHelperClient {
        if (!FileHelperClient.instance) {
            FileHelperClient.instance = new FileHelperClient()
        }
        return FileHelperClient.instance
    }

    constructor() {
        super()
        this.hasLogin = false
        this.hasReady = false
        this.client = WechatyBuilder.build({
            name: './storage/fileHelper',
            puppet: 'wechaty-puppet-wechat4u',
        })
        this.messageMTBotSender = SenderFactory.createSender(FileHelperClient.getSpyClient('botMTPClient').client)
        this.client.on('scan',async (qrcode: string, status: ScanStatus) => {
            this.logDebug('---------on scan---------')
            if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
                const config = await this.configurationService.getConfig()
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
        this.client.on('message',message => {
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
            this.hasLogin = true
        })
        this.client.on('ready',() => {
            console.log('ready')
        })
        this.client.on('logout',() => {
            console.log('logout')
        })
        this.client.on('error',err => {
            console.log('error',err)
            if (err.message === '重启时网络错误，60s后进行最后一次重启' || err.message.includes('同步失败')) {
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
        this.client.start()
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
                msg.toFileBox().then(fBox => {
                    const fileName = fBox.name
                    fBox.toBuffer().then(buffer => {
                        setTimeout(()=>{
                            if (buffer.length > 0) {
                                this.receiveFile(msg.id, fileName, buffer)
                            }
                        },1000)
                    })
                })
                break
        }
        console.log(msg)
    }

    async receiveFile(msgId: string, fileName: string, buffer: Buffer) {
        const messageService = MessageService.getInstance()
        const msg = await messageService.getByFhMsgId(msgId)
        this.messageMTBotSender.editFile(msg.chatId + '',msg.tgBotMsgId,{
            buff: buffer,
            filename: fileName,
            fileType: 'document',
            caption: msg.sender
        },{parse_mode: 'HTML'})
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }
    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }
}