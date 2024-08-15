import {spawn} from 'child_process'
import {LogUtils} from './LogUtils'
import * as fs from 'node:fs'
import WxLimitConstants from '../constant/WxLimitConstant'
import {rename} from 'node-7z'

export default class TgsUtils {
    async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
        width?: number | 128,
        height?: number | 128,
    }) {
        return new Promise((resolve, reject) => {
            const args = ['/usr/bin/lottie_to_gif.sh', '--output', outputFile]
            if (lottieConfig?.height) {
                args.push('--height', lottieConfig.height.toString())
            }
            if (lottieConfig?.width) {
                args.push('--width', lottieConfig.width.toString())
            }
            args.push(inputFile)
            console.log('tgsToGif args: ' + args.join(' '))
            const spawn1 = spawn('bash', args, {
                shell: true
            })
            spawn1.on('exit', code => {
                if (code !== 0) {
                    reject('转换失败')
                    return
                }
                const statSync = fs.statSync(outputFile)
                if (statSync.size > WxLimitConstants.MAX_GIF_SIZE) {
                    // 先删除原始gif文件
                    fs.unlinkSync(outputFile)
                    args.push('--fps', '24')
                    const zoom = 17_000 / fs.statSync(inputFile).size
                    args.push('--quality', Math.floor(70 * zoom).toString())
                    console.log('tgsToGif 第二次转换 args: ' + args.join(' '))
                    spawn('bash', args, {
                        shell: true
                    }).on('exit', code => {
                        if (code !== 0) {
                            reject('转换失败')
                            return
                        }
                        // 修改名字为gif
                        if (fs.statSync(outputFile).size > WxLimitConstants.MAX_GIF_SIZE) {
                            fs.unlinkSync(outputFile)
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

            spawn1.stderr.on('data', (data) => {
                console.log(`stderr: ${data}`)
            })

            spawn1.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`)
            })
        })
    }
}