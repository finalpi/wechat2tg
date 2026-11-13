import {DomUtils,parseDocument} from 'htmlparser2'
import {XMLValidator} from 'fast-xml-parser'
import {redPacketCoverURL} from './RedPacketCover'

export interface WechatRedPacket {title:string;coverUrl:string;xml:string;sendId:string;claimable:boolean}

/** Parse only message-owned data. Public callers must not expose xml/sendId or native URLs. */
export function readWechatRedPacket(source:unknown,outgoing = false):WechatRedPacket|undefined {
    if(typeof source !== 'string' || source.length > 524288)return undefined
    try {
        let xml = source
        if(source.trimStart().startsWith('{')){
            const stored = JSON.parse(source)
            xml = stored.xml || stored.Content || ''
        }
        if(typeof xml !== 'string' || xml.length > 131072 || /<!DOCTYPE|<!ENTITY/i.test(xml))return undefined
        const root = parseDocument(xml,{xmlMode:true,decodeEntities:true,withStartIndices:true,withEndIndices:true})
        const child = (node:any,name:string)=>{
            const matches = node?.children?.filter((item:any)=>item.type === 'tag' && item.name === name) || []
            return matches.length === 1 ? matches[0] : undefined
        }
        const message = child(root,'msg'), app = child(message,'appmsg'), pay = child(app,'wcpayinfo')
        const text = (node:any,name:string)=>{const value = child(node,name);return value ? DomUtils.textContent(value).trim() : ''}
        if(!pay || text(app,'type') !== '2001')return undefined
        const title = (text(pay,'receivertitle') || text(pay,'sendertitle') || '微信红包').slice(0,200)
        const coverUrl = [text(pay,outgoing ? 'senderc2cshowsourceurl' : 'receiverc2cshowsourceurl'),
            text(pay,'recshowsourceurl'),text(pay,'detailshowsourceurl'),text(pay,'iconurl'),text(app,'thumburl')]
            .map(redPacketCoverURL).find(Boolean) || ''
        const sendId = text(pay,'paymsgid')
        let claimable = false
        try {
            const native = new URL(text(pay,'nativeurl'))
            claimable = /^[a-zA-Z0-9_-]{6,128}$/.test(sendId) && native.protocol === 'wxpay:'
                && native.hostname === 'c2cbizmessagehandler' && native.pathname === '/hongbao/receivehongbao'
                && !native.username && !native.password && !native.port && native.searchParams.getAll('sendid').length === 1
                && native.searchParams.get('sendid') === sendId
        } catch { /* A displayable packet need not be safely claimable. */ }
        // Group payloads may have a sender prefix. Retain the exact msg XML,
        // without reserializing signed native URLs or forwarding that prefix.
        const messageXML = Number.isInteger(message.startIndex) && Number.isInteger(message.endIndex)
            ? xml.slice(message.startIndex,message.endIndex + 1) : xml
        if(XMLValidator.validate(messageXML) !== true)return undefined
        return {title,coverUrl,xml:messageXML,sendId,claimable}
    } catch {return undefined}
}

/** A notification only, never a payment/claim operation or an inferred amount.
 * Old protocols report this exact placeholder as unknown; ordinary user text is
 * not reclassified just because it mentions a red packet. */
export function wechatRedPacketNotice(type:string,text:string):string|undefined {
    if(type === 'red_packet' || type === 'unknown' && text.trim() === '收到红包，请在手机上查看'){
        return '🧧 收到红包，请在微信客户端查看。'
    }
    return undefined
}