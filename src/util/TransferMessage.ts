import type BaseMessage from '../base/BaseMessage'
import {FormatUtils} from './FormatUtils'
import {readWechatTransfer} from './WechatTransfer'
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
    message.content = packet ? `[转账] ${packet.received ? '收款通知' : packet.claimable ? outgoing ? '已转出' : '收到转账' : '请在微信查看'} ¥${(packet.amountFen / 100).toFixed(2)}${packet.memo ? `\n备注：${FormatUtils.escapeHtml(packet.memo)}` : ''}`
        : '[转账] 请在微信查看详情（当前消息缺少可安全操作的转账信息）。'
    // No native identifiers or signed payload are put into callback_data.
    const conversation = message.conversationWxId || message.wxId
    if(outgoing || group || !packet?.claimable || !account || packet.receiver !== account || recipient !== account
        || sender !== conversation || (packet.payer && packet.payer !== conversation) || !message.chatId)return
    try {
        const result = await transferService().register(source,account,{chatId:message.chatId,threadId:message.threadId,conversation})
        message.param = {...message.param,inline_keyboard:[...(message.param?.inline_keyboard || []),
            {text:transferButtonText(result),callback_data:`${result.canAccept ? 'tfo' : 'tfs'}:${result.token}`}]}
    } catch { /* Still forward the notification without a financial action. */ }
}