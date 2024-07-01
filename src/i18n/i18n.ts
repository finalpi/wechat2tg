import en from './locales/en'
import zh from './locales/zh'

type Translations = typeof en; // 假设所有语言文件的结构相同

export default class I18n {
    private translations: Translations
    private currentLanguage: string
    private static singleInstance: I18n

    private constructor(defaultLanguage = 'zh') {
        this.currentLanguage = defaultLanguage
        this.translations = this.loadTranslations(defaultLanguage)
    }

    public static grable(language = 'zh'): I18n {
        if (!I18n.singleInstance) {
            I18n.singleInstance = new I18n(language)
        }
        return I18n.singleInstance
    }

    private loadTranslations(language: string): Translations {
        switch (language) {
            case 'en':
                return en
            case 'zh':
                return zh
            default:
                console.warn(`Translation file for language "${language}" not found.`)
                return zh // fallback to default language
        }
    }

    public setLanguage(language: string): void {
        this.currentLanguage = language
        this.translations = this.loadTranslations(language)
    }

    public t(key: string): string {
        return this.getNestedTranslation(this.translations, key.split('.')) || key
    }

    private getNestedTranslation(translations: Translations, keys: string[]): any {
        return keys.reduce((result, key) => result ? result[key] : undefined, translations)
    }
}