import {MessageWrapper} from '../models/MessageWrapper'
import BaseClient from '../base/BaseClient'
import {TelegramClient} from '../client/TelegramClient'

type MessageStatus = 'success' | 'failure' | 'timeout';

type Message = {
    message?: MessageWrapper,
    id: number,
    time?: number,
}

interface IQueue<C extends BaseClient> {
    enqueue(message: MessageWrapper): Promise<MessageStatus>;
    dequeue(): Message | undefined;
    processMessage(client: C, message: MessageWrapper): Promise<MessageStatus>;
}

class TelegramMessageQueue implements IQueue<TelegramClient> {
    private queue: Message[] = []
    private idCounter = 0
    private client: TelegramClient

    constructor(private timeout: number = 5000,client: TelegramClient) {
        this.client = client
    }

    // default timeout is 5000 ms
    processMessage(client: TelegramClient, message: MessageWrapper): Promise<MessageStatus> {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve('success')
            }, Math.random() * this.timeout) // Simulate processing time
        })
    }

    enqueue(message: MessageWrapper): Promise<MessageStatus> {
        const queue: Message = {
            id: this.idCounter++,
            time: new Date().getTime(),
            message: message,
        }
        this.queue.push(queue)

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject('timeout')
            }, this.timeout)

            // Simulate message processing
            this.processMessage(this.client, message)
                .then((status: MessageStatus) => {
                    clearTimeout(timer)
                    if (status === 'success') {
                        resolve(status)
                    } else {
                        reject(status)
                    }
                })
                .catch((err) => {
                    clearTimeout(timer)
                    reject(err)
                })
        })
    }

    dequeue(): Message | undefined {
        return this.queue.shift()
    }
}