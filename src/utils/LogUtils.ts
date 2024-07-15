import log4js from 'log4js'

export class LogUtils {

    private constructor() {
        ///
    }

    public static config() {
        return log4js.configure({
            appenders: {
                console: {type: 'console'},
                file: {type: 'file', filename: 'logs/app.log', maxLogSize: '2M', backups: 5},
                errorFile: {type: 'file', filename: 'logs/error.log', maxLogSize: '2M', backups: 5},
                logLevelFilter: {
                    type: 'logLevelFilter',
                    appender: 'errorFile',
                    level: 'error'
                }
            },
            categories: {
                default: {appenders: ['console', 'file', 'logLevelFilter'], level: 'info'},
                development: {appenders: ['console', 'file', 'logLevelFilter'], level: 'debug'},
                production: {appenders: ['console', 'file', 'logLevelFilter'], level: 'warn'},
                error: {appenders: ['errorFile'], level: 'error'}
            }
        })
    }
}