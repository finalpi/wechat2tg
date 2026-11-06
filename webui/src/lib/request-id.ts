/** Request idempotency key; retain it across retries of the same operation. */
export function createRequestId(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  // getRandomValues is available on older WebViews and HTTP origins where
  // randomUUID (a secure-context API) is absent. Keep cryptographic entropy.
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('当前浏览器不支持安全请求编号，请使用新版浏览器或 Telegram 客户端。')
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
