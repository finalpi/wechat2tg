import dotenv from 'dotenv'
import {initializeSettings} from './webui/settings-db'
import {safeErrorDetails} from './util/SafeError'
import {databaseErrorHint} from './DatabaseOptions'

dotenv.config()
// Load the configured store before importing modules that snapshot settings.
void initializeSettings().then(()=>import('./run')).catch(error=>{
    console.error('无法启动配置数据库（旧文件未修改）',databaseErrorHint(error) ?? safeErrorDetails(error))
    process.exitCode = 1
})