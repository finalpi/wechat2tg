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

    public list(chatId: number): Promise<AllowForward []> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM allow_forward WHERE chat_id = ?', [chatId], (err, rows: AllowForward[]) => {
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
            const stmt = this.db.prepare('INSERT INTO allow_forward_entities (allow_forward_id, entity_id) VALUES (?, ?)')
            for (const allowForwardEntity of allowForwardEntities) {
                stmt.run(allowForwardEntity.allow_forward_id, allowForwardEntity.entity_id)
            }
            stmt.finalize((err) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(allowForwardEntities.length)
                }
            })
        })
    }

}