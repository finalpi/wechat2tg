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
        this.configurationRepository.getOne().then(data => {
            if (!data) {
                this.init()
            }
        })
    }
    init() {
        // 初始化配置
        const configuration = new Configuration()
        configuration.id = 1
        AppDataSource.manager.save(configuration)
    }
    async getConfig(){
        return this.configurationRepository.getOne()
    }

    async saveConfig(config: Configuration){
        return this.configurationRepository.updateConfig(config)
    }
}