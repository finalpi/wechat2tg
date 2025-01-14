export default interface BaseMessage {
    id: string,
    content: string,
    sender: string,
    receiver: string,
    type: string,
    sendTime: number,
    receiveTime: number,
}