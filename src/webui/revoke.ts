import {axiosInstance} from 'wx2tg-puppet/dist/utils/axiosInstance'
const error=(code:string,status=400)=>Object.assign(new Error(code),{code,status})
const uint=(value:any)=>{
    const text=String(value??'')
    if(!/^\d{1,20}$/.test(text)||BigInt(text)<1n||BigInt(text)>18446744073709551615n)throw error('revokeUnavailable')
    return text
}
export function revokePolicy(row:any){
    let source:any={};try{source=JSON.parse(row.source||'{}')}catch{}
    let appType=Number(source.AppType)||0
    if(!appType){const match=String(source.Content||source.xml||'').match(/<appmsg\b[^>]*>[\s\S]*?<type>\s*(\d+)\s*<\/type>/);if(match)appType=Number(match[1])}
    const wireType=Number(source.MsgType)||0
    const file=appType===6||(!appType&&(row.type==='file'||row.type==='audio')&&(!wireType||wireType===49))
    const windowSeconds=file?10800:120,createdAt=Number(source.CreateTime||row.timestamp)
    return {windowSeconds,createdAt,deadline:createdAt+windowSeconds}
}
export function revokePayload(row:any,selfId:string){
    if(!row||row.hidden||row.direction!=='outgoing'||row.senderId!==selfId)throw error('revokeOwnOnly',403)
    if(row.status!=='submitted')throw error('revokeUnavailable')
    const policy=revokePolicy(row),now=Date.now()/1000
    if(!Number.isSafeInteger(policy.createdAt)||policy.createdAt<1||policy.createdAt>now+5)throw error('revokeUnavailable')
    if(now>=policy.deadline)throw error('revokeExpired')
    let source:any={};try{source=JSON.parse(row.source||'{}')}catch{}
    const msgId=uint(source.ClientMsgId||source.MsgId),newId=uint(row.remoteId),time=uint(source.CreateTime||row.timestamp)
    // Keep uint64 IDs as raw JSON numbers, avoiding Number precision loss.
    return `{"Wxid":${JSON.stringify(selfId)},"ToUserName":${JSON.stringify(row.wxId)},"ClientMsgId":${msgId},"NewMsgId":${newId},"CreateTime":${time}}`
}
export async function revokeWechat(payload:string){
    try{
        const result=await axiosInstance.post('/Msg/Revoke',payload,{headers:{'Content-Type':'application/json'},transformRequest:[value=>value],timeout:20000})
        const data=result.data,base=data?.Data?.BaseResponse||data?.Data?.baseResponse||data?.Data?.base_response,ret=base?.ret??base?.Ret
        if(data?.Code===0&&ret===0)return
        if(ret!==undefined&&ret!==0)throw error('revokeRejected')
        throw error('revokeUnknown',409)
    }catch(e){
        if(e?.code==='revokeRejected'||e?.code==='revokeUnknown')throw e
        const status=e?.response?.status
        throw error(status>=400&&status<500&&status!==408?'revokeRejected':'revokeUnknown',409)
    }
}
