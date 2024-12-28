import axios from 'axios'
import {config} from '../config'

export class OpenAIService {
    private readonly _apiKey: string
    private readonly _host: string
    private readonly _model: string
    private readonly _systemPrompt: string

    constructor(_apiKey: string,_host: string,_model: string) {
        this._apiKey = _apiKey
        this._host = _host
        this._model = _model
        this._systemPrompt = config.OPENAI_SYSTEM_PROMPT
    }

    public async callOpenAI(prompt: string) {
        const url = `${this._host}/v1/chat/completions`

        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._apiKey}`,
        }
        const messages = []
        if (this._systemPrompt) {
            messages.push({ role: 'system', content: this._systemPrompt })
        }
        messages.push({ role: 'user', content: prompt })
        const body = {
            model: this._model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 150,
        }

        try {
            const response = await axios.post(url, body, { headers })
            return response.data.choices[0].message.content
        } catch (error) {
            console.error('Error calling OpenAI API:', error)
            throw error
        }
    }
}