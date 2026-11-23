import {randomBytes} from 'node:crypto'
import type {Context,Telegraf} from 'telegraf'
import {MomentsArchive,MomentsContact} from './MomentsArchive'
import {downloadMomentPhotos,fetchMomentsPage,momentsContactId} from './WechatMoments'
import type {Moment,MomentsSession} from './WechatMoments'
import {articleMessageRejected} from '../util/TelegramArticleMessage'
import {momentsScope as scope,syncMoments} from './MomentsSync'
import type {MomentsCheckpoint} from './MomentsSync'
import {getTelegramThreadId} from '../util/TelegramTopicUtils'

type Button = {text:string;callback_data:string}
type Online = {kind:'online';contact:MomentsContact;remaining:Moment[];cursor?:string;md5:string;tip:string}
type Reader = {kind:'archive';contact:MomentsContact;offset:number}
type Picker = {kind:'pick';contacts:MomentsContact[];mode:'contacts'|'saved'|'search';offset:number;more:boolean;save:boolean}
type Screen = Picker | Online | Reader | {kind:'settings'|'confirm';contact:MomentsContact}
    | {kind:'resume';contact:MomentsContact;checkpoint:MomentsCheckpoint}
type Delivery = {telegram:Context['telegram'];active:()=>Promise<boolean>}
type Ticket = {session:MomentsSession;screen:Screen;expires:number}
type Dependencies = {
    session:()=>Promise<MomentsSession|undefined>
    search:(query:string)=>Promise<MomentsContact[]>
    contacts:(offset:number,limit:number)=>Promise<MomentsContact[]>
    boundContact:(ctx:Context)=>Promise<MomentsContact|undefined>
    archive?:MomentsArchive
    fetchPage?:typeof fetchMomentsPage
    photos?:typeof downloadMomentPhotos
    rich?:{allowed:(chatId:number)=>boolean;rejected:(chatId:number)=>void}
}
const escape = (value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
const label = (contact:MomentsContact)=>contact.name.replace(/\s+/g,' ').trim().slice(0,48) || contact.id.slice(0,48)
const sameSession = (a:MomentsSession|undefined,b:MomentsSession|undefined)=>Boolean(a && b && a.owner === b.owner && a.account === b.account && a.baseURL === b.baseURL)
const pickerSize = 10
const usage = '<b>查看朋友圈</b>\n点选联系人，只查看微信当前允许看到的内容。\n<i>也可用 /moments 昵称或备注快速搜索。</i>'
const isGroup = (ctx:Context)=>ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'

type PostView = {post:Moment;images:Buffer[];expected:number;archived?:boolean;notes?:string[]}
const postTitle = (view:PostView)=>`${view.post.name} · ${view.archived ? '本地归档' : '朋友圈'}`
const postDate = (post:Moment)=>new Date(post.time * 1000).toISOString().slice(0,16).replace('T',' ') + ' UTC'
const postStats = ({post,expected}:PostView,sent:number)=>`赞 ${post.likes}  ·  评论 ${post.comments}${expected ? `  ·  图片 ${sent}/${expected}` : ''}`
const postNotes = (view:PostView)=>[...(view.post.otherMedia ? ['另有暂不支持预览的附件。'] : []),...(view.notes || [])]

export function momentHtml(view:PostView,sent:number):string {
    const content = view.post.text ? `\n\n<blockquote>${escape(view.post.text)}</blockquote>` : ''
    const notes = postNotes(view).map(note=>`\n<i>${escape(note)}</i>`).join('')
    return `<b>${escape(postTitle(view))}</b>\n<i>${postDate(view.post)}</i>${content}\n\n${postStats(view,sent)}${notes}`
}

export function momentRichPayload(view:PostView):Record<string,unknown> {
    const attachments:Record<string,unknown> = {}
    const pictures = view.images.map((source,index)=>{
        const name = `moment_${index}`
        attachments[name] = {source,filename:`moment-${index + 1}.jpg`}
        return {type:'photo',photo:{type:'photo',media:`attach://${name}`}}
    })
    const blocks:unknown[] = [{type:'paragraph',text:{type:'bold',text:postTitle(view)}},
        {type:'paragraph',text:postDate(view.post)}]
    if(view.post.text)blocks.push({type:'paragraph',text:view.post.text})
    if(pictures.length)blocks.push(pictures.length === 1 ? pictures[0] : {type:'collage',blocks:pictures})
    blocks.push({type:'paragraph',text:postStats(view,pictures.length)})
    for(const note of postNotes(view))blocks.push({type:'paragraph',text:note})
    return {...attachments,rich_message:JSON.stringify({blocks,skip_entity_detection:true})}
}

export class MomentsTelegram {
    private tickets = new Map<string,Ticket>()
    private busy = new Set<number>()
    private archive:MomentsArchive
    private jobs = new Set<string>()
    private checkingDaily = false
    constructor(private deps:Dependencies) {}
    private store() {return this.archive ||= this.deps.archive || new MomentsArchive()}
    private privateOwner(ctx:Context,session:MomentsSession|undefined) {
        return Boolean(ctx.chat?.type === 'private' && ctx.chat.id === ctx.from?.id && ctx.from?.id === session?.owner)
    }
    private delivery(ctx:Context,expected:MomentsSession,bound?:MomentsContact):Delivery {
        return {telegram:ctx.telegram,active:async()=>{
            const current = await this.deps.session()
            if(!sameSession(current,expected))return false
            if(this.privateOwner(ctx,current))return true
            // Keep in-flight group requests bound to the original individual.
            return Boolean(bound && isGroup(ctx) && ctx.from?.id === current.owner
                && (await this.deps.boundContact(ctx))?.id === bound.id)
        }}
    }
    private async show(to:Delivery,session:MomentsSession,screen:Screen,content:string | PostView,keys:(key:string)=>Button[][]) {
        const token = randomBytes(12).toString('hex'),active = to.active
        const reply_markup = {inline_keyboard:keys(token).filter(row=>row.length)}
        if(!await active())return false
        let richSent = false
        if(typeof content !== 'string' && this.deps.rich?.allowed(session.owner)) {
            try {
                await to.telegram.callApi('sendRichMessage' as any,{
                    chat_id:session.owner,protect_content:true,reply_markup,...momentRichPayload(content),
                } as any)
                richSent = true
            } catch(error) {
                if(!articleMessageRejected(error))throw error // Ambiguous delivery is not safe to repeat.
                this.deps.rich.rejected(session.owner)
            }
        }
        if(!richSent) {
            const html = typeof content === 'string' ? content : momentHtml(content,await this.photos(to,session,content.images))
            if(!await active())return false
            await to.telegram.sendMessage(session.owner,html,{parse_mode:'HTML',protect_content:true,link_preview_options:{is_disabled:true},reply_markup})
        }
        for(const [key,value] of this.tickets)if(value.expires <= Date.now())this.tickets.delete(key)
        if(this.tickets.size >= 32)this.tickets.delete(this.tickets.keys().next().value)
        this.tickets.set(token,{session,screen,expires:Date.now() + 20 * 60 * 1000})
        return true
    }
    private button(key:string,action:string,text:string):Button {return {text,callback_data:`mom:${key}:${action}`}}
    private async photos(to:Delivery,session:MomentsSession,images:Buffer[]):Promise<number> {
        if(!images.length || !await to.active())return 0
        try {
            if(images.length === 1)await to.telegram.sendPhoto(session.owner,{source:images[0],filename:'moment.jpg'},{protect_content:true})
            else await to.telegram.sendMediaGroup(session.owner,images.map((source,index)=>({type:'photo',media:{source,filename:`moment-${index + 1}.jpg`}})),{protect_content:true})
            return images.length
        } catch {return 0} // An uncertain send must not resend the album.
    }
    private async startOnline(to:Delivery,session:MomentsSession,contact:MomentsContact) {
        return this.online(to,session,{kind:'online',contact,remaining:[],md5:'',tip:''},true)
    }
    private async online(to:Delivery,session:MomentsSession,previous:Online,first = false) {
        const active = to.active,screen = {...previous}
        if(!screen.remaining.length && (first || screen.cursor)) {
            if(!await active())return false
            const result = await (this.deps.fetchPage || fetchMomentsPage)(session,screen.contact.id,screen.cursor,screen.md5)
            screen.remaining = result.posts;screen.cursor = result.next;screen.md5 = result.md5 || screen.md5
            if(result.tip)screen.tip = result.tip
        }
        const [post,...remaining] = screen.remaining
        screen.remaining = remaining
        const notes = screen.tip ? [screen.tip] : []
        let rendered:PostView|string = `<b>${escape(label(screen.contact))} · 朋友圈</b>\n${first ? '微信没有返回可查看的动态。' : '没有更多可查看的动态。'}` + (screen.tip ? `\n\n<i>${escape(screen.tip)}</i>` : '')
        if(post) {
            const images = await (this.deps.photos || downloadMomentPhotos)(post,active)
            if(!await active())return false
            try {await this.store().save(scope(session),post,images)}
            catch {notes.push('本条未能写入本地归档，请检查存储空间或归档上限。')}
            rendered = {post,images,expected:post.photos.length,notes}
        }
        return this.show(to,session,screen,rendered,key=>[
            screen.remaining.length || screen.cursor ? [this.button(key,'next',screen.remaining.length ? '下一条' : '加载更多')] : [],
            [this.button(key,'archive','查看本地归档'),this.button(key,'settings','保存设置')],
            [this.button(key,'contacts','选择联系人')],
        ])
    }
    private async archived(to:Delivery,session:MomentsSession,reader:Reader) {
        const id = scope(session),target = reader.contact.id
        const count = await this.store().count(id,target),entry = await this.store().at(id,target,reader.offset)
        const rendered:PostView|string = entry ? {post:entry.post,images:entry.images,expected:entry.expectedPhotos,archived:true}
            : `<b>${escape(label(reader.contact))} · 本地归档</b>\n暂无已保存动态。`
        return this.show(to,session,reader,rendered,key=>[
            reader.offset + 1 < count ? [this.button(key,'next','下一条归档')] : [],
            [this.button(key,'online','查看线上朋友圈'),this.button(key,'settings','保存设置')],
            [this.button(key,'saved','归档联系人'),this.button(key,'contacts','选择联系人')],
        ])
    }
    private async settings(to:Delivery,session:MomentsSession,contact:MomentsContact) {
        const id = scope(session),enabled = await this.store().enabled(id,contact.id),count = await this.store().count(id,contact.id)
        const html = `<b>${escape(label(contact))} · 朋友圈保存</b>\n每日同步：${enabled ? '已开启' : '已关闭'} · 已归档 ${count} 条\n每天最多检查一次。关闭不会删除已有内容。`
        return this.show(to,session,{kind:'settings',contact},html,key=>[
            [this.button(key,'saveall','立即保存当前可见的全部动态')],
            [this.button(key,enabled ? 'off' : 'on',enabled ? '停止每日同步' : '开启每日同步')],
            [this.button(key,'archive','查看本地归档'),this.button(key,'online','查看线上朋友圈')],
            [this.button(key,'contacts','选择联系人')],
            count ? [this.button(key,'clear','清空此人归档…')] : [],
        ])
    }
    private async picker(to:Delivery,session:MomentsSession,mode:Picker['mode'],save:boolean,offset = 0,search?:MomentsContact[]) {
        if(!await to.active())return false
        const candidates = mode === 'saved' ? await this.store().contacts(scope(session),pickerSize + 1,offset)
            : mode === 'contacts' ? await this.deps.contacts(offset,pickerSize + 1) : search || []
        const contacts = candidates.slice(0,pickerSize).filter(c=>momentsContactId(c.id)),more = mode !== 'search' && candidates.length > pickerSize
        const screen:Picker = {kind:'pick',contacts,mode,offset,more,save}
        const title = save ? '<b>保存朋友圈</b>\n点选联系人，一次保存当前可见的动态。' : usage
        return this.show(to,session,screen,title + (contacts.length ? '' : mode === 'saved' ? '\n\n暂无归档联系人。' : '\n\n没有匹配的联系人。'), key=>[
            ...contacts.map((item,index)=>[this.button(key,`p${index}`,label(item))]),
            [...offset ? [this.button(key,'prevlist','上一页')] : [],...more ? [this.button(key,'nextlist','下一页')] : []],
            mode === 'saved' ? [this.button(key,'contacts','全部联系人')] : [this.button(key,'saved','归档联系人')],
        ])
    }
    async command(ctx:Context,query = '',save = false) {
        const session = await this.deps.session(),group = isGroup(ctx)
        if(group ? !session || ctx.from?.id !== session.owner : ctx.chat?.type !== 'private')return
        if(!session)return void await ctx.reply('请先确认 Bot 已绑定主人、微信已登录。')
        if(!group && !this.privateOwner(ctx,session))return
        if(this.busy.has(session.owner))return
        this.busy.add(session.owner)
        let to = this.delivery(ctx,session)
        const groupReply = (text:string)=>ctx.reply(text,{message_thread_id:getTelegramThreadId(ctx.message)})
        try {
            if(group) {
                if(query.trim()) {
                    await groupReply('在群或话题里直接用命令，不用加参数；搜索其他人请在 Bot 私聊操作。');return
                }
                const contact = await this.deps.boundContact(ctx)
                if(!contact || !momentsContactId(contact.id)) {
                    await groupReply('这里没有可用的单人联系人绑定。请在 Bot 私聊发送命令并点选联系人。');return
                }
                to = this.delivery(ctx,session,contact)
                const sent = save ? await this.startSave(to,session,contact) : await this.startOnline(to,session,contact)
                if(sent && await to.active())await groupReply('请查看 Bot 私聊。')
                return
            }
            query = query.trim()
            if(!query){await this.picker(to,session,'contacts',save);return}
            if(query.length > 128)return void await ctx.reply('联系人搜索词太长。')
            const contacts = (await this.deps.search(query)).filter(c=>momentsContactId(c.id))
            if(contacts.length === 1) {
                if(save)await this.startSave(to,session,contacts[0]);else await this.startOnline(to,session,contacts[0])
            } else await this.picker(to,session,'search',save,0,contacts)
        } catch(error) {
            if(group)await groupReply('未能打开。请确认已在 Bot 私聊点过「开始」，也可直接在私聊试一次。').catch(()=>undefined)
            else await this.report(to,session,error)
        } finally {this.busy.delete(session.owner)}
    }
    async callback(ctx:Context,key:string,action:string) {
        const ticket = this.tickets.get(key),session = await this.deps.session()
        if(!this.privateOwner(ctx,session))return
        if(!ticket || ticket.expires <= Date.now() || !sameSession(ticket.session,session)) {
            await ctx.answerCbQuery('菜单已失效，请重新发送 /moments。');return
        }
        if(this.busy.has(session.owner)){await ctx.answerCbQuery('正在处理，请稍候。');return}
        this.busy.add(session.owner)
        try {
            await ctx.answerCbQuery()
            if(await this.navigate(this.delivery(ctx,session),session,ticket.screen,action))this.tickets.delete(key)
        } catch(error) {await this.report(this.delivery(ctx,session),session,error)}
        finally {this.busy.delete(session.owner)}
    }
    private async navigate(to:Delivery,session:MomentsSession,screen:Screen,action:string):Promise<boolean> {
        if(!await to.active())return false
        const save = screen.kind === 'pick' && screen.save
        if(action === 'contacts' || action === 'saved')return this.picker(to,session,action,save)
        if(screen.kind === 'pick') {
            if(screen.mode !== 'search') {
                if(action === 'nextlist' && screen.more)return this.picker(to,session,screen.mode,save,screen.offset + pickerSize)
                if(action === 'prevlist' && screen.offset)return this.picker(to,session,screen.mode,save,Math.max(0,screen.offset - pickerSize))
            }
            const choice = /^p(\d{1,2})$/.exec(action),contact = choice && screen.contacts[Number(choice[1])]
            if(!contact)return false
            if(save)return this.startSave(to,session,contact)
            return screen.mode === 'saved' ? this.archived(to,session,{kind:'archive',contact,offset:0}) : this.startOnline(to,session,contact)
        }
        const {contact} = screen,id = scope(session)
        if(action === 'settings')return this.settings(to,session,contact)
        if(action === 'saveall' && screen.kind === 'settings')return this.startSave(to,session,contact)
        if(action === 'resume' && screen.kind === 'resume')return this.startSave(to,session,contact,screen.checkpoint)
        if(action === 'archive')return this.archived(to,session,{kind:'archive',contact,offset:0})
        if(action === 'online')return this.startOnline(to,session,contact)
        if(action === 'next' && screen.kind === 'online' && (screen.remaining.length || screen.cursor))return this.online(to,session,screen)
        if(action === 'next' && screen.kind === 'archive')return this.archived(to,session,{...screen,offset:screen.offset + 1})
        if(screen.kind === 'settings' && (action === 'on' || action === 'off')) {
            await this.store().setEnabled(id,contact,action === 'on')
            return this.settings(to,session,contact)
        }
        if(screen.kind === 'settings' && action === 'clear') {
            if(this.jobs.has(this.jobKey(session,contact)))throw new Error('朋友圈正在归档，请完成后再清空。')
            return this.show(to,session,{kind:'confirm',contact},
                `确定删除 <b>${escape(label(contact))}</b> 的本地归档？不会影响微信里的朋友圈，也不会删除已发送到 Telegram 的消息。`,
                key=>[[this.button(key,'delete','确认清空归档'),this.button(key,'settings','取消')]])
        }
        if(screen.kind === 'confirm' && action === 'delete') {
            if(this.jobs.has(this.jobKey(session,contact)))throw new Error('朋友圈正在归档，请完成后再清空。')
            await this.store().clear(id,contact.id)
            return this.settings(to,session,contact)
        }
        return false
    }
    private jobKey(session:MomentsSession,contact:MomentsContact) {return JSON.stringify([session.owner,session.account,contact.id])}
    private async startSave(to:Delivery,session:MomentsSession,contact:MomentsContact,checkpoint?:MomentsCheckpoint):Promise<boolean> {
        const key = this.jobKey(session,contact),screen = {kind:'settings' as const,contact}
        if(this.jobs.has(key) || this.jobs.size >= 2)return this.show(to,session,screen,'朋友圈正在归档，请稍后再试。',id=>[[this.button(id,'settings','保存设置')]])
        this.jobs.add(key)
        try {
            if(!await this.show(to,session,screen,`正在保存 <b>${escape(label(contact))}</b> 当前可见的朋友圈。完成后会在这里通知。`,
                id=>[[this.button(id,'settings','保存设置')]])){this.jobs.delete(key);return false}
        } catch(error) {this.jobs.delete(key);throw error}
        void (async()=>{
            if(!await to.active())return
            await this.store().rememberContact(scope(session),contact)
            const done = await syncMoments(this.store(),session,contact,'all',to.active,
                {fetchPage:this.deps.fetchPage,photos:this.deps.photos,checkpoint})
            const result = `新增 ${done.saved} 条${done.missingPhotos ? `；${done.missingPhotos} 张图片未能保存` : ''}。`
            const summary:Screen = done.complete ? screen : {kind:'resume',contact,checkpoint:done.checkpoint}
            await this.show(to,session,summary,`<b>${escape(label(contact))} · ${done.complete ? '保存完成' : '保存已暂停'}</b>\n${result}${done.tip ? `\n<i>${escape(done.tip)}</i>` : ''}`,
                id=>[done.complete ? [] : [this.button(id,'resume','继续保存')],
                    [this.button(id,'archive','查看本地归档'),this.button(id,'settings','保存设置')]])
        })().catch(error=>this.report(to,session,error)).finally(()=>this.jobs.delete(key)).catch(()=>undefined)
        return true
    }
    async checkDaily(now?:number) {
        if(this.checkingDaily || this.jobs.size)return
        this.checkingDaily = true
        try {
            const session = await this.deps.session()
            if(!session)return
            const account = scope(session),active = async()=>sameSession(session,await this.deps.session())
            for(const contact of await this.store().due(account,now ?? Date.now())) {
                if(!await active() || this.jobs.size)break
                if(!momentsContactId(contact.id))continue
                const key = this.jobKey(session,contact)
                this.jobs.add(key)
                try {
                    if(await this.store().claimDaily(account,contact.id,now ?? Date.now()))
                        await syncMoments(this.store(),session,contact,'daily',active,{fetchPage:this.deps.fetchPage,photos:this.deps.photos})
                } catch { /* No retry until the next daily slot. Never log private content. */ }
                finally {this.jobs.delete(key)}
            }
        } finally {this.checkingDaily = false}
    }
    private async report(to:Delivery,session:MomentsSession,error:unknown) {
        // Protocol, Telegram and SQLite errors can contain private content.
        const msg = error instanceof Error && /^[\u4e00-\u9fff][\u4e00-\u9fff]/.test(error.message) ? error.message : '朋友圈操作暂时失败，请稍后再试。'
        if(await to.active())await to.telegram.sendMessage(session.owner,msg).catch(()=>undefined)
    }
}

export function installMomentsTelegram(bot:Telegraf,deps:Dependencies) {
    const reader = new MomentsTelegram(deps)
    const tick = ()=>void reader.checkDaily().catch(()=>undefined)
    setInterval(tick,15 * 60 * 1000).unref()
    bot.command('moments',ctx=>reader.command(ctx,ctx.payload))
    bot.command('savemoments',ctx=>reader.command(ctx,ctx.payload,true))
    bot.action(/^mom:([a-f0-9]{24}):([a-z0-9]{1,10})$/,ctx=>reader.callback(ctx,ctx.match[1],ctx.match[2]))
}