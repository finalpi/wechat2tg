// import {FileBox} from 'file-box'
// import {MessageInterface} from 'wechaty/impls'
// import {CacheHelper} from './CacheHelper'
// import {VariableType} from '../models/Settings'
// import {Constants} from '../constants/Constants'
// import {ContactInterface, RoomInterface} from 'wechaty/dist/esm/src/mods/impls'
// import {TelegramBotClient} from '../client/TelegramBotClient'
// TODO: 没问题后续删除
// export class WechatUtil {
//     private constructor() {
//         ///
//     }
//
//     /**
//      * 发送消息
//      * @param context
//      * @param msg
//      * @param ctx
//      */
//     public static say(context: MessageInterface | ContactInterface | RoomInterface, msg: string | FileBox, ctx: any): Promise<void | MessageInterface> {
//         const msgId = ctx.message.message_id
//         const chat_id = ctx.message?.chat.id
//         return new Promise((resolve, reject) => {
//             context.say(msg).then(msg => {
//                 // 保存到undo消息缓存
//                 if (msg) {
//                     CacheHelper.getInstances().addUndoMessage({
//                         chat_id: chat_id,
//                         wx_msg_id: msg.id,
//                         msg_id: msgId,
//                     })
//                 }
//                 if (TelegramBotClient.getInstance().setting.getVariable(VariableType.SETTING_REPLY_SUCCESS)) {
//                     ctx.reply(Constants.SEND_SUCCESS, {
//                         reply_parameters: {
//                             message_id: msgId
//                         }
//                     })
//                 }
//                 resolve(msg)
//             }).catch(() => {
//                 ctx.reply(Constants.SEND_FAIL, {
//                     reply_parameters: {
//                         message_id: msgId
//                     }
//                 })
//                 reject()
//             })
//         })
//     }
// }