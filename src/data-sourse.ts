import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'
import {BindGroup} from './entity/BindGroup'
import {Message} from './entity/Message'
import {OfficialAccountForum} from './entity/OfficialAccountForum'
import {OfficialAccountTopic} from './entity/OfficialAccountTopic'
import fs from 'node:fs'
import {WxContact} from './entity/WxContact'
import {WxRoom} from './entity/WxRoom'
import {WeChatClient} from './client/WechatClient'

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/wx2tg.db',
    entities: [Configuration, BindGroup, Message, OfficialAccountForum, OfficialAccountTopic],
    synchronize: true,
})

let gewechatDataSource: DataSource

export function getGeWeChatDataSource(): DataSource {
    // 读取 ds.json 文件，获取数据库文件路径
    try {
        if (!gewechatDataSource) {
            gewechatDataSource = new DataSource({
                type: 'sqlite',
                database: 'storage/db/puppet.db',
                entities: [WxContact,WxRoom],
                logger: 'debug',
                logging: 'all',
                // The SDK owns puppet.db schema; this mirror must not remove SDK columns.
                synchronize: false,
            })
        }
        return gewechatDataSource
    } catch (e) {
        console.error('读取 ds.json 文件失败')
    }
}