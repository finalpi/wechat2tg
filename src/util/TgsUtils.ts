import {spawn} from 'child_process'
import {LogUtils} from './LogUtils'
import * as fs from 'node:fs'
import WxLimitConstants from '../constant/WxLimitConstant'

export default class TgsUtils {
    async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
        width?: number | 128,
        height?: number | 128,
    }) {
        return new Promise((resolve, reject) => {
            const args = ['--output', outputFile]
            if (lottieConfig?.height) {
                args.push('--height', lottieConfig.height.toString())
            }
            if (lottieConfig?.width) {
                args.push('--width', lottieConfig.width.toString())
            }
            args.push(inputFile)
            console.log('tgsToGif args: ' + args.join(' '))
            spawn('tgs_to_gif', args).on('exit', () => {
                const statSync = fs.statSync(outputFile)
                if (statSync.size > WxLimitConstants.MAX_GIF_SIZE) {
                    // 先删除原始gif文件
                    fs.unlinkSync(outputFile)
                    const zoom = statSync.size / 1024 / 1024
                    args.push('--quality', '70')
                    args.push('--fps', '24')
                    console.log('tgsToGif 第二次转换 args: ' + args.join(' '))
                    spawn('tgs_to_gif', args).on('exit', () => {
                        if (fs.statSync(outputFile).size > WxLimitConstants.MAX_GIF_SIZE) {
                            reject('不能压缩gif到1MB以下')
                        } else {
                            resolve(outputFile)
                        }
                    }).on('error', (error) => {
                        reject(error)
                        LogUtils.config().getLogger('error').error('tgsToGif happened: ' + error.message)
                    })
                } else {
                    resolve(outputFile)
                }
            }).on('error', (error) => {
                reject(error)
                LogUtils.config().getLogger('error').error('tgsToGif happened: ' + error.message)
            })
        })
    }
}