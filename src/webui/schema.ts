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
}

export const groups = [
    {id: 'messages', label: '消息管理', caption: '联系人与对话，一处管理', icon: 'message'},
    {id: 'connection', label: '连接配置', caption: '让微信与 Telegram 轻松连接', icon: 'link'},
    {id: 'forward', label: '消息转发', caption: '只接收你关心的消息', icon: 'send'},
    {id: 'templates', label: '消息样式', caption: '为每一条消息添加个人风格', icon: 'type'},
    {id: 'proxy', label: '网络代理', caption: '为连接选择合适的网络路径', icon: 'globe'},
    {id: 'ai', label: 'AI 与语音', caption: '让沟通多一点灵感', icon: 'spark'},
    {id: 'mcp', label: 'MCP 接入', caption: '连接你的 AI 客户端', icon: 'link'},
    {id: 'advanced', label: '高级设置', caption: '调节重试、存储与日志', icon: 'sliders'},
]

const field = (group: string, key: string, label: string, description: string, type: Field['type'] = 'text', extra: Partial<Field> = {}): Field =>
    ({group, key, label, description, type, source: 'environment', ...extra})
const numeric = (group: string, key: string, label: string, description: string, min: number, max: number) => field(group, key, label, description, 'number', {min, max, required: key !== 'PROXY_PORT'})
const runtime = (group: string, key: string, label: string, description: string) => field(group, key, label, description, 'boolean', {source: 'runtime'})

export const fields: Field[] = [
    field('connection', 'BOT_TOKEN', 'Bot Token', '从 Telegram 的 @BotFather 获取机器人令牌。', 'password', {required: true}),
    numeric('connection', 'API_ID', 'API ID', '在 my.telegram.org 创建应用后获取。', 1, 2147483647),
    field('connection', 'API_HASH', 'API Hash', '与 API ID 配套的应用凭证。', 'password', {required: true}),
    field('connection', 'BASE_API', '微信服务地址', 'wx2tg-server 的 API 地址，例如 http://wx2tg-server:8058/api。'),
    field('connection', 'DEVICE_TYPE', '登录设备', '选择微信登录使用的设备协议。', 'select', {options: ['ipad', 'car', 'mac', 'pad', 'win', 'ipadX']}),
    field('connection', 'MODE', '消息接收模式', 'polling 定时拉取；callback 由服务端推送。', 'select', {options: ['polling', 'callback']}),
    numeric('connection', 'CALLBACK_PORT', '回调端口', 'callback 模式下监听的端口，需与 WebUI 端口不同。', 1, 65535),
    field('connection', 'CALLBACK_API', '回调服务地址', '可选，项目使用的回调服务地址。'),
    field('connection', 'FILE_API', '文件服务地址', '可选，独立文件服务地址。'),
    runtime('forward', 'receivePublicAccount', '接收公众号消息', '将公众号消息转发到 Telegram。'),
    runtime('forward', 'onlyReceiveOfficialNotify', '公众号仅接收通知', '过滤普通文章，只接收公众号通知消息。'),
    runtime('forward', 'selfMessage', '转发自己发送的消息', '让自己发送的消息也出现在 Telegram 中。'),
    runtime('forward', 'emojiPicture', '表情显示为图片链接', '将原始 emoji 以图片链接方式显示。'),
    runtime('forward', 'syncWechat', '启动时同步联系人与群组', '下次启动时同步群组名称、头像和联系人信息。'),
    field('forward', 'language', '机器人语言', 'Telegram 机器人菜单和提示使用的语言。', 'select', {source: 'runtime', options: ['zh-CN', 'en-US']}),
    ...['CONTACT_MESSAGE', 'OFFICIAL_MESSAGE', 'ROOM_MESSAGE', 'CONTACT_MESSAGE_GROUP', 'OFFICIAL_MESSAGE_GROUP', 'ROOM_MESSAGE_GROUP', 'CREATE_ROOM_NAME', 'CREATE_CONTACT_NAME', 'MESSAGE_DISPLAY'].map((key, i) => field('templates', key, ['联系人消息前缀', '公众号消息前缀', '群聊消息前缀', '联系人绑定群前缀', '公众号绑定群前缀', '群聊绑定群前缀', '自动创建微信群名称', '自动创建联系人群名称', '消息正文格式'][i], '支持项目现有的 HTML 格式与 #[…] 占位符。', 'textarea')),
    field('proxy', 'PROXY_PROTOCOL', 'Telegram 代理协议', '不使用代理时选择直连。', 'select', {options: ['', 'socks5', 'http', 'https']}),
    field('proxy', 'PROXY_HOST', '代理主机', '填写 IP 或域名，不包含协议和端口。'),
    numeric('proxy', 'PROXY_PORT', '代理端口', '代理服务器监听端口。', 1, 65535),
    field('proxy', 'PROXY_USERNAME', '代理用户名', '可选，代理认证用户名。'),
    field('proxy', 'PROXY_PASSWORD', '代理密码', '可选，代理认证密码。', 'password'),
    field('proxy', 'WX_PROXY_HOST', '微信 SOCKS 代理', '微信登录代理地址，使用与微信账号相同地区的网络。'),
    field('proxy', 'WX_PROXY_USERNAME', '微信代理用户名', '可选，微信代理认证用户名。'),
    field('proxy', 'WX_PROXY_PASSWORD', '微信代理密码', '可选，微信代理认证密码。', 'password'),
    field('ai', 'AI_API_URL', 'AI API 地址', 'OpenAI 兼容服务的完整 chat completions URL。'),
    field('ai', 'AI_API_KEY', 'AI API Key', '用于调用 AI 服务的密钥。', 'password'),
    field('ai', 'AI_MODEL', '模型名称', '填写所连接服务支持的模型名称。'),
    numeric('ai', 'AI_CONTEXT_LIMIT', '默认上下文条数', '未设置机器人上下文条数时的回退值。', 1, 200),
    numeric('ai', 'aiContextLimit', '机器人上下文条数', '优先于默认上下文条数，保存后立即使用。', 1, 200),
    runtime('ai', 'autoTranscript', '语音自动转文字', '启用后通过腾讯云 ASR 识别语音，需配置下方凭证。'),
    field('ai', 'TENCENT_SECRET_ID', '腾讯云 Secret ID', '腾讯云语音识别服务的访问标识。', 'password'),
    field('ai', 'TENCENT_SECRET_KEY', '腾讯云 Secret Key', '腾讯云语音识别服务的访问密钥。', 'password'),
    numeric('advanced', 'SEND_TO_WX_MAX_RETRIES', '微信最大重试次数', '0 表示无限重试。', 0, 1000),
    numeric('advanced', 'SEND_TO_WX_TIMEOUT', '微信发送超时（毫秒）', '单次消息发送等待时间。', 1000, 3600000),
    numeric('advanced', 'SEND_TO_TG_MAX_RETRIES', 'Telegram 最大重试次数', '0 表示无限重试。', 0, 1000),
    numeric('advanced', 'SEND_TO_TG_RETRY_DELAY', 'Telegram 重试间隔（毫秒）', '指数退避的基础等待时间。', 100, 60000),
    numeric('advanced', 'MESSAGE_BUFFER_EXPIRE_TIME', '消息缓冲有效期（毫秒）', '过期的待发送消息将被清理。', 1000, 86400000),
    field('advanced', 'AUTO_DELETE_OLD_MESSAGES', '自动清理历史消息', '仅清理数据库记录；过期消息将不能用于引用或撤回。', 'boolean'),
    numeric('advanced', 'MESSAGE_RETENTION_DAYS', '消息保留天数', '超过此期限的历史消息记录将被清理。', 1, 3650),
    field('advanced', 'LOG_LEVEL', '日志级别', '日常使用建议 info，排查问题时可选择 debug。', 'select', {options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal']}),
    field('advanced', 'DEBUG_MODE', '调试模式', '记录更多调试信息，日志可能包含消息内容。', 'boolean'),
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
        if (text.length > 4096 || text.includes('\0')) throw new Error(`${definition.label}内容过长或包含非法字符`)
        if (definition.required && !text.trim()) throw new Error(`请填写${definition.label}`)
        if (definition.type === 'number' && (text !== '' || source === 'runtime')) {
            const number = Number(text)
            if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < definition.min || number > definition.max) {
                throw new Error(`${definition.label}须为 ${definition.min}–${definition.max} 的整数`)
            }
        }
        if (definition.type === 'select' && !definition.options.includes(text)) throw new Error(`${definition.label}选项无效`)
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
