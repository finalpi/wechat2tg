import {MyMessageContact} from '../models/MyContact'
import {convertXML} from 'simple-xml-to-json'

export class MessageUtils {
    private static instance: MessageUtils
    private constructor() {
        //
    }
    public getInstance (): MessageUtils {
        if (!MessageUtils.instance) {
            MessageUtils.instance = new MessageUtils()
        }
        return MessageUtils.instance
    }

    public static messageTextToContact(messageText: string): Promise<MyMessageContact> {
        // messageText = messageText.replaceAll('\n',' ');
        const firstIndex = messageText.indexOf('<')
        if (firstIndex !== 0) {
            messageText = messageText.substring(firstIndex, messageText.length)
        }
        return new Promise((resolve) => {
            const contact: MyMessageContact = convertXML(messageText)['msg']
            return resolve(contact)
        })
    }
}