import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'
import {BindGroup} from './entity/BindGroup'
import {Message} from './entity/Message'

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/wx2tg.db',
    entities: [Configuration, BindGroup, Message],
    synchronize: true,
})