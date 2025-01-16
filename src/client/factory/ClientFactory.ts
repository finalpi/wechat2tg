import {IClient} from '../../base/BaseClient'
import {BaseFactory} from '../../base/BaseFactory'
import {TelegramBotClient} from '../TelegramBotClient'
import {WeChatClient} from '../WechatClient'
import {UserMTProtoClient} from '../UserMTProtoClient'

export class ClientFactory implements BaseFactory {
    create(type: 'botClient' | 'userMTPClient' | 'wxClient'): IClient {
        switch (type) {
            case 'botClient':
                return TelegramBotClient.getInstance()
            case 'wxClient':
                return WeChatClient.getInstance()
            case 'userMTPClient':
                return UserMTProtoClient.getInstance()
        }
    }
}