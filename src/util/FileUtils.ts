import axios, {AxiosRequestConfig} from 'axios'
import {config, useProxy} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'
import {BotMTProtoClient} from '../client/BotMTProtoClient'
import fs from 'node:fs'
import {join} from 'path'
import {LogUtils} from './LogUtil'

export interface LargeFileDownloadProgress {
    downloaded: number
    total: number
    percent: number
}

export class FileUtils {
    private constructor() { //
    }
    private static instance = undefined
    private readonly LARGE_FILE_PROGRESS_LOG_INTERVAL = 5000
    private readonly LARGE_FILE_NO_PROGRESS_TIMEOUT = 60000

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

    static async downloadWithProxy(fileUrl: string, savePath: string): Promise<void> {

        const axiosConfig: AxiosRequestConfig = {
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        }
        if (useProxy) {
            if (config.PROTOCOL === 'http' || config.PROTOCOL === 'https') {
                const agent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.HOST}:${config.PORT}`)
                axiosConfig.httpAgent = agent
                axiosConfig.httpsAgent = agent
            } else if (config.PROTOCOL === 'socks5') {
                const info = {
                    hostname: config.HOST,
                    port: config.PORT,
                    username: config.USERNAME,
                    password: config.PASSWORD
                }
                const agent = new SocksProxyAgent(info)
                axiosConfig.httpAgent = agent
                axiosConfig.httpsAgent = agent
            } else {
                throw new Error('Unsupported proxy protocol')
            }
        }

        try {
            const response = await axios(axiosConfig)
            const writer = fs.createWriteStream(savePath)
            response.data.pipe(writer)
            return new Promise<void>((resolve, reject) => {
                writer.on('finish', resolve)
                writer.on('error', reject)
            })
        } catch (error) {
            console.error('下载文件失败:', error)
            throw error
        }
    }

    public async downloadLargeFile(messageId: number, chatId: string | number, progressCallback?: (progress: LargeFileDownloadProgress) => void | Promise<void>) {
        const logger = LogUtils.config().getLogger('FileUtils')
        const startTime = Date.now()
        let lastProgressTime = Date.now()
        let lastLogTime = 0
        let lastLoggedPercent = -1
        let lastDownloaded = 0
        logger.info(`开始下载 Telegram 大文件: messageId=${messageId}, chatId=${chatId}`)
        const chat = await BotMTProtoClient.getSpyClient('botMTPClient').client.getInputEntity(chatId)
        const messages = await BotMTProtoClient.getSpyClient('botMTPClient').client?.getMessages(chat, {ids: messageId})
        if (messages) {
            const downloadPromise = messages[0].downloadMedia({
                progressCallback: (downloaded: any, fullSize: any) => {
                    const downloadedBytes = Number(downloaded?.toJSNumber?.() ?? downloaded ?? 0)
                    const totalBytes = Number(fullSize?.toJSNumber?.() ?? fullSize ?? 0)
                    lastDownloaded = downloadedBytes
                    lastProgressTime = Date.now()

                    const percent = totalBytes > 0 ? Math.floor(downloadedBytes / totalBytes * 100) : 0
                    void progressCallback?.({
                        downloaded: downloadedBytes,
                        total: totalBytes,
                        percent
                    })
                    const shouldLog = Date.now() - lastLogTime >= this.LARGE_FILE_PROGRESS_LOG_INTERVAL ||
                        percent >= lastLoggedPercent + 5 ||
                        downloadedBytes >= totalBytes
                    if (shouldLog) {
                        lastLogTime = Date.now()
                        lastLoggedPercent = percent
                        logger.info(`Telegram 大文件下载进度: messageId=${messageId}, downloaded=${this.formatBytes(downloadedBytes)}, total=${totalBytes ? this.formatBytes(totalBytes) : 'unknown'}, progress=${totalBytes ? `${percent}%` : 'unknown'}`)
                    }
                }
            })
            const timeoutPromise = new Promise<never>((_, reject) => {
                const interval = setInterval(() => {
                    if (Date.now() - lastProgressTime > this.LARGE_FILE_NO_PROGRESS_TIMEOUT) {
                        clearInterval(interval)
                        reject(new Error(`Telegram large file download no progress for ${this.LARGE_FILE_NO_PROGRESS_TIMEOUT}ms, downloaded=${this.formatBytes(lastDownloaded)}`))
                    }
                }, 5000)
                downloadPromise.finally(() => clearInterval(interval)).catch(() => undefined)
            })
            const buffer = await Promise.race([downloadPromise, timeoutPromise])
            const size = Buffer.isBuffer(buffer) ? buffer.length : Buffer.byteLength(buffer || '')
            logger.info(`Telegram 大文件下载完成: messageId=${messageId}, size=${this.formatBytes(size)}, cost=${Date.now() - startTime}ms`)
            return buffer
        }
        logger.warn(`Telegram 大文件下载失败: 未找到消息 messageId=${messageId}, chatId=${chatId}`)
    }

    private formatBytes(bytes: number): string {
        if (!bytes) {
            return '0B'
        }

        const units = ['B', 'KB', 'MB', 'GB']
        const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
        return `${(bytes / Math.pow(1024, index)).toFixed(2)}${units[index]}`
    }

    static async downloadBufferWithProxy(fileUrl: string): Promise<Buffer> {
        const axiosConfig: AxiosRequestConfig = {
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        }
        if (useProxy) {
            if (config.PROTOCOL === 'http' || config.PROTOCOL === 'https') {
                const agent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.HOST}:${config.PORT}`)
                axiosConfig.httpAgent = agent
                axiosConfig.httpsAgent = agent
            } else if (config.PROTOCOL === 'socks5') {
                const info = {
                    hostname: config.HOST,
                    port: config.PORT,
                    username: config.USERNAME,
                    password: config.PASSWORD
                }
                const agent = new SocksProxyAgent(info)
                axiosConfig.httpAgent = agent
                axiosConfig.httpsAgent = agent
            } else {
                throw new Error('Unsupported proxy protocol')
            }
        }

        try {
            const response = await axios({
                ...axiosConfig,
                responseType: 'arraybuffer'
            })
            const buffer = Buffer.from(response.data)
            return new Promise<Buffer>(resolve => resolve(buffer))
        } catch (error) {
            console.error('下载文件失败:', error)
            throw error
        }
    }

    static joinURL = (...parts) => {
        // 过滤掉空值（null、undefined 或空字符串），并且去除每个部分的开头和结尾的斜杠
        const validParts = parts.filter(part => part).map(part => part.replace(/^\/+|\/+$/g, ''))
        // 使用 '/' 拼接所有有效部分
        return validParts.join('/')
    }

    static saveFile(buff: Buffer,fileName: string) {
        const staticUrl = 'save-files'
        const tempname = '_temp'
        const proxyUrl = config.CALLBACK_API
        const tempDir = join(staticUrl, tempname)
        // 检查 temp 目录是否存在，如果不存在则创建
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir)
        }
        // 构建目标文件的路径
        const destPath = join(tempDir, fileName)
        // 复制文件到 temp 目录
        fs.writeFileSync(destPath, buff)
        const url = FileUtils.joinURL(proxyUrl, tempname, fileName)
        const t = setTimeout(() => {
            // 删除文件
            fs.unlink(destPath, (err) => {
                if (err) {
                    console.error('删除文件时出错:', err)
                } else {
                    console.log(`文件 ${destPath} 已删除`)
                }
            })
            clearTimeout(t)
        }, 1000 * 60 * 5)
        return url
    }
}
