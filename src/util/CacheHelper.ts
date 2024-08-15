export class CacheHelper {
    private undoMessage: UndoMessageType[] = []
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

    public addUndoMessage({
                              chat_id,
                              msg_id,
                              wx_msg_id
                          }: Pick<UndoMessageType, 'chat_id' | 'msg_id' | 'wx_msg_id'>): void {
        this.undoMessage.push({chat_id, msg_id, wx_msg_id, time: Date.now()})
    }

    public getUndoMessage({
                              chat_id,
                              msg_id
                          }: Pick<UndoMessageType, 'chat_id' | 'msg_id'>): UndoMessageType[] | undefined {
        return this.undoMessage.filter(item => item.chat_id === chat_id && item.msg_id === msg_id)
    }

    public getUndoMessageByMsgId({msg_id}: Pick<UndoMessageType, 'msg_id'>): UndoMessageType[] | undefined {
        return this.undoMessage.filter(item => item.msg_id === msg_id)
    }

    public getUndoMessageByWxMsgId(wx_msg_id: string): UndoMessageType | undefined {
        return this.undoMessage.find(item => item.wx_msg_id === wx_msg_id)
    }

    // remove use wx_msg_id
    public removeUndoMessage(wx_msg_id: string): void {
        this.undoMessage = this.undoMessage.filter(item => item.wx_msg_id !== wx_msg_id)
    }


    private cleanupUndoMessageCaches() {
        const time = Date.now()
        this.undoMessage = this.undoMessage.filter(item => item.time && (time - item.time <= CacheHelper.undoCacheExpiryTime))
    }
}

export type UndoMessageType = {
    msg_id: number,
    chat_id: number,
    time?: number,
    wx_msg_id?: string,
}