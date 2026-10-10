import {groupApi} from 'wx2tg-puppet/dist/api/GroupApi'
import {msgApi} from 'wx2tg-puppet/dist/api/MsgApi'
import {ResponseMsg} from 'wx2tg-puppet/dist/core/Message'

export interface Mentions {memberIds?:string[];all?:boolean;inline?:boolean}
export interface GroupMember {wxId:string;name:string;nickname:string;displayName:string;hasAvatar:boolean}
const error=(code:string,status=400)=>Object.assign(new Error(code),{code,status})
export function normalizeMentions(input:any):Required<Mentions>{
    if(input===undefined)return {memberIds:[],all:false,inline:false}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['memberIds','all','inline'].includes(k))||(input.all!==undefined&&typeof input.all!=='boolean')||(input.inline!==undefined&&typeof input.inline!=='boolean')||(input.memberIds!==undefined&&(!Array.isArray(input.memberIds)||input.memberIds.length>20||input.memberIds.some(id=>typeof id!=='string'||!id||id.length>128||/[\s,@<>]/.test(id)))))throw error('invalidMentions')
    const memberIds=[...new Set<string>(input.memberIds||[])].sort(),all=input.all===true
    if(all&&memberIds.length)throw error('mentionAllExclusive')
    return {memberIds,all,inline:Boolean((all||memberIds.length)&&input.inline)}
}
const clean=(value:any)=>String(typeof value==='object'?value?.string||'':value||'').replace(/[\r\n\x00-\x1f]/g,' ').trim().slice(0,160)
export function parseGroupMembers(data:any):GroupMember[]{
    const list=data?.NewChatroomData?.ChatRoomMember
    if(!Array.isArray(list))throw error('groupMembersUnavailable',503)
    const members=new Map<string,GroupMember>()
    for(const item of list){
        const wxId=clean(item.UserName),nickname=clean(item.NickName),displayName=clean(item.DisplayName)
        if(!wxId||/[\s,@<>]/.test(wxId))continue
        members.set(wxId,{wxId,name:displayName||nickname||wxId,nickname,displayName,hasAvatar:false})
    }
    return [...members.values()]
}
export function createGroupMentionService(getSelf:()=>string){
    const cache=new Map<string,{at:number,members:GroupMember[]}>(),pending=new Map<string,Promise<GroupMember[]>>()
    const members=async(wxId:string,refresh=false)=>{
        if(!wxId.endsWith('@chatroom'))throw error('mentionsGroupOnly')
        const self=getSelf();if(!self)throw error('wechatOffline',503)
        const key=self+':'+wxId,cached=cache.get(key)
        if(!refresh&&cached&&Date.now()-cached.at<60000)return cached.members
        if(pending.has(key))return pending.get(key)
        const operation=(async()=>{
            try{
                const result=await groupApi.GetChatRoomMemberDetail({QID:wxId,Wxid:self})
                if(result.data.Code!==0)throw error('groupMembersUnavailable',503)
                const list=parseGroupMembers(result.data.Data)
                if(cache.size>=100)cache.delete(cache.keys().next().value)
                cache.set(key,{at:Date.now(),members:list});return list
            }catch(e){throw error(e?.code==='wechatOffline'?'wechatOffline':'groupMembersUnavailable',503)}
        })()
        pending.set(key,operation)
        try{return await operation}finally{pending.delete(key)}
    }
    const resolve=async(wxId:string,text:string,input:Required<Mentions>)=>{
        if(!wxId.endsWith('@chatroom'))throw error('mentionsGroupOnly')
        if(input.all)return {text:input.inline?text:'@所有人 '+text,mentions:{all:true,members:[],inline:input.inline},at:'notify@all'}
        const list=await members(wxId,true),selected=input.memberIds.map(id=>list.find(m=>m.wxId===id))
        if(selected.some(m=>!m))throw error('mentionMemberMissing')
        const content=input.inline?text:selected.map(m=>'@'+m.name).join(' ')+' '+text
        if(content.length>4000)throw error('mentionTextTooLong')
        return {text:content,mentions:{all:false,members:selected,inline:input.inline},at:input.memberIds.join(',')}
    }
    const send=async(wxId:string,text:string,at:string)=>{
        const response=await msgApi.SendTxt({Wxid:getSelf(),ToWxid:wxId,Content:text,At:at,Type:1})
        if(response.data.Code!==0)throw error('wechatSendRejected')
        const payload=response.data.Data?.List?.[0]
        return payload?new ResponseMsg(payload):null
    }
    return {members,resolve,send}
}
