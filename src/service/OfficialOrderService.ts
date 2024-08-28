import {BindItem} from '../model/BindItem'
import {RoomItem} from '../model/RoomItem'
import {ContactItem} from '../model/ContactItem'
import {ContactImpl, WechatyInterface} from 'wechaty/impls'
import {Telegraf} from 'telegraf'
import AbstractSqlService from './BaseSqlService'
import * as fs from 'fs'
import {Contact, Room} from 'wechaty'
import DynamicService from './DynamicService'
import {CreateGroupInterface} from '../model/CreateGroupInterface'
import {OfficialOrder} from '../model/OfficialOrder'

export class OfficialOrderService extends AbstractSqlService {
    private tgBotClient: Telegraf
    private wechatyInterface: WechatyInterface

    constructor(tgBotClient: Telegraf, wechatyInterface: WechatyInterface) {
        if (!fs.existsSync('storage/db')) {
            // 创建目录
            fs.mkdirSync('storage/db', {recursive: true})
        }
        super()
        this.tgBotClient = tgBotClient
        this.wechatyInterface = wechatyInterface
        // 初始化表
        this.createOfficialOrderTable()
    }

    public getOfficialOrderByOrderName(orderName: string): Promise<OfficialOrder> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_official_order WHERE order_name= ?', [orderName], (err, row: OfficialOrder) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }

    public getOfficialOrderById(id: string): Promise<OfficialOrder> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_official_order WHERE id= ?', [id], (err, row: OfficialOrder) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }

    public removeById(id: string): Promise<OfficialOrder> {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('DELETE FROM tb_official_order WHERE id = ?')
            stmt.run(id)
            stmt.finalize()
        })
    }

    /**
     * 添加message
     * @param item
     */
    public addOfficialOrder(item: OfficialOrder) {
        this.db.serialize(() => {
            const stmt = this.db.prepare('INSERT INTO tb_official_order VALUES (?, ?, ?, ?)')
            stmt.run(item.id, item.order_name, item.name, item.order_str, (err: Error | null) => {
                if (err) {
                    this._log.error('addOfficialOrder', err)
                }
            })
            stmt.finalize()
        })
    }

    public getAllOrder(): Promise<OfficialOrder[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM tb_official_order', (err, rows: OfficialOrder[]) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }
}