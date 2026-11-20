import {DomUtils,parseDocument} from 'htmlparser2'
import {XMLValidator} from 'fast-xml-parser'

export interface WechatTransfer {
    xml:string;sendId:string;transactionId:string;invalidTime:string;payer:string;receiver:string
    amountFen:number;memo:string;claimable:boolean;received:boolean
}

export function transferExpired(invalidTime:string):boolean {
    return !/^\d{10}$/.test(invalidTime) || Number(invalidTime) <= Math.floor(Date.now() / 1000)
}

export function readWechatTransfer(source:unknown):WechatTransfer|undefined {
    if(typeof source !== 'string' || source.length > 131072 || /<!DOCTYPE|<!ENTITY/i.test(source))return
    try {
        const root = parseDocument(source,{xmlMode:true,decodeEntities:true,withStartIndices:true,withEndIndices:true})
        const child = (node:any,name:string)=>{
            const matches = node?.children?.filter((value:any)=>value.type === 'tag' && value.name === name) || []
            return matches.length === 1 ? matches[0] : undefined
        }
        const text = (node:any,name:string)=>{const value = child(node,name);return value ? DomUtils.textContent(value).trim() : ''}
        const message = child(root,'msg'),app = child(message,'appmsg'),pay = child(app,'wcpayinfo')
        if(!pay || text(app,'type') !== '2000')return
        const xml = source.slice(message.startIndex,message.endIndex + 1)
        if(XMLValidator.validate(xml) !== true)return
        const sendId = text(pay,'transferid'),transactionId = text(pay,'transcationid'),invalidTime = text(pay,'invalidtime')
        const payer = text(pay,'payer_username'),receiver = text(pay,'receiver_username')
        // These values are concatenated by the protocol server into a signed form.
        // Reject delimiters rather than allowing injected payment parameters.
        const identifiersValid = [sendId,transactionId].every(value=>/^[a-zA-Z0-9_-]{6,128}$/.test(value))
            && /^\d{10}$/.test(invalidTime) && /^[a-zA-Z0-9_.-]{1,128}$/.test(receiver)
            && (!payer || /^[a-zA-Z0-9_.-]{1,128}$/.test(payer) && payer !== receiver)
        const amount = /^[¥￥]([0-9]{1,9})(?:\.([0-9]{1,2}))?$/.exec(text(pay,'feedesc'))
        if(!amount)return
        const amountFen = Number(amount[1]) * 100 + Number((amount[2] || '').padEnd(2,'0'))
        if(!Number.isSafeInteger(amountFen) || amountFen <= 0)return
        const subtype = text(pay,'paysubtype')
        return {xml,sendId,transactionId,invalidTime,payer,receiver,amountFen,memo:text(pay,'pay_memo').slice(0,200),
            claimable:identifiersValid && subtype === '1',received:identifiersValid && subtype === '3'}
    } catch {return undefined}
}