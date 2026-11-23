import {setTimeout as pause} from 'node:timers/promises'
import type {MomentsArchive,MomentsContact} from './MomentsArchive'
import {downloadMomentPhotos,fetchMomentsPage} from './WechatMoments'
import type {MomentsSession} from './WechatMoments'

export function momentsScope(session:MomentsSession) {return JSON.stringify([session.owner,session.account])}
export type MomentsCheckpoint = {cursor?:string;md5:string}
export type MomentsSyncResult = {saved:number;missingPhotos:number;complete:boolean;tip:string;checkpoint:MomentsCheckpoint}
type Options = {fetchPage?:typeof fetchMomentsPage;photos?:typeof downloadMomentPhotos;pageDelay?:number;maxPages?:number;checkpoint?:MomentsCheckpoint}

export async function syncMoments(archive:MomentsArchive,session:MomentsSession,contact:MomentsContact,
    mode:'all'|'daily',active:()=>Promise<boolean>,options:Options = {}):Promise<MomentsSyncResult> {
    const {cursor:initialCursor,md5:initialMd5} = options.checkpoint ?? {md5:''}
    const result:MomentsSyncResult = {saved:0,missingPhotos:0,complete:false,tip:'',checkpoint:{cursor:initialCursor,md5:initialMd5}}
    const scope = momentsScope(session),deadline = Date.now() + 15 * 60 * 1000
    const canContinue = async()=>Date.now() < deadline && await active() && (mode === 'all' || await archive.enabled(scope,contact.id))
    let cursor = initialCursor,md5 = initialMd5
    for(let pageNo = 0;pageNo < (options.maxPages ?? 200);pageNo++) {
        if(!await canContinue())break
        if(pageNo && options.pageDelay !== 0)await pause(options.pageDelay ?? 400)
        if(!await canContinue())break
        const page = await (options.fetchPage || fetchMomentsPage)(session,contact.id,cursor,md5)
        if(page.tip)result.tip = page.tip
        md5 = page.md5 || md5
        let hadNew = false
        for(const post of page.posts) {
            if(!await canContinue())return result
            if(post.target !== contact.id || await archive.has(scope,contact.id,post.id))continue
            hadNew = true
            const images = await (options.photos || downloadMomentPhotos)(post,canContinue)
            if(!await canContinue())return result
            if(await archive.save(scope,post,images,mode === 'all')) {
                result.saved++
                result.missingPhotos += Math.max(0,post.photos.length - images.length)
            }
        }
        if(!page.next || page.next === cursor || (mode === 'daily' && !hadNew)) {
            result.complete = true
            break
        }
        cursor = page.next
        result.checkpoint = {cursor,md5}
    }
    return result
}