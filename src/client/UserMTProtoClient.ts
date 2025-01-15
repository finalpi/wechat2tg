import {ClientInterface} from './base/ClientInterface'
import os from 'node:os'
import {TelegramClient as GramClient} from 'telegram/client/TelegramClient'
import {StoreSession} from 'telegram/sessions'
import * as authMethods from 'telegram/client/auth'
import {config} from '../config'

export class UserMTProtoClient implements ClientInterface {
    private static instance = undefined
    private _client: GramClient
    get client() {
        return this._client
    }
    static getInstance(): UserMTProtoClient {
        if (!UserMTProtoClient.instance) {
            UserMTProtoClient.instance = new UserMTProtoClient()
        }
        return UserMTProtoClient.instance
    }
    private constructor() {
        //
        this._client = new GramClient(new StoreSession('storage/tg-user-session'), parseInt(config.API_ID), config.API_HASH, {
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
    }
    hasLogin(): boolean {
        return false
    }

    async start(authParams: authMethods.UserAuthParams | authMethods.BotAuthParams) {
        if (!await this._client?.checkAuthorization()) {
            this._client?.start(authParams).then(res=>{
                // 登录成功逻辑
            }).catch((e) => {
                //
            })
        }
        return this._client
    }

}