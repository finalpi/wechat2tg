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

    public static NAME_REGEXP = new RegExp(/#\[(.*?)\]/, 'g')

    sendMessage(simpleMessage: SimpleMessage): string | FmtString {
        if (simpleMessage instanceof FmtString) {
            return simpleMessage
        } else if (simpleMessage.sender && message) {
            // 根据配置文件构建title
            const title = simpleMessage.message ?
                SimpleMessageSender.getTitle(simpleMessage.message, simpleMessage.chatId !== TelegramBotClient.getInstance().chatId)
                : simpleMessage.sender
            return `${!simpleMessage.not_escape_html ? this.escapeHTML(typeof simpleMessage.body === 'string' ? simpleMessage.body : '') : simpleMessage.body}\n${title}`
        } else {
            return simpleMessage.body
        }
    }

    static getTitle(message: MessageInterface, isGroup: boolean): string {
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
        let placeholderStr = str

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
        inputString = inputString.replace(this.NAME_REGEXP, (match, p1) => {
            if (p1.includes('alias_first')) {
                return alias_first ? p1.replaceAll('alias_first', alias_first) : ''
            } else if (p1.includes('alias')) {
                return alias ? p1.replaceAll('alias', alias) : ''
            } else if (p1.includes('name')) {
                return name ? p1.replaceAll('name', name) : ''
            } else if (p1.includes('topic')) {
                return topic ? p1.replaceAll('topic', topic) : ''
            } else {
                return match
            }
        })

        return inputString
    }

}