import sharp from 'sharp'

export class ImageUtils {
    public async compressPicture(buff: Buffer): Promise<Buffer> {
        try {
            const image = sharp(buff)
            const metadata = await image.metadata()

            // 检查宽度是否大于 1200px，如果是，则调整宽度为 1200px
            if ((metadata.width && metadata.width > 1200) || (metadata.height && metadata.height > 1200)) {
                if (metadata.width > metadata.height) {
                    return await image
                        .resize({width: 1200})
                        .toBuffer()
                } else {
                    return await image
                        .resize({height: 1200})
                        .toBuffer()
                }
            } else {
                return buff
            }
        } catch (error) {
            console.error('Error processing image:', error)
            throw error
        }
    }
}