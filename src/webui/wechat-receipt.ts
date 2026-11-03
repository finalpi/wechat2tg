import {AsyncLocalStorage} from 'node:async_hooks'
import {axiosInstance} from 'wx2tg-puppet/dist/utils/axiosInstance'

type NativeReceipt={newMsgId:string;msgId:string;createTime?:number;toWxid?:string}
const receipts=new AsyncLocalStorage<Map<string,NativeReceipt>>()
let observing=false
const id=(value:any)=>{
    if(typeof value==='number'&&!Number.isSafeInteger(value))return ''
    const text=String(value??'')
    return /^[1-9]\d{0,19}$/.test(text)&&BigInt(text)<=18446744073709551615n?text:''
}
const clientId=(value:any)=>{
    const positive=id(value)
    if(positive)return positive
    if(typeof value==='number'&&!Number.isSafeInteger(value))return ''
    const raw=String(value??'')
    if(!/^-\d+$/.test(raw))return ''
    const signed=BigInt(raw)
    return signed>=-2147483648n&&signed<0n?String(Number(signed)>>>0):''
}
function observe(){
    if(observing)return
    axiosInstance.interceptors.response.use(response=>{
        const scope=receipts.getStore()
        if(!scope)return response
        try{
            if(new URL(response.config.url,'http://localhost').pathname!=='/Msg/SendApp'||response.data?.Code!==0)return response
            const data=response.data.Data,items=Array.isArray(data?.List)?data.List:[data]
            for(const item of items.slice(0,4)){
                const newMsgId=id(item?.NewMsgId??item?.newMsgId??item?.Newmsgid),msgId=clientId(item?.MsgId??item?.Msgid??item?.msgId)
                if(!newMsgId||!msgId||scope.size>=4)continue
                const time=Number(item.CreateTime??item.Createtime??item.createTime)
                const peer=item.ToUserName?.string||item.ToUsetName?.string||item.toUserName||(typeof item.ToUserName==='string'?item.ToUserName:'')
                scope.set(newMsgId,{newMsgId,msgId,...(Number.isFinite(time)&&time>0?{createTime:Math.floor(time)}:{}),...(typeof peer==='string'&&peer?{toWxid:peer}:{})})
            }
        }catch{}
        // Observe only: the SDK must receive exactly its original response.
        return response
    })
    observing=true
}

/** Recover SendApp's numeric server MsgId lost by the SDK's ResponseMsg wrapper.
 * Only calls inside this async scope participate; concurrent sends stay separate.
 */
export async function withNativeWechatReceipt<T>(send:()=>Promise<T>):Promise<T>{
    try{observe()}catch{return send()}
    const scope=new Map<string,NativeReceipt>()
    const result:any=await receipts.run(scope,send)
    const native=scope.get(id(result?.newMsgId))
    if(!native)return result
    return Object.assign(Object.create(Object.getPrototypeOf(result)),result,{msgId:native.msgId,createTime:result.createTime||native.createTime,toWxid:result.toWxid||native.toWxid})
}
