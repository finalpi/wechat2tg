export class CacheHelper {
    private undoMessageCaches: undoMessageCache[] = []
    private static undoCacheExpiryTime: number = 2 * 60 * 1000 // 默认缓存过期时间为2分钟
    private static undoCleanupInterval: number = 3 * 1000 // 3秒清理过期的缓存

    private static instance: CacheHelper

    private constructor() {
        // singleton
        this.startCleanupInterval()
    }

    public static getInstances(): CacheHelper {
        if (!CacheHelper.instance) {
            CacheHelper.instance = new CacheHelper()
        }
        return CacheHelper.instance
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            this.cleanupUndoMessageCaches()
        }, CacheHelper.undoCleanupInterval)
    }

    public getUndoMessageCache(tg_message_id: number | string,chat_id: number): undoMessageCache | undefined {
        return this.undoMessageCaches.find(item=>item.telegram_bot_message_id === tg_message_id && item.chat_id === chat_id)
    }

    public getUndoMessageCacheByTelegramMessageId(telegram_message_id: number | string): undoMessageCache | undefined {
        return this.undoMessageCaches.find(item=>item.telegram_message_id === telegram_message_id)
    }

    public deleteUndoMessageCache(tg_message_id: number | string,chat_id: number): void {
        this.undoMessageCaches = this.undoMessageCaches.filter(item=>!(item.telegram_bot_message_id === tg_message_id && item.chat_id === chat_id))
    }

    public deleteUndoMessageCacheByTelegramMessageId(telegram_message_id: number | string): void {
        this.undoMessageCaches = this.undoMessageCaches.filter(item=>!(item.telegram_message_id === telegram_message_id))
    }

    public addUndoMessageCache(undoMessage: undoMessageCache): void {
        const time = Date.now()
        undoMessage.time = time
        const item = this.undoMessageCaches.find(item=>item.msgDate === undoMessage.msgDate)
        if (item){
            if (!item.telegram_bot_message_id) {
                item.telegram_bot_message_id = undoMessage.telegram_bot_message_id
                item.chat_id = undoMessage.chat_id
                item.wechat_message_id = undoMessage.wechat_message_id
                return
            }else {
                if (!item.telegram_message_id){
                    item.telegram_message_id = undoMessage.telegram_message_id
                    return
                }else {
                    this.undoMessageCaches.push(undoMessage)
                }
            }
        }else {
            this.undoMessageCaches.push(undoMessage)
        }
    }


    private cleanupUndoMessageCaches() {
        const time = Date.now()
        this.undoMessageCaches = this.undoMessageCaches.filter(item=>item.time && (time - item.time <= CacheHelper.undoCacheExpiryTime))
    }
}

export interface undoMessageCache {
    telegram_bot_message_id?: number
    chat_id?: number
    time?: number
    wechat_message_id?: string
    msgDate?: number
    telegram_message_id?: number
}