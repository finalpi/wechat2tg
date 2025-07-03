import { ConfigurationService } from '../service/ConfigurationService'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type Language = 'zh-CN' | 'en-US';

class I18n {
  private static instance: I18n
  private translations: Record<Language, Record<string, string>> = {
    'zh-CN': zhCN,
    'en-US': enUS
  }
  private currentLanguage: Language = 'zh-CN'
  private configurationService = ConfigurationService.getInstance()

  private constructor() {
    this.loadLanguageFromConfig()
  }

  private async loadLanguageFromConfig() {
    try {
      const config = await this.configurationService.getConfig()
      if (config && config.language) {
        this.setLanguage(config.language)
      }
    } catch (error) {
      console.error('Error loading language from config:', error)
    }
  }

  public static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n()
    }
    return I18n.instance
  }

  public setLanguage(language: Language): void {
    if (this.translations[language]) {
      this.currentLanguage = language
    } else {
      console.warn(`Language ${language} not found, using default`)
    }
  }

  public getLanguage(): Language {
    return this.currentLanguage
  }

  public t(key: string, params?: Record<string, string>): string {
    const translation = this.translations[this.currentLanguage]?.[key] || key
    if (params) {
      return Object.entries(params).reduce((result, [paramKey, paramValue]) => {
        return result.replace(new RegExp(`{{${paramKey}}}`, 'g'), paramValue)
      }, translation)
    }
    return translation
  }
}

export default I18n