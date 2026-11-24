import fs from 'node:fs'
import path from 'node:path'
import {Database,OPEN_READONLY} from 'sqlite3'
import type {QueryRunner} from 'typeorm'
import {botStoreDefinitions,botStoreTables,postgresStoreMarker} from './BotStoreSchema'

export const hasLocalBotStores = (directory:string)=>botStoreDefinitions.some(({file})=>fs.existsSync(path.join(directory,file)))
const quote = (name:string)=>'"' + name.replace(/"/g,'""') + '"'
type Value = string | number | Buffer | null
type Row = Record<string,Value>

/** The caller must hold the migration lock and a PostgreSQL transaction. */
export async function copyBotStores(output:QueryRunner,directory:string,counts:Record<string,number>) {
    await output.query('SET LOCAL search_path TO public')
    const existing = await output.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',['public']) as {tablename:string}[]
    for(const {tablename} of existing){
        if((botStoreTables.includes(tablename) || tablename === 'inbox_cursor') &&
            await output.manager.createQueryBuilder().select('1').from(`public.${tablename}`,'existing').limit(1).getRawOne()){
            throw Object.assign(new Error('PostgreSQL auxiliary store is not empty'),{code:'BOT_PG_TARGET_NOT_EMPTY'})
        }
    }
    for(const definition of botStoreDefinitions){
        await output.query(definition.ddl)
        const file = path.join(directory,definition.file)
        if(!fs.existsSync(file))continue
        const source = await new Promise<Database>((resolve,reject)=>{
            const db = new Database(file,OPEN_READONLY,error=>error ? reject(error) : resolve(db))
        })
        const all = <T>(sql:string,values:unknown[] = [])=>new Promise<T[]>((resolve,reject)=>source.all<T>(sql,values,(error,rows)=>error ? reject(error) : resolve(rows)))
        try {
            await all('BEGIN')
            for(const table of definition.tables){
                if(!(await all('SELECT name FROM sqlite_master WHERE type=? AND name=?',['table',table])).length)continue
                const targetColumns = await output.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',table]) as {column_name:string}[]
                const columns = new Set(targetColumns.map(column=>column.column_name))
                const ddl = new Set((await all<{name:string}>('SELECT name FROM sqlite_master WHERE name=?',['sqlite_sequence'])).map(row=>row.name))
                let after:number|undefined
                counts[table] = 0
                let more = true
                while(more){
                    // Read blobs one at a time so queue media cannot exhaust the migration process.
                    const limit = ['outbox','moments_posts'].includes(table) ? 1 : 30
                    const select = `SELECT rowid AS wx2tg_copy_rowid,* FROM ${quote(table)}${after === undefined ? '' : ' WHERE rowid>?'} ORDER BY rowid LIMIT ?`
                    const rows = await all<Row>(select,after === undefined ? [limit] : [after,limit])
                    if(!rows.length)break
                    const batch = rows.map(({wx2tg_copy_rowid,...row})=>{
                        if(typeof wx2tg_copy_rowid !== 'number' || !Number.isSafeInteger(wx2tg_copy_rowid))throw new Error('Unsafe SQLite row ID')
                        after = wx2tg_copy_rowid
                        return Object.fromEntries(Object.entries(row).map(([key,value])=>{
                            if(!columns.has(key.toLowerCase()))throw new Error('Unknown column in legacy Bot storage')
                            if(typeof value === 'number' && !Number.isSafeInteger(value))throw new Error('Unsafe SQLite store integer')
                            return [key.toLowerCase(),value]
                        }))
                    })
                    await output.manager.createQueryBuilder().insert().into(`public.${table}`).values(batch).execute()
                    counts[table] += rows.length
                    more = rows.length === limit
                }
                if(ddl.has('sqlite_sequence') && (table === 'inbox' || table === 'outbox')){
                    const [{seq} = {seq:0}] = await all<{seq:number}>('SELECT seq FROM sqlite_sequence WHERE name=?',[table])
                    if(!Number.isSafeInteger(seq))throw new Error('Unsafe SQLite store sequence')
                    if(seq > 0)await output.query('SELECT setval(pg_get_serial_sequence($1,$2),$3::bigint,true)',[`public.${table}`,table === 'inbox' ? 'id' : 'seq',seq])
                }
                // Upgrades from before receipt tracking should behave as they did
                // when first opened by the newer SQLite implementation.
                if(table === 'inbox' && !(await all<{name:string}>('SELECT name FROM pragma_table_info(?)',['inbox'])).some(column=>column.name === 'telegramTracked')){
                    await output.query('UPDATE inbox SET telegramTracked=1 WHERE requestId IS NOT NULL AND status=\'submitted\'; UPDATE inbox SET telegramStatus=\'unverified\' WHERE telegramTracked=0 AND telegramStatus IN (\'none\',\'pending\',\'failed\',\'unknown\',\'syncing\');')
                }
            }
        } finally {
            await all('ROLLBACK').catch(()=>undefined)
            await new Promise<void>((resolve,reject)=>source.close(error=>error ? reject(error) : resolve()))
        }
    }
    await output.query('INSERT INTO public.app_settings (name,value) VALUES ($1,$2)',[postgresStoreMarker,'1'])
}