import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {ClientFactory} from './client/factory/ClientFactory'
import {ConfigurationService} from './service/ConfigurationService'
import {LogUtils} from './util/LogUtil'
import {config} from './config'

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

AppDataSource.initialize()
    .then(async () => {
        ConfigurationService.getInstance().getConfig().then(()=>{
            new ClientFactory().create('botClient').login()
        })
    })
    .catch((error) => console.log(error))


process.on('uncaughtException', (err) => {
    LogUtils.config().getLogger('error').error('wechat2Tg uncaughtException', err)
})