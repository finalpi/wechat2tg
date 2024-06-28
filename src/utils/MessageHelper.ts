import {MessageWrapper} from '../models/MessageWrapper'

type Queue = {
    message: MessageWrapper,
    id?: number,
    time?: number,
}

interface IQueue {
    getQueue: () => Promise<Queue[]>,
    add: (message: MessageWrapper) => void,
    remove: (id: number) => void,
    // onSuccess: () => Promise<Queue>,
    // onFail: () => Promise<Error>,
    // onTimeout: () => Promise<Queue>,
    // onCompleted: () => Promise<boolean>,
}


export default class MessageQueue implements IQueue {

    private queue: Queue[] = []

    getQueue(): Promise<Queue[]> {
        return Promise.resolve(this.queue)
    }

    add(message: MessageWrapper): void {
        this.queue.push({
            id: this.queue.length + 1,
            time: new Date().getTime(),
            message,
        })
    }

    remove(id: number): void {
        const index = this.queue.findIndex(message => message.id === id)
        if (index !== -1) {
            this.queue.splice(index, 1)
        }
    }

    onSuccess(): Promise<Queue> {
        const message = this.queue.shift()
        if (message) {
            return Promise.resolve(message)
        }
        return Promise.reject(new Error('Message not found'))
    }

    // onFail: () => Promise<Error>
    // onTimeout: () => Promise<Queue>
    // onCompleted: () => Promise<boolean>

}