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
                `<b>${simpleMessage.room} ---- ${simpleMessage.sender}: </b> \n`;
            return `${title}${this.escapeHTML(typeof simpleMessage.body === "string" ? simpleMessage.body :'')}`;
        }
    }

    private escapeHTML(str:string) {
        return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static send(simpleMessage: SimpleMessage) {
        return new SimpleMessageSender().sendMessage(simpleMessage);
    }

}


export class BotHelpText{
    static help = `
                            **欢迎使用本Bot**
                            
本Bot基于Wechaty和wechat4u项目开发。

1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录。
2\\. 使用 /user 命令可以返回所有联系人列表，或者指定某个联系人或昵称搜索。
3\\. 第一次使用 /user 或者 /room 命令时，会缓存当前能获取到的所有联系人和公众号等，等待返回列表即表示加载完成。
4\\. /settings 打开设置
5\\. 在返回列表后，选择联系人后，当前发送的消息默认都会发送给所选择的联系人。
6\\. 回复本Bot转发的群聊消息能直接转发到对应的群聊（暂时不支持回复回复的消息）。
7\\. 本项目的目的仅是实现微信消息转发到Telegram的功能。
`;
}
