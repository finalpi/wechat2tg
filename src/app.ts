import dotenv from 'dotenv'
import {initializeSettings} from './webui/settings-db'
import {safeErrorDetails} from './util/SafeError'

dotenv.config()
// Load SQLite before importing modules that snapshot startup settings.
void initializeSettings().then(()=>import('./run')).catch(error=>{
    console.error('无法启动配置数据库（旧文件未修改）',safeErrorDetails(error))
    process.exitCode = 1
})