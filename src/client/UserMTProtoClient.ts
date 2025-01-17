import os from 'node:os'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {StoreSession} from 'telegram/sessions'
import * as authMethods from 'telegram/client/auth'
import {config} from '../config'
import {AbstractClient} from '../base/BaseClient'
import BaseMessage from '../base/BaseMessage'
import {ClientFactory} from './factory/ClientFactory'

export class UserMTProtoClient extends AbstractClient {
    async login(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams): Promise<boolean> {
        if (!UserMTProtoClient.getSpyClient('userMTPClient')) {
            const clientFactory = new ClientFactory()
            UserMTProtoClient.addSpyClient({
                interfaceId: 'userMTPClient',
                client: clientFactory.create('userMTPClient')
            })
        }
        if (!await this.client?.checkAuthorization()) {
            this.client?.start(authParams).then(res => {
                // 登录成功逻辑
                this.hasLogin = true
            }).catch((e) => {
                //
            })
        }
        return true
    }

    logout(): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    onMessage(): Promise<BaseMessage> {
        throw new Error('Method not implemented.')
    }

    sendMessage(message: BaseMessage): Promise<boolean> {
        throw new Error('Method not implemented.')
    }

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown> {
        throw new Error('Method not implemented.')
    }

    private static instance = undefined

    static getInstance(): UserMTProtoClient {
        if (!UserMTProtoClient.instance) {
            UserMTProtoClient.instance = new UserMTProtoClient()
        }
        return UserMTProtoClient.instance
    }

    private constructor() {
        super()
        //
        this.client = new GramClient(new StoreSession('storage/tg-user-session'), parseInt(config.API_ID), config.API_HASH, {
            connectionRetries: 1000000,
            deviceModel: `wx2tg-pad User On ${os.hostname()}`,
            appVersion: 'rainbowcat',
            proxy: config.HOST ? {
                ip: config.HOST,
                port: parseInt(config.PORT),
                socksType: 5,
                password: config.PASSWORD,
                username: config.USERNAME,
            } : undefined,
            autoReconnect: true,
            maxConcurrentDownloads: 3,
        })
        this.hasReady = true
    }
}