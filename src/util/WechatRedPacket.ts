/** A notification only, never a payment/claim operation or an inferred amount.
 * Old protocols report this exact placeholder as unknown; ordinary user text is
 * not reclassified just because it mentions a red packet. */
export function wechatRedPacketNotice(type:string,text:string):string|undefined {
    if(type === 'red_packet' || type === 'unknown' && text.trim() === '收到红包，请在手机上查看'){
        return '🧧 收到红包，请在微信客户端查看。'
    }
    return undefined
}