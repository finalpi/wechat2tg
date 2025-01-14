import {ConfigurationRepository} from '../repository/ConfigurationRepository'
import {Configuration} from '../entity/Configuration'
import {AppDataSource} from '../data-sourse'

export class ConfigurationService {
    private configurationRepository = ConfigurationRepository.getInstance()
    private static instance
    static getInstance(): ConfigurationService {
        if (!ConfigurationService.instance) {
            ConfigurationService.instance = new ConfigurationService()
        }
        return ConfigurationService.instance
    }
    constructor() {
        //
    }
    async getConfig():Promise<Configuration>{
        return await this.configurationRepository.getOne()
    }

    async saveConfig(config: Configuration){
        return this.configurationRepository.updateConfig(config)
    }
}