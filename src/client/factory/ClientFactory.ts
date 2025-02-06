import {IClient} from '../../base/BaseClient'
import {BaseFactory, botType} from '../../base/BaseFactory'
import {TelegramBotClient} from '../TelegramBotClient'
import {WeChatClient} from '../WechatClient'
import {UserMTProtoClient} from '../UserMTProtoClient'
import {BotMTProtoClient} from '../BotMTProtoClient'
import {FileHelperClient} from '../FileHelperClient'

export class ClientFactory implements BaseFactory {
    create(type: botType): IClient {
        switch (type) {
            case 'botClient':
                return TelegramBotClient.getInstance()
            case 'wxClient':
                return WeChatClient.getInstance()
            case 'userMTPClient':
                return UserMTProtoClient.getInstance()
            case 'botMTPClient':
                return BotMTProtoClient.getInstance()
            case 'fhClient':
                return FileHelperClient.getInstance()
        }
    }
}