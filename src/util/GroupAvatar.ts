import {createHash} from 'node:crypto'
import sharp from 'sharp'

/** Compare the pixels actually used for the Telegram avatar, excluding URL and image metadata. */
export async function prepareGroupAvatar(source: Buffer): Promise<{buffer: Buffer; hash: string}> {
    const buffer = await sharp(source, {limitInputPixels: 40000000})
        .rotate().resize(200).toColourspace('srgb').ensureAlpha().png().toBuffer()
    const {data, info} = await sharp(buffer).raw().toBuffer({resolveWithObject: true})
    const hash = createHash('sha256').update(`${info.width}:${info.height}:${info.channels}:`).update(data).digest('hex')
    return {buffer, hash}
}

/** Telegram re-encodes profile photos. Compare the visible square crop with a
 * small error budget for JPEG/resizing noise, including local changes. */
export async function sameGroupAvatar(left: Buffer, right: Buffer): Promise<boolean> {
    const pixels = (buffer: Buffer) => sharp(buffer, {limitInputPixels: 40000000})
        .rotate().resize(64, 64, {fit: 'cover'}).flatten({background: '#ffffff'})
        .toColourspace('srgb').removeAlpha().raw().toBuffer()
    const [first, second] = await Promise.all([pixels(left), pixels(right)])
    let total = 0, squared = 0
    const tiles = new Array<number>(64).fill(0)
    for (let offset = 0; offset < first.length; offset++) {
        const difference = Math.abs(first[offset] - second[offset])
        total += difference
        squared += difference * difference
        const pixel = Math.floor(offset / 3)
        const tile = Math.floor(pixel / (64 * 8)) * 8 + Math.floor(pixel % 64 / 8)
        tiles[tile] += difference
    }
    return total / first.length <= 3 && Math.sqrt(squared / first.length) <= 6
        && tiles.every(value => value / (8 * 8 * 3) <= 10)
}
