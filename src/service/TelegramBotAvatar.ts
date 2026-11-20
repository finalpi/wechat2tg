import {readFile} from 'node:fs/promises'
import path from 'node:path'
import type {Telegram} from 'telegraf'

// Bundled image; startup never needs to fetch another bot's profile.
export function defaultBotAvatar():Promise<Buffer> {
    return readFile(path.join(__dirname,'../assets/bot-avatar.jpg'))
}

const pending = new WeakMap<Telegram,Promise<'kept'|'set'>>()
export function ensureDefaultBotAvatar(telegram:Telegram,botId:number):Promise<'kept'|'set'> {
    const existing = pending.get(telegram)
    if(existing)return existing
    const operation = (async()=>{
        const photos = await telegram.getUserProfilePhotos(botId,0,1)
        // Fail closed on an incomplete response. Never replace a configured avatar.
        if(!photos || photos.total_count !== 0)return 'kept' as const
        const image = await defaultBotAvatar()
        const current = await telegram.getUserProfilePhotos(botId,0,1)
        if(!current || current.total_count !== 0)return 'kept' as const
        // The pinned Telegraf predates InputProfilePhoto. Explicit attach://
        // multipart fields avoid serializing a Buffer inside the JSON photo.
        const result = await telegram.callApi('setMyProfilePhoto' as any,{
            photo:JSON.stringify({type:'static',photo:'attach://avatar'}),
            avatar:{source:image,filename:'wechat2tg-avatar.jpg'},
        } as any)
        if(result !== true)throw new Error('Default Bot avatar was not confirmed')
        return 'set' as const
    })()
    pending.set(telegram,operation)
    void operation.finally(()=>pending.delete(telegram)).catch(()=>undefined)
    return operation
}