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
    async getOne():Promise<Configuration> {
        return await this.configurationRepository.findOneBy({
            id: 1,
        })
    }
    async updateConfig(config: Configuration) {
        return this.configurationRepository.save(config)
    }
}