import {ConfigurationRepository} from '../repository/ConfigurationRepository'
import {Configuration} from '../entity/Configuration'
import {AppDataSource} from '../data-sourse'
import {Settings} from '../entity/Settings'

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

    async getSetting(){
        const config = await this.getConfig()
        const settingMap = new Map<string, Settings<any>>()
        // 质量压缩
        // this.setBooleanOptions(settingMap,'compression',config.compression, '媒体质量压缩')

        // 文件传输助手
        this.setBooleanOptions(settingMap,'useFileHelper',config.useFileHelper, '文件传输助手接收视频和文件')

        // 公众号消息
        this.setBooleanOptions(settingMap,'receivePublicAccount',config.receivePublicAccount, '接收公众号消息')

        return settingMap
    }

    private setBooleanOptions(settingMap: Map<string, Settings<any>>,key: string,value: boolean, description: string) {
        const booleanSettings = new Settings<boolean>()
        booleanSettings.description = description
        booleanSettings.value = value
        const options = new Map<boolean, string>()
        options.set(true, '开启')
        options.set(false, '关闭')
        booleanSettings.options = options
        settingMap.set(key, booleanSettings)
    }

    async saveConfig(config: Configuration){
        return this.configurationRepository.updateConfig(config)
    }
}