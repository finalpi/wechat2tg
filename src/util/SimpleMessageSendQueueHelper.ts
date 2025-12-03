import {config} from '../config'

export class SimpleMessageSendQueueHelper {
    private sendFunction: (...args) => Promise<any>
    private interval: number
    private messageQueue: SendMessageWarps[] = []
    private loopTime = 503
    private processFlag = false
    // 消息最大重试次数，从配置读取，0 表示无限重试
    private messageMaxRetries = config.SEND_TO_WX_MAX_RETRIES
    // 添加定时器引用管理
    private processInterval: NodeJS.Timeout | null = null

    constructor(sendFunction: (...args) => Promise<any>, interval: number) {
        this.sendFunction = sendFunction
        this.interval = interval
        this.startSend()
        console.log(`[SimpleMessageSendQueueHelper] 初始化完成，最大重试次数: ${this.messageMaxRetries === 0 ? '无限' : this.messageMaxRetries}`)
    }

    public addMessageWithMsgId(msgId: number, ...message: any): void {
        const sendMessage = {
            success: false,
            time: new Date(),
            message: message,
            sending: false,
            msg_id: msgId,
            retries_number: 0
        }
        let left = 0
        let right = this.messageQueue.length - 1
        while (left <= right) {
            const mid = left + Math.floor((right - left) / 2)
            if (this.messageQueue[mid].msg_id < msgId) {
                left = mid + 1
            } else {
                right = mid - 1
            }
        }
        this.messageQueue.splice(left, 0, sendMessage)
    }

    private startSend(): void {
        this.processInterval = setInterval(async () => {
            await this.processQueue()
        }, this.loopTime)
    }

    private async processQueue(): Promise<void> {
        if (this.messageQueue.length > 0 && !this.processFlag) {
            this.processFlag = true
            const sendMessage = this.messageQueue.shift()
            if (sendMessage && sendMessage.success !== true && sendMessage.sending !== true) {
                sendMessage.sending = true
                try {
                    // 使用 await 确保发送完成后再处理下一条消息
                    await this.sendFunction(...sendMessage.message)
                    sendMessage.success = true
                    sendMessage.sending = false
                    sendMessage.message = []
                } catch (e) {
                    console.error('消息发送失败:', e)
                    sendMessage.success = false
                    sendMessage.sending = false

                    // 检查是否是网络超时错误（这种情况消息可能已经发送成功）
                    const isTimeoutError = e.code === 'ETIMEDOUT' ||
                                          e.code === 'ECONNRESET' ||
                                          e.code === 'ESOCKETTIMEDOUT' ||
                                          (e.message && e.message.includes('timeout'))

                    // 只有非超时错误才重试，超时错误可能消息已发送成功
                    // messageMaxRetries === 0 表示无限重试
                    const shouldRetry = this.messageMaxRetries === 0 || sendMessage.retries_number < this.messageMaxRetries
                    if (!isTimeoutError && shouldRetry) {
                        sendMessage.retries_number++
                        // 延迟重试，避免立即重试，最大延迟 30 秒
                        const delay = Math.min(2000 * sendMessage.retries_number, 30000)
                        console.log(`[SimpleMessageSendQueueHelper] 消息发送失败，${delay}ms 后重试 (${sendMessage.retries_number}/${this.messageMaxRetries === 0 ? '∞' : this.messageMaxRetries}): msg_id=${sendMessage.msg_id}`)
                        setTimeout(() => {
                            this.messageQueue.push(sendMessage)
                        }, delay)
                    } else if (isTimeoutError) {
                        console.warn(`[SimpleMessageSendQueueHelper] 消息可能已发送（超时），跳过重试: msg_id=${sendMessage.msg_id}`)
                    } else {
                        console.error(`[SimpleMessageSendQueueHelper] 消息重试次数已达上限，放弃发送: msg_id=${sendMessage.msg_id}`)
                    }
                }
            } else if (sendMessage && !sendMessage.success && sendMessage.time.getTime() + this.interval < new Date().getTime()) {
                this.messageQueue.push(sendMessage)
            }
            // 在异步操作完成后才重置标志
            this.processFlag = false
        }
    }

    /**
     * 获取队列统计信息
     */
    getQueueStats(): {
        queueLength: number
        isProcessing: boolean
        hasInterval: boolean
    } {
        return {
            queueLength: this.messageQueue.length,
            isProcessing: this.processFlag,
            hasInterval: this.processInterval !== null
        }
    }

    /**
     * 清空队列
     */
    clearQueue(): void {
        const count = this.messageQueue.length
        this.messageQueue = []
        console.log(`已清空发送队列，删除了 ${count} 条消息`)
    }

    /**
     * 停止定时器并清理资源
     */
    destroy(): void {
        console.log('正在销毁SimpleMessageSendQueueHelper...')

        // 清理定时器
        if (this.processInterval) {
            clearInterval(this.processInterval)
            this.processInterval = null
        }

        // 清空队列
        this.clearQueue()

        // 重置处理标志
        this.processFlag = false

        console.log('SimpleMessageSendQueueHelper已销毁')
    }
}

export interface SendMessageWarps {
    success: boolean,
    sending: boolean,
    time: Date,
    message: any[],
    msg_id?: number,
    // 重试次数
    retries_number: number
}