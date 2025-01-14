import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: 'storage/db/wx2tg.db',
    entities: [Configuration],
    synchronize: true,
})