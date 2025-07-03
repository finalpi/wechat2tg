import * as fs from 'node:fs'
import * as path from 'node:path'
import { ConfigurationService } from '../service/ConfigurationService'

export type Language = 'zh-CN' | 'en-US';

class I18n {
  private static instance: I18n
  private translations: Record<string, Record<string, string>> = {}
  private currentLanguage: Language = 'zh-CN'
  private configurationService = ConfigurationService.getInstance()

  private constructor() {
    this.loadTranslations()
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

  private loadTranslations(): void {
    try {
      const localesDir = path.join(__dirname, 'locales')

      if (fs.existsSync(localesDir)) {
        const files = fs.readdirSync(localesDir)

        files.forEach(file => {
          if (file.endsWith('.json')) {
            const lang = file.replace('.json', '')
            const content = fs.readFileSync(path.join(localesDir, file), 'utf8')
            this.translations[lang] = JSON.parse(content)
          }
        })
      } else {
        console.warn('Locales directory not found, creating default structure')
        this.createDefaultLocales()
      }
    } catch (error) {
      console.error('Error loading translations:', error)
      this.createDefaultLocales()
    }
  }

  private createDefaultLocales(): void {
    try {
      const localesDir = path.join(__dirname, 'locales')

      if (!fs.existsSync(localesDir)) {
        fs.mkdirSync(localesDir, { recursive: true })
      }

      // 创建默认的中文翻译
      this.translations['zh-CN'] = {
        'login.welcome': '请输入 /login 登陆,或者输入 /help 查看帮助\n请注意执行/login 后你就是该机器的所有者',
        'login.already_logged_in': '已登录，请勿重复登录',
        'login.success': 'Telegram 客户端登录成功！',
        'login.group_not_allowed': '该命令无法在群组中使用',
        'login.please_login_wx': '请先登录微信',
        'logout.success': '退出登录成功',
        'help.title': '**欢迎使用微信消息转发bot**',
        'help.description': '[本项目](https://github.com/finalpi/wechat2tg)是基于 gewechty 开发的 pad 协议实现微信消息的收发。\n**本项目仅用于技术研究和学习，不得用于非法用途。**',
        'help.instructions': '1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录。\n2\\. 使用 /user 或者 /room 命令搜索联系人或者群聊（可以加名称或者备注,例如"/user 张"可以搜索名称或备注含有"张"的用户）。\n3\\. /settings 打开设置。\n4\\. 更多功能请查看 github 仓库（For more features, please check the GitHub repository README）。',
        'settings.title': '程序设置:',
        'settings.language': '界面语言',
        'settings.language_changed': '语言已切换为中文',
        'update.group_only': '仅支持群组中使用',
        'unbind.success': '解绑成功',
        'unbind.group_only': '仅支持群组中使用',
        'message.group_only': '仅支持群组中使用',
        'message.not_bound': '该群组暂未绑定',
        'message.status_prompt': '是否接收该群组消息',
        'message.status_receiving': '接收消息',
        'message.status_blocking': '屏蔽消息',
        'forward.group_only': '仅支持群组中使用',
        'forward.not_bound': '该群组暂未绑定',
        'forward.status_prompt': '是否转发群组内其他人的消息',
        'forward.status_on': '转发',
        'forward.status_off': '不转发',
        'add.no_user': '没有搜索到该用户',
        'add.request_sent': '好友请求已发送',
        'add.usage': '请在 /add 命令后面加上你要添加的联系人的手机号，例如：/add 18888888888',
        'user.no_contacts': '未查找到联系人',
        'user.bind_contact': '绑定联系人',
        'user.create_contact_group': '创建联系人群组',
        'room.no_groups': '未查找到群组',
        'room.bind_group': '绑定微信群',
        'room.create_wx_group': '创建微信群群组',
        'revoke.reply_required': '请回复需要撤回的消息',
        'revoke.failed': '撤回失败',
        'revoke.cannot_revoke_others': '撤回失败,无法撤回其他人发送的消息',
        'revoke.request_sent': '撤回请求已发送',
        'binding.success': '绑定成功',
        'group.create_success': '创建群组成功',
        'group.open': '打开群组 🚀',
        'send.failed': '发送失败',
        'send.sticker_convert_failed': '表情转换失败',
        'auth.phone_number': '请先登录 Telegram 客户端，请输入你的 Telegram 账户的手机号码（需要带国家区号，例如：+8613355558888）',
        'auth.password': '请输入你的二步验证密码:',
        'auth.verification_code': '请输入你收到的验证码:_ _ _ _ _\n',
        'auth.not_authorized': '抱歉，您无权与此机器人交互。'
      }

      // 创建默认的英文翻译
      this.translations['en-US'] = {
        'login.welcome': 'Please enter /login to log in, or enter /help to view help\nPlease note that after executing /login, you will be the owner of this bot',
        'login.already_logged_in': 'Already logged in, please do not log in repeatedly',
        'login.success': 'Telegram client login successful!',
        'login.group_not_allowed': 'This command cannot be used in groups',
        'login.please_login_wx': 'Please log in to WeChat first',
        'logout.success': 'Logout successful',
        'help.title': '**Welcome to WeChat message forwarding bot**',
        'help.description': '[This project](https://github.com/finalpi/wechat2tg) is based on the pad protocol developed by gewechty to implement WeChat message sending and receiving.\n**This project is only for technical research and learning, not for illegal purposes.**',
        'help.instructions': '1\\. Use the /start or /login command to start the WeChat client instance, and use the /login command to scan the code to log in.\n2\\. Use the /user or /room command to search for contacts or group chats (you can add names or remarks, for example, "/user Zhang" can search for users whose names or remarks contain "Zhang").\n3\\. /settings to open settings.\n4\\. For more features, please check the GitHub repository README.',
        'settings.title': 'Program settings:',
        'settings.language': 'Interface Language',
        'settings.language_changed': 'Language changed to English',
        'update.group_only': 'Only supported in groups',
        'unbind.success': 'Unbinding successful',
        'unbind.group_only': 'Only supported in groups',
        'message.group_only': 'Only supported in groups',
        'message.not_bound': 'This group is not bound yet',
        'message.status_prompt': 'Whether to receive messages from this group',
        'message.status_receiving': 'Receiving messages',
        'message.status_blocking': 'Blocking messages',
        'forward.group_only': 'Only supported in groups',
        'forward.not_bound': 'This group is not bound yet',
        'forward.status_prompt': 'Whether to forward messages from others in the group',
        'forward.status_on': 'Forward',
        'forward.status_off': 'Do not forward',
        'add.no_user': 'No such user found',
        'add.request_sent': 'Friend request sent',
        'add.usage': 'Please add the phone number of the contact you want to add after the /add command, for example: /add 18888888888',
        'user.no_contacts': 'No contacts found',
        'user.bind_contact': 'Bind contact',
        'user.create_contact_group': 'Create contact group',
        'room.no_groups': 'No groups found',
        'room.bind_group': 'Bind WeChat group',
        'room.create_wx_group': 'Create WeChat group',
        'revoke.reply_required': 'Please reply to the message you want to revoke',
        'revoke.failed': 'Revoke failed',
        'revoke.cannot_revoke_others': 'Revoke failed, cannot revoke messages sent by others',
        'revoke.request_sent': 'Revoke request sent',
        'binding.success': 'Binding successful',
        'group.create_success': 'Group created successfully',
        'group.open': 'Open group 🚀',
        'send.failed': 'Send failed',
        'send.sticker_convert_failed': 'Sticker conversion failed',
        'auth.phone_number': 'Please log in to the Telegram client first, please enter your Telegram account phone number (need to include country code, for example: +8613355558888)',
        'auth.password': 'Please enter your two-step verification password:',
        'auth.verification_code': 'Please enter the verification code you received:_ _ _ _ _\n',
        'auth.not_authorized': 'Sorry, you are not authorized to interact with this bot.'
      }

      // 写入文件系统
      Object.keys(this.translations).forEach(lang => {
        fs.writeFileSync(
          path.join(localesDir, `${lang}.json`),
          JSON.stringify(this.translations[lang], null, 2),
          'utf8'
        )
      })
    } catch (error) {
      console.error('Error creating default locales:', error)
    }
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