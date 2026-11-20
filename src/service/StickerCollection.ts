import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

export type StickerMedia = {fileId:string;size?:number;kind:'static'|'video'|'animated';threadId?:number}
type Item = {set:string;uniqueId:string;status:'pending'|'done'}
type State = {messages:Record<string,StickerMedia>;items:Record<string,Item>;packs:Record<string,number>}
export type StickerCollectionApi = {
    call(method:string,payload:Record<string,unknown>):Promise<any>
    prepare(media:StickerMedia):Promise<{source:Buffer;format:'static'|'video';digest:string;trimmed:boolean}>
}

export function stickerMedia(message:any):StickerMedia|undefined {
    // Telegram includes a legacy document alongside animation (usually MP4).
    // Only apply the document MIME allowlist when using a standalone document.
    const primary = message?.sticker || message?.animation || message?.photo?.at(-1)
    const media = primary || message?.document
    if(!media?.file_id)return
    const mime = media.mime_type || ''
    if(!primary && !['image/png','image/jpeg','image/webp','image/gif','video/webm'].includes(mime))return
    const kind = message.sticker?.is_animated ? 'animated' : message.sticker?.is_video || message.animation || ['image/gif','video/webm'].includes(mime) ? 'video' : 'static'
    return {fileId:media.file_id,size:media.file_size,kind,threadId:message.message_thread_id}
}

export class StickerCollection {
    private state:State
    private queue:Promise<unknown> = Promise.resolve()
    private queued = 0
    constructor(private file:string,private api:StickerCollectionApi) {
        if(fs.existsSync(file)) {
            try {
                this.state = JSON.parse(fs.readFileSync(file,'utf8'))
                if(!this.state.messages || !this.state.items || !this.state.packs)throw new Error('invalid collection state')
            } catch {throw new Error('收藏记录损坏或不可读，请先恢复备份，不能覆盖原记录。')}
        } else this.state = {messages:{},items:{},packs:{}}
    }
    private save() {
        fs.mkdirSync(path.dirname(this.file),{recursive:true})
        const temporary = `${this.file}.${process.pid}.tmp`
        fs.writeFileSync(temporary,JSON.stringify(this.state),{mode:0o600})
        fs.renameSync(temporary,this.file)
    }
    remember(botId:number,message:any) {
        const media = stickerMedia(message)
        if(!media || !message.chat?.id || !message.message_id)return
        const key = `${botId}:${message.chat.id}:${message.message_id}`
        this.state.messages[key] = media
        const keys = Object.keys(this.state.messages)
        for(const old of keys.slice(0,Math.max(0,keys.length - 5000)))delete this.state.messages[old]
        this.save()
    }
    lookup(botId:number,chatId:number,messageId:number) {return this.state.messages[`${botId}:${chatId}:${messageId}`]}
    collect(bot:{id:number;username:string},owner:number,media:StickerMedia) {
        if(this.queued >= 8)return Promise.reject(new Error('收藏队列已满，请稍后再试。'))
        this.queued++
        const operation = this.queue.then(()=>this.run(bot,owner,media))
        this.queue = operation.catch(()=>undefined)
        return operation.finally(()=>{this.queued--})
    }
    private async getSet(name:string):Promise<any|undefined> {
        try {return await this.api.call('getStickerSet',{name})}
        catch(error) {
            if(error?.response?.error_code === 400 && /STICKERSET_INVALID/.test(error.response.description || ''))return
            throw error
        }
    }
    private async run(bot:{id:number;username:string},owner:number,media:StickerMedia) {
        if(!Number.isSafeInteger(owner) || owner <= 0 || !/^[a-zA-Z0-9_]+bot$/i.test(bot.username))throw new Error('无法确定贴纸包主人或 Bot 用户名。')
        const prepared = await this.api.prepare(media)
        const scope = `${bot.id}:${owner}`,key = `${scope}:${prepared.digest}`
        const previous = this.state.items[key]
        if(previous) {
            if(previous.status === 'pending') {
                const pack = await this.getSet(previous.set)
                if(!pack?.stickers?.some((sticker:any)=>sticker.file_unique_id === previous.uniqueId))
                    throw new Error('上次收藏结果尚未确认，已停止重复上传；请检查贴纸包后再试。')
                previous.status = 'done'
                this.save()
            }
            return {url:`https://t.me/addstickers/${previous.set}`,duplicate:true,trimmed:prepared.trimmed}
        }
        let index = this.state.packs[scope] || 1
        let name:string,pack:any
        for(let attempts = 0; attempts < 100; attempts++,index++) {
            // Short hash keeps the full name within Telegram's 64-character limit.
            const ownerKey = createHash('sha256').update(scope).digest('hex').slice(0,12)
            name = `wx_${ownerKey}_${index}_by_${bot.username}`
            if(name.length > 64)throw new Error('贴纸包名称过长。')
            pack = await this.getSet(name)
            if(!pack || pack.stickers.length < 120)break
            if(attempts === 99)throw new Error('贴纸包数量异常，请检查已有收藏包。')
        }
        const uploaded = await this.api.call('uploadStickerFile',{user_id:owner,sticker:{source:prepared.source,filename:prepared.format === 'video' ? 'sticker.webm' : 'sticker.png'},sticker_format:prepared.format})
        const item:Item = {set:name,uniqueId:uploaded.file_unique_id,status:'pending'}
        this.state.items[key] = item
        this.state.packs[scope] = index
        this.save() // Persist intent before a remotely visible mutation; never blindly retry it.
        const sticker = {sticker:uploaded.file_id,format:prepared.format,emoji_list:['🙂']}
        try {
            if(pack)await this.api.call('addStickerToSet',{user_id:owner,name,sticker})
            else await this.api.call('createNewStickerSet',{user_id:owner,name,title:`微信收藏 ${String(index).padStart(2,'0')}`,stickers:[sticker],sticker_type:'regular'})
        } catch(error) {
            // Only a definite API rejection permits another mutation on the next request.
            if(error?.response?.error_code >= 400 && error.response.error_code < 500) {
                delete this.state.items[key]
                this.save()
            }
            throw new Error('收藏未完成，可能是权限、限流或网络问题。结果未知时不会自动重复添加，请稍后重试检查。')
        }
        item.status = 'done'
        this.save()
        return {url:`https://t.me/addstickers/${name}`,duplicate:false,trimmed:prepared.trimmed}
    }
}