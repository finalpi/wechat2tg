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
    CONTACT_MESSAGE_GROUP: process.env.CONTACT_MESSAGE_GROUP?.toString() || '<b>👤#[alias_first]: </b>',
    OFFICIAL_MESSAGE_GROUP: process.env.OFFICIAL_MESSAGE_GROUP?.toString() || '<b>📣#[name]: </b>',
    ROOM_MESSAGE_GROUP: process.env.ROOM_MESSAGE_GROUP?.toString() || '<b>👤#[(alias)] #[name]: </b>',
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
}

export const useProxy = config.PROTOCOL !== '' && config.HOST !== '' && config.PORT !== ''