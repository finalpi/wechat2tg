import type {Context} from 'telegraf'
import {getTelegramThreadId} from '../util/TelegramTopicUtils'
import {TransferService,transferService,transferButtonText} from './TransferService'

const pending = new Set<string>()
export async function handleTransferCallback(ctx:Context,data:string,owner:number,
    resolve:(chatId:number,threadId?:number)=>Promise<{wxId:string}|undefined>,service?:TransferService) {
    if(ctx.from?.id !== owner || !owner){await ctx.answerCbQuery('仅机器人主人可以接收转账。',{show_alert:true});return}
    const match = /^(tfo|tfs):([a-f0-9]{32})$/.exec(data)
    if(!match || !ctx.chat || !ctx.callbackQuery?.message)return
    const message = ctx.callbackQuery.message,chatId = ctx.chat.id,threadId = getTelegramThreadId(message)
    const key = `${chatId}:${message.message_id}`
    if(pending.has(key) || pending.size >= 64){await ctx.answerCbQuery('正在处理，请勿重复点击。');return}
    pending.add(key)
    let acknowledged = false
    try {
        const binding = await resolve(chatId,threadId)
        if(!binding)throw new Error('unbound')
        service ||= transferService()
        const destination = {chatId,threadId,conversation:binding.wxId}
        // Read authorization before acknowledging or attempting any action.
        let result = await service.status(match[2],destination)
        if(match[1] === 'tfo' && result.canAccept) {
            await ctx.answerCbQuery();acknowledged = true
            result = await service.accept(match[2],destination,async()=> (await resolve(chatId,threadId))?.wxId === binding.wxId)
        } else {
            await ctx.answerCbQuery(result.canAccept ? '请点击“接收转账”确认收款。' : transferButtonText(result),{show_alert:true})
            acknowledged = true
        }
        const existing = 'reply_markup' in message ? message.reply_markup?.inline_keyboard || [] : []
        const retained = existing.map(row=>row.filter(button=>!('callback_data' in button) || !/^tf[os]:/.test(button.callback_data))).filter(row=>row.length)
        const inline_keyboard = [...retained,[{text:transferButtonText(result),callback_data:`${result.canAccept ? 'tfo' : 'tfs'}:${match[2]}`}]]
        if(JSON.stringify(existing) !== JSON.stringify(inline_keyboard))await ctx.editMessageReplyMarkup({inline_keyboard})
    } catch {
        if(!acknowledged)await ctx.answerCbQuery('转账信息或会话已失效，请在微信核实。',{show_alert:true}).catch(()=>undefined)
        // After dispatch, even failure to edit the button must not trigger another
        // money request. A later click reads the durable result instead.
    } finally {pending.delete(key)}
}