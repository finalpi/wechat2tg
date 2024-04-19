import {Context, Markup, NarrowedContext, Telegraf} from 'telegraf';
import {WeChatClient} from "./WechatClient";
import {config} from "../config";
import {BotHelpText, SimpleMessage, SimpleMessageSender} from "../models/Message"
import {ContactImpl, ContactInterface, RoomInterface} from 'wechaty/impls';
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from "https-proxy-agent";
import * as tg from "telegraf/src/core/types/typegram";
// import {ContactInterface} from "wechaty/dist/esm/src/mods/impls";
import {message} from "telegraf/filters";
import {FileBox} from 'file-box'
import * as fs from "node:fs";
import {NotionListType, NotionMode, StorageSettings, VariableContainer, VariableType} from "../models/Settings";
import {ConverterHelper} from "../utils/FfmpegUtils";
import {MemberCacheType, SelectedEntity} from "../models/TgCache";
import {TalkerEntity} from "../models/TalkerCache";
import {UniqueIdGenerator} from "../utils/IdUtils";
import {MessageInterface} from "wechaty/dist/esm/src/mods/impls";

export class TelegramClient {
    get selectedMember(): SelectedEntity[] {
        return this._selectedMember;
    }

    set selectedMember(value: SelectedEntity[]) {
        this._selectedMember = value;
    }

    get recentUsers(): TalkerEntity[] {
        return this._recentUsers;
    }

    private _weChatClient: WeChatClient;
    private readonly _bot: Telegraf;
    private _chatId: number | string;
    private _ownerId: number;
    private loginCommandExecuted = false;
    private allContactCommandExecuted = false;
    private static PAGE_SIZE = 18;
    private static LINES = 2;
    private _selectedMember: SelectedEntity [] = [];
    private _flagPinMessageType = '';
    private calcShowMemberListExecuted = false;
    private selectRoom: ContactInterface | RoomInterface | undefined;
    private _recentUsers: TalkerEntity [] = [];

    private forwardSetting: VariableContainer = new VariableContainer();

    // key this message id value weChat message id
    private _messageMap = new Map<number, string>();
    // 当前回复用户
    private _currentSelectContact : ContactInterface | RoomInterface | undefined;
    // 置顶消息
    private pinnedMessageId : number | undefined


    constructor() {
        this._weChatClient = new WeChatClient(this);
        this._bot = new Telegraf(config.BOT_TOKEN)
        this._chatId = 0;
        this._ownerId = 0;
        this._chatId = 0
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }

            const socksAgent = new SocksProxyAgent(info)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: socksAgent
                }
            })
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            this._bot = new Telegraf(config.BOT_TOKEN, {
                telegram: {
                    agent: httpAgent
                }
            })
        } else {
            this._bot = new Telegraf(config.BOT_TOKEN)
        }
        // this._messageMap
        this.onWeChatLogout = this.onWeChatLogout.bind(this);
        this.onWeChatStop = this.onWeChatStop.bind(this);
    }

    public get messageMap(): Map<number, string> {
        return this._messageMap;
    }

    public set messageMap(value: Map<number, string>) {
        this._messageMap = value;
    }

    public get bot(): Telegraf {
        return this._bot;
    }

    public get setting(): VariableContainer {
        return this.forwardSetting;
    }

    public get chatId(): number | string {
        return this._chatId;
    }

    public get currentSelectContact(): ContactInterface | RoomInterface | undefined {
        return this._currentSelectContact;
    }

    public async setCurrentSelectContact(value:MessageInterface | undefined) {
        if (value){
            const room = value.room()
            if (room) {
                this.setPin('room',await room.topic())
                this.selectRoom = room
            }else {
                this._currentSelectContact = value.talker();
                const talker = value.talker()
                const alias = await talker.alias()
                if (alias){
                    this.setPin('user',alias)
                }else {
                    this.setPin('user',talker.name())
                }
            }
        }
    }

    public get weChatClient(): WeChatClient {
        return this._weChatClient;
    }

    // Setter 方法
    public set weChatClient(value: WeChatClient) {
        this._weChatClient = value;
    }


    public init() {
        const bot = this._bot;

        // 加载转发配置
        this.loadForwardSettings();

        // 初始化配置
        this.forwardSetting.writeToFile()

        // Enable graceful stop
        // process.once('SIGINT', () => bot.stop('SIGINT'))
        // process.once('SIGTERM', () => bot.stop('SIGTERM'))

        bot.telegram.setMyCommands([
            {command: 'help', description: '使用说明'},
            {command: 'start', description: '开始'},
            {command: 'login', description: '扫码登陆'},
            {command: 'user', description: '用户列表'},
            {command: 'room', description: '群组列表'},
            {command: 'recent', description: '最近联系人'},
            {command: 'settings', description: '程序设置'},
            {command: 'check', description: '检查微信存活'},
            {command: 'reset', description: '清空缓存重新登陆'},
            {command: 'stop', description: '停止微信客户端 需要重新登陆'},
            // {command: 'logout', description: '退出登陆'},
            // {command: 'stop', description: '停止微信客户端'},
            // {command: 'quit', description: '退出程序!! 会停止程序,需要手动重启(未实现)'},
        ]);

        bot.help((ctx) => ctx.replyWithMarkdownV2(BotHelpText.help))


        bot.start(async ctx => {
            ctx.reply(
                '请输入 /login 登陆,或者输入 /help 查看帮助\n' +
                '请注意执行/login 后你就是该机器的所有者'
                , Markup.removeKeyboard())
        })

        // 重启时判断是否有主人,如果存在主人则自动登录微信
        const variables = this.forwardSetting.getAllVariables()
        if (variables.chat_id && variables.chat_id !== '') {
            this._chatId = variables.chat_id
            // 找到置顶消息
            this.findPinMessage();
            this._weChatClient.start().then(() => {

                // 标记为已执行
                this.loginCommandExecuted = true;

                // 登陆后就缓存所有的联系人和房间
                this.setAllMemberCache().then(() => {
                    this.calcShowMemberList()
                });

                console.log("自动启动微信bot")
            }).catch(() => {
                console.error("自动启动失败");
            });
        }

        bot.settings(ctx => {

            ctx.reply('设置:', Markup.inlineKeyboard([
                [Markup.button.callback('通知模式(点击切换)', VariableType.SETTING_NOTION_MODE),],
                [Markup.button.callback('反馈发送成功(点击切换)', VariableType.SETTING_REPLY_SUCCESS),],
                [Markup.button.callback('开启自动切换(点击切换)', VariableType.SETTING_AUTO_SWITCH),],
                [Markup.button.callback('白名单(未实现)', VariableType.SETTING_WHITE_LIST,
                    !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'white')),
                    Markup.button.callback('黑名单(未实现)', VariableType.SETTING_BLACK_LIST,
                        !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'black')),
                ]
            ]))
        });

        // 好友请求处理
        bot.action('friendship-', ctx => {
            console.log('接受到 好友请求', ctx.match)
            this._weChatClient.client.Friendship.load(ctx.match[1])
        })

        // 通知模式
        bot.action(VariableType.SETTING_NOTION_MODE, ctx => {
            // 黑名单
            if (this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                this.forwardSetting.setVariable(VariableType.SETTING_NOTION_MODE, NotionMode.WHITE)
            } else {
                this.forwardSetting.setVariable(VariableType.SETTING_NOTION_MODE, NotionMode.BLACK)
            }
            // 点击后修改上面按钮
            ctx.editMessageReplyMarkup({
                inline_keyboard: [
                    [
                        Markup.button.callback('通知模式(点击切换)', VariableType.SETTING_NOTION_MODE),
                    ],
                    [
                        Markup.button.callback('反馈发送成功(点击切换)', VariableType.SETTING_REPLY_SUCCESS),
                    ],
                    [
                        Markup.button.callback('白名单', VariableType.SETTING_WHITE_LIST,
                            !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'white')),
                        Markup.button.callback('黑名单', VariableType.SETTING_BLACK_LIST,
                            !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'black')),
                    ]
                ],
            });
            // 点击后持久化
            this.forwardSetting.writeToFile()
        })

        // 修改回复设置
        bot.action(VariableType.SETTING_REPLY_SUCCESS, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS);
            const answerText = b ? '开启' : '关闭';
            this.forwardSetting.setVariable(VariableType.SETTING_REPLY_SUCCESS, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            return ctx.answerCbQuery(answerText)
        });

        // 自动切换设置
        bot.action(VariableType.SETTING_AUTO_SWITCH, ctx => {
            const b = !this.forwardSetting.getVariable(VariableType.SETTING_AUTO_SWITCH);
            const answerText = b ? '开启' : '关闭';
            this.forwardSetting.setVariable(VariableType.SETTING_AUTO_SWITCH, b)
            // 修改后持成文件
            this.forwardSetting.writeToFile()
            return ctx.answerCbQuery(answerText)
        });

        // 白名单设置
        bot.action(VariableType.SETTING_WHITE_LIST, ctx => {
            // 当前白名单
            const listTypes = this.forwardSetting.getVariable(VariableType.SETTING_WHITE_LIST);
            const page = 0;
            this.generateNotionListButtons(listTypes, page, VariableType.SETTING_WHITE_LIST + '-').then(buttons => {
                ctx.reply('白名单列表点击移除', Markup.inlineKeyboard(buttons))
            })
        });

        // 黑名单设置
        bot.action(VariableType.SETTING_BLACK_LIST, ctx => {
            const listTypes = this.forwardSetting.getVariable(VariableType.SETTING_BLACK_LIST);
            const page = 0;
            this.generateNotionListButtons(listTypes, page, VariableType.SETTING_BLACK_LIST + '-').then(buttons => {
                ctx.reply('黑名单列表点击移除', Markup.inlineKeyboard(buttons))
            })
        });

        // 黑白名单添加
        bot.action(/listAdd-/, ctx => {
            ctx.reply('输入完整群名或者用户名, 备注').then(res => {
                ctx.reply('请选择',)
            })
        })


        bot.command('reset', (ctx) => {
            this._weChatClient.reset()
            ctx.reply('重置成功')
        })


        // bot.command('restart', (ctx) => {
        //     this._weChatClient.logout()
        //     ctx.reply('重启中...')
        // })

        bot.command('login', async ctx => {

            this._weChatClient.start().then(() => {

                // if (!this._weChatClient.client.isLoggedIn) {
                //     ctx.reply('请扫码登陆');
                // }

                // 第一次输入的人当成bot的所有者
                this.loadOwnerChat(ctx);

                // 标记为已执行
                this.loginCommandExecuted = true;

                // 登陆后就缓存所有的联系人和房间
                this.setAllMemberCache().then(() => {
                    this.calcShowMemberList()
                });

            }).catch(() => {
                ctx.reply('已经登陆或登陆失败请检查状态');
            });


        });

        // bot.command('logout', this.onWeChatLogout)

        bot.command('stop', this.onWeChatStop)

        bot.command('check', ctx => {
            if (this._weChatClient.client.isLoggedIn) {
                ctx.reply('微信在线')
            } else {
                ctx.reply('微信不在线')
            }
        })
        // 选择群聊
        const currentSelectRoomMap = new Map<string, RoomInterface>();
        let searchRooms: RoomInterface [] = [];

        bot.command('room', async ctx => {
            if (!this.allContactCommandExecuted) {
                await ctx.reply('请等待用户列表加载完成...');
                return
            }
            const topic = ctx.message.text.split(' ')[1];
            const query = topic ? {topic: topic} : {};
            this._weChatClient.client.Room.findAll(query).then(async rooms => {
                const count = 0;
                searchRooms = rooms;
                this.generateRoomButtons(searchRooms, currentSelectRoomMap, count).then(buttons => {
                    if (buttons.length === 0) {
                        ctx.reply('没有找到群聊')
                    } else {
                        ctx.reply('请选择群聊:', {
                            ...Markup.inlineKeyboard(buttons)
                        })
                    }
                })
            })
        })

        bot.action(/room-index-\d+/, async (ctx) => {
            // console.log(ctx.match.input)
            const room = currentSelectRoomMap.get(ctx.match.input)
            this.selectRoom = room;

            // ctx.reply(`当前群聊: ${await room?.topic()}`).then((message) => {
            //     // 先取消所有置顶
            //     ctx.unpinAllChatMessages()
            //     // 方便知道当前回复的用户
            //     ctx.pinChatMessage(message.message_id);
            //     // 设置当前是在群聊
            //     this._flagPinMessageType = 'room';
            // })
            this.setPin('room',await room?.topic())
        })

        bot.action(/room-next-\d+/, async (ctx) => {
            const nextPage = parseInt(ctx.match.input.slice(10));
            this.generateRoomButtons(searchRooms, currentSelectRoomMap, nextPage).then(buttons => {
                ctx.editMessageReplyMarkup({
                    inline_keyboard: buttons
                })
            })
        })

        let contactMap = this._weChatClient.contactMap;

        let currentSearchWord = '';

        bot.command('user', async ctx => {

            // wait all contact loaded
            if (!this._weChatClient.client.isLoggedIn) {
                ctx.reply('请先登陆并获取用户列表');
                return;
            }

            if (!this.loginCommandExecuted) {
                await ctx.reply('请等待,正在登陆...');
                return;
            }

            // 没有执行完成
            if (!this.allContactCommandExecuted) {
                await ctx.reply('正在加载用户列表, 请等待5秒...');
                contactMap = await this.setAllMemberCache()
                setTimeout(() => {
                    if (this.allContactCommandExecuted) {
                        const inlineKeyboard = Markup.inlineKeyboard([
                            // Markup.button.callback('未知', 'UNKNOWN'),
                            Markup.button.callback('个人', 'INDIVIDUAL'),
                            Markup.button.callback('公众号', 'OFFICIAL')
                            // Markup.button.callback('公司', 'CORPORATION')
                        ]);
                        // Send message with inline keyboard
                        ctx.reply('请选择类型：', inlineKeyboard);
                    }
                }, 5000)
                return;
            }

            if (ctx.message.text) {
                currentSearchWord = ctx.message.text.split(' ')[1];
            } else {
                currentSearchWord = ''
            }


            // Create inline keyboard
            const inlineKeyboard = Markup.inlineKeyboard([
                Markup.button.callback('未知', 'UNKNOWN'),
                Markup.button.callback('个人', 'INDIVIDUAL'),
                Markup.button.callback('公众号', 'OFFICIAL'),
                Markup.button.callback('公司', 'CORPORATION')
            ]);

            // Send message with inline keyboard
            ctx.reply('请选择类型：', inlineKeyboard);

        })

        bot.command('recent', async ctx => {
            if (this.recentUsers.length == 0){
                ctx.reply('最近联系人为空')
                return
            }

            const buttons: tg.InlineKeyboardButton[][] = []
            this.recentUsers.forEach(item => {
                buttons.push([Markup.button.callback(item.name, item.id)])
            })
            const inlineKeyboard = Markup.inlineKeyboard(buttons);
            ctx.reply('请选择要回复的联系人：', inlineKeyboard);
        })

        bot.action(/.*recent.*/, (ctx) => {
            const data = this.recentUsers.find(item=>item.id === ctx.match.input)
            if (data){
                if (data.type === 0){
                    this.selectRoom = data.talker;
                }else {
                    this._currentSelectContact = data.talker;
                }
                this.setPin(data.type === 0?'room':'user',data.name)
            }
            ctx.deleteMessage()
        });

        bot.action(/^[0-9a-z]+/, async (ctx) => {
            // ctx.update.callback_query.message
            console.log('点击了用户', ctx.match.input)
            await ctx.reply('请输入消息内容')
            const id = ctx.match.input !== 'filehelper' ? '@' + ctx.match.input : 'filehelper';
            this._currentSelectContact = await this._weChatClient.client.Contact.find({id: id})
            // console.log(ctx.match.input
            const reply = await this._currentSelectContact?.alias() || this._currentSelectContact?.name()
            // ctx.replyWithHTML(`当前回复用户: <b>${reply}</b>`).then(res => {
            //     // 先取消所有置顶
            //     ctx.unpinAllChatMessages()
            //     // 方便知道当前回复的用户
            //     ctx.pinChatMessage(res.message_id);
            //     // 设置当前回复的是用户
            //     this._flagPinMessageType = 'user';
            // })
            this.setPin('user',reply?reply:'')
        })

        // 发送消息 回复等...
        bot.on(message('text'), async ctx => {
            const text = ctx.message.text; // 获取消息内容

            const replyMessageId = ctx.update.message['reply_to_message']?.message_id;
            // 如果是回复的消息 优先回复该发送的消息
            if (replyMessageId) {
                // try get weChat cache message id
                // todo: 可以去找到最原始的消息 非必要
                const weChatMessageId = this._messageMap.get(replyMessageId)
                if (weChatMessageId) {
                    // 添加或者移除名单

                    // 回复消息是添加或者移除名单的命令
                    if (text === '&add' || text === '&rm') {
                        const replyWechatMessage = await this.weChatClient.client.Message.find({id: weChatMessageId})
                        // 根据当前模式添加到黑白名单
                        if (this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === NotionMode.BLACK) {
                            // let toContact = replyWechatMessage.room()
                        }
                        return;
                    }

                    this.weChatClient.client.Message.find({id: weChatMessageId}).then(message => {
                        message?.say(ctx.message.text).then(() => {
                            //
                        }).catch(() => {
                            ctx.deleteMessage();
                            ctx.replyWithHTML(`发送失败 <blockquote>${text}</blockquote>`)
                        });
                    });
                }
                return;
            }

            // 当前有回复的'个人用户' 并且是选择了用户的情况下
            if (this._flagPinMessageType === 'user' && this._currentSelectContact) {
                this._currentSelectContact.say(text)
                    .then(() => {
                        if (this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                            ctx.deleteMessage();
                            ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                        }
                        // ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                    })
                    .catch(() => {
                        ctx.deleteMessage();
                        ctx.replyWithHTML(`发送失败 <blockquote>${text}</blockquote>`)
                    })
                // ctx.answerCbQuery('发送成功')
                return;
            }

            // 当前有回复的'群' 并且是选择了群的情况下
            if (this._flagPinMessageType === 'room' && this.selectRoom) {
                this.selectRoom.say(text)
                    .then(() => {
                        if (this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                            ctx.deleteMessage();
                            ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                        }
                        // ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                    })
                    .catch(() => {
                        ctx.deleteMessage();
                        ctx.replyWithHTML(`发送失败 <blockquote>${text}</blockquote>`)
                    })
                // ctx.answerCbQuery('发送成功')
                return;
            }

            return;
        })

        bot.on(message('document'), ctx => {
            // 转发文件 没有压缩的图片也是文件

            // console.log('发送文件....')

            if (ctx.message.document) {
                const fileId = ctx.message.document.file_id;
                ctx.telegram.getFileLink(fileId).then(fileLink => {
                    const fileBox = FileBox.fromUrl(fileLink.toString());
                    if (this._flagPinMessageType && this._flagPinMessageType === 'user'){
                        this._currentSelectContact?.say(fileBox).catch(() => ctx.reply('发送失败'));
                        const text = ctx.message.caption
                        if(text) {
                            this._currentSelectContact?.say(text)
                        }
                    } else {
                        this.selectRoom?.say(fileBox)
                        const text = ctx.message.caption
                        if(text) {
                            this.selectRoom?.say(text)
                        }
                    }
                    ctx.reply("发送成功!")
                })
            }
        });

        bot.on(message('photo'), async ctx => {
            if (ctx.message.photo) {
                // Get the file_id of the largest size photo
                const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                // const fileId = ctx.message.photo[ctx.message.photo.length - 1];

                // Get the file link using telegram API
                ctx.telegram.getFileLink(fileId).then(fileLink => {
                    // Create a FileBox from URL
                    const fileBox = FileBox.fromUrl(fileLink.toString());

                    // Send the FileBox to the contact
                    if (this._flagPinMessageType && this._flagPinMessageType === 'user'){
                        this._currentSelectContact?.say(fileBox).catch(() => ctx.reply('发送失败'));
                        const text = ctx.message.caption
                        if(text) {
                            this._currentSelectContact?.say(text)
                        }
                    } else {
                        this.selectRoom?.say(fileBox)
                        const text = ctx.message.caption
                        if(text) {
                            this.selectRoom?.say(text)
                        }
                    }
                    ctx.reply("发送成功!")
                })
            }
        })

        bot.on(message('sticker'), ctx => {
            const fileId = ctx.message.sticker.file_id
            ctx.telegram.getFileLink(fileId).then(fileLink => {
                const uniqueId = ctx.message.sticker.file_unique_id
                // 判断文件夹是否存在
                if (!fs.existsSync("save-files")) {
                    fs.mkdirSync("save-files");
                }
                const saveFile = `save-files/${uniqueId}`; // 不用后缀

                FileBox.fromUrl(fileLink.toString()).toFile(saveFile).then(() => {
                    const gifFile = `save-files/${uniqueId}.gif`;
                    new ConverterHelper().webmToGif(saveFile, gifFile).then(() => {
                        const fileBox = FileBox.fromFile(gifFile);
                        if (this._flagPinMessageType && this._flagPinMessageType === 'user'){
                            this._currentSelectContact?.say(fileBox).then(() => {
                                fs.rmSync(gifFile);
                                fs.rmSync(saveFile);
                            }).catch(() => ctx.reply('发送失败'));
                        } else {
                            this.selectRoom?.say(fileBox).then(() => {
                                fs.rmSync(gifFile);
                                fs.rmSync(saveFile);
                            }).catch(() => ctx.reply('发送失败'));
                        }
                        ctx.reply("发送成功!")
                    }).catch(() => ctx.reply('发送失败'))
                })

            })
        })

        const unknownPage = 0;
        const individualPage = 0;
        const officialPage = 0;
        const corporationPage = 0;
        // const contactMap = this._weChatClient.contactMap;

        bot.action('UNKNOWN',
            ctx => this.pageContacts(ctx, contactMap?.get(0), unknownPage, currentSearchWord));
        bot.action('INDIVIDUAL',
            ctx => this.pageContacts(ctx, contactMap?.get(ContactImpl.Type.Individual), individualPage, currentSearchWord));
        bot.action('OFFICIAL',
            ctx => this.pageContacts(ctx, contactMap?.get(ContactImpl.Type.Official), officialPage, currentSearchWord));
        bot.action('CORPORATION',
            ctx => this.pageContacts(ctx, contactMap?.get(ContactImpl.Type.Corporation), corporationPage, currentSearchWord));


        bot.launch();

    }

    public onMessage() {
        return;
    }

    public sendMessage(message: SimpleMessage) {
        // console.log('发送文本消息', message)
        return this.bot.telegram.sendMessage(this._chatId, SimpleMessageSender.send(message), {
            parse_mode: 'HTML'
        }).then(res => {
            this.messageMap.set(res.message_id, message.id);
        });
    }

    private async pageContacts(ctx: NarrowedContext<Context<tg.Update>, tg.Update>, source: ContactInterface[] | undefined, pageNumber: number, currentSearchWord: string) {

        if (!this.allContactCommandExecuted) {
            await ctx.sendMessage('请等待用户列表加载完成...');
            return
        }

        if (!source) {
            await ctx.reply('没有联系人');
        }
        source = await TelegramClient.filterByNameAndAlias(currentSearchWord, source);

        let buttons: tg.InlineKeyboardButton[][] = await this.pageDataButtons(source, pageNumber,
            TelegramClient.PAGE_SIZE, TelegramClient.LINES);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;

        if (pageNumber != 0) {
            this._bot.action(/(&page:1-next-|&page:1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: "&page:1-next-"});
            })

            this._bot.action(/(&page:2-next-|&page:2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: "&page:2-next-"});
            })
        } else {
            const thatContactMap = that.weChatClient.contactMap;

            let source1 = thatContactMap?.get(1);
            let source2 = thatContactMap?.get(2);

            source1 = await TelegramClient.filterByNameAndAlias(currentSearchWord, source1);
            source2 = await TelegramClient.filterByNameAndAlias(currentSearchWord, source2);


            this._bot.action(/(&page:1-next-|&page:1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source1, code: "&page:1-next-"});
            })

            this._bot.action(/(&page:2-next-|&page:2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source2, code: "&page:2-next-"});

            })
        }

        ctx.reply('请选择联系人:', {
            ...Markup.inlineKeyboard(buttons),
            // allow_sending_without_reply: true
        })

    }

    private async toButtons({ctu, source, code}: { ctu: any, source: ContactInterface[] | undefined, code: string }) {
        let pageNumber = parseInt(ctu.match[2]);
        // const prefix = ctx.match[0].slice(0, 1)
        const direction = ctu.match[1];

        let nextPageNum = 0;

        nextPageNum = direction === code ? pageNumber += 1 : pageNumber -= 1;
        // 修改 prefix1 对应的变量 todo
        ctu.editMessageReplyMarkup({
            inline_keyboard:
                [...await this.pageDataButtons(source, nextPageNum, TelegramClient.PAGE_SIZE, TelegramClient.LINES)]
        })
        return await this.pageDataButtons(source, pageNumber, TelegramClient.PAGE_SIZE, TelegramClient.LINES);
    }

    private static async filterByNameAndAlias(currentSearchWord: string, source: ContactInterface[] | undefined): Promise<ContactInterface[] | undefined> {
        if (currentSearchWord && currentSearchWord.length > 0 && source) {
            return (await Promise.all(
                source.map(async it => {
                    const alias = await it.alias();
                    if (it.name().includes(currentSearchWord) || (alias && alias.includes(currentSearchWord))) {
                        return it;
                    } else {
                        return null;
                    }
                })
            )).filter(it => it !== null) as ContactInterface[];
        }
        return source;
    }

    private async pageDataButtons(source: ContactInterface[] | undefined, page: number, pageSize: number, lines: number) {
        if (source === undefined) {
            return [];
        }
        const start = page * pageSize;
        const end = start + pageSize;
        const slice = source.slice(start, end);

        const type = source[0]?.type();

        const nextButton = Markup.button.callback('下一页', `&page:${type}-next-${page}`);
        const pervButton = Markup.button.callback('上一页', `&page:${type}-perv-${page}`);

        const buttons = []
        for (let i = 0; i < slice.length; i += lines) {
            const row = []
            for (let j = i; j < i + lines && j < slice.length; j++) {
                const alias = await slice[j].alias();
                row.push(Markup.button.callback(alias ? `[${alias}] ${slice[j].name()}` : slice[j].name(), slice[j].id.replace(/@/, '')))
            }
            buttons.push(row);
        }
        // console.warn('buttons', buttons)
        if (start == 0 && buttons.length != 0) {
            buttons.push([nextButton])
        } else if (end < source.length) {
            buttons.push([pervButton, nextButton])
        } else {
            buttons.push([pervButton])
        }
        return buttons;
    }

    public async setAllMemberCache(): Promise<Map<number, ContactInterface[]> | undefined> {
        const weChatClient = this._weChatClient.client
        if (weChatClient && weChatClient.isLoggedIn) {

            const res = new Map<number, ContactInterface[]>([
                [ContactImpl.Type.Unknown, []],
                [ContactImpl.Type.Individual, []],
                [ContactImpl.Type.Official, []],
                [ContactImpl.Type.Corporation, []]
            ]);

            const contactList = await weChatClient.Contact.findAll();

            // 不知道是什么很多空的 过滤掉没名字和不是朋友的
            const filter = contactList.filter(it => it.name() && it.friend());

            filter.forEach(it => {
                const type = it.type();
                switch (type) {
                    case ContactImpl.Type.Unknown:
                        res.get(ContactImpl.Type.Unknown)?.push(it);
                        break;
                    case ContactImpl.Type.Individual:
                        res.get(ContactImpl.Type.Individual)?.push(it);
                        break;
                    case ContactImpl.Type.Official:
                        res.get(ContactImpl.Type.Official)?.push(it);
                        break;
                    case ContactImpl.Type.Corporation:
                        res.get(ContactImpl.Type.Corporation)?.push(it);
                        break;
                }
            });

            // 缓存到客户端的实例
            this._weChatClient.contactMap = res;
            // 一起获取群放到缓存
            this._weChatClient.roomList = await weChatClient.Room.findAll()
            // console.log('通讯录', res);
            // fs.writeFileSync('contact.json', JSON.stringify(Object.fromEntries(res)));
            // set flag
            this.allContactCommandExecuted = true;

            return res || new Map<number, ContactInterface[]>();

        }
    }


    private loadOwnerChat(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {
        try {

            const ownerFile = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.OWNER_FILE_NAME}`
            // 检查存储文件夹是否存在，不存在则创建
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(ownerFile);
            }

            // 检查所有者文件是否存在
            if (fs.existsSync(ownerFile)) {
                // 读取文件并设置所有者和聊天 ID
                const ownerData = fs.readFileSync(ownerFile, 'utf8');
                const {owner_id, chat_id} = JSON.parse(ownerData);
                this._ownerId = owner_id ? owner_id : ctx.from?.id;
                this._chatId = chat_id ? chat_id : ctx.chat?.id;
            } else {
                // 创建并写入新的所有者文件
                const ownerData = {
                    owner_id: ctx.from?.id,
                    chat_id: ctx.message?.chat.id
                };
                fs.writeFileSync(ownerFile, JSON.stringify(ownerData, null, 2));
                this._ownerId = typeof ownerData.owner_id === 'number' ? ownerData.owner_id : 0
                this._chatId = typeof ownerData.chat_id === 'number' ? ownerData.chat_id : 0;
            }

        } catch (error) {
            console.error('Error loading owner data:', error);
        }
    }


    private loadForwardSettings() {
        // 没有就创建
        try {
            const settingFile = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}`
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(StorageSettings.STORAGE_FOLDER);
            }
            const variableContainer = new VariableContainer();
            variableContainer.parseFromFile();
            this.forwardSetting = variableContainer;
        } catch (error) {
            console.error('Error loading owner data:', error);

        }

    }

    private async findPinMessage() {
        // 获取聊天信息，包括已置顶消息的 ID
        const chatInfo = await this._bot.telegram.getChat(this._chatId);

        // 如果有置顶消息
        if (chatInfo.pinned_message) {
            this.pinnedMessageId = chatInfo.pinned_message.message_id;
            // 刚启动无回复用户
            this._bot.telegram.editMessageText(this._chatId,this.pinnedMessageId,undefined,'当前无回复用户').catch(e=>{
                // 无需处理
            })
        }
    }

    private setPin(type: string,name: string|undefined){
        // 判断是否是群组
        let str = ''
        if (type === 'user'){
            str = `当前回复用户: ${name}`
        }else {
            str = `当前回复群组:👥 ${name}`
        }
        this._flagPinMessageType = type;
        if(this.pinnedMessageId) {
            // 修改pin的内容
            this._bot.telegram.editMessageText(this._chatId,this.pinnedMessageId,undefined,str).catch(e=>{
                // 名字相同不用管
            })
        }else{
            // 发送消息并且pin
            this._bot.telegram.sendMessage(this._chatId,str).then(msg=>{
                this._bot.telegram.pinChatMessage(this._chatId, msg.message_id);
                this.pinnedMessageId = msg.message_id
            })
        }
    }


    public onWeChatLogout(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {

        this._weChatClient.logout().then(() => {
            ctx.reply('登出成功').then(() => this.loginCommandExecuted = false);
        }).catch(() => ctx.reply('登出失败'))
    }

    public onWeChatStop(ctx: NarrowedContext<Context<tg.Update>, tg.Update>) {
        this._weChatClient.stop().then(() => {
            ctx.reply('停止成功').then(() => this.loginCommandExecuted = false);
        }).catch(() => ctx.reply('停止失败'))
    }

    private async generateRoomButtons(rooms: RoomInterface[], currentSelectRoomMap: Map<string, RoomInterface>, page: number) {
        const size = TelegramClient.PAGE_SIZE
        const lineSize = TelegramClient.LINES
        const buttons: tg.InlineKeyboardButton[][] = [];
        const currentIndex = size * page;
        const nextIndex = size * (page + 1);
        const slice = rooms.slice(currentIndex, nextIndex);

        for (let i = 0; i < slice.length; i += lineSize) {
            const row = [];
            for (let j = i; j < i + lineSize && j < slice.length; j++) {
                const keyboard = {
                    text: await rooms[j]?.topic(),
                    data: 'room-index-' + j
                }
                currentSelectRoomMap.set(keyboard.data, rooms[j]);
                row.push(Markup.button.callback(keyboard.text, keyboard.data))
            }
            buttons.push(row);
        }

        const nextButton = Markup.button.callback('下一页', 'room-next-' + (page + 1));
        const prevButton = Markup.button.callback('上一页', 'room-next-' + (page - 1));

        if (page === 0 && buttons.length !== 0) {
            buttons.push([nextButton]);
        } else if (nextIndex < rooms.length) {
            buttons.push([prevButton, nextButton]);
        } else {
            buttons.push([prevButton]);
        }

        return buttons;
    }

    private async generateNotionListButtons(list: NotionListType[], page: number, keyPrefix: string) {
        const size = TelegramClient.PAGE_SIZE
        const lineSize = TelegramClient.LINES
        const buttons: tg.InlineKeyboardButton[][] = [];
        const currentIndex = size * page;
        const nextIndex = size * (page + 1);
        const slice = list.slice(currentIndex, nextIndex);

        for (let i = 0; i < slice.length; i += lineSize) {
            const row = [];
            for (let j = i; j < i + lineSize && j < slice.length; j++) {
                row.push(Markup.button.callback(slice[j].name, keyPrefix + slice[j].shot_id))
            }
            buttons.push(row);
        }

        const addList = Markup.button.callback('点我添加', 'listAdd-' + keyPrefix);

        const nextButton = Markup.button.callback('获取更多', keyPrefix + (page + 1));

        buttons.push([addList])

        if (page === 0 && buttons.length !== 0 && nextIndex >= list.length) {
            buttons.push([nextButton]);
        }

        return buttons;
    }

    private async calcShowMemberList(): Promise<void> {

        if (!this.calcShowMemberListExecuted) {
            // 从微信实例中获取缓存的联系人 转换成一样的数组
            const contactMap = this._weChatClient.contactMap;
            const roomList = this._weChatClient.roomList;
            const res: MemberCacheType [] = [];

            const idGenerator = UniqueIdGenerator.getInstance();

            contactMap?.forEach(it => {
                it.forEach(contact => {
                    res.push({
                        id: contact.id,
                        show_name: contact.payload?.alias ? `[${contact.payload.alias}] ${contact.name()}` : contact.name(),
                        shot_id: idGenerator.generateId('user'),
                    })
                })
            })
            for (const it of roomList) {
                res.push({
                    id: it.id,
                    show_name: await it.topic(),
                    shot_id: idGenerator.generateId('room'),
                });
            }

            this.calcShowMemberListExecuted = true;
            this._weChatClient.memberCache = res;
        }
    }
}
