import {axiosInstance} from 'wx2tg-puppet/dist/utils/axiosInstance'

export interface WechatLocation {
    latitude: number
    longitude: number
    title: string
    address: string
}

export function locationText(value: unknown): string {
    // eslint-disable-next-line no-control-regex -- XML attributes must not carry control characters.
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\ufffe\uffff]/g, ' ').trim() : ''
}

const escapeAttribute = (value:string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

export function telegramLocationFields(latitude:unknown,longitude:unknown,title = '',address = '') {
    if(typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
        || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180)return undefined
    const name = locationText(title), street = locationText(address)
    const cardTitle = name || street || '位置'
    const label = street || name || `${latitude}, ${longitude}`
    const location:WechatLocation = {latitude,longitude,title:cardTitle,address:street}
    // Use the named-place form when we have place text, but do not invent a WeChat POI ID.
    const namedPlace = name || street ? ' isFromPoiList="true"' : ''
    const source_text = `<msg><location x="${latitude}" y="${longitude}" scale="16" label="${escapeAttribute(label)}" poiname="${escapeAttribute(cardTitle)}" maptype="0" infourl="" fromusername="" poiid=""${namedPlace} /></msg>`
    return {type:5 as const,content:cardTitle,location,source_text}
}

function messageId(value:unknown) {
    if(typeof value === 'number' && !Number.isSafeInteger(value))return ''
    const id = String(value ?? '')
    return /^[1-9]\d{0,19}$/.test(id) && BigInt(id) <= 18446744073709551615n ? id : ''
}

/** ShareLocation hardcodes type 42 (contact card) on some servers; SendTxt forwards the supplied wire type. */
export async function sendWechatLocation(wxId:string,selfId:string,xml:string,timeout:number) {
    const {data} = await axiosInstance.post('/Msg/SendTxt',{Wxid:selfId,ToWxid:wxId,Type:48,At:'',Content:xml},{timeout})
    const item = data?.Data?.List?.[0]
    const rejected = [data?.Data?.BaseResponse?.Ret,item?.Ret].some(ret => /^-?[1-9]\d*$/.test(String(ret ?? '')))
    if(rejected)throw Object.assign(new Error('wechatSendRejected'),{code:'wechatSendRejected'})
    const newMsgId = messageId(item?.NewMsgId ?? item?.newMsgId ?? item?.Newmsgid)
    const peer = item?.ToUsetName ?? item?.ToUserName ?? item?.toUserName
    const toWxid = typeof peer === 'string' ? peer : peer?.string
    if(data?.Code !== 0 || data.Success === false || !newMsgId || (toWxid && toWxid !== wxId))throw new Error('wechatLocationUnconfirmed')
    return {newMsgId,msgId:messageId(item.MsgId ?? item.Msgid ?? item.msgId),createTime:item.CreateTime ?? item.Createtime ?? item.createTime,toWxid:wxId}
}