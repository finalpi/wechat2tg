import log4js from 'log4js'

abstract class BaseClient {
    protected _log: log4js.Logger

    protected constructor() {
        const env = process.env.NODE_ENV || 'default'

        log4js.configure({
            appenders: {
                console: { type: 'console' },
                file: { type: 'file', filename: 'logs/app.log' },
                errorFile: { type: 'file', filename: 'logs/error.log' },
                logLevelFilter: {
                    type: 'logLevelFilter',
                    appender: 'errorFile',
                    level: 'error'
                }
            },
            categories: {
                default: { appenders: ['console', 'file', 'logLevelFilter'], level: 'info' },
                development: { appenders: ['console', 'file', 'logLevelFilter'], level: 'debug' },
                production: { appenders: ['console', 'file', 'logLevelFilter'], level: 'warn' }
            }
        })

        const category = env === 'production' ? 'production' : env === 'development' ? 'development' : 'default'
        this._log = log4js.getLogger(category)
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