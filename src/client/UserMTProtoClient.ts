import os from 'node:os'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {StoreSession} from 'telegram/sessions'
import * as authMethods from 'telegram/client/auth'
import {config} from '../config'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'
import {Api} from 'telegram'
import {ConfigurationService} from '../service/ConfigurationService'
import {MessageService} from '../service/MessageService'
import {WeChatClient} from './WechatClient'
import {DeletedMessage} from 'telegram/events/DeletedMessage'
import {BindGroupService} from '../service/BindGroupService'
import {NewMessage} from 'telegram/events'
import {returnBigInt} from 'telegram/Helpers'
import sharp from 'sharp'
import fs from 'node:fs'
import {ConverterHelper} from '../util/FfmpegUtils'
import crypto from 'crypto'
import path from 'node:path'

export class UserMTProtoClient extends AbstractClient {
    private readonly DEFAULT_FILTER_ID = 115
    private readonly folderName = 'WeChat'

    async login(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams): Promise<boolean> {
        if (!UserMTProtoClient.getSpyClient('userMTPClient')) {
            const clientFactory = new ClientFactory()
            UserMTProtoClient.addSpyClient({
                interfaceId: 'userMTPClient',
                client: clientFactory.create('userMTPClient')
            })
        }
        if (!await this.client?.checkAuthorization()) {
            this.client?.start(authParams).then(res => {
                // 登录成功逻辑
                this.hasLogin = true
                this.createFolder()
                this.client?.addEventHandler(async event => {
                    // let id = event.peer?.id
                    // this.logInfo(`Deleted message: ${event.inputChat}`)
                    for (const deletedId of event.deletedIds) {
                        const msg = await MessageService.getInstance().getByBotMsgId(undefined, deletedId)
                        if (!msg) {
                            return
                        }
                        const wxClient: WeChatClient = UserMTProtoClient.getSpyClient('wxClient') as WeChatClient
                        if (wxClient.wxInfo.wxid !== msg.wxSenderId) {
                            return
                        }
                        await wxClient.revokeMessage(msg)
                    }
                }, new DeletedMessage({}))
                this.listenMessage()
            }).catch((e) => {
                //
            })
        }
        return true
    }

    public async listenMessage() {
        const config = await ConfigurationService.getInstance().getConfig()
        this.client?.getMe().then(me => {
            const mineId = me.id
            this.client.addEventHandler(async event => {
                const chatIdsAll = await BindGroupService.getInstance().getAll()
                const chatIds = chatIdsAll.filter(i => i.isForwardOthers).map(i => i.chatId)
                const msg = event.message
                if (msg.fromId instanceof Api.PeerUser && msg.fromId.userId.eq(mineId)) {
                    // 我发送的消息
                    return
                }
                const botId = returnBigInt(config.botId)
                const msgChatId = msg.chatId?.toJSNumber()
                const exist = await BindGroupService.getInstance().getByChatId(msgChatId)
                if (!exist) {
                    // 未绑定消息直接返回
                    return
                }
                if (msg.fromId instanceof Api.PeerUser && !msg.fromId.userId.eq(mineId)
                    && !msg.fromId.userId.eq(botId) && chatIds.includes(msgChatId)) {
                    const doSend = () => {
                        if (msg.message) {
                            if (msg.message.startsWith('/')) {
                                return
                            }
                            const textMessage: BaseMessage = {
                                id: msg.id + '',
                                senderId: '',
                                wxId: '',
                                sender: '{me}',
                                chatId: msgChatId,
                                content: msg.message,
                                type: 0
                            }
                            UserMTProtoClient.getSpyClient('wxClient').sendMessage(textMessage)
                        }
                        if (msg.media) {
                            const baseMessage: BaseMessage = {
                                id: msg.id + '',
                                senderId: '',
                                wxId: '',
                                sender: '{me}',
                                chatId: msgChatId,
                                content: '',
                                type: 1
                            }
                            const fileName = UserMTProtoClient.getFileName(msg)
                            msg.downloadMedia().then((buff) => {
                                if (Buffer.byteLength(buff) < 100 * 1024 && (fileName?.endsWith('jpg') || fileName?.endsWith('jpeg') || fileName?.endsWith('png'))) {
                                    // 构造包含无用信息的 EXIF 元数据
                                    const exifData = {
                                        IFD0: {
                                            // 添加一个长字符串作为无用信息
                                            ImageDescription: '0'.repeat(110_000 - Buffer.byteLength(buff))
                                        }
                                    }
                                    // 保存带有新元数据的图片
                                    sharp(buff)
                                        .toFormat('png')
                                        .withExif(exifData)
                                        .toBuffer()
                                        .then(buffer => {
                                            baseMessage.file = {
                                                fileName: fileName,
                                                file: buffer,
                                            }
                                            UserMTProtoClient.getSpyClient('wxClient').sendMessage(baseMessage)
                                        })
                                    return
                                }
                                if (fileName.endsWith('.tgs') || fileName.endsWith('.webm') || fileName.endsWith('.webp')) {
                                    const hash = crypto.createHash('md5')
                                    hash.update(buff)
                                    const md5 = hash.digest('hex')
                                    const saveFile = `save-files/${md5}${fileName.slice(fileName.lastIndexOf('.'))}`
                                    const gifFile = `save-files/${md5}.gif`
                                    const lottie_config = {
                                        width: 128,
                                        height: 128
                                    }
                                    // 微信不能发超过1Mb的gif文件
                                    if (saveFile.endsWith('.tgs')) {
                                        lottie_config.width = 512
                                        lottie_config.height = 512
                                    }
                                    fs.writeFile(saveFile, buff, async (err) => {
                                        if (!err) {
                                            if (!fs.existsSync(gifFile)) {
                                                if (fileName.endsWith('.tgs')) {
                                                    await new ConverterHelper().tgsToGif(saveFile, gifFile, lottie_config)
                                                } else if (fileName.endsWith('.webm')) {
                                                    await new ConverterHelper().webmToGif(saveFile, gifFile)
                                                } else if (fileName.endsWith('.webp')) {
                                                    await new ConverterHelper().webpToGif(saveFile, gifFile)
                                                }
                                            }
                                        }

                                        const buffer = fs.readFileSync(gifFile)

                                        // 提取文件名
                                        const newFileName = path.basename(gifFile)
                                        baseMessage.content = newFileName
                                        baseMessage.file = {
                                            fileName: newFileName,
                                            file: Buffer.from(buffer),
                                        }
                                        UserMTProtoClient.getSpyClient('wxClient').sendMessage(baseMessage)
                                    })
                                } else {
                                    baseMessage.file = {
                                        fileName: fileName,
                                        file: buff,
                                    }
                                    UserMTProtoClient.getSpyClient('wxClient').sendMessage(baseMessage)
                                }
                            })
                        }
                    }
                    doSend()
                }
                // }, new NewMessage())
            }, new NewMessage({func: (event) => event.isGroup}))
        })
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    onMessage(): Promise<BaseMessage> {
        throw new Error('Method not implemented.')
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance = undefined

    static getInstance(): UserMTProtoClient {
        if (!UserMTProtoClient.instance) {
            UserMTProtoClient.instance = new UserMTProtoClient()
        }
        return UserMTProtoClient.instance
    }

    private constructor() {
        super()
        //
        this.client = new GramClient(new StoreSession('storage/tg-user-session'), parseInt(config.API_ID), config.API_HASH, {
            connectionRetries: 1000000,
            deviceModel: `wx2tg-pad User On ${os.hostname()}`,
            appVersion: 'rainbowcat',
            proxy: config.HOST ? {
                ip: config.HOST,
                port: parseInt(config.PORT),
                socksType: 5,
                password: config.PASSWORD,
                username: config.USERNAME,
            } : undefined,
            autoReconnect: true,
            maxConcurrentDownloads: 3,
        })
        this.hasReady = true
    }

    async createFolder(): Promise<void> {
        const result = await this.client?.invoke(new Api.messages.GetDialogFilters())
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const values = result.filters.map(it => {
            return it.className === 'DialogFilter' ? it.id : 0
        })
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const value = result?.filters.find(it => it.title === this.folderName)
        let id
        if (value) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            id = value.id
        } else {
            id = Math.max(...values) + 1 || this.DEFAULT_FILTER_ID
        }
        if (id === 1) {
            id = 100
        }
        const config = await ConfigurationService.getInstance().getConfig()
        // console.log('filter id', id)
        if (!value) {
            // log.info('创建 TG 文件夹')
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            this.client?.getInputEntity(config.botId).then(botEntity => {
                if (botEntity) {
                    const dialogFilter = new Api.DialogFilter({
                        id: id,
                        title: this.folderName,
                        pinnedPeers: [botEntity],
                        includePeers: [botEntity],
                        excludePeers: [],
                    })
                    this.client?.invoke(new Api.messages.UpdateDialogFilter({
                        id: id,
                        filter: dialogFilter,
                    })).catch(e => {
                        if (e.errorMessage.includes('DIALOG_FILTERS_TOO_MUCH')) {
                            // 已经到达文件夹创建的上限,不再创建新的文件夹
                            return
                        }
                    })
                }
            })
        }
    }

    private static getFileName(msg: Api.Message) {
        let fileName = undefined
        switch (msg.media.className) {
            case 'MessageMediaDocument':
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                fileName = msg.document?.attributes?.find(attr => attr instanceof Api.DocumentAttributeFilename)?.fileName
                if (!fileName && msg.document.mimeType) {
                    if (msg.document.mimeType.includes('ogg')) {
                        const nowShangHaiZh = new Date().toLocaleString('zh', {
                            timeZone: 'Asia/ShangHai'
                        }).toString().replaceAll('/', '')
                        fileName = `语音-${nowShangHaiZh.toLocaleLowerCase()}.mp3`
                    } else {
                        fileName = 'file.' + msg.document.mimeType.split('/')[1]
                    }
                }
                break
            case 'MessageMediaPhoto':
                fileName = 'photo.png'
                break
        }
        return fileName
    }

}