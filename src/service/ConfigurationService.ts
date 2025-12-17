import {ConfigurationRepository} from '../repository/ConfigurationRepository'
import {Configuration} from '../entity/Configuration'
import {AppDataSource} from '../data-sourse'
import {Settings} from '../entity/Settings'
import I18n from '../i18n'

export class ConfigurationService {
    private configurationRepository = ConfigurationRepository.getInstance()
    private static instance
    private _i18n: I18n | null = null

    // 懒加载i18n实例
    private get i18n(): I18n {
        if (!this._i18n) {
            this._i18n = I18n.getInstance()
        }
        return this._i18n
    }

    static getInstance(): ConfigurationService {
        if (!ConfigurationService.instance) {
            ConfigurationService.instance = new ConfigurationService()
        }
        return ConfigurationService.instance
    }

    constructor() {
        //
    }

    async getConfig(): Promise<Configuration> {
        return await this.configurationRepository.getOne()
    }

    async getSetting() {
        const config = await this.getConfig()
        const settingMap = new Map<string, Settings<any>>()
        // 质量压缩
        // this.setBooleanOptions(settingMap,'compression',config.compression, '媒体质量压缩')

        // 文件传输助手
        // this.setBooleanOptions(settingMap, 'useFileHelper', config.useFileHelper, '文件传输助手接收视频和文件')

        // 公众号消息
        this.setBooleanOptions(settingMap, 'receivePublicAccount', config.receivePublicAccount, this.i18n.t('settings.receive_public_account'))

        // 公众号仅接收通知消息
        this.setBooleanOptions(settingMap, 'onlyReceiveOfficialNotify', config.onlyReceiveOfficialNotify, this.i18n.t('settings.only_receive_official_notify'))

        // 原始 emoji 是否以图片链接方式显示
        this.setBooleanOptions(settingMap, 'emojiPicture', config.emojiPicture, this.i18n.t('settings.emoji_picture'))

        // 转发自己发送的消息
        this.setBooleanOptions(settingMap, 'selfMessage', config.selfMessage, this.i18n.t('settings.self_message'))

        // 启动时同步群组信息
        this.setBooleanOptions(settingMap, 'syncWechat', config.syncWechat, this.i18n.t('settings.sync_wechat'))

        // 语音转文字
        this.setBooleanOptions(settingMap, 'autoTranscript', config.autoTranscript, this.i18n.t('settings.auto_transcript'))

        return settingMap
    }

    private setBooleanOptions(settingMap: Map<string, Settings<any>>, key: string, value: boolean, description: string) {
        const booleanSettings = new Settings<boolean>()
        booleanSettings.description = description
        booleanSettings.value = value
        const options = new Map<boolean, string>()
        options.set(true, this.i18n.t('settings.option_on'))
        options.set(false, this.i18n.t('settings.option_off'))
        booleanSettings.options = options
        settingMap.set(key, booleanSettings)
    }

    async saveConfig(config: Configuration) {
        return this.configurationRepository.updateConfig(config)
    }
}