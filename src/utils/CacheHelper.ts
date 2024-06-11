export class CacheHelper {
    private undoMessageCaches: Map<number | string, undoMessageCache> = new Map()
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

    public getUndoMessageCache(tg_message_id: number | string): undoMessageCache | undefined {
        return this.undoMessageCaches.get(tg_message_id)
    }

    public deleteUndoMessageCache(tg_message_id: number | string): void {
        this.undoMessageCaches.delete(tg_message_id)
    }

    public addUndoMessageCache(tg_message_id: number | string, wechat_message_id: string): void {
        const time = Date.now()
        this.undoMessageCaches.set(tg_message_id, {time, wechat_message_id})
    }


    private cleanupUndoMessageCaches() {
        const time = Date.now()
        this.undoMessageCaches.forEach((value, key) => {
            if (time - value.time > CacheHelper.undoCacheExpiryTime) {
                this.undoMessageCaches.delete(key)
            }
        })
    }
}

export interface undoMessageCache {
    time: number,
    wechat_message_id: string,
}