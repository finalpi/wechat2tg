import type BaseMessage from '../base/BaseMessage'
import {FormatUtils} from './FormatUtils'
import {readWechatTransfer,resolveTransferPayer} from './WechatTransfer'
import {transferService,transferButtonText} from '../service/TransferService'

export async function observeTransferReceipt(source:string,account:string,conversation:string) {
    if(!readWechatTransfer(source)?.received)return
    try {await transferService().observeReceipt(source,account,conversation)}
    catch { /* A local journal failure must not suppress the payment notification. */ }
}

export async function decorateTransferMessage(message:BaseMessage,source:string,account:string,
    outgoing = false,sender?:string,recipient?:string,group = false) {
    const packet = readWechatTransfer(source)
    message.source_type = 'transfer'
    const label = packet?.received ? '收款通知' : !packet?.claimable ? '请在微信查看'
        : outgoing ? '已转出' : group && packet.receiver !== account ? '群内转账' : '收到转账'
    message.content = packet ? `[转账] ${label} ¥${(packet.amountFen / 100).toFixed(2)}${packet.memo ? `\n备注：${FormatUtils.escapeHtml(packet.memo)}` : ''}`
        : '[转账] 请在微信查看详情（当前消息缺少可安全操作的转账信息）。'
    // No native identifiers or signed payload are put into callback_data.
    const conversation = message.conversationWxId || message.wxId
    const envelope = {sender,recipient,group}
    if(outgoing || !packet || !message.chatId || !resolveTransferPayer(packet,account,conversation,envelope))return
    try {
        const result = await transferService().register(source,account,{chatId:message.chatId,threadId:message.threadId,conversation},envelope)
        message.param = {...message.param,inline_keyboard:[...(message.param?.inline_keyboard || []),
            {text:transferButtonText(result),callback_data:`${result.canAccept ? 'tfo' : 'tfs'}:${result.token}`}]}
    } catch { /* Still forward the notification without a financial action. */ }
}