import path from 'node:path'
import {AppDataSource,getGeWeChatDataSource} from '../data-sourse'
import {AbstractClient} from '../base/BaseClient'
import {BindGroup} from '../entity/BindGroup'
import {OfficialAccountTopic} from '../entity/OfficialAccountTopic'
import {WxRoom} from '../entity/WxRoom'
import {sendSolitaireCreate,sendSolitaireJoin,solitaireCreateBody,solitaireJoinBody} from '../service/SolitaireService'
import type {MessageCenterAdapter} from '../webui/messages'
import {settingsPath} from '../webui/store'
import {AutomationAdapter,AutomationScope,scopeKey} from './contracts'
import {AutomationEngine} from './engine'
import {listenAutomations} from './events'

export function createAutomationAdapter(messages:MessageCenterAdapter):AutomationAdapter {
    const wx = ():any => AbstractClient.getSpyClient('wxClient')
    const bot = ():any => AbstractClient.getSpyClient('botClient')
    return {
        async scopes() {
            const out:Array<AutomationScope & {name:string}> = []
            const accountId = String(wx()?.wxInfo?.wxid || '')
            if(wx()?.hasLogin && accountId) {
                const rooms = getGeWeChatDataSource().isInitialized ? await getGeWeChatDataSource().getRepository(WxRoom).find() : []
                for(const room of rooms)out.push({source:'wechat',accountId,groupId:room.chatroomId,name:room.remark || room.nickName || room.chatroomId})
                const bindings = await AppDataSource.getRepository(BindGroup).find()
                for(const binding of bindings)if(binding.wxId?.endsWith('@chatroom'))out.push({source:'wechat',accountId,groupId:binding.wxId,name:binding.alias || binding.name || binding.wxId})
            }
            const telegramId = String(bot()?.client?.botInfo?.id || '')
            if(bot()?.hasLogin && telegramId) {
                for(const binding of await AppDataSource.getRepository(BindGroup).find())if(binding.chatId < 0)out.push({source:'telegram',accountId:telegramId,groupId:String(binding.chatId),name:binding.alias || binding.name || String(binding.chatId)})
                for(const topic of await AppDataSource.getRepository(OfficialAccountTopic).find())if(topic.status === 'ready' && topic.threadId)out.push({source:'telegram',accountId:telegramId,groupId:String(topic.chatId),topicId:String(topic.threadId),name:topic.name + ' · 话题'})
            }
            return [...new Map(out.map(scope=>[scopeKey(scope),scope])).values()].slice(0,2000)
        },
        async execute(action,event,requestId) {
            const target = action.kind === 'send' ? action.target : event
            if(target.source === 'wechat') {
                if(!wx()?.hasLogin || wx().wxInfo?.wxid !== target.accountId)return {status:'rejected'}
                if(action.kind === 'solitaire.join' || action.kind === 'solitaire.create') {
                    if(!target.groupId.endsWith('@chatroom'))return {status:'rejected'}
                    const body = action.kind === 'solitaire.join'
                        ? solitaireJoinBody({wxid:target.accountId,toWxid:target.groupId,content:action.entry,newMsgId:event.solitaire?.messageId})
                        : solitaireCreateBody({wxid:target.accountId,toWxid:target.groupId,title:action.title,content:action.entry,tail:action.tail})
                    const result = await (action.kind === 'solitaire.join' ? sendSolitaireJoin(body) : sendSolitaireCreate(body))
                    return {status:result.status === 'joined' ? 'success' : result.status === 'rejected' ? 'rejected' : 'unknown'}
                }
                await messages.send(target.groupId,action.text,requestId)
                // Reuse the journal and its receipts; a queued send is NOT success.
                const deadline = Date.now() + 15000
                while(Date.now() < deadline) {
                    const row:any = await messages.sendStatus(requestId)
                    if(row.status === 'submitted')return {status:'success'}
                    if(row.status === 'failed')return {status:'rejected'}
                    if(row.status === 'unknown')return {status:'unknown'}
                    await new Promise(resolve=>setTimeout(resolve,200))
                }
                return {status:'unknown'}
            }
            if(!bot()?.hasLogin || String(bot().client?.botInfo?.id) !== target.accountId)return {status:'rejected'}
            try {
                await bot().client.telegram.sendMessage(target.groupId,action.text,{
                    ...(target.topicId ? {message_thread_id:Number(target.topicId)} : {}),
                    ...(action.kind === 'reply' ? {reply_parameters:{message_id:Number(event.id),allow_sending_without_reply:true}} : {}),
                })
                return {status:'success'}
            } catch(error) {
                return {status:error?.response?.error_code >= 400 && error?.response?.error_code < 500 && ![408,429].includes(error.response.error_code) ? 'rejected' : 'unknown'}
            }
        },
    }
}
export function createLiveAutomation(messages:MessageCenterAdapter) {
    const engine = new AutomationEngine(path.join(path.dirname(settingsPath()),'automations.json'),createAutomationAdapter(messages))
    listenAutomations(event=>engine.receive(event))
    return engine
}