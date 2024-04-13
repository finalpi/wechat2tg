export class Lock {
    constructor() {
        this.locked = false;
        this.waitQueue = [];
    }

    acquire() {
        return new Promise((resolve, reject) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            } else {
                this.waitQueue.push(resolve);
            }
        });
    }

    release() {
        if (this.waitQueue.length > 0) {
            const nextResolve = this.waitQueue.shift();
            nextResolve();
        } else {
            this.locked = false;
        }
    }
}