import {Context, Markup, NarrowedContext, Telegraf} from 'telegraf';
import {WeChatClient} from "./WechatClient";
import {config} from "../config";
import {BotHelpText, SimpleMessage, SimpleMessageSender} from "../models/Message"
import {ContactImpl, ContactInterface} from 'wechaty/impls';
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from "https-proxy-agent";
import * as tg from "telegraf/src/core/types/typegram";
// import {ContactInterface} from "wechaty/dist/esm/src/mods/impls";
import {message} from "telegraf/filters";
import {FileBox} from 'file-box'
import * as fs from "node:fs";
import {NotionMode, StorageSettings, VariableContainer, VariableType} from "../models/Settings";
import {ConverterHelper} from "../utils/FfmpegUtils";

export class TelegramClient {


    private _weChatClient: WeChatClient;
    private readonly _bot: Telegraf;
    private _chatId: number | string;
    private _ownerId: number;
    private loginCommandExecuted = false;
    private allContactCommandExecuted = false;
    private static PAGE_SIZE = 18;
    private static LINES = 2;
    // setting 是否反馈发送文本消息成功
    // 保存有互动的 contact
    // private messageContacts;

    private forwardSetting: VariableContainer = new VariableContainer();

    // key this message id value weChat message id
    private _messageMap = new Map<number, string>();


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

    public get chatId(): number | string {
        return this._chatId;
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

        // Enable graceful stop
        process.once('SIGINT', () => bot.stop('SIGINT'))
        process.once('SIGTERM', () => bot.stop('SIGTERM'))

        bot.telegram.setMyCommands([
            {command: 'help', description: '使用说明'},
            {command: 'start', description: '开始'},
            {command: 'login', description: '扫码登陆'},
            {command: 'logout', description: '退出登陆(未实现)'},
            {command: 'stop', description: '停止微信客户端'},
            {command: 'check', description: '检查微信存活'},
            {command: 'say', description: '加用户名或昵称搜索'},
            {command: 'settings', description: '行为设置'},
            // {command: 'quit', description: '退出程序!! 会停止程序,需要手动重启(未实现)'},
        ]);

        bot.start(async ctx => {
            ctx.reply(
                '请输入 /login 登陆 或者 /help 查看帮助; 请注意执行/login 后你就是该机器的所有人'
                , Markup.removeKeyboard())
        })

        bot.settings(ctx => {

            ctx.reply('settings', Markup.inlineKeyboard([
                [Markup.button.callback('通知模式(点击切换)', VariableType.SETTING_NOTION_MODE),],
                [Markup.button.callback('反馈发送成功(点击切换)', VariableType.SETTING_REPLY_SUCCESS),],
                [Markup.button.callback('白名单', VariableType.SETTING_WHITE_LIST,
                    !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'white')),
                    Markup.button.callback('黑名单', VariableType.SETTING_BLACK_LIST,
                        !(this.forwardSetting.getVariable(VariableType.SETTING_NOTION_MODE) === 'black')),
                ]
            ]))
        });

        // 好友请求处理
        bot.action('friendship-',ctx => {
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

        // 白名单设置

        bot.help((ctx) => ctx.replyWithMarkdownV2(BotHelpText.help))

        bot.command('login', async ctx => {

            // 第一次输入的人当成bot的所有者
            this.loadOwnerChat(ctx);

            // 检查标志变量，如果已经执行过则不再执行
            if (this.loginCommandExecuted) {
                await ctx.reply('已登陆');
                return;
            }

            await this._weChatClient.init();

            // 标记为已执行
            this.loginCommandExecuted = true;

        });

        bot.command('logout', () => this._weChatClient.logout())

        bot.command('stop', async ctx => {
            await this._weChatClient.stop();
        })

        bot.command('check', ctx => {
            if (this._weChatClient.client.isLoggedIn) {
                ctx.reply('微信客户端存活')
            } else {
                ctx.reply('微信客户端未存活')
            }
        })

        let contactMap = this._weChatClient.contactMap;

        let currentSearchWord = '';

        bot.command('say', async ctx => {
            // wait all contact loaded
            if (!this._weChatClient.client.isLoggedIn) {
                ctx.reply('请先登陆并获取用户列表');
                return;
            }

            // 没有执行完成
            if (!this.allContactCommandExecuted) {
                await ctx.reply('正在加载用户列表, 请等待用户列表加载完成');
                contactMap = await this.getAllContact()
                setTimeout(() => {
                    if (this.allContactCommandExecuted) {
                        const inlineKeyboard = Markup.inlineKeyboard([
                            Markup.button.callback('未知', 'UNKNOWN'),
                            Markup.button.callback('个人', 'INDIVIDUAL'),
                            Markup.button.callback('公众号', 'OFFICIAL'),
                            Markup.button.callback('公司', 'CORPORATION')
                        ]);
                        // Send message with inline keyboard
                        ctx.reply('请选择类型：', inlineKeyboard);
                    }
                }, 3000)
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

        let currentSelectContact: ContactInterface | undefined;

        bot.action(/^[1-9a-z]+/, async (ctx) => {
            // ctx.update.callback_query.message
            await ctx.reply('请输入消息内容')
            const id = ctx.match.input !== 'filehelper' ? '@' + ctx.match.input : 'filehelper';
            currentSelectContact = await this._weChatClient.client.Contact.find({id: id})
            // console.log(ctx.match.input
            const reply = await currentSelectContact?.alias() || currentSelectContact?.name()
            ctx.replyWithHTML(`当前回复用户: <b>${reply}</b>`).then(res => {
                // 先取消所有置顶
                ctx.unpinAllChatMessages()
                // 方便知道当前回复的用户
                ctx.pinChatMessage(res.message_id);
            })
        })

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
                            ctx.replyWithHTML(`发送失败 <blockquote>${text}</blockquote`)
                        });
                    });
                }
                return;
            }

            // 当前有回复的'个人用户'
            if (currentSelectContact) {
                currentSelectContact.say(text)
                    .then(() => {
                        if (this.forwardSetting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                            ctx.deleteMessage();
                            ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                        }
                        // ctx.replyWithHTML(`发送成功 <blockquote>${text}</blockquote>`)
                    })
                    .catch(() => {
                        ctx.deleteMessage();
                        ctx.replyWithHTML(`发送失败 <blockquote>${text}</blockquote`)
                    })
                // ctx.answerCbQuery('发送成功')
            }
            return;
        })

        bot.on(message('document'), ctx => {
            // 转发文件 没有压缩的图片也是文件

            // console.log('发送文件....')

            if (ctx.message.document && currentSelectContact) {
                const fileId = ctx.message.document.file_id;
                ctx.telegram.getFileLink(fileId).then(fileLink => {
                    const fileBox = FileBox.fromUrl(fileLink.toString());
                    currentSelectContact?.say(fileBox).catch(() => ctx.reply('发送失败'));
                })
            }
        });

        bot.on(message('photo'), async ctx => {
            if (ctx.message.photo && currentSelectContact) {
                // Get the file_id of the largest size photo
                const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                // const fileId = ctx.message.photo[ctx.message.photo.length - 1];

                // Get the file link using telegram API
                ctx.telegram.getFileLink(fileId).then(fileLink => {
                    // Create a FileBox from URL
                    const fileBox = FileBox.fromUrl(fileLink.toString());

                    // Send the FileBox to the contact
                    currentSelectContact?.say(fileBox).catch(() => ctx.reply('发送失败'));
                })


            }
        })

        bot.on(message('sticker'), ctx => {
            const fileId = ctx.message.sticker.file_id
            ctx.telegram.getFileLink(fileId).then(fileLink => {
                const uniqueId = ctx.message.sticker.file_unique_id
                const saveFile = `save-files/${uniqueId}`; // 不用后缀

                FileBox.fromUrl(fileLink.toString()).toFile(saveFile).then(() => {
                    const gifFile = `save-files/${uniqueId}.gif`;
                    new ConverterHelper().webmToGif(saveFile, gifFile).then(() => {
                        const fileBox = FileBox.fromFile(gifFile);
                        currentSelectContact?.say(fileBox).then(() => {
                            fs.rmSync(gifFile);
                            fs.rmSync(saveFile);
                        }).catch(() => ctx.reply('发送失败'));
                    }).catch(() => ctx.reply('发送失败'))
                })

            })
        })

        // bot.use(async (ctx: Context, next) => {
        //     ctx.message.
        // })

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

        // action page next or perv

        bot.launch();

    }

    public onMessage() {
        return;
    }

    public sendMessage(message: SimpleMessage) {
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
                row.push(Markup.button.callback(alias ? alias : slice[j].name(), slice[j].id.replace(/@/, '')))
            }
            buttons.push(row);
        }
        // console.warn('buttons', buttons)
        if (start == 0) {
            buttons.push([nextButton])
        } else if (end < source.length) {
            buttons.push([pervButton, nextButton])
        } else {
            buttons.push([pervButton])
        }
        return buttons;
    }

    public async getAllContact(): Promise<Map<number, ContactInterface[]> | undefined> {
        const weChatClient = this._weChatClient.client
        if (weChatClient && weChatClient.isLoggedIn) {

            const res = new Map<number, ContactInterface[]>([
                [ContactImpl.Type.Unknown, []],
                [ContactImpl.Type.Individual, []],
                [ContactImpl.Type.Official, []],
                [ContactImpl.Type.Corporation, []]
            ]);

            const contactList = await weChatClient.Contact.findAll();

            // 不知道是什么很多空的
            const filter = contactList.filter(it => it.name());

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

            this._weChatClient.contactMap = res;
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
            const settingFile = `${StorageSettings.STORAGE_FOLDER}/${StorageSettings.SETTING_FILE_NAME}}}`
            if (!fs.existsSync(StorageSettings.STORAGE_FOLDER)) {
                fs.mkdirSync(settingFile);
            }
            if (fs.existsSync(settingFile)) {
                const variableContainer = new VariableContainer();
                variableContainer.parseFromFile(settingFile);
                this.forwardSetting = variableContainer;
            }
        } catch (error) {
            console.error('Error loading owner data:', error);

        }

    }


}
