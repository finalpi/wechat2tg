import type BaseMessage from '../base/BaseMessage'
import {FormatUtils} from './FormatUtils'
import {readWechatRedPacket,wechatRedPacketNotice} from './WechatRedPacket'
import {redPacketService} from '../service/RedPacketService'

/** Shared by live forwarding and manual WebUI sync. Registration never opens a packet. */
export async function decorateRedPacketMessage(message:BaseMessage,source:string,accountId:string,outgoing = false) {
    const packet = readWechatRedPacket(source,outgoing)
    message.content = packet && packet.title !== '微信红包' ? `${FormatUtils.escapeHtml(packet.title)}\n${wechatRedPacketNotice('red_packet','')}` : wechatRedPacketNotice('red_packet','')
    message.source_type = 'red_packet'
    if(packet)message.source_text = packet.xml
    if(packet?.coverUrl)message.redPacket = {coverUrl:packet.coverUrl}
    if(packet?.claimable && accountId && message.chatId){
        try {
            const entry = await redPacketService().register({accountId,conversation:message.conversationWxId || message.wxId,
                remoteId:message.id,source:packet.xml,chatId:message.chatId,threadId:message.threadId})
            message.param = {...message.param,inline_keyboard:[...(message.param?.inline_keyboard || []),{text:'打开红包',callback_data:`rp:${entry.token}`}]}
        } catch { /* A missing authorization/journal only removes the action, never the notification. */ }
    }
}