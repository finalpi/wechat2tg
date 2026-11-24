import dotenv from 'dotenv'
import {initializeSettings} from './settings-db'
import {safeErrorDetails} from '../util/SafeError'
import {databaseErrorHint} from '../DatabaseOptions'

// Configure connections without starting Telegram or WeChat clients.
dotenv.config()
void initializeSettings().then(async()=>{
    const {config} = await import('../config')
    const {startWebUI} = await import('./server')
    startWebUI(config)
}).catch(error=>{
    console.error('无法打开配置数据库',databaseErrorHint(error) ?? safeErrorDetails(error))
    process.exitCode = 1
})