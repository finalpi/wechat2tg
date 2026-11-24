import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {Database} from 'sqlite3'
import {Pool} from 'pg'
import {APP_DATABASE,BOT_SETTINGS_LOCK,BOT_TABLES,botPostgresDsn} from '../DatabaseOptions'
import {botStoreDefinitions,botStoreTables,postgresStoreMarker} from '../BotStoreSchema'
import {persistedFields,validatePatch} from './schema'
import {readOverrides,settingsPath} from './store'

export {APP_DATABASE}
const SETTINGS_TABLE_SQL = 'CREATE TABLE IF NOT EXISTS app_settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)'
export const POSTGRES_SETTINGS_TABLE_SQL = SETTINGS_TABLE_SQL.replace('app_settings','public.app_settings')
export const SQLITE_IMPORT_MARKER = 'sqlite-import-v1'

type SettingRow = {name:string;value:string}
const UPSERT = 'INSERT INTO app_settings (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value'
export interface SettingsDocument {
    read(): string | undefined
    write(value:string): Promise<void>
}

export class SettingsDatabase {
    private constructor(private values:Map<string,string>,private upsert:(name:string,value:string)=>Promise<void>,readonly close:()=>Promise<void>) {}
    static openConfigured():Promise<SettingsDatabase> {
        const dsn = botPostgresDsn()
        return dsn ? this.openPostgres(dsn) : this.open()
    }
    static async openPostgres(dsn:string,sqliteFile = APP_DATABASE,legacyFile = settingsPath()):Promise<SettingsDatabase> {
        const pool = new Pool({connectionString:dsn,connectionTimeoutMillis:5000,max:4,application_name:'wechat2tg-settings'})
        pool.on('error',()=>console.warn('[Settings] Idle PostgreSQL connection failed'))
        try {
            const client = await pool.connect()
            let query = (sql:string,params?:unknown[])=>client.query(sql,params)
            try {
                await query('BEGIN')
                await query('SELECT pg_advisory_xact_lock($1::bigint)',[BOT_SETTINGS_LOCK])
                const {rows:tables} = await query('SELECT tablename FROM pg_tables WHERE schemaname=$1',['public'])
                if(tables.some(({tablename})=>![...BOT_TABLES,...botStoreTables,'inbox_cursor'].includes(tablename))){
                    throw Object.assign(new Error('Dedicated bot database required'),{code:'BOT_PG_TARGET_NOT_EMPTY'})
                }
                await query(POSTGRES_SETTINGS_TABLE_SQL)
                const {rows} = await query('SELECT name, value FROM public.app_settings')
                const store = new SettingsDatabase(new Map(rows.map(({name,value}:SettingRow)=>[name,value])),async(name,value)=>{
                    await query(UPSERT.replace('app_settings','public.app_settings').replace('?,?','$1,$2'),[name,value])
                },()=>pool.end())
                if(!store.values.has(postgresStoreMarker)){
                    const directory = path.dirname(sqliteFile)
                    const existingPg = store.values.has('legacy-v1')
                    if(existingPg || botStoreDefinitions.some(({file})=>fs.existsSync(path.join(directory,file)))){
                        const code = existingPg ? 'BOT_PG_STORES_MIGRATION_REQUIRED' : 'BOT_PG_MIGRATION_REQUIRED'
                        throw Object.assign(new Error('Existing SQLite stores require an offline migration'),{code})
                    }
                    await store.document(postgresStoreMarker).write('1')
                }
                if(!store.values.has('legacy-v1')){
                    if(!store.values.has(SQLITE_IMPORT_MARKER) && fs.existsSync(sqliteFile)){
                        throw Object.assign(new Error('Run --migrate-postgres before enabling PostgreSQL for an existing SQLite database'),{code:'BOT_PG_MIGRATION_REQUIRED'})
                    }
                    await store.migrate(legacyFile,path.dirname(sqliteFile))
                }
                await query('COMMIT')
                query = (sql,params)=>pool.query(sql,params)
                return store
            } catch(error) {
                await query('ROLLBACK').catch(()=>undefined)
                throw error
            } finally {client.release()}
        } catch(error) {await pool.end();throw error}
    }
    static async open(file = APP_DATABASE,legacyFile = settingsPath()):Promise<SettingsDatabase> {
        fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
        // This file now includes credentials. Also tighten permissions on upgraded installations.
        fs.closeSync(fs.openSync(file,'a',0o600))
        fs.chmodSync(file,0o600)
        const db = await new Promise<Database>((resolve,reject)=>{
            const connection = new Database(file,error=>error ? reject(error) : resolve(connection))
        })
        db.configure('busyTimeout',5000)
        const run = (sql:string,params:string[] = []):Promise<void> => new Promise((resolve,reject)=>db.run(sql,params,error=>error ? reject(error) : resolve()))
        const store = new SettingsDatabase(new Map(),(name,value)=>run(UPSERT,[name,value]),()=>new Promise((resolve,reject)=>db.close(error=>error ? reject(error) : resolve())))
        try {
            await run(SETTINGS_TABLE_SQL)
            await run('BEGIN IMMEDIATE')
            try {
                const rows = await new Promise<SettingRow[]>((resolve,reject)=>db.all('SELECT name, value FROM app_settings', (error,rows:SettingRow[])=>error ? reject(error) : resolve(rows)))
                store.values = new Map(rows.map(({name,value})=>[name,value]))
                if(!store.values.has('legacy-v1'))await store.migrate(legacyFile,path.dirname(file))
                await run('COMMIT')
            } catch(error) {
                await run('ROLLBACK').catch(()=>undefined)
                throw error
            }
            return store
        } catch(error) {await store.close();throw error}
    }
    document(name:string):SettingsDocument {
        return {
            read:()=>this.values.get(name),
            write:async value=>{
                await this.upsert(name,value)
                this.values.set(name,value)
            },
        }
    }
    private async migrate(file:string,dbDirectory:string) {
        const legacyDir = path.dirname(file)
        const copy = async(name:string,filename:string,maxBytes:number,verify?:(raw:string)=>string)=>{
            const document = this.document(name)
            if(document.read() !== undefined || !fs.existsSync(filename))return
            if(fs.statSync(filename).size > maxBytes || (name === 'automations' && fs.lstatSync(filename).isSymbolicLink()))throw new Error(`Invalid legacy ${name} settings file`)
            const raw = fs.readFileSync(filename,'utf8')
            await document.write(verify ? verify(raw) : raw)
        }
        const environment = this.document('environment')
        if(environment.read() === undefined)await environment.write(JSON.stringify(readOverrides(file)))
        await copy('telegram-display-v1',path.join(dbDirectory,'..','telegram-display.json'),256 * 1024)
        await copy('automations',path.join(legacyDir,'automations.json'),16 * 1024 * 1024)
        await copy('mcp',path.join(legacyDir,'mcp-settings.json'),16384)
        await copy('mcp-token',path.join(legacyDir,'mcp-token'),1024,value=>value.trim())
        await copy('mcp-read-token',path.join(legacyDir,'mcp-read-token'),1024,value=>value.trim())
        await copy('webui-token',path.join(legacyDir,'webui-token'),1024,value=>value.trim())
        const token = this.document('webui-token')
        if(token.read() === undefined)await token.write(randomBytes(32).toString('hex'))
        for(const name of ['mcp-token','mcp-read-token']) {
            const credential = this.document(name)
            if(credential.read() === undefined)await credential.write(randomBytes(32).toString('hex'))
        }
        // Keep historical template backups as-is. The old template reset is not replayed.
        await this.document('legacy-v1').write('1')
    }
    savedEnvironment():Record<string,string> {
        try {return JSON.parse(this.document('environment').read() || '{}')}
        catch {throw new Error('Invalid persisted application settings')}
    }
    async saveEnvironment(values:Record<string,string>) {await this.document('environment').write(JSON.stringify(values))}
    /** Explicit opt-in for retiring legacy ENV-only application settings. Never replaces DB values. */
    async importEnvironment(environment:NodeJS.ProcessEnv):Promise<number> {
        const saved = this.savedEnvironment(),overrides = environmentOverrides(environment)
        const additions = Object.fromEntries(persistedFields.filter(field=>field.source === 'environment'
            && overrides[field.key] !== undefined && !Object.prototype.hasOwnProperty.call(saved,field.key))
            .map(({key,type})=>[key,type === 'boolean' && ['true','false'].includes(overrides[key]) ? overrides[key] === 'true' : overrides[key]]))
        const validated = validatePatch('environment',additions,true) as Record<string,string>
        await this.saveEnvironment({...saved,...validated})
        return Object.keys(validated).length
    }
}

export function environmentOverrides(environment:NodeJS.ProcessEnv):Record<string,string> {
    // Empty entries in existing .env templates are unset. Use explicit 'false'
    // for boolean overrides and remove the variable to return control to WebUI.
    return Object.fromEntries(persistedFields.filter(f=>f.source === 'environment' && environment[f.key]?.trim()).map(f=>[f.key,environment[f.key]]))
}

export let settingsDatabase:SettingsDatabase|undefined
export let startupOverrides:Record<string,string>|undefined
export async function initializeSettings() {
    settingsDatabase = await SettingsDatabase.openConfigured()
    startupOverrides = environmentOverrides(process.env)
    for(const [key,value] of Object.entries(settingsDatabase.savedEnvironment())) {
        if(startupOverrides[key] === undefined)process.env[key] = value
    }
}