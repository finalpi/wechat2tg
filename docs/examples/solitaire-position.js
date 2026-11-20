// Preview first. The host deduplicates account/group/round across rules and restarts.
export default async function handler(event, api, params) {
  if (event.type !== 'solitaire.received' || !event.solitaire) return
  const title = event.solitaire.title || ''
  if (!title.includes(params.targetTitle || '用餐接龙')) return
  const position = Number(params.targetPosition ?? 5)
  if (!Number.isSafeInteger(position) || position < 2 || position > 4097) {
    api.log('targetPosition 必须是 2～4097 的整数')
    return
  }
  const count = event.solitaire.entryCount
  if (!Number.isSafeInteger(count) || count < 1) {
    api.log('缺少原生报名条数，请更新 Bot 后再启用，不能根据标题猜人数')
    return
  }
  if (!event.solitaire.id) {
    api.log('缺少可靠轮次标识，停止自动报名；不能用 messageId 代替')
    return
  }
  if (count !== position - 1) {
    api.log(`当前 ${count} 条报名，目标第 ${position} 位，本次不操作`)
    return
  }
  const entry = String(params.myEntry || '').trim()
  api.log(`观察到 ${count} 条报名，计划参加；最终名次仍受并发报名影响`)
  // Omit entry to use this account's group nickname (or WeChat nickname).
  await api.solitaire.join({solitaireId: event.solitaire.id, ...(entry ? {entry} : {})})
}