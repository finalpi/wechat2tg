import {FileBox, FileBoxType} from 'file-box'
import {MessageInterface} from 'wechaty/impls'
import {CacheHelper} from './CacheHelper'
import {VariableType} from '../models/Settings'
import {Constants} from '../constants/Constants'
import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
import {TelegramBotClient} from '../client/TelegramBotClient'

export class WechatUtil{
    private constructor() {
        ///
    }

    /**
     * 发送消息
     * @param context
     * @param msg
     * @param ctx
     */
    public static say(context: MessageInterface|ContactInterface|RoomInterface,msg: string|FileBox,ctx: any): Promise<void | MessageInterface>{
        const msgId = ctx.message.message_id
        const chat_id = ctx.message?.chat.id
        const msgDate = ctx.message.date
        return new Promise((resolve, reject) => {
            context.say(msg).then(msg => {
                // 保存到undo消息缓存
                if (msg) {
                    CacheHelper.getInstances().addUndoMessageCache({
                        telegram_bot_message_id: msgId,
                        chat_id: chat_id,
                        wechat_message_id: msg.id,
                        msgDate: msgDate
                    })
                }
                if (TelegramBotClient.getInstance().setting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                    ctx.reply(Constants.SEND_SUCCESS, {
                        reply_parameters: {
                            message_id: msgId
                        }
                    })
                }
                resolve(msg)
            }).catch(() => {
                ctx.reply(Constants.SEND_FAIL, {
                    reply_parameters: {
                        message_id: msgId
                    }
                })
                reject()
            })
        })
    }
}