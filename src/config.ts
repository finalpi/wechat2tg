// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import dotenv from 'dotenv'

dotenv.config()

export const config = {
    BOT_TOKEN: process.env.BOT_TOKEN?.toString() || '', // tg bot father 申请的 bot token
    PROTOCOL: process.env.PROXY_PROTOCOL?.toString() || '', // 协议:socks5/http/https
    HOST: process.env.PROXY_HOST?.toString() || '', // 代理服务器地址
    PORT: process.env.PROXY_PORT?.toString() || '', // 代理服务器端口
    USERNAME: process.env.PROXY_USERNAME?.toString() || '', // 代理服务器用户名
    PASSWORD: process.env.PROXY_PASSWORD?.toString() || '', // 代理服务器密码
    API_ID: process.env.API_ID?.toString() || '',
    API_HASH: process.env.API_HASH?.toString() || '',
    TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID?.toString() || '',
    TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY?.toString() || '',
    DB_SQLITE_PATH: process.env.DB_SQLITE_PATH?.toString() || 'storage/db/wechat2Tg.db',
    CONTACT_MESSAGE: process.env.CONTACT_MESSAGE?.toString() || '<b>👤#[alias_first]: </b>',
    OFFICIAL_MESSAGE: process.env.OFFICIAL_MESSAGE?.toString() || '<b>📣#[name]: </b>',
    ROOM_MESSAGE: process.env.ROOM_MESSAGE?.toString() || '<i>🌐#[topic]</i> ---- <b>👤#[(alias)] #[name]: </b>',
    CONTACT_MESSAGE_GROUP: process.env.CONTACT_MESSAGE_GROUP?.toString() || '',
    OFFICIAL_MESSAGE_GROUP: process.env.OFFICIAL_MESSAGE_GROUP?.toString() || '',
    ROOM_MESSAGE_GROUP: process.env.ROOM_MESSAGE_GROUP?.toString() || '',
    CREATE_ROOM_NAME: process.env.CREATE_ROOM_NAME?.toString() || '#[alias_first]',
    CREATE_CONTACT_NAME: process.env.CREATE_CONTACT_NAME?.toString() || '#[alias]#[[name]]',
    MESSAGE_DISPLAY: process.env.MESSAGE_DISPLAY?.toString() || '#[identity]#[br]#[body]',
    BASE_API: process.env.BASE_API?.toString(),
    FILE_API: process.env.FILE_API?.toString(),
    CALLBACK_API: process.env.CALLBACK_API?.toString(),
    DEBUG_MODE: process.env.DEBUG_MODE === 'true' ? true : false,
    DEVICE_TYPE: process.env.DEVICE_TYPE?.toString() || 'ipad',
    MODE: process.env.MODE?.toString() || 'polling',
    CALLBACK_PORT: process.env.CALLBACK_PORT?.toString() || '8056',
    WX_PROXY_HOST: process.env.WX_PROXY_HOST?.toString() || '',
    WX_PROXY_USERNAME: process.env.WX_PROXY_USERNAME?.toString() || '',
    WX_PROXY_PASSWORD: process.env.WX_PROXY_PASSWORD?.toString() || '',

    // 消息发送重试配置
    // 发送到微信的消息重试次数，0 表示无限重试
    SEND_TO_WX_MAX_RETRIES: parseInt(process.env.SEND_TO_WX_MAX_RETRIES || '3'),
    // 发送到微信的消息超时时间（毫秒）
    SEND_TO_WX_TIMEOUT: parseInt(process.env.SEND_TO_WX_TIMEOUT || '30000'),

    // 发送到 Telegram 的消息重试次数，0 表示无限重试
    SEND_TO_TG_MAX_RETRIES: parseInt(process.env.SEND_TO_TG_MAX_RETRIES || '3'),
    // 发送到 Telegram 的消息重试延迟基数（毫秒），实际延迟 = 基数 * 2^(重试次数-1)
    SEND_TO_TG_RETRY_DELAY: parseInt(process.env.SEND_TO_TG_RETRY_DELAY || '5000'),
    // 消息缓冲区过期时间（毫秒），超过此时间的消息将被清理
    MESSAGE_BUFFER_EXPIRE_TIME: parseInt(process.env.MESSAGE_BUFFER_EXPIRE_TIME || '300000'),

    // 自动删除旧消息配置
    // 是否启用自动删除数据库中的旧消息
    AUTO_DELETE_OLD_MESSAGES: process.env.AUTO_DELETE_OLD_MESSAGES === 'true' ? true : false,
    // 消息保留天数，超过此天数的消息将被自动删除
    MESSAGE_RETENTION_DAYS: parseInt(process.env.MESSAGE_RETENTION_DAYS || '7'),
}

export const useProxy = config.PROTOCOL !== '' && config.HOST !== '' && config.PORT !== ''