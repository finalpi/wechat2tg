import dotenv from 'dotenv';
dotenv.config();

export const config = {
	BOT_TOKEN: process.env.BOT_TOKEN?.toString() || '' , // tg bot father 申请的 bot token
}


