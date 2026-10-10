import {Message as WxMessage} from 'wx2tg-puppet'

// The SDK does not classify MsgType 50. Recognize only the call bubble XML,
// so unrelated unknown/control messages keep their existing filtering.
export function getWechatCallStatus(xml: string): string | undefined {
    if (typeof xml !== 'string' || !xml.includes('<voipmsg')) return undefined
    try {
        const call = WxMessage.getXmlToJson(xml)?.voipmsg
        if (call?.type !== 'VoIPBubbleMsg') return undefined
        const status = call.VoIPBubbleMsg?.msg
        return typeof status === 'string' && status.trim() ? status.trim() : undefined
    } catch {
        return undefined
    }
}

export function formatWechatCallStatus(status: string): string {
    const escaped = status.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return `[视频/语音] ${escaped}`
}
