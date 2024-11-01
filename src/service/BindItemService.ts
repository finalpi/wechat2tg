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

export class BindItemService extends AbstractSqlService {
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
        this.createManualBindTable()
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

    /**
     * 更新 chatId 的 allow_entities ！！注意没有 chatId 会更新所有的
     * @param chatId 群聊id
     * @param allows
     */
    public async addAllowEntityByChat(chatId: number, allows: string[]) {
        this.db.serialize(() => {
            // 查询已经存在的 allow_entities
            this.db.get('SELECT json_array(allow_entities) FROM tb_bind_item WHERE chat_id = ?', [chatId], (err, row) => {
                this.logError('addAllowEntityByChat Error: ', err)
                let exitAllows: string[] = []
                if (row) {
                    exitAllows = row as string[]
                }
                exitAllows.push(...allows)
                // 去处重复元素
                const insertAllows = Array.from(new Set(exitAllows))

                let allowEntitiesJsonArraySql = ''
                const params = []
                for (let i = 0; i < insertAllows.length; i++) {
                    const sql = `'$[' || (json_array_length(allow_entities) + ${i}) || ']', ?`
                    params.push(insertAllows[i])
                    if (i !== insertAllows.length - 1) {
                        allowEntitiesJsonArraySql += sql + ','
                    } else {
                        allowEntitiesJsonArraySql += sql
                    }
                }
                const updateAllowEntitiesSql = `json_insert(allow_entities, ${allowEntitiesJsonArraySql})`
                const sql = chatId ? `UPDATE tb_bind_item
                                      SET allow_entities = ${updateAllowEntitiesSql}
                                      WHERE chat_id = ?`
                    : `UPDATE tb_bind_item
                       SET allow_entities = ${updateAllowEntitiesSql}`
                if (chatId) {
                    params.push(chatId)
                }
                // console.log('SQL:', sql)
                // console.log('Params:', params)
                this.db.prepare(sql, params).run().finalize((err) => {
                    this.logError('addAllowEntityByChat Error: ', err)
                })
            })
        })
    }

    public bindContacts(bindItem: BindItem, contacts: Set<ContactItem>): ContactItem | undefined {
        if (contacts) {
            let find
            for (const contactItem of contacts) {
                if (contactItem.contact.id === bindItem.wechat_id) {
                    find = contactItem
                    break
                }
            }
            // 先根据 wechat_id 绑定
            if (find) {
                this.bindContact(find, bindItem)
                return find
            }
            // 再根据备注绑定
            if (bindItem.alias && bindItem.alias !== '') {
                const aliasList = []
                for (const contactItem of contacts) {
                    if (contactItem.contact.payload?.alias === bindItem.alias) {
                        if (!find) {
                            find = contactItem
                        }
                        aliasList.push(contactItem)
                    }
                }
                if (find) {
                    // 如果存在多个别名相同的用户,再根据微信名绑定
                    if (aliasList.length > 1) {
                        find = aliasList.find(i => i.contact.payload?.name === bindItem.name)
                    }
                    this.bindContact(find, bindItem)
                    return find
                }
            }
            for (const contactItem of contacts) {
                if (contactItem.contact.payload?.name === bindItem.name) {
                    find = contactItem
                    break
                }
            }
            // 最后根据昵称进行绑定
            if (find) {
                this.bindContact(find, bindItem)
                return find
            }
            this.bindErr(bindItem.chat_id)
        }
    }

    private bindContact(find, bindItem: BindItem) {
        const name = find.contact.payload?.name
        this.bindGroup({
            name: name ? name : '',
            chat_id: bindItem.chat_id,
            type: bindItem.type,
            bind_id: find.id,
            alias: find.contact.payload?.alias ? find.contact.payload.alias : '',
            wechat_id: find.contact.id,
            avatar: find.contact.payload?.avatar ? find.contact.payload?.avatar : ''
        })
    }

    public async updateItem(roomList: RoomItem[], contactMap: Map<number, Set<ContactItem>> | undefined) {
        const allBindItem = await this.getAllBindItems()
        const individual = contactMap?.get(ContactImpl.Type.Individual)
        const official = contactMap?.get(ContactImpl.Type.Official)
        for (const bindItem of allBindItem) {
            // 绑定联系人
            if (bindItem.type === 0) {
                const find = this.bindContacts(bindItem, individual)
                if (!find) {
                    this.bindContacts(bindItem, official)
                }
            } else {
                // 群组绑定,先根据wechat_id绑定
                let room = roomList.find(item => item.room.id === bindItem.wechat_id)
                if (room) {
                    this.bindRoom(room, bindItem)
                    continue
                }
                // room不存在根据名称重新绑定room
                const roomResult = roomList.filter(item => item.room.payload?.topic === bindItem.name)
                if (roomResult.length === 1) {
                    room = roomResult[0]
                    this.bindRoom(room, bindItem)
                    continue
                } else if (roomResult.length > 1) {
                    // 说明有重名,先根据seq判断如果匹配不上,则根据与群人数做差取绝对值最小的绑定
                    room = roomResult.find(i => this.getseq(i.room.payload.avatar) === bindItem.avatar)
                    if (room) {
                        this.bindRoom(room, bindItem)
                        continue
                    } else {
                        const roomResultSort = roomResult.sort((a, b) => ((Math.abs(a.room.payload.memberIdList.length - bindItem.room_number)) - (Math.abs(b.room.payload.memberIdList.length - bindItem.room_number))))
                        room = roomResultSort[0]
                        this.bindRoom(room, bindItem)
                        continue
                    }
                }
                this.bindErr(bindItem.chat_id)
            }
        }
    }

    private bindRoom(room: RoomItem, bindItem: BindItem) {
        const topic = room.room.payload?.topic
        this.bindGroup({
            name: topic ? topic : '',
            chat_id: bindItem.chat_id,
            type: bindItem.type,
            bind_id: room.id,
            alias: '',
            wechat_id: room.room.id,
            avatar: room.room.payload.avatar,
            room_number: room.room.payload.memberIdList.length
        })
    }

    public bindErr(chatId: number) {
        const stmt = this.db.prepare('UPDATE tb_bind_item SET has_bound=0 WHERE chat_id=?')
        stmt.run(chatId)
        stmt.finalize()
    }

    // 如果item别名或者头像变化则更新
    public async updateGroupData(bindItem: BindItem, newBindItem: BindItem) {
        // 获取群组管理员列表
        const administrators = await this.tgBotClient.telegram.getChatAdministrators(bindItem.chat_id)

        // 检查机器人是否在管理员列表中
        const me = await this.tgBotClient.telegram.getMe()
        const botId = me.id
        const isAdmin = administrators.some(admin => admin.user.id === botId)
        if (isAdmin) {
            if (newBindItem.name !== bindItem.name || newBindItem.alias !== bindItem.alias) {
                // 更新群组名称
                await this.tgBotClient.telegram.setChatTitle(bindItem.chat_id, `${newBindItem.alias}[${newBindItem.name}]`)
            }
            if (bindItem.avatar !== newBindItem.avatar && bindItem.type === 0) {
                // 更新头像
                const contact = await this.wechatyInterface.Contact.find({
                    id: newBindItem.wechat_id
                })
                if (contact) {
                    contact.avatar().then(fbox => {
                        fbox.toBuffer().then(async buff => {
                            await this.tgBotClient.telegram.setChatPhoto(bindItem.chat_id, {
                                source: buff
                            })
                        })
                    })
                }
            }
        }
    }

    // updateBindItem by groupId when bindItem has changed
    public updateBindItem(groupId: string, bindItem: BindItem) {
        this.db.serialize(() => {
            let query = 'UPDATE tb_bind_item SET '
            const params = []
            let first = true

            if (bindItem.name) {
                query += first ? 'name=?' : ', name=?'
                params.push(bindItem.name)
                first = false
            }
            if (bindItem.chat_id) {
                query += first ? 'chat_id=?' : ', chat_id=?'
                params.push(bindItem.chat_id)
                first = false
            }
            if (bindItem.type === 0 || bindItem.type === 1) {
                query += first ? 'type=?' : ', type=?'
                params.push(bindItem.type)
                first = false
            }
            if (bindItem.bind_id) {
                query += first ? 'bind_id=?' : ', bind_id=?'
                params.push(bindItem.bind_id)
                first = false
            }
            if (bindItem.alias) {
                query += first ? 'alias=?' : ', alias=?'
                params.push(bindItem.alias)
                first = false
            }
            if (bindItem.wechat_id) {
                query += first ? 'wechat_id=?' : ', wechat_id=?'
                params.push(bindItem.wechat_id)
                first = false
            }
            if (bindItem.avatar) {
                query += first ? 'avatar=?' : ', avatar=?'
                params.push(bindItem.avatar)
                first = false
            }
            if (bindItem.has_bound === 1 || bindItem.has_bound === 0) {
                query += first ? 'has_bound=?' : ', has_bound=?'
                params.push(bindItem.has_bound)
                first = false
            }
            if (bindItem.forward === 1 || bindItem.forward === 0) {
                query += first ? 'forward=?' : ', forward=?'
                params.push(bindItem.forward)
                first = false
            }
            if (bindItem.avatar_hash) {
                query += first ? 'avatar_hash=?' : ', avatar_hash=?'
                params.push(bindItem.avatar_hash)
                first = false
            }
            if (bindItem.allow_entities) {
                query += first ? 'allow_entities=?' : ', allow_entities=?'
                params.push(bindItem.allow_entities)
                first = false
            }
            if (bindItem.room_number) {
                query += first ? 'room_number=?' : ', room_number=?'
                params.push(bindItem.room_number)
                first = false
            }
            query += ' WHERE chat_id=?'
            params.push(groupId)

            const stmt = this.db.prepare(query)
            stmt.run(...params)
            stmt.finalize()
        })
    }

    public removeBindItemByChatId(chatId: number | string) {
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
            this.db.get('SELECT * FROM tb_bind_item WHERE chat_id= ? AND has_bound=1', [chatId], (err, row: BindItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }

    // 重新绑定,如果之前有绑定失败的群组,那么下次接受到消息就会重新绑定,防止多次创建群组
    public reBind(createGroupInterface: CreateGroupInterface): Promise<BindItem | undefined> {
        return new Promise(resolve => {
            let alias = ''
            let name = ''
            let wechatId = ''
            let avatar = ''
            if (createGroupInterface.type === 0) {
                alias = createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : ''
                name = createGroupInterface.contact?.payload?.name ? createGroupInterface.contact?.payload?.name : ''
                wechatId = createGroupInterface.contact?.id ? createGroupInterface.contact?.id : ''
                avatar = createGroupInterface.contact?.payload?.avatar ? createGroupInterface.contact?.payload?.avatar : ''
            } else {
                name = createGroupInterface.room?.payload?.topic ? createGroupInterface.room?.payload?.topic : ''
                wechatId = createGroupInterface.room?.id ? createGroupInterface.room?.id : ''
            }
            this.db.serialize(() => {
                if (alias !== '') {
                    this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND alias=? AND has_bound=0', [createGroupInterface.type, alias], (err, row: BindItem) => {
                        if (err) {
                            console.log(err)
                        }
                        if (row) {
                            this.bindGroup({
                                name: name,
                                chat_id: row.chat_id,
                                type: createGroupInterface.type,
                                bind_id: createGroupInterface.bindId ? createGroupInterface.bindId : '',
                                alias: alias,
                                wechat_id: wechatId,
                                avatar: avatar
                            })
                            resolve(row)
                        } else {
                            this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND name=? AND has_bound=0', [createGroupInterface.type, name], (err, row: BindItem) => {
                                if (err) {
                                    console.log(err)
                                }
                                if (row) {
                                    this.bindGroup({
                                        name: name,
                                        chat_id: row.chat_id,
                                        type: createGroupInterface.type,
                                        bind_id: createGroupInterface.bindId ? createGroupInterface.bindId : '',
                                        alias: alias,
                                        wechat_id: wechatId,
                                        avatar: avatar
                                    })
                                    resolve(row)
                                } else {
                                    resolve(undefined)
                                }
                            })
                        }
                    })
                } else {
                    this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND name=? AND has_bound=0', [createGroupInterface.type, name], (err, row: BindItem) => {
                        if (err) {
                            console.log(err)
                        }
                        if (row) {
                            this.bindGroup({
                                name: name,
                                chat_id: row.chat_id,
                                type: createGroupInterface.type,
                                bind_id: createGroupInterface.bindId ? createGroupInterface.bindId : '',
                                alias: alias,
                                wechat_id: wechatId,
                                avatar: avatar
                            })
                            resolve(row)
                        } else {
                            resolve(undefined)
                        }
                    })
                }
            })
        })
    }

    // 绑定到tg群组
    public bindGroup(bind: BindItem) {
        // 提取头像的特征码存到数据库
        if (bind.avatar) {
            bind.avatar = this.getseq(bind.avatar)
        } else {
            bind.avatar = ''
        }
        this.db.serialize(() => {
            this.db.get('SELECT * FROM tb_bind_item WHERE chat_id= ?', [bind.chat_id], (err, row: BindItem) => {
                if (err) {
                    console.log(err)
                }
                if (row) {
                    this.updateGroupData(row, {
                        ...bind,
                        has_bound: 1,
                        forward: 1
                    })
                }
            })
            const stmt = this.db.prepare('DELETE FROM tb_bind_item WHERE wechat_id = ? OR chat_id = ?')
            stmt.run(bind.wechat_id, bind.chat_id)
            stmt.finalize()

            const stmt1 = this.db.prepare(`INSERT INTO tb_bind_item (
                name, chat_id, type, bind_id, alias, wechat_id, 
                avatar, has_bound, forward, avatar_hash, allow_entities, room_number
            ) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`)
            stmt1.run(
                bind.name, bind.chat_id, bind.type,
                bind.bind_id, bind.alias, bind.wechat_id, bind.avatar, bind.avatar_hash, bind.allow_entities, bind.room_number
            )
            stmt1.finalize()
        })

        // 创建对象
        const bindItem: BindItem = {
            ...bind,
            has_bound: 1,
            forward: 1
        }

        // 返回对象
        return bindItem
    }

    private getseq(avatar: string) {
        const match = avatar.match(/seq=([^&]+)/)
        if (match) {
            avatar = match[1]
        }
        return avatar
    }

    public async bindGroupBetterArgs(concat: Contact | Room, chatId: number, bindId: string) {
        let name = ''
        let type: number
        let alias: string
        let wechatId: string
        if (DynamicService.isContact(concat)) {
            name = concat.name()
            type = 0
            alias = await concat.alias()
            wechatId = concat.id
        }
        if (DynamicService.isRoom(concat)) {
            name = await concat.topic()
            type = 1
            alias = ''
            wechatId = concat.id
        }
        // 群组绑定
        this.db.serialize(() => {
            const stmt = this.db.prepare('DELETE FROM tb_bind_item WHERE wechat_id = ? OR chat_id = ?')
            stmt.run(wechatId, chatId)
            stmt.finalize()

            const stmt1 = this.db.prepare('INSERT INTO tb_bind_item VALUES (?, ?, ?, ?, ?, ?, 1)')
            stmt1.run(name, chatId, type, bindId, alias, wechatId)
            stmt1.finalize()
        })
        this.tgBotClient.telegram.sendMessage(chatId, `绑定成功:${name}`, {disable_notification: true}).then(ctx => {
            setTimeout(() => {
                this.tgBotClient.telegram.deleteMessage(chatId, ctx.message_id)
            }, 10 * 1000)
        }).catch(e => {
            if (e.response.error_code === 403) {
                this.removeBindItemByChatId(chatId)
            }
        })

    }

    /**
     * 根据微信Id查询BindItem
     * @param wechatId 微信id
     */
    public getBindItemByWechatId(wechatId: string): Promise<BindItem> {
        return new Promise((resolve, reject) => {
            this.db.get('SELECT * FROM tb_bind_item WHERE wechat_id= ? AND has_bound=1', [wechatId], (err, row: BindItem) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(row)
                }
            })
        })
    }
}