import BaseMessage from '../base/BaseMessage'
import {LogUtils} from './LogUtil'

interface BufferedMessage {
    id: string
    message: BaseMessage
    timestamp: number
    retryCount: number
    status: 'pending' | 'sent' | 'failed'
}

export class MessageBufferService {
    private static instance: MessageBufferService
    private messageBuffer: Map<string, BufferedMessage> = new Map()
    private readonly MAX_RETRY_COUNT = 3
    private readonly RETRY_DELAY = 5000 // 5秒
    private readonly BUFFER_CLEANUP_INTERVAL = 60000 // 1分钟
    private readonly MESSAGE_EXPIRE_TIME = 300000 // 5分钟
    private logger = LogUtils.config().getLogger('MessageBuffer')
    
    // 添加定时器引用管理
    private cleanupInterval: NodeJS.Timeout | null = null
    private retryTimeouts: Map<string, NodeJS.Timeout> = new Map()
    private deleteTimeouts: Map<string, NodeJS.Timeout> = new Map()

    private constructor() {
        // 定期清理过期消息
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredMessages()
        }, this.BUFFER_CLEANUP_INTERVAL)
    }

    static getInstance(): MessageBufferService {
        if (!MessageBufferService.instance) {
            MessageBufferService.instance = new MessageBufferService()
        }
        return MessageBufferService.instance
    }

    /**
     * 将消息添加到缓冲区
     */
    addMessage(message: BaseMessage): string {
        const messageId = this.generateMessageId(message)
        const bufferedMessage: BufferedMessage = {
            id: messageId,
            message,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending'
        }

        this.messageBuffer.set(messageId, bufferedMessage)
        return messageId
    }

    /**
     * 标记消息为已发送
     */
    markMessageAsSent(messageId: string): void {
        const bufferedMessage = this.messageBuffer.get(messageId)
        if (bufferedMessage) {
            bufferedMessage.status = 'sent'
            
            // 清理可能存在的重试定时器
            const retryTimeout = this.retryTimeouts.get(messageId)
            if (retryTimeout) {
                clearTimeout(retryTimeout)
                this.retryTimeouts.delete(messageId)
            }
            
            // 发送成功后，延迟删除消息（防止重复发送）
            const deleteTimeout = setTimeout(() => {
                this.messageBuffer.delete(messageId)
                this.deleteTimeouts.delete(messageId)
            }, 10000) // 10秒后删除
            
            this.deleteTimeouts.set(messageId, deleteTimeout)
        }
    }

    /**
     * 标记消息发送失败并尝试重发
     */
    markMessageAsFailed(messageId: string, sendCallback: (message: BaseMessage) => Promise<boolean>): void {
        const bufferedMessage = this.messageBuffer.get(messageId)
        if (!bufferedMessage) return

        bufferedMessage.retryCount++
        bufferedMessage.status = 'failed'

        if (bufferedMessage.retryCount <= this.MAX_RETRY_COUNT) {
            this.logger.warn(`消息发送失败，准备重试 (${bufferedMessage.retryCount}/${this.MAX_RETRY_COUNT}): ${messageId}`)

            // 指数退避重试
            const retryDelay = this.RETRY_DELAY * Math.pow(2, bufferedMessage.retryCount - 1)

            const retryTimeout = setTimeout(async () => {
                try {
                    bufferedMessage.status = 'pending'
                    const success = await sendCallback(bufferedMessage.message)
                    if (success) {
                        this.markMessageAsSent(messageId)
                    } else {
                        this.markMessageAsFailed(messageId, sendCallback)
                    }
                } catch (error) {
                    this.logger.error(`重试发送消息失败: ${messageId}`, error)
                    this.markMessageAsFailed(messageId, sendCallback)
                } finally {
                    this.retryTimeouts.delete(messageId)
                }
            }, retryDelay)
            
            // 存储定时器引用
            this.retryTimeouts.set(messageId, retryTimeout)
        } else {
            this.logger.error(`消息重试次数已达上限，标记为永久失败: ${messageId}`)
            bufferedMessage.status = 'failed'
            // 可以选择将失败消息保存到数据库或文件
            this.saveFailedMessage(bufferedMessage)
        }
    }

    /**
     * 获取待重发的消息
     */
    getPendingMessages(): BufferedMessage[] {
        return Array.from(this.messageBuffer.values()).filter(
            msg => msg.status === 'pending' || msg.status === 'failed'
        )
    }

    /**
     * 获取缓冲区统计信息
     */
    getBufferStats(): {
        total: number
        pending: number
        sent: number
        failed: number
        activeTimeouts: number
    } {
        const messages = Array.from(this.messageBuffer.values())
        return {
            total: messages.length,
            pending: messages.filter(m => m.status === 'pending').length,
            sent: messages.filter(m => m.status === 'sent').length,
            failed: messages.filter(m => m.status === 'failed').length,
            activeTimeouts: this.retryTimeouts.size + this.deleteTimeouts.size
        }
    }

    /**
     * 重新发送所有失败的消息
     */
    async retryFailedMessages(sendCallback: (message: BaseMessage) => Promise<boolean>): Promise<void> {
        const failedMessages = Array.from(this.messageBuffer.values()).filter(
            msg => msg.status === 'failed' && msg.retryCount < this.MAX_RETRY_COUNT
        )

        this.logger.info(`开始重发 ${failedMessages.length} 条失败消息`)

        for (const bufferedMessage of failedMessages) {
            try {
                bufferedMessage.status = 'pending'
                const success = await sendCallback(bufferedMessage.message)
                if (success) {
                    this.markMessageAsSent(bufferedMessage.id)
                } else {
                    this.markMessageAsFailed(bufferedMessage.id, sendCallback)
                }
                // 添加延迟避免发送过快
                await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (error) {
                this.logger.error(`重发消息失败: ${bufferedMessage.id}`, error)
                this.markMessageAsFailed(bufferedMessage.id, sendCallback)
            }
        }
    }

    private generateMessageId(message: BaseMessage): string {
        return `${message.chatId}_${message.id}_${Date.now()}`
    }

    private cleanupExpiredMessages(): void {
        const now = Date.now()
        let cleanupCount = 0

        for (const [messageId, bufferedMessage] of this.messageBuffer.entries()) {
            if (now - bufferedMessage.timestamp > this.MESSAGE_EXPIRE_TIME) {
                // 清理相关的定时器
                const retryTimeout = this.retryTimeouts.get(messageId)
                if (retryTimeout) {
                    clearTimeout(retryTimeout)
                    this.retryTimeouts.delete(messageId)
                }
                
                const deleteTimeout = this.deleteTimeouts.get(messageId)
                if (deleteTimeout) {
                    clearTimeout(deleteTimeout)
                    this.deleteTimeouts.delete(messageId)
                }
                
                this.messageBuffer.delete(messageId)
                cleanupCount++
            }
        }

        if (cleanupCount > 0) {
            this.logger.info(`清理了 ${cleanupCount} 条过期消息和相关定时器`)
        }
    }

    private saveFailedMessage(bufferedMessage: BufferedMessage): void {
        // 可以将失败的消息保存到文件或数据库中，供后续分析
        this.logger.error(`永久失败的消息: ${JSON.stringify({
            id: bufferedMessage.id,
            chatId: bufferedMessage.message.chatId,
            content: bufferedMessage.message.content?.substring(0, 100),
            type: bufferedMessage.message.type,
            retryCount: bufferedMessage.retryCount
        })}`)
    }

    /**
     * 清空缓冲区并清理所有定时器
     */
    clearBuffer(): void {
        const count = this.messageBuffer.size
        
        // 清理所有重试定时器
        for (const timeout of this.retryTimeouts.values()) {
            clearTimeout(timeout)
        }
        this.retryTimeouts.clear()
        
        // 清理所有删除定时器
        for (const timeout of this.deleteTimeouts.values()) {
            clearTimeout(timeout)
        }
        this.deleteTimeouts.clear()
        
        // 清理消息缓冲区
        this.messageBuffer.clear()
        
        this.logger.info(`已清空缓冲区，删除了 ${count} 条消息和所有相关定时器`)
    }

    /**
     * 销毁服务，清理所有资源
     */
    destroy(): void {
        this.logger.info('正在销毁MessageBufferService...')
        
        // 清理主清理定时器
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
            this.cleanupInterval = null
        }
        
        // 清理所有消息和定时器
        this.clearBuffer()
        
        // 重置实例
        MessageBufferService.instance = undefined
        
        this.logger.info('MessageBufferService已销毁')
    }
}