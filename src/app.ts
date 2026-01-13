import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {ClientFactory} from './client/factory/ClientFactory'
import {ConfigurationService} from './service/ConfigurationService'
import {LogUtils} from './util/LogUtil'
import {config} from './config'
import {MessageService} from './service/MessageService'

// 校验配置是否配置了必填项
if (!config.API_HASH){
    console.error('请配置 API_HASH')
    process.exit(1)
}
if (!config.API_ID){
    console.error('请配置 API_ID')
    process.exit(1)
}
if (!config.BOT_TOKEN){
    console.error('请配置 BOT_TOKEN')
    process.exit(1)
}

// 定时清理旧消息的任务
function scheduleOldMessageCleanup() {
    if (!config.AUTO_DELETE_OLD_MESSAGES) {
        LogUtils.config().getLogger('app').info('自动删除旧消息功能未启用')
        return
    }

    LogUtils.config().getLogger('app').info(`自动删除旧消息功能已启用，保留天数: ${config.MESSAGE_RETENTION_DAYS} 天`)

    // 立即执行一次清理
    cleanupOldMessages()

    // 每天凌晨 3 点执行清理任务
    const scheduleCleanup = () => {
        const now = new Date()
        const targetTime = new Date()
        targetTime.setHours(3, 0, 0, 0)

        // 如果今天的 3 点已经过了，则设置为明天 3 点
        if (now > targetTime) {
            targetTime.setDate(targetTime.getDate() + 1)
        }

        const timeUntilCleanup = targetTime.getTime() - now.getTime()

        setTimeout(() => {
            cleanupOldMessages()
            // 执行完后，重新安排下一次清理
            scheduleCleanup()
        }, timeUntilCleanup)

        LogUtils.config().getLogger('app').info(`下次消息清理时间: ${targetTime.toLocaleString('zh-CN')}`)
    }

    scheduleCleanup()
}

// 执行清理旧消息
async function cleanupOldMessages() {
    try {
        const messageService = MessageService.getInstance()
        const deletedCount = await messageService.deleteOldMessages(config.MESSAGE_RETENTION_DAYS)
        LogUtils.config().getLogger('app').info(`成功清理 ${deletedCount} 条旧消息（超过 ${config.MESSAGE_RETENTION_DAYS} 天）`)
    } catch (error) {
        LogUtils.config().getLogger('error').error('清理旧消息失败:', error)
    }
}

AppDataSource.initialize()
    .then(async () => {
        ConfigurationService.getInstance().getConfig().then(()=>{
            new ClientFactory().create('botClient').login()
            // 启动定时清理任务
            scheduleOldMessageCleanup()
        })
    })
    .catch((error) => console.log(error))


process.on('uncaughtException', (err) => {
    LogUtils.config().getLogger('error').error('wechat2Tg uncaughtException', err)
})