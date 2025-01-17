import axios from 'axios'

export class FileUtils {
    private constructor() { //
    }
    private static instance = undefined

    static getInstance(): FileUtils {
        if (!FileUtils.instance) {
            FileUtils.instance = new FileUtils()
        }
        return FileUtils.instance
    }
    async downloadUrl2Buffer(url): Promise<Buffer> {
        const response = await axios.get(url, { responseType: 'arraybuffer' })
        const buff = Buffer.from(response.data)
        return buff
    }
}