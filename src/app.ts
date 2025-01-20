import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {ClientFactory} from './client/factory/ClientFactory'
import {ConfigurationService} from './service/ConfigurationService'

AppDataSource.initialize()
    .then(async () => {
        ConfigurationService.getInstance().getConfig().then(()=>{
            new ClientFactory().create('botClient').login()
        })
    })
    .catch((error) => console.log(error))