import log4js, {Logger} from 'log4js'
import {config} from '../config'

export class LogUtils {
    private static initialized = false

    private constructor() {
        ///
    }

    /**
     * 初始化日志配置（只会执行一次）
     * 日志级别从配置文件读取：LOG_LEVEL 环境变量
     * 支持的级别：trace, debug, info, warn, error, fatal
     */
    public static config() {
        if (!this.initialized) {
            const logLevel = config.LOG_LEVEL || 'info'
            log4js.configure({
                appenders: {
                    console: {type: 'console'},
                    file: {type: 'file', filename: 'logs/app.log', maxLogSize: '5M', backups: 5},
                    errorFile: {type: 'file', filename: 'logs/error.log', maxLogSize: '5M', backups: 5},
                    logLevelFilter: {
                        type: 'logLevelFilter',
                        appender: 'errorFile',
                        level: 'error'
                    }
                },
                categories: {
                    default: {appenders: ['console', 'file', 'logLevelFilter'], level: logLevel}
                }
            })
            this.initialized = true
        }
        return log4js
    }

    public static errorLog(): Logger {
        return LogUtils.config().getLogger('error')
    }

    public static infoLog(): Logger {
        return LogUtils.config().getLogger('info')
    }

    public static debugLog(): Logger {
        return LogUtils.config().getLogger('debug')
    }
}