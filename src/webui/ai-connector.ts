import axios from 'axios'
import {AI_PROMPT} from '../automation/contracts'

const fail = (code:string,status = 400) => Object.assign(new Error(code),{code,status,connectorError:true})
export function aiEndpoints(value:string) {
    try {
        const url = new URL(value)
        if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw fail('aiInvalidURL')
        const base = url.pathname.replace(/\/+$/,'')
        const completions = new URL(url.href),models = new URL(url.href)
        if (base.endsWith('/chat/completions')) models.pathname = base.slice(0,-'/chat/completions'.length) + '/models'
        else {completions.pathname = base + '/chat/completions';models.pathname = base + '/models'}
        completions.hash = models.hash = ''
        return {completions:completions.href,models:models.href,origin:url.origin}
    } catch {throw fail('aiInvalidURL')}
}
export function createAIConnector(current:()=>{url:string;key:string;model:string},transport = axios) {
    let working = false
    return async(action:string,input:any) => {
        if (working) throw fail('aiBusy',429)
        if (!['models','test','script'].includes(action) || !input || typeof input !== 'object') throw fail('invalidRequest')
        for (const key of ['url','key','model']) if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 4096)) throw fail('invalidRequest')
        if (action === 'script' && (typeof input.requirement !== 'string' || !input.requirement.trim() || input.requirement.length > 4000 || ['url','key','model'].some(key=>input[key] !== undefined))) throw fail('invalidRequest')
        const saved = current(),endpoints = aiEndpoints(input.url || saved.url),key = input.key || saved.key
        if (!input.key && saved.key && saved.url && endpoints.origin !== aiEndpoints(saved.url).origin) throw fail('aiKeyForNewProvider')
        const options = {headers:{...(key ? {Authorization:`Bearer ${key}`} : {})},timeout:action === 'script' ? 45000 : 30000,maxRedirects:0,maxContentLength:2 * 1024 * 1024}
        working = true
        const started = Date.now()
        try {
            if (action === 'models') {
                const response = await transport.get(endpoints.models,options)
                const values = response.data?.data || response.data?.models || []
                if (!Array.isArray(values)) throw fail('aiInvalidModels',502)
                const models = [...new Set(values.map(m=>typeof m === 'string' ? m : m?.id || m?.name).filter(m=>typeof m === 'string' && m.length <= 200))].sort().slice(0,2000)
                return {models,elapsedMs:Date.now() - started}
            }
            const model = input.model || saved.model
            if (!model || model.length > 200) throw fail('aiModelRequired')
            const body = {model,messages:action === 'script'
                ? [{role:'system',content:AI_PROMPT},{role:'user',content:input.requirement}]
                : [{role:'user',content:'Reply with exactly OK.'}],max_tokens:action === 'script' ? 4096 : 128}
            let response
            try {response = await transport.post(endpoints.completions,body,options)} catch (error) {
                if (error?.response?.status === 400 && /max_tokens.*(?:not supported|unsupported)|(?:not supported|unsupported).*max_tokens/i.test(String(error.response?.data?.error?.message || ''))) {
                    const alternate:any = {...body,max_completion_tokens:body.max_tokens}
                    delete alternate.max_tokens
                    response = await transport.post(endpoints.completions,alternate,options)
                } else throw error
            }
            const reply = response.data?.choices?.[0]?.message?.content
            if (action === 'script') {
                if (typeof reply !== 'string' || !reply.trim() || Buffer.byteLength(reply) > 24000) throw fail('aiInvalidScript',502)
                const source = reply.trim().replace(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/,'$1')
                if (Buffer.byteLength(source) > 20000) throw fail('aiInvalidScript',502)
                // Return a draft only. Never publish, simulate or enable AI output.
                return {source,model,elapsedMs:Date.now() - started}
            }
            return {ok:true,model,elapsedMs:Date.now() - started,reply:typeof reply === 'string' ? reply.slice(0,500) : '',emptyReply:!reply}
        } catch (error) {
            if (error?.connectorError) throw error
            const status = error?.response?.status
            if (status === 401 || status === 403) throw fail('aiUnauthorized',502)
            if (status === 404) throw fail('aiEndpointMissing',502)
            if (status === 429) throw fail('aiRateLimited',502)
            if (status === 400) throw fail('aiRequestRejected',502)
            throw fail('aiConnectionFailed',502)
        } finally {working = false}
    }
}