import {createGroupMentionService} from '../webui/mentions'

/** Optional name enrichment, sharing the existing bounded account/group member cache. */
export function createGroupMemberNameResolver(getSelf: () => string) {
    const groups = createGroupMentionService(getSelf)
    const failures = new Map<string, number>()
    return async (roomId: string, senderId: string, fallback: string): Promise<string> => {
        const self = getSelf()
        if (!self || !senderId || !roomId.endsWith('@chatroom')) return fallback
        const key = self + ':' + roomId
        if ((failures.get(key) || 0) > Date.now()) return fallback
        let timer: ReturnType<typeof setTimeout>
        try {
            const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Group member lookup timed out')), 1500)
            })
            const list = await Promise.race([groups.members(roomId), timeout])
            if (self !== getSelf()) return fallback
            const member = list.find(item => item.wxId === senderId)
            failures.delete(key)
            // Do not use a contact remark or the parser's ID fallback as a nickname.
            return member?.displayName || member?.nickname || fallback
        } catch {
            if (failures.size >= 100) failures.delete(failures.keys().next().value)
            failures.set(key, Date.now() + 60000)
            return fallback
        } finally {
            clearTimeout(timer)
        }
    }
}