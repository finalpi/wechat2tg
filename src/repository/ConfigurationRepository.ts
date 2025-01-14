import {AppDataSource} from '../data-sourse'
import {Configuration} from '../entity/Configuration'
import {Repository} from 'typeorm/repository/Repository'

export class ConfigurationRepository {
    private configurationRepository: Repository<Configuration>
    private static instance
    static getInstance(): ConfigurationRepository {
        if (!ConfigurationRepository.instance) {
            ConfigurationRepository.instance = new ConfigurationRepository()
        }
        return ConfigurationRepository.instance
    }
    constructor() {
        this.configurationRepository = AppDataSource.getRepository(Configuration)
    }
    async initConfig() {
        // 初始化配置
        const configuration = new Configuration()
        configuration.id = 1
        return await this.configurationRepository.save(configuration)
    }
    async getOne():Promise<Configuration> {
        let config = await this.configurationRepository.findOneBy({
            id: 1,
        })
        if (!config) {
            config = await this.initConfig()
        }
        return config
    }
    async updateConfig(config: Configuration) {
        return this.configurationRepository.save(config)
    }
}