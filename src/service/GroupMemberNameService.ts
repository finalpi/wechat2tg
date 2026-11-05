import {createGroupMentionService} from '../webui/mentions'

/** Optional name enrichment, sharing the existing bounded account/group member cache. */
export function createGroupMemberNameResolver(getSelf: () => string) {
    const groups = createGroupMentionService(getSelf)
    const failures = new Map<string, number>()
    // Only real absence is discarded: a WeChat nickname may literally be
    // "undefined" and must still be usable as a solitaire entry.
    const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
    return async (roomId: string, senderId: string, fallback: string): Promise<string> => {
        const safeFallback = clean(fallback)
        const self = getSelf()
        if (!self || !senderId || !roomId.endsWith('@chatroom')) return safeFallback
        const key = self + ':' + roomId
        if ((failures.get(key) || 0) > Date.now()) return safeFallback
        let timer: ReturnType<typeof setTimeout>
        try {
            const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Group member lookup timed out')), 1500)
            })
            const list = await Promise.race([groups.members(roomId), timeout])
            if (self !== getSelf()) return safeFallback
            const member = list.find(item => item.wxId === senderId)
            failures.delete(key)
            // Do not use a contact remark or the parser's ID fallback as a nickname.
            return clean(member?.displayName) || clean(member?.nickname) || safeFallback
        } catch {
            if (failures.size >= 100) failures.delete(failures.keys().next().value)
            failures.set(key, Date.now() + 60000)
            return safeFallback
        } finally {
            clearTimeout(timer)
        }
    }
}