export class SimpleMessageSendQueueHelper {
    private sendFunction: (...args) => Promise<any>
    private interval: number
    private messageQueue: SendMessageWarps[] = []
    private loopTime = 503
    private processFlag = false
    // 消息最大重试次数
    private messageMaxRetries = 2

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
        setInterval(async () => {
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