import log4js from 'log4js'
import {LogUtils} from '../utils/LogUtils'
import IClient, {Message, MessageResult} from './IClient'

abstract class BaseClient<M extends Message, R extends MessageResult> implements IClient<M, R> {
    protected _log: log4js.Logger

    protected constructor() {
        const env = process.env.NODE_ENV || 'default'
        const category = env === 'production' ? 'production' : env === 'development' ? 'development' : 'default'
        this._log = LogUtils.config().getLogger(category)
    }

    sendMessage(message: M extends Message ? any : any): Promise<R extends MessageResult ? any : any> {
        throw new Error('Method not implemented.')
    }
    editMessage(key: string | number, m: M extends Message ? any : any): Promise<R extends MessageResult ? any : any> {
        throw new Error('Method not implemented.')
    }
    deleteMessage(key: string | number): Promise<R extends MessageResult ? any : any> {
        throw new Error('Method not implemented.')
    }

    protected logInfo(message: string, ...args: any[]): void {
        this._log.info(message, ...args)
    }

    protected logError(message: string, ...args: any[]): void {
        this._log.error(message, ...args)
    }

    protected logDebug(message: string, ...args: any[]): void {
        this._log.debug(message, ...args)
    }

    protected logWarn(message: string, ...args: any[]): void {
        this._log.warn(message, ...args)
    }
}

export default BaseClient