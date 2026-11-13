export type TelegramHomeScreenStatus = 'unsupported' | 'unknown' | 'added' | 'missed'
export type TelegramWebApp = {
  initData: string
  colorScheme: 'light' | 'dark'
  viewportStableHeight: number
  ready(): void
  expand(): void
  close(): void
  onEvent(name: string, handler: (event?: {status?: unknown}) => void): void
  offEvent(name: string, handler: (event?: {status?: unknown}) => void): void
  isVersionAtLeast?(version: string): boolean
  addToHomeScreen?(): void
  checkHomeScreenStatus?(callback?: (status: TelegramHomeScreenStatus) => void): void
  BackButton?: {show(): void; hide(): void; onClick(handler: () => void): void; offClick(handler: () => void): void}
}
declare global {interface Window {Telegram?: {WebApp?: TelegramWebApp}}}

// Capture once before stripping credentials from the fragment. This is untrusted
// launch data; only the backend signature/owner check grants a session.
export function telegramLaunch() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const existing = window.Telegram?.WebApp
  return {
    isMiniApp: fragment.has('tgWebAppData') || fragment.has('tgWebAppPlatform') || Boolean(existing?.initData),
    initData: existing?.initData || fragment.get('tgWebAppData') || '',
  }
}

let sdk: Promise<TelegramWebApp> | undefined
export function loadTelegramSDK() {
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp)
  if (!sdk) sdk = new Promise<TelegramWebApp>((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => {script.remove(); reject(new Error('Telegram SDK unavailable'))}, 10000)
    script.src = 'https://telegram.org/js/telegram-web-app.js'
    script.async = true
    script.onload = () => {
      window.clearTimeout(timeout)
      const app = window.Telegram?.WebApp
      if (app) resolve(app)
      else reject(new Error('Telegram SDK unavailable'))
    }
    script.onerror = () => {window.clearTimeout(timeout); script.remove(); reject(new Error('Telegram SDK unavailable'))}
    document.head.append(script)
  })
  return sdk
}

export function clearLaunchCredentials() {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  fragment.delete('tgWebAppData')
  const hash = fragment.toString()
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? `#${hash}` : ''))
}

export function connectTelegramAppearance(app: TelegramWebApp, theme: (value: 'light' | 'dark') => void) {
  const update = () => {
    theme(app.colorScheme === 'dark' ? 'dark' : 'light')
    if (Number.isFinite(app.viewportStableHeight) && app.viewportStableHeight > 0) {
      document.documentElement.style.setProperty('--mini-app-height', `${app.viewportStableHeight}px`)
    }
  }
  app.onEvent('themeChanged', update)
  app.onEvent('viewportChanged', update)
  app.ready(); app.expand(); update()
  clearLaunchCredentials()
  return () => {
    app.offEvent('themeChanged', update)
    app.offEvent('viewportChanged', update)
    document.documentElement.style.removeProperty('--mini-app-height')
  }
}
