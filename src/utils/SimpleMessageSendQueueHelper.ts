import { promisify } from 'util'

const sleep = promisify(setTimeout)

export class SimpleMessageSendQueueHelper {
    private sendFunction: (...args   ) => Promise<any>
    private interval: number
    private messageQueue: SendMessageWarps[] = []

    constructor(sendFunction: (...args) => Promise<any>, interval: number) {
        this.sendFunction = sendFunction
        this.interval = interval
        this.startSend()
    }

    public addMessage(...message: any): void {
        const sendMessage = {
            msgId: new Date().getTime(),
            success: false,
            time: new Date(),
            message: message,
        }
        this.messageQueue.push(sendMessage)
    }

    private  startSend(): void {
        setInterval(async () => {
            await this.processQueue()
        }, this.interval)
    }

    private async processQueue(): Promise<void> {
        while (this.messageQueue.length > 0) {
            const sendMessage = this.messageQueue.shift()
            if (sendMessage && sendMessage.success !== true) {
               await this.sendFunction(...sendMessage.message).then(() => {
                        sendMessage.success = true
                }).catch(() => {
                    this.sendFunction(...sendMessage.message).then(() => {
                        sendMessage.success = true
                    })
                })
                await sleep(this.interval)
            } else if (!sendMessage.success && sendMessage.time.getTime() + this.interval * 10 < new Date().getTime()){
                this.messageQueue.push(sendMessage)
            }
        }

    }
}

export interface SendMessageWarps {
    msgId: number | string,
    success: boolean,
    time: Date,
    message: any[],
}