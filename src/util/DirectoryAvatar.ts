import sharp from 'sharp'
import {loadAvatar} from '../webui/avatars'

export const DETAIL_AVATAR_SIZE = 256

/** A portrait only, never a name banner. Telegram controls photo display size;
 * the caller keeps it inside a collapsed details block instead of faking an
 * inline thumbnail with a wide canvas. Flatten the circular crop onto white
 * because Telegram photo conversion does not preserve PNG transparency. */
export async function renderDirectoryAvatar(image: Buffer): Promise<Buffer> {
    const size = DETAIL_AVATAR_SIZE
    const mask = Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`)
    const circle = await sharp(image, {limitInputPixels: 4000000}).rotate().resize(size, size, {fit: 'cover'})
        .composite([{input: mask, blend: 'dest-in'}]).png().toBuffer()
    return sharp(circle).flatten({background: '#ffffff'}).png().toBuffer()
}

export async function createDirectoryAvatar(url: string): Promise<Buffer> {
    // Reuse the bounded, CDN-allowlisted avatar loader; never publish raw URLs.
    return renderDirectoryAvatar(await loadAvatar(url))
}