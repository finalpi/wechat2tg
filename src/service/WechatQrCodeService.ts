import {userApi} from 'wx2tg-puppet/dist/api/UserApi'
import {configService} from 'wx2tg-puppet/dist/services/config.service'

// The pinned SDK's qrcode() uses `style || 8`, so even explicit 0
// selects the decorative card. Call the same API with a plain style instead.
export async function getWechatQrCode(style = 0): Promise<{qrCode: string}> {
    const config = await configService.get()
    if (!config) throw new Error('WeChat account configuration unavailable')
    const response = await userApi.GetQRCode({Style: style, Wxid: config.wxid})
    return {qrCode: response.data.Data.qrcode.buffer}
}