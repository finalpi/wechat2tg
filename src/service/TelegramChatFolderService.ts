import {Api, TelegramClient, utils} from 'telegram'

export type FolderPlacement =
    | {status: 'added' | 'already-present'; folderId: number; folderName: string}
    | {status: 'skipped'; reason: 'folder-limit' | 'unavailable' | 'excluded'}

type FolderCaps = {chats: number; folders?: number; expires: number}

/** Folder placement is best-effort: a usable group must not depend on this succeeding. */
export class TelegramChatFolderService {
    private static readonly clients = new WeakMap<TelegramClient, TelegramChatFolderService>()
    private queue: Promise<void> = Promise.resolve()
    private caps?: FolderCaps

    private constructor(private readonly client: TelegramClient) {}

    static forClient(client: TelegramClient): TelegramChatFolderService {
        let service = this.clients.get(client)
        if (!service) {
            service = new TelegramChatFolderService(client)
            this.clients.set(client, service)
        }
        return service
    }

    addChat(chatId: number): Promise<FolderPlacement> {
        return this.enqueue(() => this.place(chatId, false))
    }

    ensurePrimaryFolder(botId: number): Promise<FolderPlacement> {
        return this.enqueue(() => this.place(botId, true))
    }

    private enqueue(operation: () => Promise<FolderPlacement>): Promise<FolderPlacement> {
        const result = this.queue.then(operation).catch((): FolderPlacement => ({
            status: 'skipped', reason: 'unavailable',
        }))
        // Both startup and normal placements share this queue, including after a failed RPC.
        this.queue = result.then(() => undefined)
        return result
    }

    private ordinal(title: string): bigint | undefined {
        if (title === 'WeChat') return 1n
        const match = /^WeChat ([1-9]\d*)$/.exec(title)
        if (!match || match[0] !== title) return undefined
        const ordinal = BigInt(match[1])
        return ordinal >= 2n ? ordinal : undefined
    }

    private peerIds(peers: Api.TypeInputPeer[]): Set<string> {
        return new Set(peers.map(peer => utils.getPeerId(peer)))
    }

    private present(folder: Api.DialogFilter): FolderPlacement {
        return {status: 'already-present', folderId: folder.id, folderName: folder.title}
    }

    private async getCaps(): Promise<FolderCaps> {
        if (this.caps && this.caps.expires > Date.now()) return this.caps
        let chats = 100
        let folders: number | undefined
        try {
            const me = await this.client.getMe()
            const result = await this.client.invoke(new Api.help.GetAppConfig({hash: 0}))
            if (result instanceof Api.help.AppConfig && result.config instanceof Api.JsonObject) {
                const suffix = me.premium ? 'premium' : 'default'
                const entries = result.config.value
                const value = (key: string, minimum: number): number | undefined => {
                    const entry = entries.find(item => item.key === `${key}_${suffix}`)?.value
                    return entry instanceof Api.JsonNumber && Number.isSafeInteger(entry.value)
                        && entry.value >= minimum ? entry.value : undefined
                }
                chats = value('dialog_filters_chats_limit', 1) ?? 100
                folders = value('dialog_filters_limit', 0)
            }
        } catch {
            // An unknown total cap is NOT 10: let the server decide, including for Premium.
        }
        this.caps = {chats, folders, expires: Date.now() + 5 * 60 * 1000}
        return this.caps
    }

    private async place(peerId: number, primary: boolean): Promise<FolderPlacement> {
        const {filters} = await this.client.invoke(new Api.messages.GetDialogFilters())
        const managed = filters.filter((filter): filter is Api.DialogFilter =>
            filter instanceof Api.DialogFilter && this.ordinal(filter.title) !== undefined)
            .sort((a, b) => {
                const left = this.ordinal(a.title) ?? 0n
                const right = this.ordinal(b.title) ?? 0n
                return left < right ? -1 : left > right ? 1 : 0
            })
        const existingPrimary = managed.find(filter => filter.title === 'WeChat')
        // Do not "repair" a user's existing primary folder or re-pin their bot on startup.
        if (primary && existingPrimary) return this.present(existingPrimary)

        const peer = await this.client.getInputEntity(peerId)
        const key = utils.getPeerId(peer)
        // Respect an explicit opt-out rather than circumventing it with a new overflow folder.
        if (managed.some(filter => this.peerIds(filter.excludePeers).has(key))) {
            return {status: 'skipped', reason: 'excluded'}
        }
        if (!primary) {
            const existing = managed.find(filter =>
                this.peerIds([...filter.includePeers, ...filter.pinnedPeers]).has(key))
            if (existing) return this.present(existing)
        } else if (filters.some(filter =>
            filter instanceof Api.DialogFilterChatlist && filter.title === 'WeChat')) {
            // Reuse a previously created numbered primary when a shared folder owns the title.
            const existing = managed.find(filter =>
                this.peerIds([...filter.includePeers, ...filter.pinnedPeers]).has(key))
            if (existing) return this.present(existing)
        }

        const caps = await this.getCaps()
        if (!primary) {
            for (const folder of managed) {
                if (this.peerIds([...folder.includePeers, ...folder.pinnedPeers]).size >= caps.chats) continue
                // Clone the filter and every peer array; failed RPCs must not mutate cached state.
                const updated = new Api.DialogFilter({
                    ...folder,
                    includePeers: [...folder.includePeers, peer],
                    pinnedPeers: [...folder.pinnedPeers],
                    excludePeers: [...folder.excludePeers],
                })
                const result = await this.update(updated)
                if (result !== 'full') return result
            }
        }

        const custom = filters.filter(filter => !(filter instanceof Api.DialogFilterDefault))
        if (caps.folders !== undefined && custom.length >= caps.folders) {
            return {status: 'skipped', reason: 'folder-limit'}
        }
        const ids = new Set(custom.map(filter => 'id' in filter ? filter.id : undefined))
        let id = 2
        while (id <= 255 && ids.has(id)) id++
        if (id > 255) return {status: 'skipped', reason: 'folder-limit'}
        const names = new Set(custom.map(filter => 'title' in filter ? filter.title : undefined))
        let number = 1
        let title = 'WeChat'
        while (names.has(title)) title = `WeChat ${++number}`
        const folder = new Api.DialogFilter({
            id, title, includePeers: [peer], pinnedPeers: primary ? [peer] : [], excludePeers: [],
        })
        // Only one creation attempt. A single-peer folder rejection cannot be fixed by more names.
        const result = await this.update(folder)
        return result === 'full' ? {status: 'skipped', reason: 'unavailable'} : result
    }

    private async update(folder: Api.DialogFilter): Promise<FolderPlacement | 'full'> {
        try {
            const updated = await this.client.invoke(new Api.messages.UpdateDialogFilter({
                id: folder.id, filter: folder,
            }))
            return updated ? {status: 'added', folderId: folder.id, folderName: folder.title}
                : {status: 'skipped', reason: 'unavailable'}
        } catch (error) {
            const code = error?.errorMessage ?? error?.message
            if (code === 'DIALOG_FILTER_INCLUDE_TOO_MUCH' || code === 'FILTER_INCLUDE_TOO_MUCH') return 'full'
            if (code === 'DIALOG_FILTERS_TOO_MUCH' || code === 'FILTERS_TOO_MUCH') {
                return {status: 'skipped', reason: 'folder-limit'}
            }
            // Includes flood waits and ambiguous transport failures: no retry or extra folder.
            return {status: 'skipped', reason: 'unavailable'}
        }
    }
}