import sharp from 'sharp'
import {loadAvatar} from '../webui/avatars'

export const DETAIL_AVATAR_LAYOUT = {width: 512, height: 88, size: 48, left: 16, top: 20} as const

/** Telegram photo blocks have no CSS thumbnail size. A short, wide name strip
 * keeps the avatar small even when the client fits the image to message width. */
export async function renderDirectoryAvatar(image: Buffer, name: string): Promise<Buffer> {
    const {width, height, size, left, top} = DETAIL_AVATAR_LAYOUT
    const clean = Array.from(name, char => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159) ? ' ' : char).join('').trim()
    const points = Array.from(clean)
    const label = (points.length > 18 ? points.slice(0, 17).join('') + '…' : clean)
        .replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;'}[char]))
    const text = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="80" y="51" font-family="sans-serif" font-size="20" fill="#27272a">${label}</text></svg>`)
    const avatar = await sharp(image, {limitInputPixels: 4000000}).resize(size, size, {fit: 'cover'}).png().toBuffer()
    return sharp({create: {width, height, channels: 4, background: '#f4f4f5'}})
        .composite([{input: avatar, left, top}, {input: text, left: 0, top: 0}]).png().toBuffer()
}

export async function createDirectoryAvatar(url: string, name: string): Promise<Buffer> {
    // Reuse the bounded, CDN-allowlisted avatar loader; never publish raw URLs.
    return renderDirectoryAvatar(await loadAvatar(url), name)
}