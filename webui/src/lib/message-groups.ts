import type {ChatMessage} from './messages-api'

export interface ChatMessageGroup {id:string;messages:ChatMessage[];day:string}
const localDay = (timestamp:number)=>new Date(timestamp * 1000).toLocaleDateString()

/** Identity, not display name or text: two members with the same nickname must
 * never merge. Missing identities, date boundaries and notices break a run.
 * Elapsed time within a day does not split visually consecutive messages. */
export function groupChatMessages(rows:ChatMessage[],publication:boolean,room:boolean):ChatMessageGroup[] {
  const groups:ChatMessageGroup[] = []
  const identity = (row:ChatMessage)=>row.senderId || (!room && row.direction==='incoming'?row.wxId:'')
  for(const row of rows){
    const group = groups[groups.length-1],previous = group?.messages[group.messages.length-1]
    const day = localDay(row.timestamp)
    const notice = (message:ChatMessage)=>['system','revoke_notice'].includes(message.type) || message.revokeStatus==='revoked'
    const join = !publication && previous && identity(row) && identity(row)===identity(previous)
      && row.wxId===previous.wxId && row.direction===previous.direction && day===group.day
      && row.timestamp>=previous.timestamp
      && !notice(row) && !notice(previous)
    if(join)group.messages.push(row)
    else groups.push({id:`group-${row.id}`,day,messages:[row]})
  }
  return groups
}
