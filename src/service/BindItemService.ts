import {BindItem} from '../models/BindItem'
import {Database} from 'sqlite3'
import {RoomItem} from '../models/RoomItem'
import {ContactItem} from '../models/ContactItem'
import {ContactImpl} from 'wechaty/impls'

export class BindItemService{
    private db: Database
    constructor(db: Database) {
        this.db = db
        // 初始化表
        this.db.serialize(() => {
            this.db.get('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'tb_bind_item\'', (err, row) => {
                if (!row) {
                    // 如果表不存在，则创建表
                    this.db.run('CREATE TABLE tb_bind_item (name TEXT, chat_id INT, type INT, bind_id TEXT, alias TEXT,wechat_id TEXT)')
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

    public async updateItem(roomList: RoomItem[], contactMap: Map<number, Set<ContactItem>> | undefined) {
        const allBindItem = await this.getAllBindItems()
        const individual = contactMap?.get(ContactImpl.Type.Individual)
        const official = contactMap?.get(ContactImpl.Type.Official)
        for (const bindItem of allBindItem) {
            if (bindItem.type === 0){
                if (individual){
                    let find
                    for (const contactItem of individual) {
                        if (contactItem.contact.id === bindItem.wechat_id){
                            find = contactItem
                            break
                        }
                    }
                    if (find){
                        continue
                    }
                    if (bindItem.alias && bindItem.alias != ''){
                        for (const contactItem of individual) {
                            if (contactItem.contact.payload?.alias === bindItem.alias){
                                find = contactItem
                                break
                            }
                        }
                        if (find){
                            const name = find.contact.payload?.name
                            this.bindGroup(name ? name : '',bindItem.chat_id,bindItem.type,find.id,find.contact.payload?.alias ? find.contact.payload.alias : '',find.contact.id)
                            continue
                        }
                    }
                    for (const contactItem of individual) {
                        if (contactItem.contact.payload?.name === bindItem.name){
                            find = contactItem
                            break
                        }
                    }
                    if (find){
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '',bindItem.chat_id,bindItem.type,find.id,find.contact.payload?.alias ? find.contact.payload.alias : '',find.contact.id)
                        continue
                    }
                    // 如果找不到则删除该元素
                    this.removeBindItemByChatId(bindItem.chat_id)
                }
                if (official){
                    let find
                    for (const contactItem of official) {
                        if (contactItem.contact.id === bindItem.wechat_id){
                            find = contactItem
                            break
                        }
                    }
                    if (find){
                        continue
                    }
                    if (bindItem.alias && bindItem.alias != ''){
                        for (const contactItem of official) {
                            if (contactItem.contact.payload?.alias === bindItem.alias){
                                find = contactItem
                                break
                            }
                        }
                        if (find){
                            const name = find.contact.payload?.name
                            this.bindGroup(name ? name : '',bindItem.chat_id,bindItem.type,find.id,find.contact.payload?.alias ? find.contact.payload.alias : '',find.contact.id)
                            continue
                        }
                    }
                    for (const contactItem of official) {
                        if (contactItem.contact.payload?.name === bindItem.name){
                            find = contactItem
                            break
                        }
                    }
                    if (find){
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '',bindItem.chat_id,bindItem.type,find.id,find.contact.payload?.alias ? find.contact.payload.alias : '',find.contact.id)
                        continue
                    }
                    // 如果找不到则删除该元素
                    this.removeBindItemByChatId(bindItem.chat_id)
                }
            }else {
                let room = roomList.find(item=>item.room.id === bindItem.wechat_id)
                if (room){
                    // room存在说明并未重新登录跳过
                    continue
                }
                // room不存在根据名称重新绑定room
                room = roomList.find(item=>item.room.payload?.topic === bindItem.name)
                if (room){
                    const topic = room.room.payload?.topic
                    this.bindGroup(topic ? topic : '',bindItem.chat_id,bindItem.type,room.id,'',room.room.id)
                    continue
                }
                // 如果找不到则删除该元素
                this.removeBindItemByChatId(bindItem.chat_id)
            }
        }
    }
    public removeBindItemByChatId(chatId: number){
        this.db.serialize(() => {
            const stmt = this.db.prepare('DELETE FROM tb_bind_item WHERE chat_id = ?')
            stmt.run(chatId)
            stmt.finalize()
        })
    }

    /**
     * 根据chatId查询BindItem
     * @param bindId
     */
    public getBindItemByChatId(chatId: number): Promise<BindItem> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_bind_item WHERE chat_id= ?',[chatId] , (err, row: BindItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }

    public bindGroup(name: string,chatId: number,type: number,bindId: string,alias: string,wechatId: string){
        // 群组绑定
        this.db.serialize(() => {
            const stmt = this.db.prepare('DELETE FROM tb_bind_item WHERE wechat_id = ? OR chat_id = ?')
            stmt.run(wechatId,chatId)
            stmt.finalize()

            const stmt1 = this.db.prepare('INSERT INTO tb_bind_item VALUES (?, ?, ?, ?, ?, ?)')
            stmt1.run(name,chatId,type,bindId,alias,wechatId)
            stmt1.finalize()
        })
    }

    /**
     * 根据微信Id查询BindItem
     * @param bindId
     */
    public getBindItemByWechatId(wechatId: string): Promise<BindItem> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_bind_item WHERE wechat_id= ?',[wechatId] , (err, row: BindItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }
}