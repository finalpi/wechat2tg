import axios from 'axios'
import {config} from '../config'
import {Message} from '../entity/Message'
import {Language} from '../i18n'
import {LogUtils} from '../util/LogUtil'

export class AiReplyService {
    private static instance: AiReplyService
    private logger = LogUtils.config().getLogger('AiReplyService')

    static getInstance(): AiReplyService {
        if (!AiReplyService.instance) {
            AiReplyService.instance = new AiReplyService()
        }
        return AiReplyService.instance
    }

    async generateReplySuggestion(contextMessages: Message[], instruction = '', contextLimit = 20, language: Language = 'zh-CN', selfWxId = ''): Promise<string> {
        if (!config.AI_API_KEY || !config.AI_API_URL) {
            throw new Error('AI is not configured')
        }

        const context = this.formatContext(contextMessages, contextLimit, selfWxId)
        const replyLanguage = language === 'en-US' ? 'English' : '中文'
        const userPrompt = [
            `请根据下面的微信聊天上下文，给出 3 条适合我发送的${replyLanguage}回复建议。`,
            `要求：优先模仿上下文里“我”的语气、用词、句子长短和亲疏程度；自然、简短、符合上下文；如果信息不足，请给出稳妥回复；只输出${replyLanguage}建议列表。`,
            '每条建议只能是消息正文，不要带“我:”“我：”或任何发送者前缀。',
            instruction ? `额外要求：${instruction}` : '',
            '',
            '聊天上下文：',
            context || '(暂无上下文)'
        ].filter(Boolean).join('\n')

        if (config.DEBUG_MODE) {
            this.logger.info(`AI context:\n${context || '(empty)'}`)
            this.logger.info(`AI prompt:\n${userPrompt}`)
        }

        const response = await axios.post(config.AI_API_URL, {
            model: config.AI_MODEL || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `你是微信聊天回复助手。你会学习上下文中“我”的说话方式，并提供可直接发送或稍作修改即可发送的${replyLanguage}回复建议。不要编造不存在的事实，不要使用明显不像“我”的客服腔或过度正式语气。输出的每条建议必须是消息正文，不要包含“我:”或其他发送者标签。`
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

    formatSuggestionsForTelegram(suggestion: string): string {
        return suggestion
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => this.extractSuggestionText(line))
            .filter(Boolean)
            .map(line => `\`${this.escapeMarkdownCode(line)}\``)
            .join('\n')
    }

    private formatContext(messages: Message[], contextLimit: number, selfWxId: string): string {
        return messages
            .slice()
            .filter(message => this.isWechatConversationMessage(message))
            .slice(0, contextLimit)
            .reverse()
            .map(message => {
                const sender = this.getSpeakerLabel(message, selfWxId)
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

    private getSpeakerLabel(message: Message, selfWxId: string): string {
        if (message.sender === '{me}' || (selfWxId && message.wxSenderId === selfWxId)) {
            return '我'
        }

        const sender = this.extractSenderName(message)
        return sender || '未知用户'
    }

    private extractSenderName(message: Message): string {
        const sender = this.stripHtml(String(message.sender || '').trim())
        if (sender) {
            return sender
        }

        if (message.wxSenderId) {
            return message.wxSenderId
        }

        return ''
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

    private stripHtml(text: string): string {
        return text
            .replace(/<[^>]*>/g, '')
            .replace(/[#👤📣🌐]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[:：]+$/g, '')
            .trim()
    }

    private extractSuggestionText(line: string): string {
        return line
            .replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '')
            .replace(/^["“](.*)["”]$/, '$1')
            .trim()
    }

    private escapeMarkdownCode(text: string): string {
        return text.replace(/[`\\]/g, match => `\\${match}`)
    }
}
