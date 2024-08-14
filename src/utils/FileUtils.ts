import axios, {AxiosRequestConfig} from 'axios'
import * as fs from 'fs'
import {config, useProxy} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'

export class FileUtils {

    static async downloadWithProxy(fileUrl: string, savePath: string): Promise<void> {

        const axiosConfig: AxiosRequestConfig = {
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        }
        if (useProxy) {
            if (config.PROTOCOL === 'http' || config.PROTOCOL === 'https') {
                axiosConfig.proxy = {
                    host: config.HOST,
                    port: Number.parseInt(config.PORT),
                    auth: {
                        username: config.USERNAME,
                        password: config.PASSWORD
                    }
                }
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

    static async downloadBufferWithProxy(fileUrl: string): Promise<Buffer> {
        const axiosConfig: AxiosRequestConfig = {
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        }
        if (useProxy) {
            if (config.HOST !== '' && config.PROTOCOL === 'http' || config.PROTOCOL === 'https') {
                axiosConfig.proxy = {
                    host: config.HOST,
                    port: Number.parseInt(config.PORT),
                    auth: {
                        username: config.USERNAME,
                        password: config.PASSWORD
                    }
                }
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

    static async deleteFile(filePath: string) {
        try {
            // 使用 fs.promises.unlink() 方法删除文件
            await fs.promises.unlink(filePath)
            console.log(`Successfully deleted file: ${filePath}`)
        } catch (err) {
            console.error(`Error deleting file: ${filePath}`, err)
            throw err // 抛出错误以便上层处理
        }
    }
}