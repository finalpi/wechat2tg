import {normalizeMiniAppUrl} from './mini-app-auth'

/** Set a private-chat menu for the trusted owner only; never set a global menu. */
export async function installMiniAppMenu(telegram: {setChatMenuButton(options: any): Promise<unknown>}, ownerId: number, value: unknown) {
    const url = normalizeMiniAppUrl(value)
    if (!url || !Number.isSafeInteger(ownerId) || ownerId <= 0) return false
    await telegram.setChatMenuButton({chat_id: ownerId, menu_button: {type: 'web_app', text: '控制台', web_app: {url}}})
    return true
}