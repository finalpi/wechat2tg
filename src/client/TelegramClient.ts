import { Telegraf } from 'telegraf';
import { WeChatClient } from "./WechatClient";
import { config } from '../config';
import fs from 'fs';
import { SimpleMessage, SimpleMessageSender } from "../models/Message"

export class TelegramClient {

    private _weChatClient: WeChatClient;
    private _bot: Telegraf;
    private lang: string;
    private _chatId: number | string;
    private loginCommandExecuted = false;

    constructor () {
        this._weChatClient = new WeChatClient(this);
        this.lang = 'zh'
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
            { command: 'start', description: '开始' },
            { command: 'login', description: '扫码登陆' },
            { command: 'quit', description: '退出程序!! 会停止程序,需要手动重启' },
        ]);

        bot.start(ctx => {
            ctx.reply(
                '请输入/login 登陆'
            )
            this._chatId = ctx.message.chat.id
        })

        bot.command('login', async ctx => {

            this._chatId = ctx.message.chat.id
            // 检查标志变量，如果已经执行过则不再执行
            if (this.loginCommandExecuted) {
                ctx.reply('登陆已经完成，无需重复执行！');
                return;
            }

            // ctx.reply('请扫码登陆');

            await this._weChatClient.init();

            // 标记为已执行
            this.loginCommandExecuted = true;

            ctx.reply('登陆成功...')
        });

        bot.launch();

    }

    public onMessage() {
        return;
    }

    public sendMessage(message: SimpleMessage) {
        this.bot.telegram.sendMessage(this._chatId, SimpleMessageSender.send(message), {
            parse_mode: 'Markdown'
        });
    }
}