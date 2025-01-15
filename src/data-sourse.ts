import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'
import {BindGroup} from './entity/BindGroup'

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/wx2tg.db',
    entities: [Configuration, BindGroup],
    synchronize: true,
})