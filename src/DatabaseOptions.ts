import type {PostgresConnectionOptions} from 'typeorm/driver/postgres/PostgresConnectionOptions'

export const APP_DATABASE = 'storage/db/wx2tg.db'
export const BOT_SETTINGS_LOCK = 0x7778327467
export const BOT_TABLES = ['app_settings','configuration','bind_group','message','official_account_forum','official_account_topic'] as const
export const BOT_DATABASE_ERRORS:Record<string,string> = {
    BOT_PG_INVALID_DSN:'BOT_POSTGRES_DSN 必须是包含数据库名的 PostgreSQL URL。',
    BOT_PG_MIGRATION_REQUIRED:'检测到旧 Bot SQLite 数据。请先停止 Bot 并运行 node dist/settings-cli.js --migrate-postgres。',
    BOT_PG_STORES_MIGRATION_REQUIRED:'Bot 主库已使用 PostgreSQL，但历史与业务流水仍在 SQLite。请停止 Bot 并运行 node dist/settings-cli.js --migrate-postgres-stores。',
    BOT_PG_TARGET_NOT_EMPTY:'请使用专用的空 Bot PostgreSQL 数据库，不要与 wx2tg-server 共用数据库。',
    BOT_PG_NO_SQLITE_SOURCE:'未找到要迁移的 storage/db/wx2tg.db。',
}

export function databaseErrorHint(error:{code?:string}|undefined):string|undefined {
    return Object.prototype.hasOwnProperty.call(BOT_DATABASE_ERRORS,error?.code) ? BOT_DATABASE_ERRORS[error.code] : undefined
}

export function botPostgresDsn(environment = process.env):string|undefined {
    const dsn = environment.BOT_POSTGRES_DSN?.trim()
    if(!dsn)return undefined
    try {
        const url = new URL(dsn)
        if((url.protocol === 'postgres:' || url.protocol === 'postgresql:') && url.hostname && /^\/[^/]+$/.test(url.pathname))return dsn
    } catch { /* Never print a connection string that may contain credentials. */ }
    throw Object.assign(new Error('Invalid PostgreSQL connection URL'),{code:'BOT_PG_INVALID_DSN'})
}

export function botPostgresOptions(dsn:string):PostgresConnectionOptions {
    return {type:'postgres',url:dsn,schema:'public',connectTimeoutMS:5000,applicationName:'wechat2tg'}
}