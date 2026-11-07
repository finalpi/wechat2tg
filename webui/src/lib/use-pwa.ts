import {useEffect, useRef, useState} from 'react'

type Options = {enabled: boolean; canReload: () => boolean}
type PwaState = {supported: boolean; installed: boolean; canInstall: boolean; updateReady: boolean; error: string}
type InstallPrompt = Event & {prompt(): Promise<void>; userChoice: Promise<{outcome: string}>}
const empty: PwaState = {supported: false, installed: false, canInstall: false, updateReady: false, error: ''}
const blocked = '存在未保存或正在提交的编辑，请完成后再更新。'

// Small lifecycle seam: each mounted hook owns its listeners and reload approval.
// Nothing (especially installation prompts or approval) is persisted/shared across tabs.
export function createPwaLifecycle(options: Options, publish: (state: PwaState) => void) {
  let state = {...empty}
  let disposed = false
  let prompt: InstallPrompt | undefined
  let installing = false
  let registration: ServiceWorkerRegistration | undefined
  let pending: ServiceWorker | undefined
  // Activation can complete while new edits veto the reload. Keep an explicit
  // retry in this tab only; the worker is no longer in registration.waiting.
  let activated: ServiceWorker | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cleanups: Array<() => void> = []
  const watched = new Set<ServiceWorker>()
  const emit = (patch: Partial<PwaState>) => {
    if (!disposed) {state = {...state, ...patch}; publish(state)}
  }
  const clearPending = () => {
    pending = undefined
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
  }
  const listen = (target: EventTarget, event: string, handler: EventListener) => {
    target.addEventListener(event, handler)
    cleanups.push(() => target.removeEventListener(event, handler))
  }
  const allowed = () => {
    try {return options.canReload()} catch {return false}
  }
  const refreshWaiting = () => emit({updateReady: Boolean(navigator.serviceWorker.controller && (registration?.waiting || activated === navigator.serviceWorker.controller))})
  const watch = (worker: ServiceWorker | null) => {
    if (!worker || watched.has(worker)) return
    watched.add(worker)
    listen(worker, 'statechange', () => {
      refreshWaiting()
      if (worker === pending && worker.state === 'redundant') {
        clearPending()
        emit({error: '更新失败，请稍后重试。'})
      }
    })
  }
  if (options.enabled && typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator) {
    emit({supported: true})
    const display = window.matchMedia('(display-mode: standalone)')
    const installed = () => {
      const value = display.matches || Boolean((navigator as Navigator & {standalone?: boolean}).standalone)
      if (value) prompt = undefined
      emit({installed: value, canInstall: Boolean(prompt) && !value})
    }
    installed()
    listen(display, 'change', installed)
    listen(window, 'beforeinstallprompt', event => {
      event.preventDefault()
      if (!state.installed) {prompt = event as InstallPrompt; emit({canInstall: true})}
    })
    listen(window, 'appinstalled', () => {
      prompt = undefined
      emit({installed: true, canInstall: false})
    })
    listen(navigator.serviceWorker, 'controllerchange', () => {
      refreshWaiting()
      if (!pending) return // First installation and other tabs never grant reload approval.
      const requested = pending
      clearPending()
      if (navigator.serviceWorker.controller !== requested) return
      activated = requested
      if (!allowed()) {emit({error: blocked, updateReady: true}); return}
      try {window.location.reload(); activated = undefined} catch {emit({error: '无法刷新页面，请手动刷新。', updateReady: true})}
    })
    // Deferral avoids duplicate registration during StrictMode setup/cleanup replay.
    void Promise.resolve().then(async () => {
      if (disposed) return
      try {
        const result = await navigator.serviceWorker.register('/sw.js', {scope: '/'})
        if (disposed) return
        registration = result
        const found = () => {watch(result.installing); watch(result.waiting); refreshWaiting()}
        listen(result, 'updatefound', found)
        found()
      } catch {
        emit({error: '离线支持暂不可用，请联网后重试。'})
      }
    })
  } else {
    emit(empty)
  }
  return {
    async install(): Promise<boolean> {
      if (disposed || !prompt || installing) return false
      const event = prompt
      prompt = undefined
      installing = true
      emit({canInstall: false, error: ''})
      let timer: ReturnType<typeof setTimeout> | undefined
      let cancel: (() => void) | undefined
      try {
        const choice = (async () => {await event.prompt(); return (await event.userChoice).outcome === 'accepted'})()
        const expired = new Promise<boolean>(resolve => {
          cancel = () => resolve(false)
          cleanups.push(cancel)
          timer = setTimeout(() => resolve(false), 60000)
        })
        return await Promise.race([choice, expired]) && !disposed
      } catch {
        emit({error: '无法打开安装提示，请使用浏览器菜单安装。'})
        return false
      } finally {
        installing = false
        if (timer !== undefined) clearTimeout(timer)
        if (cancel) {const index = cleanups.indexOf(cancel); if (index >= 0) cleanups.splice(index, 1)}
      }
    },
    async applyUpdate(): Promise<boolean> {
      const worker = registration?.waiting
      if (disposed || pending || (!worker && !activated) || !navigator.serviceWorker.controller) return false
      if (!worker && activated !== navigator.serviceWorker.controller) return false
      try {
        // Check directly before sending the activation request, not when rendering UI.
        if (!allowed()) {emit({error: blocked}); return false}
        if (!worker) {
          window.location.reload()
          activated = undefined
          emit({updateReady: false, error: ''})
          return true
        }
        pending = worker
        timeout = setTimeout(() => {
          clearPending()
          emit({error: '更新等待超时，请稍后重试。'})
        }, 15000)
        worker.postMessage({type: 'SKIP_WAITING'})
        emit({error: ''})
        return true
      } catch {
        clearPending()
        emit({error: '更新失败，请稍后重试。'})
        return false
      }
    },
    dispose() {
      disposed = true
      prompt = undefined
      activated = undefined
      clearPending()
      for (const cleanup of cleanups) cleanup()
      cleanups.length = 0
    },
  }
}

export function usePwa({enabled, canReload}: Options) {
  const [state, setState] = useState<PwaState>(empty)
  const latest = useRef({enabled, canReload})
  latest.current = {enabled, canReload}
  const lifecycle = useRef<ReturnType<typeof createPwaLifecycle> | null>(null)
  useEffect(() => {
    const current = createPwaLifecycle({enabled, canReload: () => latest.current.enabled && latest.current.canReload()}, setState)
    lifecycle.current = current
    return () => {lifecycle.current = null; current.dispose()}
  }, [enabled])
  return {
    ...(enabled ? state : empty),
    install: () => enabled ? lifecycle.current?.install() ?? Promise.resolve(false) : Promise.resolve(false),
    applyUpdate: () => enabled ? lifecycle.current?.applyUpdate() ?? Promise.resolve(false) : Promise.resolve(false),
  }
}
