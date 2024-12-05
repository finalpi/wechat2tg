import BaseSqlService from './BaseSqlService'
import {AllowForward, AllowForwardEntities} from '../model/AllowForwardEntity'

export default class AllowForwardService extends BaseSqlService {
    private static instance?: AllowForwardService

    public static getInstance(): AllowForwardService {
        if (!AllowForwardService.instance) {
            AllowForwardService.instance = new AllowForwardService()
        }
        return AllowForwardService.instance
    }

    private constructor() {
        super()
        super.createAllowForwardTable()
    }

    public one(chatId: number): Promise<AllowForward> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM allow_forward WHERE chat_id = ?', [chatId], (err, rows: AllowForward) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }

    public all(): Promise<AllowForward []> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM allow_forward', (err, rows: AllowForward[]) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }

    /**
     * 移除转发所有人
     * @param chat_id
     */
    public removeAll(chat_id: number) {
        this.db.exec('DELETE FROM allow_forward_entities ' +
            'WHERE allow_forward_id IN (' +
            '    SELECT af.id' +
            '    FROM allow_forward af' +
            `    WHERE af.chat_id = ${chat_id}` +
            ')')
        this.db.exec(`DELETE FROM allow_forward WHERE chat_id=${chat_id}`)
    }

    public listEntities(allowId: number): Promise<AllowForwardEntities []> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM allow_forward_entities WHERE allow_forward_id = ?', [allowId], (err, rows: AllowForwardEntities[]) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }

    public listAllEntities(): Promise<AllowForwardEntities []> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM allow_forward_entities', (err, rows: AllowForwardEntities[]) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }

    public createOrUpdate(allowForward: AllowForward): Promise<number> {
        return this.one(allowForward.chat_id).then(existingRecord => {
            if (existingRecord) {
                return this.updateByChatId(allowForward)
            } else {
                return this.add(allowForward)
            }
        })
    }

    public add(allowForward: AllowForward): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run('INSERT INTO allow_forward (chat_id, all_allow) VALUES (?, ?)', [allowForward.chat_id, allowForward.all_allow], function (err) {
                if (err) {
                    reject(err)
                } else {
                    resolve(this.lastID)
                }
            })
        })
    }

    public addEntitiesList(allowForwardEntities: AllowForwardEntities []): Promise<number> {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('INSERT INTO allow_forward_entities (allow_forward_id, entity_id, username) VALUES (?, ? ,?)')
            const promises = allowForwardEntities.map(allowForwardEntity => {
                return new Promise<void>((res, rej) => {
                    stmt.run(allowForwardEntity.allow_forward_id, allowForwardEntity.entity_id, allowForwardEntity.username, (err) => {
                        if (err) {
                            rej(err)
                        } else {
                            res()
                        }
                    })
                })
            })
            Promise.allSettled(promises).then(results => {
                stmt.finalize((err) => {
                    if (err) {
                        reject(err)
                    } else {
                        const successCount = results.filter(result => result.status === 'fulfilled').length
                        resolve(successCount)
                    }
                })
            })
        })
    }

    public updateByChatId(allowForward: AllowForward): Promise<number> {
        return new Promise((resolve, reject) => {
            this.db.run('UPDATE allow_forward SET all_allow = ? WHERE chat_id = ?', [allowForward.all_allow, allowForward.chat_id], function (err) {
                if (err) {
                    reject(err)
                } else {
                    resolve(this.lastID)
                }
            })
        })
    }

    public rmEntities({chatId, entityIds}: { chatId?: number, entityIds: number[] }) {
        return new Promise((resolve, reject) => {
            const sql = chatId ? 'DELETE FROM allow_forward_entities WHERE allow_forward_id = ? AND entity_id IN (?)'
                : 'DELETE FROM allow_forward_entities WHERE entity_id IN (?)'
            const stmt = this.db.prepare(sql)
            stmt.run(chatId ? [chatId, entityIds] : [entityIds], function (err) {
                if (err) {
                    reject(err)
                } else {
                    resolve(this.changes)
                }
            })
            stmt.finalize()
        })
    }
}