import {normalizeMiniAppUrl} from './mini-app-auth'

export interface Field {
    key: string
    label: string
    description: string
    group: string
    type: 'text' | 'password' | 'number' | 'select' | 'boolean' | 'textarea'
    source: 'environment' | 'runtime'
    options?: string[]
    min?: number
    max?: number
    required?: boolean
    defaultValue?: string | boolean
}

export const groups = [
    {id: 'messages', label: '消息管理', caption: '', icon: 'message'},
    {id: 'connection', label: '连接配置', caption: '', icon: 'link'},
    {id: 'forward', label: '消息转发', caption: '', icon: 'send'},
    {id: 'templates', label: '消息样式', caption: '', icon: 'type'},
    {id: 'proxy', label: '网络代理', caption: '', icon: 'globe'},
    {id: 'ai', label: 'AI 与语音', caption: '', icon: 'spark'},
    {id: 'mcp', label: 'MCP 接入', caption: '', icon: 'link'},
    {id: 'advanced', label: '高级设置', caption: '', icon: 'sliders'},
]

const field = (group: string, key: string, label: string, description: string, type: Field['type'] = 'text', extra: Partial<Field> = {}): Field =>
    ({group, key, label, description, type, source: 'environment', ...extra})
const numeric = (group: string, key: string, label: string, description: string, min: number, max: number) => field(group, key, label, description, 'number', {min, max, required: key !== 'PROXY_PORT'})
const runtime = (group: string, key: string, label: string, description: string) => field(group, key, label, description, 'boolean', {source: 'runtime'})

export const fields: Field[] = [
    field('connection', 'BOT_TOKEN', 'Bot Token', '从 @BotFather 获取。', 'password', {required: true}),
    numeric('connection', 'API_ID', 'API ID', '在 my.telegram.org 获取。', 1, 2147483647),
    field('connection', 'API_HASH', 'API Hash', '与 API ID 配套。', 'password', {required: true}),
    field('connection', 'BASE_API', '微信服务地址', 'wx2tg-server 地址。'),
    field('connection', 'DEVICE_TYPE', '登录设备', '微信登录协议。', 'select', {options: ['ipad', 'car', 'mac', 'pad', 'win', 'ipadX']}),
    field('connection', 'MODE', '消息接收模式', 'polling 拉取 / callback 推送。', 'select', {options: ['polling', 'callback']}),
    numeric('connection', 'CALLBACK_PORT', '回调端口', 'callback 监听端口。', 1, 65535),
    field('connection', 'CALLBACK_API', '回调服务地址', '可选。'),
    field('connection', 'FILE_API', '文件服务地址', '可选。'),
    field('forward', 'AUTO_CREATE_GROUPS', '自动创建独立群', '未绑定会话自动建群。', 'boolean'),
    field('forward', 'OFFICIAL_ACCOUNT_TOPICS_ENABLED', '公众号集中到论坛话题', '公众号集中到论坛话题。', 'boolean'),
    field('advanced', 'OFFICIAL_ACCOUNT_FORUM_CHAT_ID', '公众号论坛恢复 ID', '留空自动创建；仅恢复时填 -100… ID。'),
    runtime('forward', 'receivePublicAccount', '接收公众号消息', '接收公众号消息。'),
    runtime('forward', 'onlyReceiveOfficialNotify', '公众号仅接收通知', '仅接收公众号通知。'),
    runtime('forward', 'selfMessage', '转发自己发送的消息', '转发自己发送的消息。'),
    field('forward', 'TELEGRAM_DISPLAY_MODE', 'Telegram 默认展示', 'auto：默认在发送前预检测原生表情资格，其他富媒体参考主人会员状态；compatible：普通消息；enhanced：主动启用增强。/display 可覆盖单个聊天。', 'select', {options:['auto','compatible','enhanced'],defaultValue:'auto'}),
    field('forward', 'TELEGRAM_EMOJI_FALLBACK', '兼容表情展示', 'links：微信表情图片超链接；text：保留文字编码。无需会员。', 'select', {options:['links','text']}),
    field('forward', 'WECHAT_CUSTOM_EMOJI_ENABLED', '微信行内自定义表情', '默认开启并自动验证发送资格，未确认资格时使用兼容展示。手动关闭或 compatible 模式优先。保存后重启生效。', 'boolean', {defaultValue:true}),
    runtime('forward', 'emojiPicture', '表情显示为图片链接', '表情显示为图片链接。'),
    runtime('forward', 'syncWechat', '启动时同步联系人与群组', '启动时同步联系人与群组。'),
    runtime('forward', 'deleteAvatarNotices', '自动删除联系人头像更换通知', '微信群绑定的头像通知自动清理。此开关控制联系人头像通知，默认关闭，保存后生效。'),
    runtime('forward', 'deleteTitleNotices', '自动删除名称更改通知', '删除程序更改 Telegram 群名称产生的系统消息。默认关闭，保存后生效。'),
    field('forward', 'language', '机器人语言', '机器人语言。', 'select', {source: 'runtime', options: ['zh-CN', 'en-US']}),
    ...['CONTACT_MESSAGE', 'OFFICIAL_MESSAGE', 'ROOM_MESSAGE', 'CONTACT_MESSAGE_GROUP', 'OFFICIAL_MESSAGE_GROUP', 'ROOM_MESSAGE_GROUP', 'CREATE_ROOM_NAME', 'CREATE_CONTACT_NAME', 'MESSAGE_DISPLAY'].map((key, i) => field('templates', key, ['联系人消息前缀', '公众号消息前缀', '群聊消息前缀', '联系人绑定群前缀', '公众号绑定群前缀', '群聊绑定群前缀', '自动创建微信群名称', '自动创建联系人群名称', '消息正文格式'][i], key.startsWith('CREATE_') ? '支持 #[…] 占位符。' : '支持 HTML 与 #[…] 占位符；留空用默认格式。', 'textarea')),
    field('proxy', 'PROXY_PROTOCOL', 'Telegram 代理协议', '不使用代理时选直连。', 'select', {options: ['', 'socks5', 'http', 'https']}),
    field('proxy', 'PROXY_HOST', '代理主机', 'IP 或域名。'),
    numeric('proxy', 'PROXY_PORT', '代理端口', '代理服务器监听端口。', 1, 65535),
    field('proxy', 'PROXY_USERNAME', '代理用户名', '可选。'),
    field('proxy', 'PROXY_PASSWORD', '代理密码', '可选。', 'password'),
    field('proxy', 'WX_PROXY_HOST', '微信 SOCKS 代理', '微信登录代理。'),
    field('proxy', 'WX_PROXY_USERNAME', '微信代理用户名', '可选。'),
    field('proxy', 'WX_PROXY_PASSWORD', '微信代理密码', '可选。', 'password'),
    field('ai', 'AI_API_URL', 'AI API 地址', 'OpenAI 兼容 API 地址。'),
    field('ai', 'AI_API_KEY', 'AI API Key', 'AI 密钥。', 'password'),
    field('ai', 'AI_MODEL', '模型名称', '模型名称。'),
    numeric('ai', 'AI_CONTEXT_LIMIT', '默认上下文条数', '默认上下文条数。', 1, 200),
    numeric('ai', 'aiContextLimit', '机器人上下文条数', '机器人上下文条数。', 1, 200),
    runtime('ai', 'autoTranscript', '语音自动转文字', '语音自动转文字。'),
    field('ai', 'TENCENT_SECRET_ID', '腾讯云 Secret ID', '腾讯云 ASR 凭证。', 'password'),
    field('ai', 'TENCENT_SECRET_KEY', '腾讯云 Secret Key', '腾讯云 ASR 凭证。', 'password'),
    numeric('advanced', 'SEND_TO_WX_MAX_RETRIES', '微信最大重试次数', '0 = 无限。', 0, 1000),
    numeric('advanced', 'SEND_TO_WX_TIMEOUT', '微信发送超时（毫秒）', '单次等待时间。', 1000, 3600000),
    numeric('advanced', 'SEND_TO_TG_MAX_RETRIES', 'Telegram 普通错误重试次数', '0 = 不限。明确未连接和 429 持续退避；结果未知不自动重发。', 0, 1000),
    numeric('advanced', 'SEND_TO_TG_RETRY_DELAY', 'Telegram 重试间隔（毫秒）', '退避基础等待。', 100, 60000),
    numeric('advanced', 'MESSAGE_BUFFER_EXPIRE_TIME', '已完成转发记录保留时间（毫秒）', '兼容旧配置，实际至少 7 天。未送达记录不会因过期而删除。', 1000, 31536000000),
    field('advanced', 'AUTO_DELETE_OLD_MESSAGES', '自动清理历史消息', '自动清理历史消息。', 'boolean'),
    numeric('advanced', 'MESSAGE_RETENTION_DAYS', '消息保留天数', '超过此期限的记录将被清理。', 1, 3650),
    field('advanced', 'LOG_LEVEL', '日志级别', '日志级别。', 'select', {options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal']}),
    field('advanced', 'WEBUI_MINI_APP_URL', 'Telegram Mini App 地址', '根路径 HTTPS 地址；仅主人可用，保存后重启。'),
    field('advanced', 'DEBUG_MODE', '调试模式', '调试模式。', 'boolean'),
]
fields.find(f => f.key === 'API_ID').required = true
fields.find(f => f.key === 'aiContextLimit').source = 'runtime'

// Previous WebUI releases could save MQTT settings. Keep loading those values,
// but exclude them from the public schema and reject new API edits.
export const persistedFields: Field[] = [...fields,
    field('mqtt', 'MQTT_ENABLED', '启用 MQTT 通知', '', 'boolean'),
    field('mqtt', 'MQTT_BROKER_URL', 'Broker 地址', ''),
    field('mqtt', 'MQTT_USERNAME', '用户名', ''),
    field('mqtt', 'MQTT_PASSWORD', '密码', '', 'password'),
    field('mqtt', 'MQTT_TOPIC', '通知主题', ''),
    field('mqtt', 'MQTT_CLIENT_ID', 'Client ID', ''),
    numeric('mqtt', 'MQTT_NOTIFY_FAIL_COUNT', '失败通知阈值', '', 1, 1000),
]

export function validatePatch(source: Field['source'], patch: unknown, persisted = false): Record<string, string | boolean | number> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('配置必须是对象')
    const result = Object.create(null)
    for (const [key, value] of Object.entries(patch)) {
        const definition = (persisted ? persistedFields : fields).find(f => f.key === key && f.source === source)
        if (!definition) throw new Error(`不支持的配置项：${key}`)
        if (definition.type === 'boolean') {
            if (typeof value !== 'boolean') throw new Error(`${definition.label}必须是布尔值`)
        } else if (typeof value !== 'string' && !(definition.type === 'number' && typeof value === 'number')) {
            throw new Error(`${definition.label}格式不正确`)
        }
        const text = String(value)
        if (key === 'WEBUI_MINI_APP_URL') {
            try {normalizeMiniAppUrl(text)} catch {throw new Error('Mini App 地址必须是无参数的根路径 HTTPS URL')}
        }
        if (text.length > 4096 || text.includes('\0')) throw new Error(`${definition.label}内容过长或包含非法字符`)
        if (definition.required && !text.trim()) throw new Error(`请填写${definition.label}`)
        if (definition.type === 'number' && (text !== '' || source === 'runtime')) {
            const number = Number(text)
            if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < definition.min || number > definition.max) {
                throw new Error(`${definition.label}须为 ${definition.min}–${definition.max} 的整数`)
            }
        }
        if (definition.type === 'select' && !definition.options.includes(text)) throw new Error(`${definition.label}选项无效`)
        if (key === 'OFFICIAL_ACCOUNT_FORUM_CHAT_ID' && text && (!/^-100[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))) {
            throw new Error('公众号论坛恢复 ID 必须是有效的 -100… 超级群 ID')
        }
        if (['BASE_API', 'FILE_API', 'CALLBACK_API', 'AI_API_URL', 'MQTT_BROKER_URL'].includes(key) && text) {
            let url: URL
            try { url = new URL(text) } catch { throw new Error(`${definition.label}必须是完整 URL`) }
            const protocols = key === 'MQTT_BROKER_URL' ? ['mqtt:', 'mqtts:', 'ws:', 'wss:'] : ['http:', 'https:']
            if (!protocols.includes(url.protocol) || url.username || url.password) throw new Error(`${definition.label}协议或认证格式无效`)
        }
        result[key] = source === 'environment' ? text : definition.type === 'number' ? Number(value) : value
    }
    return result
}
