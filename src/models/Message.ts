import { FmtString } from "telegraf/format";

export interface SimpleMessage {
    sender: string;
    body: string | FmtString;
}

export interface MessageSender {
    sendMessage(simpleMessage: SimpleMessage): string | FmtString;
}

export class SimpleMessageSender implements MessageSender {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor () {

    }

    sendMessage(simpleMessage: SimpleMessage): string | FmtString {
        if (simpleMessage instanceof FmtString) {
            return simpleMessage;
        } else {
            return `*${simpleMessage.sender}: *\n${simpleMessage.body}`;
        }
    }

    static send(simpleMessage: SimpleMessage) {
        return new SimpleMessageSender().sendMessage(simpleMessage);
    }

}