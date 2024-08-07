import * as fs from 'node:fs'
// @ts-ignore
import converter from 'lottie-converter'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _7z = require('7zip-min')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const renderLottie = require('puppeteer-lottie')
import path from 'node:path'

export default class TgsUtils {
    async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
        width?: number,
        height?: number,
    }) {
        return new Promise<void>((resolve, reject) => {
            const output = outputFile.substring(0, outputFile.lastIndexOf('.'))
            // 解压文件
            _7z.unpack(inputFile, output, async (err: any) => {
                // done
                if (!err) {
                    try {
                        const tmpFilePath = outputFile.substring(0, outputFile.lastIndexOf('.'))

                        const files = fs.readdirSync(tmpFilePath)
                        if (files.length === 1) {
                            // const file = fs.readFileSync(tmpFilePath + '/' + files[0])
                            // const converted = await converter({
                            //     file: file,
                            //     format: 'gif',
                            //     ...lottieConfig,
                            // })
                            await renderLottie({
                                path: path.resolve(tmpFilePath + '/' + files[0]),
                                output: outputFile,
                                ...lottieConfig,
                            })

                            // fs.writeFileSync(outputFile, converted, 'base64')
                            const stats = fs.statSync(outputFile)
                            const fileSizeInBytes = stats.size

                            if (fileSizeInBytes > 1024 * 1024) {
                                await renderLottie({
                                    path: path.resolve(tmpFilePath + '/' + files[0]),
                                    output: outputFile,
                                    width: 100,
                                    height: 100
                                })

                                // fs.writeFileSync(outputFile, converted, 'base64')
                            }
                        } else {
                            // 文件不止一个
                            reject('Tgs file is more than one file')
                        }
                        resolve()
                    } catch (error) {
                        reject(error)
                    }
                } else {
                    reject(err)
                }
            })
        })
    }
}