export class LockUtil {
    private isLocked = false
    private waiting: Array<{ resolve: () => void; reject: (reason?: any) => void }> = []
    private timeout = 3000


    constructor(timeout?: number) {
        this.timeout = timeout || this.timeout
    }

    // 获取锁
    async acquire(): Promise<void> {
        if (!this.isLocked) {
            this.isLocked = true
            return Promise.resolve()
        }

        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.release()
            }, this.timeout)

            this.waiting.push({
                resolve: () => {
                    clearTimeout(timer)
                    resolve()
                },
                reject: (reason) => {
                    clearTimeout(timer)
                    reject(reason)
                },
            })
        })
    }

    // 释放锁
    release(): void {
        if (this.waiting.length > 0) {
            const {resolve} = this.waiting.shift()!
            resolve()
        } else {
            this.isLocked = false
        }
    }
}