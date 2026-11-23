import dotenv from 'dotenv'
import {SettingsDatabase} from './webui/settings-db'
import {safeErrorDetails} from './util/SafeError'

async function main() {
    dotenv.config()
    const action = process.argv[2]
    if(!['--import-env','--webui-token'].includes(action) || process.argv.length !== 3){
        console.error('Usage: node dist/settings-cli.js --import-env | --webui-token')
        process.exitCode = 2
        return
    }
    const db = await SettingsDatabase.open()
    try {
        if(action === '--import-env')console.log(`已导入 ${await db.importEnvironment(process.env)} 项原本未保存的应用配置。现有数据库配置未覆盖。`)
        else console.log(process.env.WEBUI_TOKEN || db.document('webui-token').read())
    } finally {await db.close()}
}

void main().catch(error=>{
    console.error('配置操作失败',safeErrorDetails(error))
    process.exitCode = 1
})