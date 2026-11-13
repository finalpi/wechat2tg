import {createArticleCoverLoader} from './ArticleCover'

/** Only the image hosts observed in WeChat red-packet messages, never TenPay/native URLs. */
export function redPacketCoverURL(value:unknown):string {
    if(typeof value !== 'string' || value.length > 4096 || Array.from(value).some(char=>char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127))return ''
    try {
        const url = new URL(value)
        if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port
            || !['wx.gtimg.com','snssvppicb.video.qq.com','snssvppicc.video.qq.com'].includes(url.hostname))return ''
        url.protocol = 'https:';url.hash = ''
        return url.href
    } catch {return ''}
}
export const loadRedPacketCover = createArticleCoverLoader('storage/webui-red-packet-covers',undefined,redPacketCoverURL)