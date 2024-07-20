import {MyMessageContact} from '../models/MyContact.js'
import {convertXML} from 'simple-xml-to-json'
import {CacheHelper} from './CacheHelper.js'
import {TelegramBotClient} from '../client/TelegramBotClient.js'

export class MessageUtils {
    private static instance: MessageUtils

    private constructor() {
        //
    }

    public getInstance(): MessageUtils {
        if (!MessageUtils.instance) {
            MessageUtils.instance = new MessageUtils()
        }
        return MessageUtils.instance
    }

    public static messageTextToContact(messageText: string): Promise<MyMessageContact> {
        // messageText = messageText.replaceAll('\n',' ');
        const firstIndex = messageText.indexOf('<')
        if (firstIndex !== 0) {
            messageText = messageText.substring(firstIndex, messageText.length)
        }
        return new Promise((resolve) => {
            const contact: MyMessageContact = convertXML(messageText)['msg']
            return resolve(contact)
        })
    }

    /**
     * 撤回消息
     * @param tgMsgId
     * @private
     */
    public static undoMessage(tgMsgId: number) {
        const undoMessageCache = CacheHelper.getInstances().getUndoMessageByMsgId({msg_id: tgMsgId})
        if (undoMessageCache) {
            // 撤回消息
            const wxMsgId = undoMessageCache?.wx_msg_id
            TelegramBotClient.getInstance().weChatClient.client.Message.find({id: wxMsgId})
                .then(message => {
                    message?.recall().then((res) => {
                        if (res) {
                            if (wxMsgId) {
                                CacheHelper.getInstances().removeUndoMessage(wxMsgId)
                            }
                            if (undoMessageCache.chat_id) {
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, '撤回成功')
                            }
                        } else {
                            if (undoMessageCache.chat_id) {
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, '撤回失败')
                            }
                        }

                    }).catch((e) => {
                        if (undoMessageCache.chat_id) {
                            TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, '撤回失败')
                        }
                    })
                })
        }
    }
}