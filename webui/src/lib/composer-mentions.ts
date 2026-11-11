import type {Member} from './messages-api'

export interface InlineMention {start: number; end: number; text: string; wxId: string}
export interface MentionQuery {start: number; end: number; query: string}

export function replaceMentionRange(mentions: InlineMention[], start: number, end: number, length: number): InlineMention[] {
  const delta = length - (end - start)
  return mentions.flatMap(item => {
    if (item.end <= start) return [item]
    if (item.start >= end) return [{...item, start: item.start + delta, end: item.end + delta}]
    return []
  })
}

export function mentionQuery(body: string, start: number, end = start, mentions: InlineMention[] = []): MentionQuery | null {
  if (start !== end || mentions.some(item => start > item.start && start <= item.end)) return null
  const match = /[@＠]([^\s@＠]{0,100})$/u.exec(body.slice(0, start))
  if (!match || /[\w.+/-]$/.test(body.slice(0, match.index))) return null
  return {start: match.index, end: start, query: match[1]}
}

/** Textarea offsets use UTF-16, including when a message contains emoji. */
export function editMentions(previous: string, next: string, mentions: InlineMention[]): InlineMention[] {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  let before = previous.length, after = next.length
  while (before > start && after > start && previous[before - 1] === next[after - 1]) {before--; after--}
  return replaceMentionRange(mentions, start, before, after - start).filter(item => next.slice(item.start, item.end) === item.text)
}

export function insertMention(body: string, target: MentionQuery, member: Pick<Member, 'wxId' | 'name' | 'displayName'>, mentions: InlineMention[]) {
  const text = '@' + (member.displayName || member.name || member.wxId)
  const value = body.slice(0, target.start) + text + '\u2005' + body.slice(target.end)
  const remaining = replaceMentionRange(mentions, target.start, target.end, text.length + 1)
  return {body: value, caret: target.start + text.length + 1, mentions: [...remaining, {start: target.start, end: target.start + text.length, text, wxId: member.wxId}]}
}

export function composerMentions(body: string, selected: Member[], all: boolean, inline: InlineMention[]) {
  const valid = inline.filter(item => body.slice(item.start, item.end) === item.text)
  const everyone = all || valid.some(item => item.wxId === 'notify@all')
  const memberIds = [...new Set([...selected.map(item => item.wxId), ...valid.filter(item => item.wxId !== 'notify@all').map(item => item.wxId)])]
  const prefix = all ? '@所有人 ' : selected.map(item => '@' + (item.displayName || item.name || item.wxId)).join(' ')
  return {
    body: valid.length && prefix ? prefix + (all ? '' : ' ') + body : body,
    mentions: everyone ? {all: true, ...(valid.length ? {inline: true} : {})}
      : memberIds.length ? {memberIds, ...(valid.length ? {inline: true} : {})} : undefined,
  }
}
