import {extractFull} from 'node-7z'
import * as fs from 'node:fs'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import converter from 'lottie-converter'
import os from 'node:os'

export default class TgsUtils {
    // 需要系统安装 7z
    public static PATH_TO_7ZIP = '7z'

    async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
        width?: number,
        height?: number,
    }) {
        return new Promise<void>((resolve, reject) => {
            const output = outputFile.substring(0, outputFile.lastIndexOf('.'))
            const resultStream = extractFull(inputFile,
                output,
                {
                    cpuAffinity: os.cpus().length.toString(),
                    $bin: TgsUtils.PATH_TO_7ZIP
                })

            resultStream.on('end', async () => {
                try {
                    const tmpFilePath = outputFile.substring(0, outputFile.lastIndexOf('.'))

                    const files = fs.readdirSync(tmpFilePath)
                    if (files.length === 1) {
                        const file = fs.readFileSync(tmpFilePath + '/' + files[0])
                        const converted = await converter({
                            file: file,
                            format: 'gif',
                            ...lottieConfig,
                        })

                        fs.writeFileSync(outputFile, converted, 'base64')
                    } else {
                        // 文件不止一个
                        reject('Tgs file is more than one file')
                    }
                    resolve()
                } catch (error) {
                    reject(error)
                }
            })

            resultStream.on('error', (err) => {
                reject(err)
            })
        })
    }
}