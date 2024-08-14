import {MyMessageContact} from '../model/MyContact'
import {convertXML} from 'simple-xml-to-json'
import {CacheHelper} from './CacheHelper'
import {TelegramBotClient} from '../client/TelegramBotClient'
import I18n from '../i18n/i18n'

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
        const undoMessageCaches = CacheHelper.getInstances().getUndoMessageByMsgId({msg_id: tgMsgId})
        for (const undoMessageCache of undoMessageCaches) {
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
                                // if (undoMessageCache.chat_id) {
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, I18n.grable().t('telegram.msg.recallSuccess'))
                                // }
                            } else {
                                if (undoMessageCache.chat_id) {
                                    TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, I18n.grable().t('telegram.msg.recallFail'))
                                }
                            }

                        }).catch((e) => {
                            if (undoMessageCache.chat_id) {
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id, I18n.grable().t('telegram.msg.recallFail'))
                            }
                        })
                    })
            }
        }
    }
}