import axios from 'axios'
import {config} from '../config'
import {Message} from '../entity/Message'
import {Language} from '../i18n'

export class AiReplyService {
    private static instance: AiReplyService

    static getInstance(): AiReplyService {
        if (!AiReplyService.instance) {
            AiReplyService.instance = new AiReplyService()
        }
        return AiReplyService.instance
    }

    async generateReplySuggestion(contextMessages: Message[], instruction = '', contextLimit = 20, language: Language = 'zh-CN'): Promise<string> {
        if (!config.AI_API_KEY || !config.AI_API_URL) {
            throw new Error('AI is not configured')
        }

        const context = this.formatContext(contextMessages, contextLimit)
        const replyLanguage = language === 'en-US' ? 'English' : '中文'
        const userPrompt = [
            `请根据下面的微信聊天上下文，给出 3 条适合我发送的${replyLanguage}回复建议。`,
            `要求：自然、简短、符合上下文；如果信息不足，请给出稳妥回复；只输出${replyLanguage}建议列表。`,
            instruction ? `额外要求：${instruction}` : '',
            '',
            '聊天上下文：',
            context || '(暂无上下文)'
        ].filter(Boolean).join('\n')

        const response = await axios.post(config.AI_API_URL, {
            model: config.AI_MODEL || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `你是微信聊天回复助手。你只提供可直接发送或稍作修改即可发送的${replyLanguage}回复建议，不要编造不存在的事实。`
                },
                {
                    role: 'user',
                    content: userPrompt
                }
            ],
            temperature: 0.7,
            max_tokens: 800
        }, {
            headers: {
                Authorization: `Bearer ${config.AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        })

        const content = response.data?.choices?.[0]?.message?.content
        if (!content) {
            throw new Error('AI response is empty')
        }
        return content.trim()
    }

    private formatContext(messages: Message[], contextLimit: number): string {
        return messages
            .slice()
            .filter(message => this.isWechatConversationMessage(message))
            .slice(0, contextLimit)
            .reverse()
            .map(message => {
                const sender = message.sender || message.wxSenderId || 'unknown'
                const content = this.getMessageContent(message)
                return `${sender}: ${content}`
            })
            .filter(line => line.trim().length > 0)
            .join('\n')
    }

    private isWechatConversationMessage(message: Message): boolean {
        if (!message) {
            return false
        }

        const content = String(message.content || '').trim()
        if (content.startsWith('/')) {
            return false
        }

        return Boolean(message.wxMsgId || message.msgId || message.source_text || message.sender === '{me}')
    }

    private getMessageContent(message: Message): string {
        if (message.type === 0 && message.content) {
            return String(message.content).slice(0, 1000)
        }

        if (message.content) {
            return `[${this.getMessageTypeName(message.type)}] ${String(message.content).slice(0, 200)}`
        }

        return `[${this.getMessageTypeName(message.type)}]`
    }

    private getMessageTypeName(type: number): string {
        switch (type) {
            case 1:
                return '媒体/文件'
            case 4:
                return '名片'
            case 5:
                return '位置'
            case 6:
                return '撤回'
            default:
                return '消息'
        }
    }
}
