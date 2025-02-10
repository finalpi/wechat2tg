import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'
import {BindGroup} from './entity/BindGroup'
import {Message} from './entity/Message'
import fs from 'node:fs'
import {WxContact} from './entity/WxContact'
import {WxRoom} from './entity/WxRoom'

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/wx2tg.db',
    entities: [Configuration, BindGroup, Message],
    synchronize: true,
})

export const GeWeChatDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/' + getGeWeChatDataSource() + '.db',
    // database: 'wx_J2acELrtPBGJqoEffcNWL.db',
    entities: [WxContact,WxRoom],
    logger: 'debug',
    logging: 'all',
    synchronize: true,
})


function getGeWeChatDataSource(): string {
    // 读取 ds.json 文件，获取数据库文件路径
    try {
        const dsJson = fs.readFileSync('storage/ds.json', 'utf-8')
        const ds = JSON.parse(dsJson)
        return ds.appid
    } catch (e) {
        console.error('读取 ds.json 文件失败')
    }
}