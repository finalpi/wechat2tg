import {createHash} from 'node:crypto'
import sharp from 'sharp'

/** WeChat's documented avatar sizes: /0 is the original/large image.
 * Do not rewrite arbitrary URLs, paths or authentication query parameters. */
export function largeGroupAvatarURL(value: string): string {
    try {
        const url = new URL(value)
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            && (url.hostname === 'qlogo.cn' || url.hostname.endsWith('.qlogo.cn'))
            && /^\/(mmhead|mmcrhead|mmopen)\//.test(url.pathname)
            && /\/(46|64|96|132)$/.test(url.pathname)) {
            url.pathname = url.pathname.replace(/\/(46|64|96|132)$/, '/0')
            return url.toString()
        }
    } catch { /* Leave nonstandard SDK URLs unchanged. */ }
    return value
}

/** 64-bit horizontal dHash of the actual large source file, before upload resizing.
 * Auto-orient, flatten transparency onto white, grayscale, then compare adjacent
 * pixels of a 9x8 image (row-major, most significant bit first). */
export async function groupAvatarDHash(source: Buffer): Promise<string> {
    const pixels = await sharp(source, {limitInputPixels: 40000000})
        .rotate().flatten({background: '#ffffff'}).greyscale()
        .resize(9, 8, {fit: 'fill'}).raw().toBuffer()
    let hash = 0n
    for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
            const offset = row * 9 + column
            hash = (hash << 1n) | (pixels[offset] > pixels[offset + 1] ? 1n : 0n)
        }
    }
    return hash.toString(16).padStart(16, '0')
}

/** Missing, corrupt and legacy SHA/MD5 hashes are not valid dHash baselines. */
export function groupAvatarDHashDistance(left: unknown, right: unknown): number | undefined {
    if (typeof left !== 'string' || typeof right !== 'string'
        || !/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) return undefined
    let difference = BigInt('0x' + left) ^ BigInt('0x' + right), distance = 0
    while (difference) {
        difference &= difference - 1n
        distance++
    }
    return distance
}

export function sameGroupAvatarDHash(left: unknown, right: unknown): boolean {
    const distance = groupAvatarDHashDistance(left, right)
    return distance !== undefined && distance < 5
}

/** Keep the legacy pixel digest for compatibility, never as the change detector. */
export async function prepareGroupAvatar(source: Buffer): Promise<{buffer: Buffer; hash: string; dHash: string}> {
    const dHash = await groupAvatarDHash(source)
    const buffer = await sharp(source, {limitInputPixels: 40000000})
        .rotate().resize(200).toColourspace('srgb').ensureAlpha().png().toBuffer()
    const {data, info} = await sharp(buffer).raw().toBuffer({resolveWithObject: true})
    const hash = createHash('sha256').update(`${info.width}:${info.height}:${info.channels}:`).update(data).digest('hex')
    return {buffer, hash, dHash}
}

/** Compatibility fallback only when bootstrapping/recovering from Telegram's
 * re-encoded photo, never an extra condition on a matching saved source dHash. */
export async function sameGroupAvatar(left: Buffer, right: Buffer): Promise<boolean> {
    const size = 32, tileSize = size / 8
    const pixels = (buffer: Buffer) => sharp(buffer, {limitInputPixels: 40000000})
        .rotate().resize(size, size, {fit: 'cover'}).flatten({background: '#ffffff'})
        .toColourspace('srgb').removeAlpha().raw().toBuffer()
    const [first, second] = await Promise.all([pixels(left), pixels(right)])
    let total = 0, squared = 0
    const tiles = new Array<number>(64).fill(0)
    for (let offset = 0; offset < first.length; offset++) {
        const difference = Math.abs(first[offset] - second[offset])
        total += difference
        squared += difference * difference
        const pixel = Math.floor(offset / 3)
        const tile = Math.floor(pixel / (size * tileSize)) * 8 + Math.floor(pixel % size / tileSize)
        tiles[tile] += difference
    }
    return total / first.length <= 4 && Math.sqrt(squared / first.length) <= 6
        && tiles.every(value => value / (tileSize * tileSize * 3) <= 10)
}