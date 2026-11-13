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
