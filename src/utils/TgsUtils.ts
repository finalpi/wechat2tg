// // @ts-ignore
// import converter from 'lottie-converter'
// // eslint-disable-next-line @typescript-eslint/no-var-requires
// const _7z = require('7zip-min')
// // eslint-disable-next-line @typescript-eslint/no-var-requires
// const renderLottie = require('puppeteer-lottie')
import {spawn} from 'child_process'
import {LogUtils} from './LogUtils'

export default class TgsUtils {
    // async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
    //     width?: number,
    //     height?: number,
    // }) {
    //     return new Promise<void>((resolve, reject) => {
    //         const output = outputFile.substring(0, outputFile.lastIndexOf('.'))
    //         // 解压文件
    //         _7z.unpack(inputFile, output, async (err: any) => {
    //             // done
    //             if (!err) {
    //                 try {
    //                     const tmpFilePath = outputFile.substring(0, outputFile.lastIndexOf('.'))
    //
    //                     const files = fs.readdirSync(tmpFilePath)
    //                     if (files.length === 1) {
    //                         // const file = fs.readFileSync(tmpFilePath + '/' + files[0])
    //                         // const converted = await converter({
    //                         //     file: file,
    //                         //     format: 'gif',
    //                         //     ...lottieConfig,
    //                         // })
    //                         const browser = await puppeteer.launch({
    //                             args: ['--no-sandbox', '--disable-setuid-sandbox']
    //                         })
    //                         await renderLottie({
    //                             path: path.resolve(tmpFilePath + '/' + files[0]),
    //                             output: outputFile,
    //                             ...lottieConfig,
    //                             browser: browser
    //                         })
    //
    //                         // fs.writeFileSync(outputFile, converted, 'base64')
    //                         let stats = fs.statSync(outputFile)
    //                         let fileSizeInBytes = stats.size
    //
    //                         if (fileSizeInBytes > 1024 * 1024) {
    //                             await renderLottie({
    //                                 path: path.resolve(tmpFilePath + '/' + files[0]),
    //                                 output: outputFile,
    //                                 width: 200,
    //                                 height: lottieConfig.height / lottieConfig.width * 200,
    //                                 browser: browser
    //                             })
    //                             stats = fs.statSync(outputFile)
    //                             fileSizeInBytes = stats.size
    //                             if (fileSizeInBytes > 1024 * 1024) {
    //                                 await renderLottie({
    //                                     path: path.resolve(tmpFilePath + '/' + files[0]),
    //                                     output: outputFile,
    //                                     width: 100,
    //                                     height: lottieConfig.height / lottieConfig.width * 100,
    //                                     browser: browser
    //                                 })
    //                             }
    //                         }
    //                         await browser.close()
    //                     } else {
    //                         // 文件不止一个
    //                         reject('Tgs file is more than one file')
    //                     }
    //                     resolve()
    //                 } catch (error) {
    //                     reject(error)
    //                 }
    //             } else {
    //                 reject(err)
    //             }
    //         })
    //     })
    // }

    async tgsToGif(inputFile: string, outputFile: string, lottieConfig?: {
        width?: number | 100,
        height?: number | 100,
    }) {
        return new Promise((resolve, reject) => {
            const args = []
            if (lottieConfig?.height) {
                args.push('--height', lottieConfig.height.toString())
            }
            if (lottieConfig?.width) {
                args.push('--width', lottieConfig.width.toString())
            }
            args.push(inputFile)
            console.log('tgsToGif args: ' + args.join(' '))
            spawn('tgs_to_gif', args).on('exit', () => {
                resolve(outputFile.replace('.tgs', ''))
            }).on('error', (error) => {
                reject(error)
                LogUtils.config().getLogger('error').error('tgsToGif happened: ' + error.message)
            })
        })
    }
}