import {WebMessageStore} from './message-store'

// Both the WebUI acknowledgement and WeChat callbacks use this durable key.
// A recall is a separate native reply; never edit or delete the saved message.
export async function annotateTelegramRecall(store:WebMessageStore,telegram:any,wxId:string,remoteId:string,chatId:number,original:any,body:string,notice:string,request:(action:()=>Promise<any>)=>Promise<any>=action=>action(),confirm=false){
    const key=`${chatId}:${wxId}:${remoteId}`
    if(!await store.claimRecallNotice(key,confirm)){
        const saved=(await store.all('SELECT status FROM telegram_recalls WHERE key=?',[key]))[0]
        if(saved?.status==='synced')return
        throw new Error('revokeNotificationPending')
    }
    try{
        const replyId=Number(original?.tgBotMsgId)
        await request(()=>telegram.sendMessage(chatId,notice,Number.isSafeInteger(replyId)&&replyId>0?{reply_parameters:{message_id:replyId,allow_sending_without_reply:true}}:undefined))
        await store.run("UPDATE telegram_recalls SET status='synced' WHERE key=?",[key])
    }catch(e){
        // A timed-out notification send may have succeeded: never duplicate it.
        await store.run("UPDATE telegram_recalls SET status=? WHERE key=?",[e?.response?.error_code?'failed':'unknown',key]);throw e
    }
}
