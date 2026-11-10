import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import type {MessageCenterAdapter} from './messages'
import type {MediaFile} from './media'
import {createMessageEvents} from './message-events'

interface DemoContact {
    wxId: string; name: string; nickname: string; kind: 'group' | 'contact'; category: string; indexLetter: string;
    hasAvatar: boolean; lastActivity: number; lastSequence: number; lastBody: string; lastType: string; unsyncedCount: number;
}
interface DemoMessage {
    id: number; wxId: string; remoteId: string; senderId: string; senderDisplayName: string; senderHasAvatar: boolean;
    body: string; bodyFormat: string; type: string; timestamp: number; direction: string; status: string;
    telegramTracked: boolean; telegramStatus: string; canRevoke: boolean; revokeStatus?: string; requestId?: string;
    details?: Record<string, unknown>;
}
const fail = (code: string, status = 400): never => {throw Object.assign(new Error(code), {code, status})}
const copy = <T>(value: T): T => structuredClone(value)
const PAGE_SIZE = 30

/** Standalone preview only. No clients, repositories, production stores, or remote URLs. */
export async function createDemoMessageCenter(directory: string): Promise<MessageCenterAdapter> {
    await fs.mkdir(directory, {recursive: true})
    const events = createMessageEvents()
    const now = Math.floor(Date.now() / 1000)
    const contacts: DemoContact[] = [
        ['demo-team@chatroom', '产品讨论组', 'group', 'C'],
        ['demo-travel@chatroom', '周末出游', 'group', 'Z'],
        ['demo-family@chatroom', '家人', 'group', 'J'],
        ['demo-lin', '林小满', 'person', 'L'],
        ['demo-zhou', '周予安', 'person', 'Z'],
        ['demo-chen', '陈可', 'person', 'C'],
        ['demo-alex', 'Alex', 'person', 'A'],
        ['demo-design', '设计周刊', 'official', 'S'],
        ['demo-reading', '每日阅读', 'official', 'M'],
        ['demo-city', '城市服务', 'service', 'C'],
        ['demo-work@openim', '项目协作助手', 'enterprise', 'X'],
        ['demo-unknown', '待识别账号', 'unknown', '#'],
    ].map(([wxId, name, category, indexLetter]) => ({wxId, name, nickname: name, category, indexLetter,
        kind: category === 'group' ? 'group' : 'contact', hasAvatar: true,
        lastActivity: 0, lastSequence: 0, lastBody: '', lastType: 'text', unsyncedCount: 0}))
    const members = contacts.filter(contact => ['demo-lin', 'demo-zhou', 'demo-chen', 'demo-work@openim'].includes(contact.wxId))
        .map(contact => ({wxId: contact.wxId, name: contact.name, displayName: contact.name, nickname: contact.name, hasAvatar: true}))
    members.push({wxId: 'demo-self', name: '我', displayName: '我', nickname: '我', hasAvatar: true})
    const names = new Map([...contacts.map(contact => [contact.wxId, contact.name] as const), ['demo-self', '我']])
    const avatarCache = new Map<string, Promise<Buffer>>()
    const avatar = (wxId: string) => {
        if (!names.has(wxId)) fail('avatarUnavailable', 404)
        if (!avatarCache.has(wxId)) {
            const seed = [...wxId].reduce((sum, char) => sum + char.charCodeAt(0), 0)
            const color = ['#7c83cf', '#6aaba2', '#d6a169', '#c9819f', '#79a5c8'][seed % 5]
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="24" fill="${color}"/><circle cx="48" cy="36" r="18" fill="#fff"/><ellipse cx="48" cy="87" rx="32" ry="29" fill="#fff"/><circle cx="42" cy="34" r="2" fill="${color}"/><circle cx="54" cy="34" r="2" fill="${color}"/><path d="M42 42 Q48 47 54 42" fill="none" stroke="${color}" stroke-width="2"/></svg>`
            avatarCache.set(wxId, sharp(Buffer.from(svg)).png().toBuffer())
        }
        return avatarCache.get(wxId)!
    }
    const files = new Map<string, MediaFile>()
    const makeFile = async (id: string, name: string, mime: string, kind: MediaFile['kind'], bytes: Buffer) => {
        const file = {id, name, mime, kind, size: bytes.length, digest: 'demo', path: path.join(directory, id)}
        await fs.writeFile(file.path, bytes, {mode: 0o600})
        files.set(id, file)
        return id
    }
    const imageId = await makeFile('00000000-0000-4000-8000-000000000001', '周末山景.png', 'image/png', 'image', await sharp(Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#d7e8f2"/><circle cx="485" cy="90" r="38" fill="#f2cd85"/><path d="M0 290 180 100 350 300 485 160 640 290V360H0Z" fill="#92b3ac"/><path d="M0 330 160 220 345 350 510 240 640 315V360H0Z" fill="#527d77"/></svg>')).png().toBuffer())
    const sampleRate = 8000, samples = 6400, wav = Buffer.alloc(44 + samples * 2)
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40)
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 440 * 2) * 1200 * Math.sin(i / samples * Math.PI)), 44 + i * 2)
    const audioId = await makeFile('00000000-0000-4000-8000-000000000002', '提示音示例.wav', 'audio/wav', 'audio', wav)
    const documentId = await makeFile('00000000-0000-4000-8000-000000000003', '讨论纪要.txt', 'text/plain', 'file', Buffer.from('演示讨论纪要\n1. 调整聊天留白\n2. 操作显示在消息之后\n3. 头像仅使用合成样例\n'))
    const messages: DemoMessage[] = []
    const attachments = new Map<number, string>()
    let nextId = 1
    const add = (contact: DemoContact, body: string, outgoing = false, senderId = contact.wxId, type = 'text', timestamp = now): DemoMessage => {
        const id = nextId++
        const row: DemoMessage = {id, wxId: contact.wxId, remoteId: String(1000000 + id), senderId: outgoing ? 'demo-self' : senderId,
            senderDisplayName: outgoing ? '我' : names.get(senderId) || contact.name, senderHasAvatar: true,
            body, bodyFormat: 'plain', type, timestamp, direction: outgoing ? 'outgoing' : 'incoming', status: outgoing ? 'submitted' : 'received',
            telegramTracked: true, telegramStatus: 'synced', canRevoke: outgoing}
        messages.push(row)
        return row
    }
    const conversation = ['大家早上好，今天看看聊天页面的新效果。', '收到，头像和名字现在清楚多了。', '回复和同步操作放在消息后面，不要盖住正文。', '这个留白很舒服，手机上也试一下。', '周末要不要一起去走走？', '可以，路线和时间在群里确认。']
    for (const contact of contacts) {
        const count = contact.wxId === 'demo-team@chatroom' ? 45 : 4
        for (let i = 0; i < count; i++) add(contact, conversation[i % conversation.length], i % 4 === 2,
            contact.kind === 'group' ? members[i % 3].wxId : contact.wxId, 'text', now - (count - i) * 180)
    }
    const team = contacts[0]
    const original = add(team, '这是本地演示聊天。可以搜索、引用、查看图片，或输入一条消息试试；不会发送给真实联系人。', false, 'demo-lin', 'text', now - 70)
    add(team, '这条较长的消息用来检查换行和气泡宽度。窗口缩小后，正文应完整显示；同步状态、回复和撤回按钮会在消息之后出现，不会覆盖这些文字。', false, 'demo-chen', 'text', now - 60)
    const quote = add(team, '明白，我先试试引用回复。', true, 'demo-self', 'quote', now - 50)
    quote.details = {replyTo: {id: original.id, remoteId: original.remoteId, name: original.senderDisplayName, preview: original.body}}
    attachments.set(add(team, '这是一张本地生成的示例图片。', false, 'demo-zhou', 'image', now - 40).id, imageId)
    attachments.set(add(team, '音频预览：一小段提示音。', false, 'demo-lin', 'audio', now - 30).id, audioId)
    attachments.set(add(team, '讨论纪要发在这里了。', false, 'demo-chen', 'file', now - 20).id, documentId)
    const pending = add(team, '这条是「同步结果未知」的演示，可以悬停后模拟重试。', true, 'demo-self', 'text', now - 10)
    pending.telegramStatus = 'unknown'
    const coverArt = await sharp(await fs.readFile(files.get(imageId)!.path!)).jpeg().toBuffer()
    const articleCovers = new Map<number,Buffer[]>()
    for(const publisher of contacts.filter(item=>['official','service'].includes(item.category))){
        const article = add(publisher,'本地图文示例',false,publisher.wxId,'link',now - 5)
        article.details = {articles:['把日常整理成一篇图文','周末阅读清单','城市生活小提示'].map((title,index)=>({title,description:'离线生成的示例内容，不连接真实账号。',url:`https://example.com/demo/${index}`,coverPath:`/api/media/article/${article.id}/${index}`}))}
        articleCovers.set(article.id,[coverArt,coverArt,coverArt])
    }
    const contact = (wxId: string) => contacts.find(item => item.wxId === wxId) || fail('recipientMissing', 404)
    const row = (id: number) => messages.find(item => item.id === id) || fail('messageMissing', 404)
    const matching = (wxId: string, query = '') => {
        contact(wxId)
        return messages.filter(item => item.wxId === wxId && item.body.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
    }
    const summaries = () => contacts.map(item => {
        const history = matching(item.wxId), latest = history[history.length - 1]
        return {...item, lastActivity: latest?.timestamp || 0, lastSequence: latest?.id || 0, lastBody: latest?.body || '', lastType: latest?.type || 'text',
            unsyncedCount: history.filter(message => message.telegramStatus !== 'synced').length}
    })
    const changed = (message: DemoMessage) => events.publish({type: 'messages', wxId: message.wxId, ids: [message.id]})
    const requests = new Map<string, {fingerprint: string; id: number}>()
    const media = (id: string) => files.get(id) || fail('mediaMissing', 404)
    return {
        subscribe: listener => events.subscribe(listener),
        articleCover:async(id,index)=>{
            const image = articleCovers.get(id)?.[index]
            if(!image || row(id).revokeStatus === 'revoked')fail('coverUnavailable',404)
            return image
        },
        status: async () => ({available: true, wechatOnline: true, telegramOnline: true, directoryAvailable: true, demo: true}),
        contacts: async (query, kind, offset, order) => {
            const all = summaries().filter(item => `${item.name} ${item.wxId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            const counts = {person: 0, group: 0, official: 0, service: 0, enterprise: 0, unknown: 0}
            all.forEach(item => counts[item.category]++)
            const filtered = all.filter(item => kind === 'all' || kind === 'contact' && item.kind === 'contact' || item.category === kind)
            filtered.sort(order === 'letter' ? (a, b) => a.indexLetter.localeCompare(b.indexLetter) || a.name.localeCompare(b.name) : (a, b) => b.lastActivity - a.lastActivity)
            return {contacts: copy(filtered.slice(offset, offset + 60)), counts, total: all.length, countsScope: 'cached', directoryAvailable: true, offset: offset + 60, hasMore: filtered.length > offset + 60}
        },
        history: async (wxId, before, query) => {
            const all = matching(wxId, query)
            const boundary = before ? all.findIndex(item => item.id === before) : all.length
            const history = boundary < 0 ? all.filter(item => item.id < before) : all.slice(0, boundary)
            const page = history.slice(-PAGE_SIZE)
            return {messages: copy(page), hasMore: history.length > page.length, before: page[0]?.id || 0, serverTime: Math.floor(Date.now() / 1000)}
        },
        updates: async (wxId, ids, query) => ({messages: copy(matching(wxId, query).filter(item => ids.includes(item.id))), serverTime: Math.floor(Date.now() / 1000)}),
        locate: async (wxId, id, remoteId) => {
            const all = matching(wxId), index = all.findIndex(item => id ? item.id === id : item.remoteId === remoteId)
            if (index < 0) fail('messageMissing', 404)
            const page = all.slice(Math.max(0, index - 15), index + 16)
            return {messages: copy(page), targetId: all[index].id, before: page[0].id, hasMore: index > 15, hasNewer: index + 16 < all.length, serverTime: Math.floor(Date.now() / 1000)}
        },
        groupMembers: async (wxId, query, offset) => {
            if (contact(wxId).kind !== 'group') fail('mentionsGroupOnly')
            const filtered = members.filter(item => `${item.name} ${item.wxId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
            return {members: copy(filtered.slice(offset, offset + 100)), total: filtered.length, offset: offset + 100, hasMore: filtered.length > offset + 100}
        },
        send: async (wxId, body, requestId, attachmentId, mentions, replyToId) => {
            const target = contact(wxId)
            const fingerprint = JSON.stringify({wxId, body, attachmentId, mentions, replyToId})
            const previous = requests.get(requestId)
            if (previous) {
                if (previous.fingerprint !== fingerprint) fail('requestConflict', 409)
                return copy(row(previous.id))
            }
            if (requests.size >= 500) fail('demoLimit', 429)
            if (attachmentId) fail('demoReadOnly', 403)
            const quoted = replyToId ? row(replyToId) : undefined
            if (quoted && quoted.wxId !== wxId) fail('messageMissing', 404)
            if (mentions?.all || mentions?.memberIds?.length) {
                if (target.kind !== 'group') fail('mentionsGroupOnly')
                const selected = (mentions.memberIds || []).map(id => members.find(member => member.wxId === id) || fail('mentionMemberMissing'))
                body = (mentions.all ? '@所有人' : selected.map(member => '@' + member.name).join(' ')) + ' ' + body
            }
            const message = add(target, body, true)
            message.requestId = requestId
            if (quoted) message.details = {replyTo: {id: quoted.id, remoteId: quoted.remoteId, name: quoted.senderDisplayName, preview: quoted.body}}
            requests.set(requestId, {fingerprint, id: message.id})
            changed(message)
            return copy(message)
        },
        sync: async id => {const message = row(id);message.telegramStatus = 'synced';changed(message);return {id, telegramStatus: 'synced'}},
        revoke: async id => {
            const message = row(id)
            if (message.direction !== 'outgoing') fail('revokeUnavailable')
            message.revokeStatus = 'revoked';message.canRevoke = false;message.body = '这条演示消息已撤回';message.details = undefined
            changed(message)
            return {id, revokeStatus: 'revoked', revokeTelegramStatus: 'synced'}
        },
        sendStatus: async requestId => copy(row(requests.get(requestId)?.id || 0)),
        conversations: async offset => ({contacts: copy(summaries().slice(offset, offset + 60)), offset: offset + 60, hasMore: false}),
        newMessages: async (cursor, wxId, limit) => ({messages: copy(messages.filter(item => item.id > (cursor || 0) && (!wxId || item.wxId === wxId)).slice(0, limit)), cursor: nextId - 1}),
        avatar,
        media: async id => copy(media(id)),
        attachment: async id => {row(id);return copy(media(attachments.get(id) || ''))},
        upload: async () => fail('demoReadOnly', 403),
        officialMenu: async wxId => ['official', 'service'].includes(contact(wxId).category)
            ? {available: true, menu: {buttons: [{name: '演示菜单', kind: 'group', children: [{name: '仅预览，不调用微信', kind: 'unsupported', reason: 'wechat'}]}]}}
            : {available: false, menu: null, reason: 'notOfficial'},
    }
}