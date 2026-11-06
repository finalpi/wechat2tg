import type {ChatMessage, HistoryPage} from './messages-api'

const compare = (a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp || a.id - b.id

/** Fill the interval between a saved live edge and a newly fetched latest page. */
export async function fillMessageGap(latest: HistoryPage, current: ChatMessage[], loadBefore: (before: number) => Promise<HistoryPage>): Promise<HistoryPage> {
  const edge = current[current.length - 1]
  if (!edge || !latest.messages.length || compare(latest.messages[0], edge) <= 0) return latest
  const messages = [...latest.messages]
  const cursors = new Set<number>()
  let page = latest
  while (page.hasMore && page.before > 0 && !cursors.has(page.before) && page.messages.length && compare(page.messages[0], edge) > 0) {
    cursors.add(page.before)
    page = await loadBefore(page.before)
    messages.push(...page.messages)
  }
  return {...latest, messages}
}
