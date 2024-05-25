import ffmpegStatic from 'ffmpeg-static'
import * as fs from 'node:fs'
import TgsUtils from './TgsUtils'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpeg = require('fluent-ffmpeg')


export class ConverterHelper {
    constructor() {
        // 设置 ffmpeg-static 的路径
        ffmpeg.setFfmpegPath(ffmpegStatic)
    }

    async webmToGif(inputFile: string | Buffer, outputFile: string): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(inputFile)
                // .outputOptions('-vf', 'fps=16,scale=360:-1')
                .format('gif')
                .saveToFile(outputFile)
                .on('end', () => {
                    console.log('file has been converted successfully')
                    resolve()
                })
                .on('error', (error: Error) => {
                    console.error('an error happened: ' + error.message)
                    reject(error)
                })
        })
    }

    async tgsToGif(inputFile: string | Buffer, outputFile: string, lottie_config?: {
        width?: number,
        height?: number
    }): Promise<void> {
        if (typeof inputFile === 'string') {
            return new TgsUtils().tgsToGif(inputFile, outputFile, lottie_config)
                .then(() => {
                    // 这里删除临时文件
                    const tmpFile = outputFile.substring(0, outputFile.lastIndexOf('.'))
                    fs.unlinkSync(tmpFile)
                })
        }
        throw new Error('Input file must be a string')
    }
}