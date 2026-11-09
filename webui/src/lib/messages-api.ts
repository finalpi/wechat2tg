import {ApiError, request} from './api'

export type ContactCategory = 'person' | 'group' | 'official' | 'service' | 'enterprise' | 'unknown'
export type ContactCounts = Partial<Record<ContactCategory, number>>
export interface OfficialMenuButton {
  name: string
  kind: 'group' | 'url' | 'unsupported'
  url?: string
  reason?: 'event' | 'miniapp' | 'wechat' | 'unknown'
  children?: OfficialMenuButton[]
}
export interface OfficialMenuResult {available: boolean; menu: {buttons: OfficialMenuButton[]} | null; reason?: 'notSynced' | 'notOfficial'}

export interface Contact {
  wxId: string
  name: string
  nickname: string
  kind: 'contact' | 'group'
  category?: ContactCategory
  indexLetter?: string
  hasAvatar: boolean
  lastActivity: number
  lastSequence: number
  lastBody: string
  lastType: string
  unsyncedCount: number
}
export interface MediaFile {id: string; name: string; kind: string; mime: string; size: number}
export interface TranscriptAttachment {path: string; id: string; type: string; name?: string; title?: string; size?: number}
export interface Transcript {
  path: string
  title: string
  content: string
  entries?: {id: string; sender: string; time: string; type: string; text: string; attachmentId?: string; nestedId?: string; url?: string}[]
  attachments: TranscriptAttachment[]
  children: Transcript[]
  truncated: boolean
}
export interface ChatMessage {
  id: number
  requestId?: string
  wxId: string
  remoteId?: string
  senderId?: string
  senderName?: string
  senderDisplayName?: string
  senderHasAvatar?: boolean
  body: string
  bodyFormat?: string
  direction: 'incoming' | 'outgoing'
  type: string
  status: string
  timestamp: number
  attachmentId?: string
  telegramStatus: string
  telegramTracked?: boolean
  revokeStatus?: string
  canRevoke?: boolean
  revokeDeadline?: number
  revokeUnavailableReason?: string
  details?: {
    title?: string; description?: string; url?: string; mime?: string; size?: number
    articles?: {title?: string; description?: string; url?: string}[]
    replyTo?: {id?: number; remoteId: string; wxId?: string; name?: string; preview?: string; type?: string}
    attachmentUnavailable?: boolean
  } | null
  transcript?: Transcript
  transcriptAttachments?: TranscriptAttachment[]
}
export interface MessageUpdates {messages: ChatMessage[]; serverTime: number}
export interface HistoryPage extends MessageUpdates {hasMore: boolean; before: number}
export interface ContactsPage {contacts: Contact[]; hasMore: boolean; offset: number; directoryAvailable: boolean; counts?: ContactCounts; total?: number; countsScope?: 'cached'}
interface TelegramPollingStatus {
  state:'starting'|'healthy'|'retrying'|'stalled'|'stopped'; healthy:boolean; inFlight:boolean
  lastAttemptAt:number|null; lastSuccessAt:number|null; lastFailureAt:number|null
  lastError:string|null; consecutiveFailures:number; lastDurationMs:number|null; requestTimeoutMs:number
}
export interface MessageStatus {available: boolean; wechatOnline: boolean; telegramOnline?: boolean; telegramPolling?:TelegramPollingStatus; directoryAvailable: boolean; demo?: boolean}
export interface Member {wxId: string; name: string; nickname: string; displayName: string; hasAvatar: boolean}
export interface MembersPage {members: Member[]; hasMore: boolean; offset: number; total: number}
export interface SendMessage {
  wxId: string
  body: string
  requestId: string
  attachmentId?: string
  replyToId?: number
  mentions?: {memberIds?: string[]; all?: boolean}
}

const query = (values: Record<string, string | number | boolean>) => new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))
export const messagesApi = {
  status: (token: string, signal?: AbortSignal) => request<MessageStatus>('/api/messages/status', token, {signal}),
  contacts: (token: string, q = '', kind = 'all', offset = 0, signal?: AbortSignal, order?: 'letter') =>
    request<ContactsPage>(`/api/contacts?${query({q, kind, offset})}${order === 'letter'?'&order=letter':''}`, token, {signal,cache:'no-store'}),
  officialMenu: (token: string, wxId: string, signal?: AbortSignal) =>
    request<OfficialMenuResult>(`/api/contacts/menu?${query({wxId})}`, token, {signal}),
  history: (token: string, wxId: string, q = '', before = 0, signal?: AbortSignal) =>
    request<HistoryPage>(`/api/messages?${query({wxId, q, before})}`, token, {signal}),
  updates: (token: string, wxId: string, ids: number[], signal?: AbortSignal, q = '') => {
    const valid = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))]
    if (!valid.length || valid.length > 100) throw new Error('消息更新每次需要 1–100 个有效 ID。')
    return request<MessageUpdates>(`/api/messages/updates?${query({wxId, ids: valid.join(','), q})}`, token, {signal})
  },
  locate: (token: string, wxId: string, target: {id?: number; remoteId?: string}, signal?: AbortSignal) =>
    request<HistoryPage & {targetId: number; hasNewer: boolean}>(`/api/messages/locate?${query({wxId, ...(target.id ? {id: target.id} : {}), ...(target.remoteId ? {remoteId: target.remoteId} : {})})}`, token, {signal}),
  members: (token: string, wxId: string, q = '', offset = 0, refresh = false, signal?: AbortSignal) =>
    request<MembersPage>(`/api/groups/members?${query({wxId, q, offset, refresh})}`, token, {signal}),
  send: (token: string, body: SendMessage) => request<ChatMessage>('/api/messages', token, {method: 'POST', body: JSON.stringify(body)}),
  sync: (token: string, id: number, confirm = false) => request<{id: number; telegramStatus: string}>(`/api/messages/${id}/sync`, token, {method: 'POST', body: JSON.stringify({confirm})}),
  revoke: (token: string, id: number, requestId: string, confirmUncertain = false) =>
    request<{id: number; revokeStatus: string; revokeTelegramStatus: string}>(`/api/messages/${id}/revoke`, token, {method: 'POST', body: JSON.stringify({requestId, confirm: true, confirmUncertain})}),
  media: (token: string, id: number) => request<MediaFile>(`/api/media/message/${id}`, token),
  transcriptMedia: (token: string, id: number, path: string, attachment: string) =>
    request<MediaFile>(`/api/media/transcript/${id}?${query({path, id: attachment})}`, token),
  upload: async (token: string, file: File, voice: boolean): Promise<MediaFile> => {
    if (!file.size) throw new Error('文件为空。')
    if (file.size > 50 * 1024 * 1024) throw new Error('文件不能超过 50 MB。')
    const response = await fetch(`/api/media?${query({name: file.name, type: voice ? 'voice' : 'auto'})}`, {
      method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream'}, body: file,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(body.error || 'uploadFailed', body.error, response.status)
    }
    return response.json()
  },
  blob: async (token: string, path: string, signal?: AbortSignal) => {
    const response = await fetch(path, {headers: {Authorization: `Bearer ${token}`}, signal})
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new ApiError(body.error || 'mediaMissing', body.error, response.status)
    }
    return response.blob()
  },
}

const errors: Record<string, string> = {
  networkError: '无法连接服务，请检查网络。',
  demoReadOnly: '演示模式不支持上传附件或修改服务配置；可以预览示例附件、模拟发送文字。', demoLimit: '本次演示消息已达上限，请重启 dev:webui 重置。',
  wechatOffline: '微信未连接，暂时无法发送。', messagesUnavailable: '消息服务未连接。', telegramOffline: 'Telegram 未连接。',
  sendQueueFull: '发送队列已满，请稍后重试。', mediaMissing: '附件暂不可用。', downloadTooLarge: '附件超过下载限制。',
  mediaTooLarge: '文件不能超过 50 MB。', invalidVoiceFormat: '请选择音频文件。', recipientMissing: '联系人不存在。',
  syncUncertain: '同步结果未知，重试可能重复。', telegramQueued: '消息正在同步。', messageExcluded: '此消息不参与同步。',
  messageNotSubmitted: '消息尚未发送成功。', requestConflict: '请求内容冲突，请刷新后重试。',
  groupMembersUnavailable: '无法获取群成员。', mentionMemberMissing: '群成员已变更，请重新选择。',
  quoteUnavailable: '此消息无法引用。', quoteTextOnly: '引用回复仅支持文字。', unauthorized: '访问令牌已失效，请重新登录。',
}
export function messageError(error: unknown) {
  if (error instanceof ApiError) return errors[error.code] || `操作失败（${error.code}）。`
  return error instanceof Error ? error.message : '操作失败，请重试。'
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const rows = new Map(current.map(row => [row.id, row]))
  for (const row of incoming) rows.set(row.id, {...rows.get(row.id), ...row})
  return [...rows.values()].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
}
