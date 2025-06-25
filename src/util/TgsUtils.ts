import {spawn} from 'child_process'
import * as fs from 'node:fs'
import WxLimitConstants from '../constant/WxLimitConstant'

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
            // console.log('tgsToGif args: ' + args.join(' '))
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
                    args.push('--fps', '24')
                    const zoom = 17_000 / fs.statSync(inputFile).size
                    let quality = Math.floor(70 * zoom)
                    if (quality < 0) {
                        quality = 1
                    } else if (quality > 100) {
                        quality = 99
                    }
                    args.push('--quality', quality.toString())
                    // console.log('tgsToGif 第二次转换 args: ' + args.join(' '))
                    spawn('bash', args, {
                        shell: true
                    }).on('exit', code => {
                        if (code !== 0) {
                            // 失败去删除第一次的gif文件
                            fs.unlinkSync(outputFile)
                            reject('转换失败')
                            return
                        }
                        // 修改名字为gif
                        if (fs.statSync(outputFile).size > WxLimitConstants.MAX_GIF_SIZE) {
                            const minQuality = 10
                            const minFps = 8
                            const minWidth = 32
                            const minHeight = 32
                            let curQuality = quality
                            let curFps = 24
                            let curWidth = lottieConfig?.width || 128
                            let curHeight = lottieConfig?.height || 128

                            const compressLoop = async (): Promise<string> => {
                                // 删除上一次的输出
                                if (fs.existsSync(outputFile)) {
                                    fs.unlinkSync(outputFile)
                                }
                                const loopArgs = ['/usr/bin/lottie_to_gif.sh', '--output', outputFile, '--quality', curQuality.toString(), '--fps', curFps.toString(), '--width', curWidth.toString(), '--height', curHeight.toString(), inputFile]
                                // console.log('tgsToGif 第三次及以后循环 args: ' + loopArgs.join(' '))
                                await new Promise<void>((resolveSpawn, rejectSpawn) => {
                                    const res = spawn('bash', loopArgs, { shell: true })
                                    res.on('exit', code2 => {
                                        if (code2 !== 0) {
                                            if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
                                            rejectSpawn('转换失败')
                                            return
                                        }
                                        resolveSpawn()
                                    })
                                    res.on('error', (error) => {
                                        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
                                        rejectSpawn(error)
                                    })
                                })
                                if (fs.statSync(outputFile).size <= WxLimitConstants.MAX_GIF_SIZE) {
                                    return outputFile
                                } else {
                                    if (curQuality > minQuality) {
                                        curQuality -= 10
                                    } else if (curFps > minFps) {
                                        curFps -= 2
                                    } else if (curWidth > minWidth && curHeight > minHeight) {
                                        curWidth = Math.floor(curWidth * 0.8)
                                        curHeight = Math.floor(curHeight * 0.8)
                                    } else {
                                        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
                                        throw new Error('不能压缩gif到1MB以下')
                                    }
                                    return compressLoop()
                                }
                            }
                            compressLoop().then(resolvedFile => {
                                resolve(resolvedFile)
                            }).catch(err => {
                                reject(typeof err === 'string' ? err : (err?.message || '压缩失败'))
                            })
                        } else {
                            resolve(outputFile)
                        }
                    }).on('error', (error) => {
                        // 失败去删除第一次的gif文件
                        fs.unlinkSync(outputFile)
                        reject(error)
                    })
                } else {
                    resolve(outputFile)
                }
            }).on('error', (error) => {
                reject(error)
            })
        })
    }
}