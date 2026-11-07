import {useEffect,useState} from 'react'

export function useWorkspaceRoute() {
  const [chatOnly,setChatOnly] = useState(() => window.location.pathname !== '/manage')
  useEffect(() => {
    const pop = () => setChatOnly(window.location.pathname !== '/manage')
    window.addEventListener('popstate',pop)
    return () => window.removeEventListener('popstate',pop)
  },[])
  const navigate = (chat:boolean) => {
    const path = chat ? '/chat' : '/manage'
    if(window.location.pathname !== path) {
      const state={...window.history.state}
      // A workspace entry is not the conversation's Back-to-list entry.
      delete state.chatSession;delete state.chatConversation
      window.history.pushState(state,'',path + window.location.hash)
    }
    setChatOnly(chat)
  }
  return {chatOnly,navigate}
}

/** Use the visible viewport when a mobile keyboard shrinks/pans the page. */
export function useWorkspaceViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      // Do not resize the layout when the user pinch-zooms.
      if(viewport && viewport.scale !== 1)return
      document.documentElement.style.setProperty('--workspace-height',`${viewport?.height || window.innerHeight}px`)
      document.documentElement.style.setProperty('--workspace-top',`${viewport?.offsetTop || 0}px`)
    }
    update()
    viewport?.addEventListener('resize',update)
    viewport?.addEventListener('scroll',update)
    window.addEventListener('resize',update)
    return () => {
      viewport?.removeEventListener('resize',update)
      viewport?.removeEventListener('scroll',update)
      window.removeEventListener('resize',update)
      document.documentElement.style.removeProperty('--workspace-height')
      document.documentElement.style.removeProperty('--workspace-top')
    }
  },[])
}

/** Consult mounted editors' existing guards without initiating a navigation. */
export function editorsAllowReload() {
  return window.dispatchEvent(new Event('beforeunload',{cancelable:true}))
}
