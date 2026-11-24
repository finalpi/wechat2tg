import {DataSource} from 'typeorm'
import {WxContact} from './entity/WxContact'
import {WxRoom} from './entity/WxRoom'
import {createBotDataSource} from './BotDataSource'
import {botPostgresDsn} from './DatabaseOptions'

export const AppDataSource = createBotDataSource(botPostgresDsn())

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