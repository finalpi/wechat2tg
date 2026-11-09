import {useEffect, useState} from 'react'
import type {Contact, ContactCategory} from './messages-api'

export const directoryCategories: {id:ContactCategory; label:string}[] = [
  {id:'group',label:'群聊'}, {id:'official',label:'公众号'}, {id:'service',label:'服务号'},
  {id:'enterprise',label:'企业微信联系人'}, {id:'person',label:'联系人'}, {id:'unknown',label:'待识别'},
]
export interface ChatPreferences {hiddenCategories:ContactCategory[]}
export const CHAT_PREFERENCES_KEY = 'webui-chat-preferences-v1'
export function parseChatPreferences(raw:string|null):ChatPreferences {
  try {
    const value = JSON.parse(raw || '{}')
    return {hiddenCategories:directoryCategories.map(c=>c.id).filter(id=>Array.isArray(value?.hiddenCategories) && value.hiddenCategories.includes(id))}
  } catch {return {hiddenCategories:[]}}
}
export function isContactVisible(contact:Contact, preferences:ChatPreferences) {
  const category = contact.category || (contact.kind === 'group' ? 'group' : 'unknown')
  return !preferences.hiddenCategories.includes(category)
}
export function useChatPreferences() {
  const [preferences,setPreferences] = useState<ChatPreferences>(()=>{
    try {return parseChatPreferences(localStorage.getItem(CHAT_PREFERENCES_KEY))} catch {return {hiddenCategories:[]}}
  })
  const [error,setError] = useState('')
  useEffect(()=>{
    const changed = (event:StorageEvent)=>{if(event.key === CHAT_PREFERENCES_KEY || event.key === null)setPreferences(parseChatPreferences(event.newValue))}
    window.addEventListener('storage',changed)
    return ()=>window.removeEventListener('storage',changed)
  },[])
  const update = (next:ChatPreferences)=>{
    setPreferences(next)
    try {localStorage.setItem(CHAT_PREFERENCES_KEY,JSON.stringify(next));setError('')}
    catch {setError('浏览器无法保存偏好，本次修改仅在当前页面生效。')}
  }
  return {preferences,update,error}
}
