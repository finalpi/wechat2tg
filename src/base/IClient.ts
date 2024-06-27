interface IClient<M extends Message, R extends MessageResult> {
    sendMessage(m: M): Promise<R>

    editMessage(key: string | number, m: M): Promise<R>

    deleteMessage(key: string | number): Promise<R>
}

export default IClient

export interface Message {
    text: string,
}

export interface MessageResult {
    message_id: string | number,
}