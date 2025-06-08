export class SimpleMessageSendQueueHelper {
    private sendFunction: (...args) => Promise<any>
    private interval: number
    private messageQueue: SendMessageWarps[] = []
    private loopTime = 503
    private processFlag = false
    // 消息最大重试次数
    private messageMaxRetries = 2
    // 添加定时器引用管理
    private processInterval: NodeJS.Timeout | null = null

    constructor(sendFunction: (...args) => Promise<any>, interval: number) {
        this.sendFunction = sendFunction
        this.interval = interval
        this.startSend()
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
                this.sendFunction(...sendMessage.message).then(() => {
                    sendMessage.success = true
                    sendMessage.sending = false
                    sendMessage.message = []
                }).catch(async e => {
                    console.error(e)
                    sendMessage.success = false
                    sendMessage.sending = false
                    if (sendMessage.retries_number < this.messageMaxRetries) {
                        sendMessage.retries_number++
                        this.messageQueue.push(sendMessage)
                    }
                }).finally(() => {
                    sendMessage.sending = false
                })
            } else if (!sendMessage.success && sendMessage.time.getTime() + this.interval < new Date().getTime()) {
                this.messageQueue.push(sendMessage)
            }
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