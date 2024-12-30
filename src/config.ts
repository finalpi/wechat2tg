// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import dotenv from 'dotenv'

dotenv.config()

export const config = {
    TG_PH_TOKEN_FILE: process.env.TG_PH_TOKEN?.toString() || 'storage/telegra.ph.json',
    BOT_TOKEN: process.env.BOT_TOKEN?.toString() || '', // tg bot father 申请的 bot token
    PROTOCOL: process.env.PROXY_PROTOCOL?.toString() || '', // 协议:socks5/http/https
    HOST: process.env.PROXY_HOST?.toString() || '', // 代理服务器地址
    PORT: process.env.PROXY_PORT?.toString() || '', // 代理服务器端口
    USERNAME: process.env.PROXY_USERNAME?.toString() || '', // 代理服务器用户名
    PASSWORD: process.env.PROXY_PASSWORD?.toString() || '', // 代理服务器密码
    API_ID: process.env.API_ID?.toString() || '',
    API_HASH: process.env.API_HASH?.toString() || '',
    DB_SQLITE_PATH: process.env.DB_SQLITE_PATH?.toString() || 'storage/db/wechat2Tg.db',
    APP_NAME: process.env.APP_NAME?.toString() || 'wechat2Tg',
    CONTACT_MESSAGE: process.env.CONTACT_MESSAGE?.toString() || '<b>👤#[alias_first]: </b>',
    OFFICIAL_MESSAGE: process.env.OFFICIAL_MESSAGE?.toString() || '<b>📣#[name]: </b>',
    ROOM_MESSAGE: process.env.ROOM_MESSAGE?.toString() || '<i>🌐#[topic]</i> ---- <b>👤#[(alias)] #[name]: </b>',
    CONTACT_MESSAGE_GROUP: process.env.CONTACT_MESSAGE_GROUP?.toString() || '<b>👤#[alias_first]: </b>',
    OFFICIAL_MESSAGE_GROUP: process.env.OFFICIAL_MESSAGE_GROUP?.toString() || '<b>📣#[name]: </b>',
    ROOM_MESSAGE_GROUP: process.env.ROOM_MESSAGE_GROUP?.toString() || '<b>👤#[(alias)] #[name]: </b>',
    CREATE_ROOM_NAME: process.env.CREATE_ROOM_NAME?.toString() || '#[topic]',
    CREATE_CONTACT_NAME: process.env.CREATE_CONTACT_NAME?.toString() || '#[alias]#[[name]]',
    MESSAGE_DISPLAY: process.env.MESSAGE_DISPLAY?.toString() || '#[identity]#[br]#[body]',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY?.toString() || '',
    OPENAI_HOST: process.env.OPENAI_HOST?.toString() || 'https://api.openai.com',
    OPENAI_MODEL: process.env.OPENAI_MODEL?.toString() || 'gpt-3.5-turbo',
    OPENAI_SYSTEM_PROMPT: process.env.OPENAI_SYSTEM_PROMPT?.toString() || '',
    OPENAI_MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS) || 150,
    OPENAI_TEMPERATURE: parseInt(process.env.OPENAI_TEMPERATURE) || 0.7,
}

export const useProxy = config.PROTOCOL !== '' && config.HOST !== '' && config.PORT !== ''