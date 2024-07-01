import {FmtString} from 'telegraf/format'
import {MessageInterface} from 'wechaty/impls'

export interface SimpleMessage {
    id?: string,
    room?: string,
    sender?: string,
    type?: number,
    body: string | FmtString,
    not_escape_html?: boolean,
    chatId: number | string,
    message?: MessageInterface,
    replay_msg_id?: number,
    send_id?: string,
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
        // 查找所有 <a> 标签并将它们替换成占位符
        // const aTagPattern = /<a href="tg:\/\/user\?id=\d+">.*?<\/a>/g
        // const aTags = str.match(aTagPattern) || []
        // let placeholderStr = str.replace(aTagPattern, (match, offset) => `__PLACEHOLDER_${offset}__`)
        let placeholderStr = str
        // 转义其他 HTML 字符
        // placeholderStr = placeholderStr.replace(/</g, '&lt;')
        //     .replace(/>/g, '&gt;')

        // 将占位符替换回原始的 <a> 标签
        // aTags.forEach((aTag, offset) => {
        //     placeholderStr = placeholderStr.replace(`__PLACEHOLDER_${offset}__`, aTag)
        // })

        // 查找和处理分隔线
        const splitLineNumber = placeholderStr.search(/\n- - - - - - - - - - - - - - -\n/)
        if (splitLineNumber !== -1) {
            placeholderStr = `<blockquote>${placeholderStr.slice(1, splitLineNumber - 1)}</blockquote>${placeholderStr.slice(splitLineNumber + 31)}`
        }

        return placeholderStr
    }

    static send(simpleMessage: SimpleMessage) {
        return new SimpleMessageSender().sendMessage(simpleMessage)
    }

}