import {Context, Markup, NarrowedContext, Telegraf} from 'telegraf';
import {WeChatClient} from "./WechatClient";
import {config} from "../config";
import {SimpleMessage, SimpleMessageSender} from "../models/Message"
import {ContactImpl} from 'wechaty/impls';
import * as tg from "telegraf/src/core/types/typegram";
import {ContactInterface} from "wechaty/dist/esm/src/mods/impls";

export class TelegramClient {

    private _weChatClient: WeChatClient;
    private readonly _bot: Telegraf;
    private _chatId: number | string;
    private loginCommandExecuted = false;
    private allContactCommandExecuted = false;
    private static PAGE_SIZE = 18;
    private static LINES = 2;

    constructor() {
        this._weChatClient = new WeChatClient(this);
        this._chatId = 0
        this._bot = new Telegraf(config.BOT_TOKEN)
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

        bot.telegram.setMyCommands([
            {command: 'start', description: '开始'},
            {command: 'login', description: '扫码登陆'},
            {command: 'logout', description: '退出登陆'},
            {command: 'say', description: '加用户名或昵称搜索'},
            {command: 'quit', description: '退出程序!! 会停止程序,需要手动重启'},
        ]);


        bot.start(async ctx => {
            ctx.reply(
                '请输入/login 登陆'
            )
            this._chatId = ctx.message.chat.id

        })

        bot.command('login', async ctx => {

            this._chatId = ctx.message.chat.id
            // 检查标志变量，如果已经执行过则不再执行
            if (this.loginCommandExecuted) {
                ctx.reply('已登陆');
                return;
            }


            await this._weChatClient.init();

            // 标记为已执行
            this.loginCommandExecuted = true;

            // 获取微信用户列表
        });

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
                ctx.reply('正在加载用户列表, 请等待用户列表加载完成');
                contactMap = await this.getAllContact();
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

        bot.action(/[1-9a-z]/, (ctx) => {
            ctx.reply('你选择了' + ctx.match.input)
            ctx.reply('请输入消息').then(res => {
                // this._weChatClient.client.say()
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

        // action page next or perv

        bot.launch();

    }

    public onMessage() {
        return;
    }

    public sendMessage(message: SimpleMessage) {
        return this.bot.telegram.sendMessage(this._chatId, SimpleMessageSender.send(message), {
            parse_mode: 'Markdown'
        });
    }


    private async pageContacts(ctx: NarrowedContext<Context<tg.Update>, tg.Update>, source: ContactInterface[] | undefined, pageNumber: number, currentSearchWord: string) {

        if (!source) {
            await ctx.reply('没有联系人');
        }
        source = await TelegramClient.filterByNameAndAlias(currentSearchWord, source);

        let buttons: tg.InlineKeyboardButton[][] = await this.pageDataButtons(source, pageNumber,
            TelegramClient.PAGE_SIZE, TelegramClient.LINES);

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;

        if (pageNumber != 0) {
            this._bot.action(/(1-next-|1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: "1-next-"});
            })

            this._bot.action(/(2-next-|2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source, code: "2-next-"});
            })
        } else {
            const thatContactMap = that.weChatClient.contactMap;

            let source1 = thatContactMap?.get(1);
            let source2 = thatContactMap?.get(2);

            source1 = await TelegramClient.filterByNameAndAlias(currentSearchWord, source1);
            source2 = await TelegramClient.filterByNameAndAlias(currentSearchWord, source2);


            this._bot.action(/(1-next-|1-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source1, code: "1-next-"});
            })

            this._bot.action(/(2-next-|2-perv-)(\d+)/, async (ctu) => {
                buttons = await this.toButtons({ctu: ctu, source: source2, code: "2-next-"});

            })
        }

        ctx.reply('请选择联系人:', {
            ...Markup.inlineKeyboard(buttons)
        })

    }

    private async toButtons({ctu, source, code}: { ctu: any, source: ContactInterface[] | undefined, code: string }) {
        let pageNumber = parseInt(ctu.match[2]);
        // const prefix = ctx.match[0].slice(0, 1)
        const direction = ctu.match[1];

        let nextPageNum = 0;

        nextPageNum = direction === code ? pageNumber += 1 : pageNumber -= 1;
        // 修改 prefix1 对应的变量
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

        const nextButton = Markup.button.callback('下一页', `${type}-next-${page}`);
        const pervButton = Markup.button.callback('上一页', `${type}-perv-${page}`);

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


}
