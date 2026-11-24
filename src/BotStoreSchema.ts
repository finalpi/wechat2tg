import path from 'node:path'
import {APP_DATABASE} from './DatabaseOptions'

export const botStores = {
    web: {file:'webui-messages.db',tables:['inbox','media','transcript_media','telegram_recalls'],ddl:`
        CREATE TABLE IF NOT EXISTS inbox (
            id BIGSERIAL PRIMARY KEY, requestId TEXT UNIQUE,
            wxId TEXT NOT NULL, remoteId TEXT, senderId TEXT, senderName TEXT,
            body TEXT NOT NULL, direction TEXT NOT NULL, type TEXT, status TEXT NOT NULL, timestamp BIGINT NOT NULL,
            attachmentId TEXT, telegramStatus TEXT DEFAULT 'none', source TEXT, details TEXT,
            telegramTracked INTEGER DEFAULT 0, bodyFormat TEXT DEFAULT 'plain', hidden INTEGER DEFAULT 0,
            revokeStatus TEXT DEFAULT 'none', revokeRequestId TEXT, revokedAt BIGINT, revokeTelegramStatus TEXT DEFAULT 'none',
            UNIQUE(wxId,remoteId));
        CREATE INDEX IF NOT EXISTS inbox_conversation ON inbox(wxId,id);
        CREATE INDEX IF NOT EXISTS inbox_chronology ON inbox(wxId,timestamp,id);
        CREATE UNIQUE INDEX IF NOT EXISTS inbox_revoke_request ON inbox(revokeRequestId);
        CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,name TEXT,kind TEXT,mime TEXT,size BIGINT,digest TEXT);
        CREATE TABLE IF NOT EXISTS transcript_media(cacheKey TEXT PRIMARY KEY,attachmentId TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS telegram_recalls(key TEXT PRIMARY KEY,status TEXT NOT NULL);`},
    outbox: {file:'telegram-outbox.db',tables:['outbox'],ddl:`
        CREATE TABLE IF NOT EXISTS outbox (
            seq BIGSERIAL PRIMARY KEY,key TEXT NOT NULL UNIQUE,account TEXT NOT NULL,
            remoteId TEXT NOT NULL,conversation TEXT NOT NULL,chatId BIGINT NOT NULL,kind TEXT NOT NULL,
            state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,nextAt BIGINT NOT NULL,
            updatedAt BIGINT NOT NULL,payload TEXT,media BYTEA,progress TEXT);
        CREATE INDEX IF NOT EXISTS outbox_due ON outbox(account,state,kind,nextAt);
        CREATE INDEX IF NOT EXISTS outbox_remote ON outbox(account,remoteId);
        CREATE INDEX IF NOT EXISTS outbox_lane ON outbox(account,chatId,kind,state,seq);
        CREATE INDEX IF NOT EXISTS outbox_chat ON outbox(account,chatId,state,seq);`},
    packets: {file:'red-packets.db',tables:['red_packets'],ddl:`
        CREATE TABLE IF NOT EXISTS red_packets (
            key TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,account TEXT NOT NULL,owner BIGINT NOT NULL,
            conversation TEXT NOT NULL,remoteId TEXT NOT NULL,xml TEXT,state TEXT NOT NULL,
            amount BIGINT,reason TEXT,chatId BIGINT,threadId BIGINT,updatedAt BIGINT NOT NULL);`},
    transfers: {file:'transfers.db',tables:['transfers'],ddl:`
        CREATE TABLE IF NOT EXISTS transfers (key TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,
            account TEXT NOT NULL,owner BIGINT NOT NULL,conversation TEXT NOT NULL,chatId BIGINT NOT NULL,threadId BIGINT,
            payer TEXT,transferId TEXT NOT NULL,transactionId TEXT NOT NULL,invalidTime TEXT NOT NULL,amount BIGINT NOT NULL,state TEXT NOT NULL);`},
    moments: {file:'moments.db',tables:['moments_contacts','moments_posts','moments_daily'],ddl:`
        CREATE TABLE IF NOT EXISTS moments_contacts(scope TEXT NOT NULL,target TEXT NOT NULL,name TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(scope,target));
        CREATE TABLE IF NOT EXISTS moments_posts(scope TEXT NOT NULL,target TEXT NOT NULL,id TEXT NOT NULL,published BIGINT NOT NULL,
            post TEXT NOT NULL,images TEXT NOT NULL,PRIMARY KEY(scope,target,id));
        CREATE TABLE IF NOT EXISTS moments_daily(scope TEXT NOT NULL,target TEXT NOT NULL,last_attempt BIGINT NOT NULL,PRIMARY KEY(scope,target));
        CREATE INDEX IF NOT EXISTS moments_posts_order ON moments_posts(scope,target,published DESC);`},
}
export type BotStoreKind = keyof typeof botStores
export const botStoreDefinitions = Object.values(botStores)
export const botStoreTables = botStoreDefinitions.flatMap(store=>store.tables)
export const postgresStoreMarker = 'sqlite-stores-import-v1'
export const storeFile = (kind:BotStoreKind)=>path.join(path.dirname(APP_DATABASE),botStores[kind].file)