import {FmtString} from 'telegraf/format'
import {MessageInterface} from 'wechaty/impls'

export interface SimpleMessage {
    id?: string;
    room?: string;
    sender?: string;
    type?: number;
    body: string | FmtString;
    not_escape_html?: boolean;
    chatId: number | string,
    message?: MessageInterface
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
            return simpleMessage
        } else if (simpleMessage.sender) {
            let title = !simpleMessage.room || simpleMessage.room === ''
                ? `<b>👤${simpleMessage.sender} : </b> \n` :
                `<i>🌐${simpleMessage.room}</i> ---- <b>👤${simpleMessage.sender} : </b> \n`
            if (simpleMessage.type === 1) {
                title = `<b>📣${simpleMessage.sender} : </b> \n`
            }
            return `${title}${!simpleMessage.not_escape_html ? this.escapeHTML(typeof simpleMessage.body === 'string' ? simpleMessage.body : '') : simpleMessage.body}`
        } else {
            return simpleMessage.body
        }
    }

    private escapeHTML(str: string) {
        str = str.replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        const splitLineNumber = str.search(/\n- - - - - - - - - - - - - - -\n/)
        if (splitLineNumber !== -1) {
            str = `<blockquote>${str.slice(1, splitLineNumber - 1)}</blockquote>${str.slice(splitLineNumber + 31)}`
        }
        return str
    }

    static send(simpleMessage: SimpleMessage) {
        return new SimpleMessageSender().sendMessage(simpleMessage)
    }

}


export class BotHelpText {
    static help = `
                        **欢迎使用微信消息转发bot**
                            
                    [本项目](https://github.com/finalpi/wechat2tg)是基于Wechaty和wechat4u项目开发
                  **本项目仅用于技术研究和学习，不得用于非法用途。**

1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录
2\\. 使用 /user 或者 /room 命令搜索联系人或者群聊（可以加名称或者备注,例如"/user 张"可以搜索名称或备注含有"张"的用户）
3\\. 每次登陆后需要等待联系人列表加载才能选择人和群发送信息
4\\. /settings 打开设置
5\\. 当前回复的用户或者群会被pin
6\\. 回复转发的消息能直接直接转发到对应的人或者群（暂时不支持回复回复的消息，而且不改变当前正在回复的用户）
7\\. 由于使用的web协议的微信协议所以可能会**封号**（目前我没遇到过），使用前请三思 
8\\. 更多功能请查看 github 仓库（For more features, please check the GitHub repository README）
`
}