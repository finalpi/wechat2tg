import dotenv from 'dotenv'
import {SettingsDatabase} from './webui/settings-db'
import {safeErrorDetails} from './util/SafeError'
import {botPostgresDsn,databaseErrorHint} from './DatabaseOptions'

async function main() {
    dotenv.config()
    const action = process.argv[2]
    if(!['--import-env','--webui-token','--migrate-postgres'].includes(action) || process.argv.length !== 3){
        console.error('Usage: node dist/settings-cli.js --import-env | --webui-token | --migrate-postgres')
        process.exitCode = 2
        return
    }
    if(action === '--migrate-postgres'){
        const dsn = botPostgresDsn()
        if(!dsn){
            console.error('迁移需要设置 BOT_POSTGRES_DSN')
            process.exitCode = 2
            return
        }
        const {migrateBotToPostgres} = await import('./BotPostgresMigration')
        console.log('Bot SQLite → PostgreSQL 迁移完成（各表行数）：',await migrateBotToPostgres(dsn))
        return
    }
    const db = await SettingsDatabase.openConfigured()
    try {
        if(action === '--import-env')console.log(`已导入 ${await db.importEnvironment(process.env)} 项原本未保存的应用配置。现有数据库配置未覆盖。`)
        else console.log(process.env.WEBUI_TOKEN || db.document('webui-token').read())
    } finally {await db.close()}
}

void main().catch(error=>{
    console.error('配置操作失败',databaseErrorHint(error) ?? safeErrorDetails(error))
    process.exitCode = 1
})