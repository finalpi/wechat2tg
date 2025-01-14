import 'reflect-metadata'
import {AppDataSource} from './data-sourse'
import {Configuration} from './entity/Configuration'
import {TelegramBotClient} from './client/TelegramBotClient'

AppDataSource.initialize()
    .then(async () => {
        TelegramBotClient.getInstance().start()
    })
    .catch((error) => console.log(error))