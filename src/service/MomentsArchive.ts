import fs from 'node:fs'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import type {Moment} from './WechatMoments'
import {BotStorePostgres} from '../BotStorePostgres'
import {storeFile} from '../BotStoreSchema'

export type MomentsContact = {id:string;name:string}
export type ArchivedMoment = {post:Moment;expectedPhotos:number;images:Buffer[]}
export const momentsDay = 24 * 60 * 60 * 1000

export class MomentsArchive {
    private db:sqlite3.Database
    private ready:Promise<void>
    private pg?:BotStorePostgres
    constructor(file?:string) {
        this.pg = BotStorePostgres.configured('moments',file)
        if(this.pg){
            this.ready = this.pg.initialize('moments','')
            void this.ready.catch(()=>undefined)
            return
        }
        file ??= storeFile('moments')
        fs.mkdirSync(path.dirname(file),{recursive:true})
        if(!fs.existsSync(file))fs.closeSync(fs.openSync(file,'wx',0o600))
        fs.chmodSync(file,0o600)
        this.ready = new Promise((resolve,reject)=>{
            this.db = new sqlite3.Database(file,error=>{
                if(error)return reject(error)
                this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
                    CREATE TABLE IF NOT EXISTS moments_contacts (
                      scope TEXT NOT NULL, target TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL,
                      PRIMARY KEY(scope,target));
                    CREATE TABLE IF NOT EXISTS moments_posts (
                      scope TEXT NOT NULL, target TEXT NOT NULL, id TEXT NOT NULL, published INTEGER NOT NULL,
                      post TEXT NOT NULL, images TEXT NOT NULL, PRIMARY KEY(scope,target,id));
                    CREATE TABLE IF NOT EXISTS moments_daily (
                      scope TEXT NOT NULL, target TEXT NOT NULL, last_attempt INTEGER NOT NULL,
                      PRIMARY KEY(scope,target));
                    CREATE INDEX IF NOT EXISTS moments_posts_order ON moments_posts(scope,target,published DESC);`,err=>err ? reject(err) : resolve())
            })
        })
        void this.ready.catch(()=>undefined)
    }
    private async run(sql:string,args:unknown[]) {
        await this.ready
        if(this.pg)return this.pg.changes(sql,args)
        return new Promise<number>((resolve,reject)=>this.db.run(sql,args,function(error){error ? reject(error) : resolve(this.changes)}))
    }
    private async rows<T>(sql:string,args:unknown[]) {
        await this.ready
        if(this.pg)return this.pg.rows<T>(sql,args)
        return new Promise<T[]>((resolve,reject)=>this.db.all<T>(sql,args,(error,rows)=>error ? reject(error) : resolve(rows)))
    }
    async enabled(scope:string,target:string):Promise<boolean> {
        const [row] = await this.rows<{enabled:number}>('SELECT enabled FROM moments_contacts WHERE scope=? AND target=?',[scope,target])
        return row?.enabled === 1
    }
    async contacts(scope:string,limit = 12,offset = 0):Promise<MomentsContact[]> {
        return this.rows('SELECT target AS id,name FROM moments_contacts WHERE scope=? ORDER BY enabled DESC,name,target LIMIT ? OFFSET ?',[scope,limit,offset])
    }
    async rememberContact(scope:string,target:MomentsContact) {
        await this.run(`INSERT INTO moments_contacts(scope,target,name,enabled)
            SELECT ?,?,?,0 WHERE (SELECT COUNT(*) FROM moments_contacts) < 2000 ON CONFLICT DO NOTHING`,[scope,target.id,target.name])
        if(!(await this.rows('SELECT 1 FROM moments_contacts WHERE scope=? AND target=?',[scope,target.id])).length)
            throw new Error('本机的朋友圈归档联系人已达上限。')
    }
    async due(scope:string,now:number,limit = 5):Promise<MomentsContact[]> {
        return this.rows(`SELECT c.target AS id,c.name FROM moments_contacts c
            LEFT JOIN moments_daily d ON d.scope=c.scope AND d.target=c.target
            WHERE c.scope=? AND c.enabled=1 AND COALESCE(d.last_attempt,0)<=?
            ORDER BY COALESCE(d.last_attempt,0),c.target LIMIT ?`,[scope,now - momentsDay,limit])
    }
    async claimDaily(scope:string,target:string,now:number) {
        return (await this.run(`INSERT INTO moments_daily(scope,target,last_attempt)
            SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM moments_contacts WHERE scope=? AND target=? AND enabled=1)
            ON CONFLICT(scope,target) DO UPDATE SET last_attempt=excluded.last_attempt
            WHERE moments_daily.last_attempt<=?`,[scope,target,now,scope,target,now - momentsDay])) === 1
    }
    async has(scope:string,target:string,id:string):Promise<boolean> {
        return Boolean((await this.rows('SELECT 1 FROM moments_posts WHERE scope=? AND target=? AND id=?',[scope,target,id])).length)
    }
    async setEnabled(scope:string,target:MomentsContact,enabled:boolean) {
        await this.run(`INSERT INTO moments_contacts(scope,target,name,enabled)
            SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM moments_contacts) < 2000 OR EXISTS(SELECT 1 FROM moments_contacts WHERE scope=? AND target=?)
            ON CONFLICT(scope,target) DO UPDATE SET enabled=excluded.enabled,name=excluded.name`,[scope,target.id,target.name,enabled ? 1 : 0,scope,target.id])
        if(enabled && !await this.enabled(scope,target.id))throw new Error('本机的朋友圈归档联系人已达上限。')
    }
    async save(scope:string,post:Moment,images:Buffer[],explicit = false):Promise<boolean> {
        if(images.length > 9 || images.reduce((sum,image)=>sum + image.length,0) > 8 * 1024 * 1024)throw new Error('朋友圈图片超过单条归档上限。')
        const snapshot = JSON.stringify({post:{...post,photos:[]},expectedPhotos:post.photos.length})
        const encoded = JSON.stringify(images.map(image=>image.toString('base64')))
        const inserted = await this.run(`INSERT INTO moments_posts(scope,target,id,published,post,images)
            SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM moments_contacts WHERE scope=? AND target=? AND (enabled=1 OR ?=1))
            AND (SELECT COUNT(*) FROM moments_posts) < 2000
            AND (SELECT COALESCE(SUM(length(post)+length(images)),0) FROM moments_posts) + ? <= ?
            ON CONFLICT DO NOTHING`,
        [scope,post.target,post.id,post.time,snapshot,encoded,scope,post.target,explicit ? 1 : 0,Buffer.byteLength(snapshot) + encoded.length,128 * 1024 * 1024])
        if(inserted)return true
        if((explicit || await this.enabled(scope,post.target)) && !await this.has(scope,post.target,post.id))
            throw new Error('朋友圈归档已达上限，仍可查看线上内容。')
        return false
    }
    async at(scope:string,target:string,offset:number):Promise<ArchivedMoment|undefined> {
        const [row] = await this.rows<{post:string;images:string}>(`SELECT post,images FROM moments_posts WHERE scope=? AND target=?
            ORDER BY published DESC,length(id) DESC,id DESC LIMIT 1 OFFSET ?`,[scope,target,offset])
        if(!row)return
        try {
            const snapshot = JSON.parse(row.post)
            const images = (JSON.parse(row.images) as string[]).map(image=>Buffer.from(image,'base64'))
            return {...snapshot,images}
        } catch {throw new Error('这条本地归档无法读取。')}
    }
    async count(scope:string,target:string):Promise<number> {
        const [row] = await this.rows<{total:number}>('SELECT COUNT(*) AS total FROM moments_posts WHERE scope=? AND target=?',[scope,target])
        return row.total
    }
    async clear(scope:string,target:string) {await this.run('DELETE FROM moments_posts WHERE scope=? AND target=?',[scope,target])}
    async close() {if(this.pg){await this.ready.catch(()=>undefined);return this.pg.close()}await this.ready;await new Promise<void>((resolve,reject)=>this.db.close(error=>error ? reject(error) : resolve()))}
}