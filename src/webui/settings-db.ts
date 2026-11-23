import fs from 'node:fs'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {Database} from 'sqlite3'
import {persistedFields,validatePatch} from './schema'
import {readOverrides,settingsPath} from './store'

export const APP_DATABASE = 'storage/db/wx2tg.db'
export interface SettingsDocument {
    read(): string | undefined
    write(value:string): Promise<void>
}

export class SettingsDatabase {
    private constructor(private db:Database,private values:Map<string,string>) {}
    static async open(file = APP_DATABASE,legacyFile = settingsPath()):Promise<SettingsDatabase> {
        fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
        // This file now includes credentials. Also tighten permissions on upgraded installations.
        fs.closeSync(fs.openSync(file,'a',0o600))
        fs.chmodSync(file,0o600)
        const db = await new Promise<Database>((resolve,reject)=>{
            const connection = new Database(file,error=>error ? reject(error) : resolve(connection))
        })
        db.configure('busyTimeout',5000)
        const store = new SettingsDatabase(db,new Map())
        try {
            await store.run('CREATE TABLE IF NOT EXISTS app_settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)')
            await store.run('BEGIN IMMEDIATE')
            try {
                const rows = await new Promise<Array<{name:string;value:string}>>((resolve,reject)=>db.all('SELECT name, value FROM app_settings', (error,rows:Array<{name:string;value:string}>)=>error ? reject(error) : resolve(rows)))
                store.values = new Map(rows.map(({name,value})=>[name,value]))
                if(!store.values.has('legacy-v1'))await store.migrate(legacyFile,path.dirname(file))
                await store.run('COMMIT')
            } catch(error) {
                await store.run('ROLLBACK').catch(()=>undefined)
                throw error
            }
            return store
        } catch(error) {await store.close();throw error}
    }
    private run(sql:string,params:string[] = []):Promise<void> {
        return new Promise((resolve,reject)=>this.db.run(sql,params,error=>error ? reject(error) : resolve()))
    }
    close():Promise<void> {return new Promise((resolve,reject)=>this.db.close(error=>error ? reject(error) : resolve()))}
    document(name:string):SettingsDocument {
        return {
            read:()=>this.values.get(name),
            write:async value=>{
                await this.run('INSERT INTO app_settings (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value',[name,value])
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
        catch {throw new Error('Invalid application settings in SQLite')}
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
    settingsDatabase = await SettingsDatabase.open()
    startupOverrides = environmentOverrides(process.env)
    for(const [key,value] of Object.entries(settingsDatabase.savedEnvironment())) {
        if(startupOverrides[key] === undefined)process.env[key] = value
    }
}