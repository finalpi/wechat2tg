import {FmtString} from 'telegraf/format'
import {MessageInterface} from 'wechaty/impls'
import {config} from '../config'
import {TelegramBotClient} from '../client/TelegramBotClient'
import {message} from 'telegraf/filters'
import * as PUPPET from 'wechaty-puppet'

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
        } else if (simpleMessage.sender && message) {
            // 根据配置文件构建title
            const title = SimpleMessageSender.getTitle(simpleMessage.message,simpleMessage.chatId !== TelegramBotClient.getInstance().chatId)
            // let title = !simpleMessage.room || simpleMessage.room === ''
            //     ? `<b>👤${simpleMessage.sender} : </b> \n` :
            //     `<i>🌐${simpleMessage.room}</i> ---- <b>👤${simpleMessage.sender} : </b> \n`
            // if (simpleMessage.type === 1) {
            //     title = `<b>📣${simpleMessage.sender} : </b> \n`
            // }
            return `${title}\n${!simpleMessage.not_escape_html ? this.escapeHTML(typeof simpleMessage.body === 'string' ? simpleMessage.body : '') : simpleMessage.body}`
        } else {
            return simpleMessage.body
        }
    }

    static getTitle(message: MessageInterface,isGroup: boolean): string {
        const room = message.room()
        if (!isGroup) {
            if (room) {
                return this.transformTitleStr(config.ROOM_MESSAGE, message.talker().payload.alias, message.talker().payload.name, room.payload.topic)
            } else {
                if (message.talker().type() === PUPPET.types.Contact.Official) {
                    // 公众号
                    return this.transformTitleStr(config.OFFICIAL_MESSAGE, message.talker().payload.alias, message.talker().payload.name, '')
                } else {
                    return this.transformTitleStr(config.CONTACT_MESSAGE, message.talker().payload.alias, message.talker().payload.name, '')
                }
            }
        } else {
            if (room) {
                return this.transformTitleStr(config.ROOM_MESSAGE_GROUP, message.talker().payload.alias, message.talker().payload.name, room.payload.topic)
            } else {
                if (message.talker().type() === PUPPET.types.Contact.Official) {
                    // 公众号
                    return this.transformTitleStr(config.OFFICIAL_MESSAGE_GROUP, message.talker().payload.alias, message.talker().payload.name, '')
                } else {
                    return this.transformTitleStr(config.CONTACT_MESSAGE_GROUP, message.talker().payload.alias, message.talker().payload.name, '')
                }
            }
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

    static transformTitleStr(inputString: string, alias: string, name: string, topic: string): string {
        const alias_first = alias || name

        // 创建一个正则表达式，用于匹配 ${alias}、${name} 和 ${topic} 占位符
        const regex = new RegExp('\\$\\{(alias|name|topic)\\}', 'g')

        // 使用指定的替换值替换占位符
        inputString = inputString.replace(regex, (match, p1) => {
            switch (p1) {
                case 'alias':
                    return alias
                case 'name':
                    return name
                case 'topic':
                    return topic
                default:
                    return match
            }
        })

        // 替换 ${alias_first} 占位符
        const alias_firstReg = new RegExp(`\\$\\{${alias_first}\\}`, 'g')
        return inputString.replace(alias_firstReg, alias_first)
    }

}