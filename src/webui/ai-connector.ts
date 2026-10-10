import axios from 'axios'

const fail=(code:string,status=400)=>Object.assign(new Error(code),{code,status,connectorError:true})
export function aiEndpoints(value:string) {
    let url:URL
    try{url=new URL(value)}catch{throw fail('aiInvalidURL')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail('aiInvalidURL')
    const base=url.pathname.replace(/\/+$/,'')
    const completions=new URL(url.href),models=new URL(url.href)
    if(base.endsWith('/chat/completions')){models.pathname=base.slice(0,-'/chat/completions'.length)+'/models'}
    else{completions.pathname=base+'/chat/completions';models.pathname=base+'/models'}
    completions.hash=models.hash=''
    return {completions:completions.href,models:models.href,origin:url.origin}
}
export function createAIConnector(current:()=>{url:string;key:string;model:string},transport=axios) {
    let working=false
    return async(action:string,input:any)=>{
        if(working)throw fail('aiBusy',429)
        if(!['models','test'].includes(action)||!input||typeof input!=='object')throw fail('invalidRequest')
        for(const key of ['url','key','model'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>4096))throw fail('invalidRequest')
        const saved=current(),endpoints=aiEndpoints(input.url||saved.url),key=input.key||saved.key
        if(!input.key&&saved.key&&saved.url&&endpoints.origin!==aiEndpoints(saved.url).origin)throw fail('aiKeyForNewProvider')
        const options={headers:{...(key?{Authorization:`Bearer ${key}`}:{})},timeout:30000,maxRedirects:0,maxContentLength:2*1024*1024}
        working=true
        const started=Date.now()
        try {
            if(action==='models'){
                const response=await transport.get(endpoints.models,options)
                const values=response.data?.data||response.data?.models||[]
                if(!Array.isArray(values))throw fail('aiInvalidModels',502)
                const models=[...new Set(values.map(m=>typeof m==='string'?m:m?.id||m?.name).filter(m=>typeof m==='string'&&m.length<=200))].sort().slice(0,2000)
                return {models,elapsedMs:Date.now()-started}
            }
            const model=input.model||saved.model
            if(!model||model.length>200)throw fail('aiModelRequired')
            let response
            const body={model,messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:128}
            try{response=await transport.post(endpoints.completions,body,options)}catch(error){
                if(error?.response?.status===400&&/max_tokens.*(?:not supported|unsupported)|(?:not supported|unsupported).*max_tokens/i.test(String(error.response?.data?.error?.message||''))){
                    const {max_tokens,...rest}=body
                    response=await transport.post(endpoints.completions,{...rest,max_completion_tokens:128},options)
                }else throw error
            }
            const reply=response.data?.choices?.[0]?.message?.content
            return {ok:true,model,elapsedMs:Date.now()-started,reply:typeof reply==='string'?reply.slice(0,500):'',emptyReply:!reply}
        }catch(error){
            if(error?.connectorError)throw error
            const status=error?.response?.status
            if(status===401||status===403)throw fail('aiUnauthorized',502)
            if(status===404)throw fail('aiEndpointMissing',502)
            if(status===429)throw fail('aiRateLimited',502)
            if(status===400)throw fail('aiRequestRejected',502)
            throw fail('aiConnectionFailed',502)
        }finally{working=false}
    }
}
