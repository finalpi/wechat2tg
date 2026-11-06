import type {Telegram} from 'telegraf'
import {normalizeMiniAppUrl} from './mini-app-auth'

/** Set a private-chat menu for the trusted owner only; never set a global menu. */
export async function installMiniAppMenu(telegram: Pick<Telegram, 'setChatMenuButton'>, ownerId: number, value: unknown) {
    const url = normalizeMiniAppUrl(value)
    if (!url || !Number.isSafeInteger(ownerId) || ownerId <= 0) return false
    await telegram.setChatMenuButton({chatId: ownerId, menuButton: {type: 'web_app', text: '控制台', web_app: {url}}})
    return true
}