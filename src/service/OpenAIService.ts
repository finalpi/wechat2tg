import axios from 'axios'
import {config} from '../config'
import {SocksProxyAgent} from 'socks-proxy-agent'
import {HttpsProxyAgent} from 'https-proxy-agent'

export class OpenAIService {
    private readonly _apiKey: string
    private readonly _host: string
    private readonly _model: string
    private readonly _systemPrompt: string
    private readonly _maxTokens: number
    private readonly _temperature: number

    constructor(_apiKey: string,_host: string,_model: string) {
        this._apiKey = _apiKey
        this._host = _host
        this._model = _model
        this._systemPrompt = config.OPENAI_SYSTEM_PROMPT
        this._maxTokens = config.OPENAI_MAX_TOKENS
        this._temperature = config.OPENAI_TEMPERATURE
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
            temperature: this._temperature,
            max_tokens: this._maxTokens,
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const axiosConfig: axios.AxiosRequestConfig = { headers }
        // 使用代理
        if (config.PROTOCOL === 'socks5' && config.HOST !== '' && config.PORT !== '') {
            const info = {
                hostname: config.HOST,
                port: config.PORT,
                username: config.USERNAME,
                password: config.PASSWORD
            }
            const socksAgent = new SocksProxyAgent(info)
            axiosConfig.httpsAgent = socksAgent
            axiosConfig.httpAgent = socksAgent
        } else if ((config.PROTOCOL === 'http' || config.PROTOCOL === 'https') && config.HOST !== '' && config.PORT !== '') {
            const httpAgent = new HttpsProxyAgent(`${config.PROTOCOL}://${config.USERNAME}:${config.PASSWORD}@${config.HOST}:${config.PORT}`)
            axiosConfig.httpsAgent = httpAgent
            axiosConfig.httpAgent = httpAgent
        }

        try {
            const response = await axios.post(url, body, axiosConfig)
            return response.data.choices[0].message.content
        } catch (error) {
            console.error('Error calling OpenAI API:', error)
            throw error
        }
    }
}