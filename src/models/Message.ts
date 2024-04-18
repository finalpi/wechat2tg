import {FmtString} from "telegraf/format";

export interface SimpleMessage {
    id: string;
    room: string;
    sender: string;
    body: string | FmtString;
}

export interface MessageSender {
    sendMessage(simpleMessage: SimpleMessage): string | FmtString;
}

export class SimpleMessageSender implements MessageSender {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor() {

    }

    sendMessage(simpleMessage: SimpleMessage): string | FmtString {
        if (simpleMessage instanceof FmtString) {
            return simpleMessage;
        } else {
            const title = simpleMessage.room === ''
                ? `<b>${simpleMessage.sender}: </b> \n` :
                `<b>👥 ${simpleMessage.room} ---- ${simpleMessage.sender}: </b> \n`;
            return `${title}${simpleMessage.body}`;
        }
    }

    static send(simpleMessage: SimpleMessage) {
        return new SimpleMessageSender().sendMessage(simpleMessage);
    }

}


export class BotHelpText{
    static help = `
                            **欢迎使用本Bot**
                            
本Bot基于Wechaty和wechat4u项目开发，需要注意可能会受到微信方面的警告或封号。

1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录。
2\\. 使用 /user 命令可以返回所有联系人列表，或者指定某个联系人或昵称搜索。
3\\. 第一次使用 /say 命令时，会缓存当前能获取到的所有联系人和公众号等，等待返回列表即表示加载完成。
4\\. /settings 打开设置 当是白名单模式的时候回复&add 加入白名单 &rm 去除,黑名单同理。\\(未实现\\)
5\\. 在返回列表后，选择联系人后，当前发送的消息默认都会发送给所选择的联系人。
6\\. 回复本Bot转发的群聊消息能直接转发到对应的群聊（暂时不支持回复回复的消息）。
7\\. 本项目的目的仅是实现微信消息转发到Telegram的功能。
8\\. 目前仍处于Demo状态，可能会有不稳定性，请谨慎使用。
`;
}
