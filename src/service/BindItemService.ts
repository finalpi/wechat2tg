import {BindItem} from '../models/BindItem'
import {Database} from 'sqlite3'
import {RoomItem} from "../models/RoomItem";
import {ContactItem} from "../models/ContactItem";

export class BindItemService{
    private db: Database
    constructor(db: Database) {
        this.db = db
        // 初始化表
        this.db.serialize(() => {
            this.db.get('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'tb_bind_item\'', (err, row) => {
                if (!row) {
                    // 如果表不存在，则创建表
                    this.db.run('CREATE TABLE tb_bind_item (name TEXT, chat_id INT, type INT, bind_id TEXT, alias TEXT)')
                }
            })
        })
    }
    public getAllBindItems(): Promise<BindItem[]> {
        return new Promise((resolve, reject) => {
            this.db.all('SELECT * FROM tb_bind_item', (err, rows: BindItem[]) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(rows)
                }
            })
        })
    }

    public updateItem(roomList: RoomItem[], contactMap: Map<number, Set<ContactItem>> | undefined) {
        // TODO 重新登录时更新group的信息
    }
}