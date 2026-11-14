import type {Context} from 'telegraf'
import {randomInt} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {getTelegramThreadId} from '../util/TelegramTopicUtils'
import {RedPacketService,redPacketService,redPacketResultText,redPacketButtonText} from './RedPacketService'

export const redPacketTelegramDelay = ()=>randomInt(1000,3001)
const waitBeforeOpen = ()=>delay(redPacketTelegramDelay())
const pendingMessages = new Set<string>()

/** Edit only the originating message's keyboard: preserve photo/text, caption,
 * entities and unrelated buttons. The final button itself shows the amount.
 * rpo is explicit one-click consent; rps only reads. Legacy rp opens only when
 * the clicked button explicitly says to open, never when it says view results. */
export async function handleRedPacketCallback(ctx:Context,data:string,ownerId:number,
    resolve:(chatId:number,threadId?:number)=>Promise<{wxId:string}|undefined>,service?:RedPacketService,
    wait:()=>Promise<void> = waitBeforeOpen) {
    if(!ctx.from?.id || ctx.from.id !== ownerId){await ctx.answerCbQuery('仅机器人主人可以打开红包。',{show_alert:true});return}
    const match = /^(rp|rpo|rps|rpc|rpx):([a-f0-9]{32})$/.exec(data)
    if(!match || !ctx.chat || !ctx.callbackQuery?.message)return
    const message = ctx.callbackQuery.message
    const threadId = getTelegramThreadId(message),chatId = ctx.chat.id
    const scope = `telegram:${chatId}:${threadId || 0}`
    const key = `${chatId}:${message.message_id}`
    if(pendingMessages.has(key) || pendingMessages.size >= 64){await ctx.answerCbQuery('正在处理，请稍后查看，勿重复点击。');return}
    pendingMessages.add(key)
    const existing = 'reply_markup' in message ? message.reply_markup?.inline_keyboard || [] : []
    const legacyOpen = match[1] === 'rp' && existing.some(row=>row.some(button=>'callback_data' in button
        && button.callback_data === data && ['拆红包','打开红包'].includes(button.text)))
    const retained = existing.map(row=>row.filter(button=>!('callback_data' in button)
        || !/^rp(?:o|s|c|x)?:/.test(button.callback_data))).filter(row=>row.length)
    let updateAttempted = false
    const edit = async(buttons:Array<{text:string;callback_data:string}>)=>{
        const inline_keyboard = [...retained,buttons]
        if(updateAttempted || JSON.stringify(existing) === JSON.stringify(inline_keyboard))return
        updateAttempted = true
        try {await ctx.editMessageReplyMarkup({inline_keyboard})}
        catch(error){if(error?.response?.error_code !== 400 || !/message is not modified/i.test(error.response.description || ''))throw error}
    }
    let acknowledged = false,token:string|undefined
    let destination:{chatId:number;threadId?:number;conversation:string}|undefined
    try {
        service ||= redPacketService()
        const binding = await resolve(chatId,threadId)
        if(!binding)throw new Error('unavailable')
        destination = {chatId,threadId,conversation:binding.wxId}
        if(match[1] === 'rpx'){
            token = await service.cancel(match[2],scope,destination)
            await ctx.answerCbQuery('已取消，不会领取。');acknowledged = true
            if(token)await edit([{text:'拆红包',callback_data:`rpo:${token}`}])
            return
        }
        if(match[1] === 'rps' || match[1] === 'rp' && !legacyOpen){
            const result = await service.status(match[2],destination)
            await ctx.answerCbQuery(redPacketResultText(result),{show_alert:true});acknowledged = true
            token = match[2]
            if(result.canOpen)await edit([{text:'拆红包',callback_data:`rpo:${token}`}])
            else if(match[1] === 'rp' && result.state !== 'opening')await edit([{text:redPacketButtonText(result),callback_data:`rps:${token}`}])
            return
        }
        let confirmation = match[2]
        if(match[1] === 'rp' || match[1] === 'rpo'){
            token = match[2]
            const prepared = await service.prepare(token,scope,destination)
            if(!prepared.confirmation){
                await ctx.answerCbQuery(redPacketResultText(prepared),{show_alert:true});acknowledged = true
                if(match[1] === 'rp' && prepared.state !== 'opening')await edit([{text:redPacketButtonText(prepared),callback_data:`rps:${token}`}])
                return
            }
            confirmation = prepared.confirmation
        }
        await ctx.answerCbQuery();acknowledged = true
        const result = await service.confirm(confirmation,scope,destination,
            async()=> (await resolve(chatId,threadId))?.wxId === binding.wxId,
            async packetToken=>{
                token = packetToken
                // Reserve before the random delay. No Telegram requests while
                // waiting or claiming; only the final result edits the message.
                await wait()
            })
        token = result.token
        if(result.state !== 'opening')await edit([{text:redPacketButtonText(result),callback_data:`rps:${token}`}])
    } catch {
        if(!acknowledged)await ctx.answerCbQuery('红包或确认已失效，或账号 / 会话已切换。请从原红包重新查看。',{show_alert:true}).catch(()=>undefined)
        else if(token && !updateAttempted){
            // Retry is offered only when the private journal confirms no request
            // was dispatched and the current account/binding still authorizes it.
            let text = '领取失败 · 会话已失效',callback_data = `rps:${token}`
            try {
                if(!destination || (await resolve(chatId,threadId))?.wxId !== destination.conversation)throw new Error('unavailable')
                const state = await service.status(token,destination)
                if(state.canOpen){text = '领取失败 · 重试';callback_data = `rpo:${token}`}
                else text = redPacketButtonText(state)
            } catch { /* No automatic money retry or exposure of another account's result. */ }
            await edit([{text,callback_data}]).catch(()=>undefined)
        }
        else if(!token)await edit([{text:'已失效',callback_data:`rpx:${match[2]}`}]).catch(()=>undefined)
        // A Telegram UI failure must never repeat the money-affecting operation.
    } finally {pendingMessages.delete(key)}
}