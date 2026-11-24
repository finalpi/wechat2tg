import {DataSource} from 'typeorm'
import {Configuration} from './entity/Configuration'
import {BindGroup} from './entity/BindGroup'
import {Message} from './entity/Message'
import {OfficialAccountForum} from './entity/OfficialAccountForum'
import {OfficialAccountTopic} from './entity/OfficialAccountTopic'
import {APP_DATABASE,botPostgresOptions} from './DatabaseOptions'
import {safeInteger} from './entity/SafeInteger'

const entities = [Configuration,BindGroup,Message,OfficialAccountForum,OfficialAccountTopic]

class BotDataSource extends DataSource {
    protected async buildMetadatas() {
        await super.buildMetadatas()
        // SQLite INTEGER already stores signed 64-bit values. Preserve the old
        // column definitions so enabling this release does not rebuild SQLite tables.
        if(this.options.type === 'sqlite')for(const entity of this.entityMetadatas){
            for(const column of entity.columns){
                if(column.type === 'bigint' && column.transformer === safeInteger)column.type = 'integer'
            }
        }
    }
}

export function createBotDataSource(dsn:string|undefined, synchronize = true,file = APP_DATABASE) {
    const options = dsn ? botPostgresOptions(dsn) : {type:'sqlite' as const,database:file,busyTimeout:5000}
    return new BotDataSource({...options,entities,synchronize})
}