import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {ClientFactory} from './client/factory/ClientFactory'
import {ConfigurationService} from './service/ConfigurationService'
import {LogUtils} from './util/LogUtil'
import {WxContactRepository} from './repository/WxContactRepository'

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