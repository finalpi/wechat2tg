// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import dotenv from 'dotenv';
dotenv.config();

export const config = {
	BOT_TOKEN: process.env.BOT_TOKEN?.toString() || '' , // tg bot father 申请的 bot token
	PROTOCOL: process.env.PROXY_PROTOCOL?.toString() || '' , // 协议:http/socket
	HOST: process.env.PROXY_HOST?.toString() || '' , // 代理服务器地址
	PORT: process.env.PROXY_PORT?.toString() || '' , // 代理服务器端口
	USERNAME: process.env.PROXY_USERNAME?.toString() || '' , // 代理服务器用户名
	PASSWORD: process.env.PROXY_PASSWORD?.toString() || '' , // 代理服务器密码
}


