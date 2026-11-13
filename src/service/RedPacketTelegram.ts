import type {Context} from 'telegraf'
import {getTelegramThreadId} from '../util/TelegramTopicUtils'
import {RedPacketService,redPacketService,redPacketResultText} from './RedPacketService'

/** Every callback is owner-, account-, binding- and topic-scoped. Amounts appear only
 * in the owner's callback alert, never in a public group result message. */
export async function handleRedPacketCallback(ctx:Context,data:string,ownerId:number,
    resolve:(chatId:number,threadId?:number)=>Promise<{wxId:string}|undefined>,service?:RedPacketService) {
    if(!ctx.from?.id || ctx.from.id !== ownerId){await ctx.answerCbQuery('仅机器人主人可以打开红包。',{show_alert:true});return}
    const match = /^(rp|rpc|rpx):([a-f0-9]{32})$/.exec(data)
    if(!match || !ctx.chat)return
    const threadId = getTelegramThreadId(ctx.callbackQuery?.message),chatId = ctx.chat.id
    const scope = `telegram:${chatId}:${threadId || 0}`
    let acknowledged = false
    try {
        service ||= redPacketService()
        const binding = await resolve(chatId,threadId)
        if(!binding)throw new Error('unavailable')
        const destination = {chatId,threadId,conversation:binding.wxId}
        if(match[1] === 'rpx'){
            await service.cancel(match[2],scope)
            await ctx.answerCbQuery('已取消，不会领取。');acknowledged = true
            await ctx.editMessageText('已取消打开红包。')
            return
        }
        if(match[1] === 'rp'){
            const prepared = await service.prepare(match[2],scope,destination)
            if(!prepared.confirmation){await ctx.answerCbQuery(redPacketResultText(prepared),{show_alert:true});return}
            await ctx.answerCbQuery();acknowledged = true
            await ctx.reply('确认打开这个红包？这会尝试领取到当前登录的微信账号。结果未知时不会重复请求；确认两分钟内有效。',{
                message_thread_id:threadId,
                reply_parameters:{message_id:ctx.callbackQuery.message.message_id},
                reply_markup:{inline_keyboard:[[{text:'确认打开并领取',callback_data:`rpc:${prepared.confirmation}`},{text:'取消',callback_data:`rpx:${prepared.confirmation}`}]]},
            })
            return
        }
        await ctx.answerCbQuery('正在打开，请勿重复操作。');acknowledged = true
        const result = await service.confirm(match[2],scope,destination,async()=> (await resolve(chatId,threadId))?.wxId === binding.wxId)
        const text = result.state === 'received' ? '红包领取已确认。点击“查看结果”查看金额（仅主人可见）。' : redPacketResultText(result)
        await ctx.editMessageText(text,{reply_markup:{inline_keyboard:[[{text:'查看结果',callback_data:`rp:${result.token}`}]]}})
    } catch {
        if(!acknowledged)await ctx.answerCbQuery('红包或确认已失效，或账号 / 会话已切换。请从原红包重新查看。',{show_alert:true}).catch(()=>undefined)
        else await ctx.editMessageText('操作状态未能更新，请从原红包查看结果或在微信核实；不要重复领取。').catch(()=>undefined)
        // A Telegram UI failure must never repeat the money-affecting operation.
    }
}