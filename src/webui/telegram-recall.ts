import {WebMessageStore} from './message-store'

// Both the WebUI acknowledgement and WeChat callbacks use this durable key.
export async function annotateTelegramRecall(store:WebMessageStore,telegram:any,wxId:string,remoteId:string,chatId:number,original:any,body:string,notice:string,request:(action:()=>Promise<any>)=>Promise<any>=action=>action(),confirm=false){
    const key=`${chatId}:${wxId}:${remoteId}`
    if(!await store.claimRecallNotice(key,confirm)){
        const saved=(await store.all('SELECT status FROM telegram_recalls WHERE key=?',[key]))[0]
        if(saved?.status==='synced')return
        throw new Error('revokeNotificationPending')
    }
    try{
        let fallback=!original?.tgBotMsgId
        if(!fallback){
            try{
                const text=[body,`<i>${notice}</i>`].filter(Boolean).join('\n\n')
                if(original.type===1)await request(()=>telegram.editMessageCaption(chatId,original.tgBotMsgId,undefined,text,{parse_mode:'HTML'}))
                else await request(()=>telegram.editMessageText(chatId,original.tgBotMsgId,undefined,text,{parse_mode:'HTML'}))
            }catch(e){
                const description=String(e?.response?.description||'')
                if(/message is not modified/i.test(description)){}
                else if(e?.response?.error_code===400)fallback=true
                else throw e
            }
        }
        if(fallback)await request(()=>telegram.sendMessage(chatId,notice,original?.tgBotMsgId?{reply_parameters:{message_id:original.tgBotMsgId,allow_sending_without_reply:true}}:undefined))
        await store.run("UPDATE telegram_recalls SET status='synced' WHERE key=?",[key])
    }catch(e){
        // A timed-out notification send may have succeeded: never duplicate it.
        await store.run("UPDATE telegram_recalls SET status=? WHERE key=?",[e?.response?.error_code?'failed':'unknown',key]);throw e
    }
}
