import BaseMessage from './BaseMessage'
import {Logger} from 'log4js'

export abstract class AbstractClient implements IClient {
    protected spyClientMap: Map<string, IClient> = new Map<string, IClient>()
    logger: Logger
    protected constructor(logger: Logger) {
        this.logger = logger
    }

    abstract login(): Promise<boolean>;
    abstract logout(): Promise<boolean>;
    abstract onMessage(): Promise<BaseMessage>;
    abstract sendMessage(message: BaseMessage): Promise<boolean>;
    abstract handlerMessage(event: Event, message: BaseMessage): Promise<unknown>;

    addSpyClient(client: SpyClient): void {
        this.spyClientMap.set(client.interfaceId, client.client)
    }

    popSpyClient(id: string): IClient {
        const iClient = this.spyClientMap.get(id)
        this.spyClientMap.delete(id)
        return iClient
    }
    spyClients(): SpyClient[] {
        return Array.from(this.spyClientMap).map(([interfaceId, client]) => {
            return {interfaceId, client}
        })
    }

    getSpyClient(id: string): IClient {
        return this.spyClientMap.get(id)
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
    login(): Promise<boolean>
    logout(): Promise<boolean>
    onMessage(): Promise<BaseMessage>
    sendMessage(message: BaseMessage): Promise<boolean>
    handlerMessage(event: Event, message: BaseMessage): Promise<unknown>
    getSpyClient(id: string): IClient
    addSpyClient(client: SpyClient): void
    popSpyClient(id: string): IClient
    spyClients(): SpyClient[]
    logger: Logger
}

export type SpyClient = {
    interfaceId: string
    client: IClient
}