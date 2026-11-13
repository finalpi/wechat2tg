import type {ChatMessage} from './messages-api'

export interface MessageLocation {id: number}

export function findLoadedMessage(rows: ChatMessage[], target: {id?: number; remoteId?: string}) {
  return rows.find(row => (target.id !== undefined ? row.id === target.id : Boolean(target.remoteId) && row.remoteId === target.remoteId)
    && (!target.remoteId || row.remoteId === target.remoteId))
}

/** One cancellable scroll/highlight cycle per click, including repeated clicks on the same message. */
export function revealMessage(location: MessageLocation, viewport: HTMLElement, scrollToMessage: (id: string, options: {align: 'center'; behavior: ScrollBehavior}) => void) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let frame = 0, timer = 0, animation: Animation | undefined, highlighted: HTMLElement | null = null
  let disposed = false, arrived = false
  const highlight = () => {
    if (disposed || arrived) return
    arrived = true
    window.clearTimeout(timer)
    viewport.removeEventListener('scrollend', highlight)
    const row = viewport.querySelector<HTMLElement>(`[data-message-id="${location.id}"]`)
    highlighted = row?.querySelector<HTMLElement>('[data-slot="bubble"]') || row || null
    if (!highlighted) return
    highlighted.dataset.locateActive = 'true'
    if (reducedMotion || !highlighted.animate) {
      highlighted.classList.add('message-location-highlight')
      timer = window.setTimeout(() => {
        highlighted?.classList.remove('message-location-highlight')
        highlighted?.removeAttribute('data-locate-active')
      }, 1600)
      return
    }
    animation = highlighted.animate([
      {boxShadow: '0 0 0 0 hsl(var(--primary) / 0)'},
      {boxShadow: '0 0 0 5px hsl(var(--primary) / .22)', offset: .2},
      {boxShadow: '0 0 0 5px hsl(var(--primary) / .12)', offset: .6},
      {boxShadow: '0 0 0 8px hsl(var(--primary) / 0)'},
    ], {duration: 1700, easing: 'cubic-bezier(.2,.7,.25,1)'})
    void animation.finished.then(() => {if (!disposed) highlighted?.removeAttribute('data-locate-active')}, () => {})
  }
  frame = requestAnimationFrame(() => {
    if (disposed) return
    viewport.addEventListener('scrollend', highlight)
    // Browsers omit scrollend when the target is already centered.
    timer = window.setTimeout(highlight, reducedMotion ? 0 : 750)
    scrollToMessage(String(location.id), {align: 'center', behavior: reducedMotion ? 'auto' : 'smooth'})
  })
  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
    viewport.removeEventListener('scrollend', highlight)
    animation?.cancel()
    highlighted?.classList.remove('message-location-highlight')
    highlighted?.removeAttribute('data-locate-active')
  }
}
