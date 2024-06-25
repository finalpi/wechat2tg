import {MyMessageContact} from '../models/MyContact'
import {convertXML} from 'simple-xml-to-json'
import {CacheHelper} from './CacheHelper'
import {TelegramBotClient} from '../client/TelegramBotClient'

export class MessageUtils {
    private static instance: MessageUtils
    private constructor() {
        //
    }
    public getInstance (): MessageUtils {
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
    public static undoMessage(tgMsgId: number | string) {
        const undoMessageCache = CacheHelper.getInstances().getUndoMessageCacheByTelegramMessageId(tgMsgId)
        if (undoMessageCache && undoMessageCache.wechat_message_id) {
            // 撤回消息
            TelegramBotClient.getInstance().weChatClient.client.Message.find({id: undoMessageCache.wechat_message_id})
                .then(message => {
                    message?.recall().then((res) => {
                        if (res) {
                            if (undoMessageCache.chat_id){
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id,'撤回成功')
                            }
                            CacheHelper.getInstances().deleteUndoMessageCacheByTelegramMessageId(tgMsgId)
                        } else {
                            if (undoMessageCache.chat_id){
                                TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id,'撤回失败')
                            }
                        }

                    }).catch((e) => {
                        if (undoMessageCache.chat_id){
                            TelegramBotClient.getInstance().bot.telegram.sendMessage(undoMessageCache.chat_id,'撤回失败')
                        }
                    })
                })
        }
        return
    }
}