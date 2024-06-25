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
        return new Promise((resolve, reject) => {
            context.say(msg).then(msg => {
                // 保存到undo消息缓存
                if (msg) {
                    CacheHelper.getInstances().addUndoMessageCache(ctx.message.message_id, msg.id)
                }
                if (TelegramBotClient.getInstance().setting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
                    ctx.reply(Constants.SEND_SUCCESS, {
                        reply_parameters: {
                            message_id: ctx.message.message_id
                        }
                    })
                }
                resolve(msg)
            }).catch(() => {
                ctx.reply(Constants.SEND_FAIL, {
                    reply_parameters: {
                        message_id: ctx.message.message_id
                    }
                })
                reject()
            })
        })
    }
}