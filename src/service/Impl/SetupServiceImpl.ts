import {Contact, Room} from 'wechaty'
import {ISetupService} from '../SetupService'
import {TelegramClient} from '../../client/TelegramClient'
import {Api} from 'telegram'
import {TelegramBotClient} from '../../client/TelegramBotClient'
import bigInt from 'big-integer'

export class SetupServiceImpl implements ISetupService {
    private readonly tgClient: TelegramClient = TelegramClient.getInstance()
    private readonly tgBotClient: TelegramBotClient = TelegramBotClient.getInstance()

    createFolder(): Promise<Api.TypeUpdates> {
        return this.tgClient.client.invoke(
            new Api.folders.EditPeerFolders({
                folderPeers: [
                    new Api.InputFolderPeer({
                        peer: new Api.InputPeerChat({
                            chatId: bigInt(this.tgBotClient.chatId.toString()),
                        }),
                        folderId: 43,
                    }),
                ],
            })
        )
    }

    setupGroup(contact: Contact | Room): Promise<void> {
        throw new Error('Method not implemented.')
    }
}