import ffmpegStatic from 'ffmpeg-static'
import * as fs from 'node:fs'
import TgsUtils from './TgsUtils'
import WxLimitConstants from '../constant/WxLimitConstant'
import sharp from 'sharp'
import {FileBox} from 'file-box'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpeg = require('fluent-ffmpeg')

export class ConverterHelper {
    constructor() {
        // 设置 ffmpeg-static 的路径
        ffmpeg.setFfmpegPath(ffmpegStatic)
    }

    async webpToGif(inputFile: string | Buffer, outputFile: string): Promise<void> {
        try {
            const info = await sharp(inputFile)
                .toFormat('gif')
                .toFile(outputFile)
            console.log('Conversion finished!', info)
            fs.unlinkSync(inputFile)
        } catch (err) {
            console.error('Error during conversion:', err)
            throw err
        }
    }

    async oggToMp3(inputFile: string | Buffer, outputFile: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            // 使用 ffmpeg 处理转换
            ffmpeg(inputFile)
                .inputFormat('ogg')  // 指定输入格式为 OGG
                .outputFormat('mp3') // 指定输出格式为 MP3
                .on('error', (err) => {
                    reject(`Error during conversion: ${err.message}`)
                })
                .on('end', () => {
                    console.log('Conversion finished!')
                    const fb = FileBox.fromFile(outputFile)
                    fb.toBuffer().then(buffer => {
                        fs.unlinkSync(inputFile)
                        fs.unlinkSync(outputFile)
                        resolve(buffer) // 转换完成后 resolve
                    })
                })
                .save(outputFile) // 将转换后的 MP3 保存为指定文件
        })
    }

    async webmToGif(inputFile: string | Buffer, outputFile: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const convert = (resolution: number, fps: number) => {
                let scale = 'scale=iw:-1:flags=lanczos'
                if (resolution < 410) {
                    scale = `scale=${resolution}:-1:flags=lanczos`
                }
                ffmpeg()
                    .input(inputFile)
                    .outputOptions('-vf', `fps=${fps},${scale}`)
                    .format('gif')
                    .save(outputFile)
                    .on('end', () => {
                        console.log('file has been converted successfully')
                        const stats = fs.statSync(outputFile)
                        const fileSizeInBytes = stats.size

                        if (fileSizeInBytes > WxLimitConstants.MAX_GIF_SIZE) {
                            console.log(`文件大小 ${fileSizeInBytes} 超过 1MB，重新调整参数`)
                            if (resolution > 100 && fps > 1) {
                                // 递归调用，降低分辨率和帧率
                                convert(resolution - 50, fps - 1)
                            } else {
                                reject(new Error('无法将文件压缩到 1MB 以下'))
                            }
                        } else {
                            console.log(`文件大小 ${fileSizeInBytes} 满足要求`)
                            fs.unlinkSync(inputFile)
                            resolve()
                        }
                    })
                    .on('error', (error: Error) => {
                        console.error('an error happened: ' + error.message)
                        reject(error)
                    })
            }

            // 初始参数
            const initialResolution = 360 + 50
            const initialFps = 16 + 1

            // 开始转换
            convert(initialResolution, initialFps)
        })
    }

    async tgsToGif(inputFile: string | Buffer, outputFile: string, lottie_config?: {
        width?: number,
        height?: number
    }): Promise<void> {
        if (typeof inputFile === 'string') {
            return new TgsUtils().tgsToGif(inputFile, outputFile, lottie_config)
                .then(() => {
                    fs.unlink(inputFile, (err) => {
                        if (err) throw err
                    })
                }).catch((err) => {
                    throw err
                })
        }
        throw new Error('Input file must be a string')
    }

    extractThumbnail(videoPath, outputImage, time = '00:00:01') {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [time], // 指定时间点（默认1秒处）
                    filename: outputImage,
                    folder: './',
                    size: '320x?' // 限制宽度，高度自适应
                })
                .on('end', () => resolve(outputImage))
                .on('error', (err) => reject(err))
        })
    }

    getVideoDuration(videoPath): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath).ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(Math.floor(metadata.format.duration)) // 获取时长（单位：秒）
                }
            })
        })
    }
}