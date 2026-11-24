import fs from 'node:fs'
import path from 'node:path'
import {DataSource,QueryRunner} from 'typeorm'
import {OPEN_READONLY} from 'sqlite3'
import {createBotDataSource} from './BotDataSource'
import {APP_DATABASE,BOT_SETTINGS_LOCK} from './DatabaseOptions'
import {POSTGRES_SETTINGS_TABLE_SQL,SQLITE_IMPORT_MARKER} from './webui/settings-db'
import {copyBotStores,hasLocalBotStores} from './BotStoreMigration'
import {botStoreTables,postgresStoreMarker} from './BotStoreSchema'

const identifier = (name:string)=>'"' + name.replace(/"/g,'""') + '"'
type SqliteValue = string | number | boolean | null

async function present(runner:QueryRunner,table:string):Promise<boolean> {
    const rows = await runner.query('SELECT name FROM sqlite_master WHERE type = ? AND name = ?',['table',table])
    return rows.length > 0
}

function columnValue(type:unknown,value:SqliteValue):SqliteValue {
    if(value == null)return value
    if(type === Boolean || type === 'boolean'){
        if(value !== 0 && value !== 1 && value !== false && value !== true)throw new Error('Invalid SQLite boolean')
        return !!value
    }
    if(typeof value === 'number' && !Number.isSafeInteger(value))throw new Error('Unsafe SQLite integer')
    return type === String || type === 'text' ? String(value) : value
}

// For installations already using PG for the core schema. Never overwrite
// history, jobs, or payment journals that have already been migrated.
export async function migrateExistingPostgresStores(dsn:string,file = APP_DATABASE):Promise<Record<string,number>> {
    const target = await createBotDataSource(dsn,false).initialize()
    try {
        const output = target.createQueryRunner()
        try {
            await output.startTransaction()
            await output.query('SELECT pg_advisory_xact_lock($1::bigint)',[BOT_SETTINGS_LOCK])
            const markers = await output.query('SELECT name FROM public.app_settings WHERE name IN ($1,$2)',['legacy-v1',postgresStoreMarker]) as {name:string}[]
            if(!markers.some(row=>row.name === 'legacy-v1') || markers.some(row=>row.name === postgresStoreMarker)){
                throw Object.assign(new Error('Existing Bot PostgreSQL migration not applicable'),{code:'BOT_PG_TARGET_NOT_EMPTY'})
            }
            const counts:Record<string,number> = {}
            await copyBotStores(output,path.dirname(file),counts)
            await output.commitTransaction()
            return counts
        } catch(error) {
            if(output.isTransactionActive)await output.rollbackTransaction()
            throw error
        } finally {await output.release()}
    } finally {await target.destroy()}
}

/** Run with both installations stopped. The SQLite source is opened read-only. */
export async function migrateBotToPostgres(dsn:string,file = APP_DATABASE):Promise<Record<string,number>> {
    const directory = path.dirname(file),hasMain = fs.existsSync(file)
    if(!hasMain && !hasLocalBotStores(directory))throw Object.assign(new Error('Bot SQLite source does not exist'),{code:'BOT_PG_NO_SQLITE_SOURCE'})
    const source = new DataSource({type:'sqlite',database:hasMain ? file : ':memory:',...(hasMain ? {flags:OPEN_READONLY} : {}),busyTimeout:5000})
    const target = createBotDataSource(dsn,false)
    try {
        await source.initialize()
        await target.initialize()
        const input = source.createQueryRunner(),output = target.createQueryRunner()
        await input.startTransaction()
        try {
            try {
                await output.query('SELECT pg_advisory_lock($1::bigint)',[BOT_SETTINGS_LOCK])
                const existing = await output.query('SELECT tablename FROM pg_tables WHERE schemaname=\'public\'') as Array<{tablename:string}>
                const expected = new Set(['app_settings',...botStoreTables,...target.entityMetadatas.map(meta=>meta.tableName)])
                for(const {tablename} of existing){
                    if(!expected.has(tablename) || await output.manager.createQueryBuilder().select('1').from(`public.${tablename}`,'existing').limit(1).getRawOne()){
                        throw Object.assign(new Error('PostgreSQL migration requires an empty dedicated bot database'),{code:'BOT_PG_TARGET_NOT_EMPTY'})
                    }
                }
                // Build the normal application tables without committing partial imported rows.
                await target.synchronize()
                await output.startTransaction()
                await output.query(POSTGRES_SETTINGS_TABLE_SQL)
                const counts:Record<string,number> = {}
                const sequences = await present(input,'sqlite_sequence')
                    ? await input.query('SELECT name,seq FROM sqlite_sequence') as Array<{name:string;seq:number}>
                    : []
                for(const meta of target.entityMetadatas){
                    const table = meta.tableName
                    if(!await present(input,table))continue
                    const key = meta.primaryColumns[0],keySql = identifier(key.databaseName)
                    let after:SqliteValue|undefined
                    counts[table] = 0
                    let hasMore = true
                    while(hasMore){
                        const select = input.manager.createQueryBuilder().select('entry.*').from(table,'entry').orderBy(keySql,'ASC').limit(200)
                        if(after !== undefined)select.where(`${keySql} > :after`,{after})
                        const rows = await select.getRawMany<Record<string,SqliteValue>>()
                        if(!rows.length)break
                        const batch = rows.map(row=>Object.fromEntries(meta.columns.filter(column=>Object.prototype.hasOwnProperty.call(row,column.databaseName))
                            .map(column=>[column.propertyName,columnValue(column.type,row[column.databaseName])])))
                        // TypeORM omits generated IDs unless insert columns are explicit.
                        await output.manager.createQueryBuilder().insert().into(meta.target,meta.columns.map(column=>column.propertyPath))
                            .values(batch).updateEntity(false).execute()
                        counts[table] += rows.length
                        after = rows[rows.length - 1][key.databaseName]
                        hasMore = rows.length === 200
                    }
                    if(key.isGenerated){
                        const highWater = Math.max(typeof after === 'number' ? after : 0,sequences.find(row=>row.name === table)?.seq ?? 0)
                        if(!Number.isSafeInteger(highWater))throw new Error('Unsafe SQLite sequence')
                        if(highWater > 0)await output.query('SELECT setval(pg_get_serial_sequence($1,$2),$3::bigint,true)',[`public.${table}`,key.databaseName,highWater])
                    }
                }
                counts.app_settings = 0
                if(await present(input,'app_settings')){
                    const rows = await input.query('SELECT name,value FROM app_settings ORDER BY name') as {name:string;value:string}[]
                    for(const {name,value} of rows){
                        if(name === SQLITE_IMPORT_MARKER || name === postgresStoreMarker)continue
                        await output.query('INSERT INTO public.app_settings (name,value) VALUES ($1,$2)',[name,value])
                        counts.app_settings++
                    }
                }
                await copyBotStores(output,directory,counts)
                await output.query('INSERT INTO public.app_settings (name,value) VALUES ($1,$2)',[SQLITE_IMPORT_MARKER,'1'])
                await output.commitTransaction()
                return counts
            } catch(error) {
                if(output.isTransactionActive)await output.rollbackTransaction()
                throw error
            } finally {
                await output.query('SELECT pg_advisory_unlock($1::bigint)',[BOT_SETTINGS_LOCK]).catch(()=>undefined)
                await output.release()
            }
        } finally {await input.rollbackTransaction();await input.release()}
    } finally {
        await Promise.all([source,target].filter(db=>db.isInitialized).map(db=>db.destroy()))
    }
}