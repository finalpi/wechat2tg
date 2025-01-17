import BaseMessage from './BaseMessage'
import {Logger} from 'log4js'
import {LogUtils} from '../util/LogUtil'
import {botType} from './BaseFactory'


export abstract class AbstractClient implements IClient {
    protected static spyClientMap: Map<string, IClient> = new Map<string, IClient>()
    client: Client
    logger: Logger
    hasReady = false
    hasLogin = false

    protected constructor() {
        const env = process.env.NODE_ENV || 'default'
        const category = env === 'production' ? 'production' : env === 'development' ? 'development' : 'default'
        this.logger = LogUtils.config().getLogger(category)
    }

    abstract login(param?: any): Promise<boolean>;

    abstract logout(): Promise<boolean>;

    abstract onMessage(msg: any): void;

    abstract sendMessage(message: BaseMessage): Promise<boolean>;

    abstract handlerMessage(event: Event, message: BaseMessage): Promise<unknown>;

    static addSpyClient(client: SpyClient): void {
        AbstractClient.spyClientMap.set(client.interfaceId, client.client)
    }

    static popSpyClient(id: botType): IClient {
        const iClient = AbstractClient.spyClientMap.get(id)
        AbstractClient.spyClientMap.delete(id)
        return iClient
    }

    static getSpyClient(id: botType): IClient {
        return AbstractClient.spyClientMap.get(id)
    }

    logInfo(message: string): void {
        this.logger.info(message)
    }

    logError(message: string): void {
        this.logger.error(message)
    }

    logDebug(message: string): void {
        this.logger.debug(message)
    }
}

export interface IClient {
    login(param?: any): Promise<boolean>

    logout(): Promise<boolean>

    onMessage(msg: any): void;

    sendMessage(message: BaseMessage): Promise<boolean>

    handlerMessage(event: Event, message: BaseMessage): Promise<unknown>

    hasReady: boolean
    hasLogin: boolean
    logger: Logger
    client: Client
}

export type Client = any

export type SpyClient = {
    interfaceId: botType
    client: IClient
}