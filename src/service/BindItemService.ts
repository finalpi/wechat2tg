import {BindItem} from '../models/BindItem'
import {RoomItem} from '../models/RoomItem'
import {ContactItem} from '../models/ContactItem'
import {ContactImpl} from 'wechaty/impls'
import {Telegraf} from 'telegraf'
import AbstractSqlService from './BaseSqlService'
import * as fs from 'fs'
import {ContactInterface, RoomInterface, WechatyInterface} from 'wechaty/dist/esm/src/mods/impls'
import DynamicService from './DynamicService'
import {CreateGroupInterface} from '../models/CreateGroupInterface'

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

    public async updateItem(roomList: RoomItem[], contactMap: Map<number, Set<ContactItem>> | undefined) {
        const allBindItem = await this.getAllBindItems()
        const individual = contactMap?.get(ContactImpl.Type.Individual)
        const official = contactMap?.get(ContactImpl.Type.Official)
        for (const bindItem of allBindItem) {
            if (bindItem.type === 0) {
                if (individual) {
                    let find
                    for (const contactItem of individual) {
                        if (contactItem.contact.id === bindItem.wechat_id) {
                            find = contactItem
                            break
                        }
                    }
                    if (find) {
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                        continue
                    }
                    if (bindItem.alias && bindItem.alias !== '') {
                        const aliasList = []
                        for (const contactItem of individual) {
                            if (contactItem.contact.payload?.alias === bindItem.alias) {
                                if (!find) {
                                    find = contactItem
                                }
                                aliasList.push(contactItem)
                            }
                        }
                        if (find) {
                            // 处理同别名的情况
                            if (aliasList.length > 1) {
                                for (const aliasListElement of aliasList) {
                                    if (aliasListElement.contact.payload?.name === bindItem.name) {
                                        find = aliasListElement
                                        break
                                    }
                                }
                            }
                            const name = find.contact.payload?.name
                            this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                            continue
                        }
                    }
                    for (const contactItem of individual) {
                        if (contactItem.contact.payload?.name === bindItem.name) {
                            find = contactItem
                            break
                        }
                    }
                    if (find) {
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                        continue
                    }
                }
                if (official) {
                    let find
                    for (const contactItem of official) {
                        if (contactItem.contact.id === bindItem.wechat_id) {
                            find = contactItem
                            break
                        }
                    }
                    if (find) {
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                        continue
                    }
                    if (bindItem.alias && bindItem.alias != '') {
                        for (const contactItem of official) {
                            if (contactItem.contact.payload?.alias === bindItem.alias) {
                                find = contactItem
                                break
                            }
                        }
                        if (find) {
                            const name = find.contact.payload?.name
                            this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                            continue
                        }
                    }
                    for (const contactItem of official) {
                        if (contactItem.contact.payload?.name === bindItem.name) {
                            find = contactItem
                            break
                        }
                    }
                    if (find) {
                        const name = find.contact.payload?.name
                        this.bindGroup(name ? name : '', bindItem.chat_id, bindItem.type, find.id, find.contact.payload?.alias ? find.contact.payload.alias : '', find.contact.id, find.contact.payload?.avatar ? find.contact.payload?.avatar : '')
                        continue
                    }
                }
                this.bindErr(bindItem.chat_id)
            } else {
                let room = roomList.find(item => item.room.id === bindItem.wechat_id)
                if (room) {
                    const topic = room.room.payload?.topic
                    this.bindGroup(topic ? topic : '', bindItem.chat_id, bindItem.type, room.id, '', room.room.id, '')
                    continue
                }
                // room不存在根据名称重新绑定room
                room = roomList.find(item => item.room.payload?.topic === bindItem.name)
                if (room) {
                    const topic = room.room.payload?.topic
                    this.bindGroup(topic ? topic : '', bindItem.chat_id, bindItem.type, room.id, '', room.room.id, '')
                    continue
                }
                // 如果找不到则删除该元素
                // await this.tgBotClient.telegram.sendMessage(bindItem.chat_id, '找不到对应的绑定信息,请使用 /room 或者 /user 命令将联系人或者群组绑定').catch(e=>{
                //     if (e.response.error_code === 403 && bindItem){
                //         this.removeBindItemByChatId(bindItem.chat_id)
                //         return
                //     }
                // })
                this.bindErr(bindItem.chat_id)
            }
        }
    }

    public bindErr(chatId: number){
        const stmt = this.db.prepare('UPDATE tb_bind_item SET has_bound=0 WHERE chat_id=?')
        stmt.run(chatId)
        stmt.finalize()
    }

    public async updateGroupData(bindItem: BindItem, newBindItem: BindItem) {
        // 如果item别名或者头像变化则更新
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
            if (bindItem.avatar !== newBindItem.avatar) {
                // 更新头像
                const contact = await this.wechatyInterface.Contact.find({
                    id: newBindItem.wechat_id
                })
                if (contact){
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


    public reBind(createGroupInterface: CreateGroupInterface): Promise<BindItem | undefined>{
        return new Promise(resolve => {
            let alias = ''
            let name = ''
            let wechatId = ''
            let avatar = ''
            if (createGroupInterface.type === 0){
                alias = createGroupInterface.contact?.payload?.alias ? createGroupInterface.contact?.payload?.alias : ''
                name = createGroupInterface.contact?.payload?.name ? createGroupInterface.contact?.payload?.name : ''
                wechatId = createGroupInterface.contact?.id ? createGroupInterface.contact?.id : ''
                avatar = createGroupInterface.contact?.payload?.avatar ? createGroupInterface.contact?.payload?.avatar : ''
            }else {
                name = createGroupInterface.room?.payload?.topic ? createGroupInterface.room?.payload?.topic : ''
                wechatId = createGroupInterface.room?.id ? createGroupInterface.room?.id : ''
            }
            this.db.serialize(() => {
                if (alias !== ''){
                    this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND alias=? AND has_bound=0', [createGroupInterface.type,alias], (err, row: BindItem) => {
                        if (err) {
                            console.log(err)
                        }
                        if(row){
                            this.bindGroup(name,row.chat_id,createGroupInterface.type,createGroupInterface.bindId ? createGroupInterface.bindId : '',alias,wechatId,avatar)
                            resolve(row)
                        }else {
                            this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND name=? AND has_bound=0', [createGroupInterface.type,name], (err, row: BindItem) => {
                                if (err) {
                                    console.log(err)
                                }
                                if(row){
                                    this.bindGroup(name,row.chat_id,createGroupInterface.type,createGroupInterface.bindId ? createGroupInterface.bindId : '',alias,wechatId,avatar)
                                    resolve(row)
                                }else {
                                    resolve(undefined)
                                }
                            })
                        }
                    })
                }else {
                    this.db.get('SELECT * FROM tb_bind_item WHERE type= ? AND name=? AND has_bound=0', [createGroupInterface.type,name], (err, row: BindItem) => {
                        if (err) {
                            console.log(err)
                        }
                        if(row){
                            this.bindGroup(name,row.chat_id,createGroupInterface.type,createGroupInterface.bindId ? createGroupInterface.bindId : '',alias,wechatId,avatar)
                            resolve(row)
                        }else {
                            resolve(undefined)
                        }
                    })
                }
            })
        })
    }

    public bindGroup(name: string, chatId: number, type: number, bindId: string, alias: string, wechatId: string, avatar: string) {
        // 群组绑定
        avatar = this.getseq(avatar)
        this.db.serialize(() => {
            this.db.get('SELECT * FROM tb_bind_item WHERE chat_id= ?', [chatId], (err, row: BindItem) => {
                if (err) {
                    console.log(err)
                }
                if(row){
                   this.updateGroupData(row, {
                        name: name,
                        chat_id: chatId,
                        type: type,
                        bind_id: bindId,
                        alias: alias,
                        wechat_id: wechatId,
                        avatar: avatar,
                        has_bound: 1
                    })
                }
            })
            const stmt = this.db.prepare('DELETE FROM tb_bind_item WHERE wechat_id = ? OR chat_id = ?')
            stmt.run(wechatId, chatId)
            stmt.finalize()

            const stmt1 = this.db.prepare('INSERT INTO tb_bind_item VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
            stmt1.run(name, chatId, type, bindId, alias, wechatId, avatar)
            stmt1.finalize()
        })

        // this.tgBotClient.telegram.sendMessage(chatId, `绑定成功:${name}`,{disable_notification: true}).then(ctx => {
        //     setTimeout(() => {
        //         this.tgBotClient.telegram.deleteMessage(chatId, ctx.message_id)
        //     }, 10 * 1000)
        // }).catch(e => {
        //     if (e.response.error_code === 403) {
        //         this.removeBindItemByChatId(chatId)
        //     }
        // })

        // 创建对象
        const bindItem: BindItem = {
            name: name,
            chat_id: chatId,
            type: type,
            bind_id: bindId,
            alias: alias,
            wechat_id: wechatId,
            avatar: avatar,
            has_bound: 1
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

    public bindGroupBetterArgs(concat: ContactInterface | RoomInterface, chatId: number, bindId: string) {
        let name = ''
        let type: number
        let alias: string
        let wechatId: string
        if (DynamicService.isContact(concat)) {
            name = concat.payload?.name ? concat.payload.name : ''
            type = 0
            alias = concat.payload?.alias ? concat.payload.alias : ''
            wechatId = concat.id
        }
        if (DynamicService.isRoom(concat)) {
            name = concat.payload?.topic ? concat.payload.topic : ''
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
        this.tgBotClient.telegram.sendMessage(chatId, `绑定成功:${name}`,{disable_notification: true}).then(ctx => {
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
     * 根据微信Id查询BindItem （这是item实例的id...）
     * @param bindId
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