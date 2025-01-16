import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {ClientFactory} from './client/factory/ClientFactory'

AppDataSource.initialize()
    .then(async () => {
        new ClientFactory().create('botClient').login()
    })
    .catch((error) => console.log(error))