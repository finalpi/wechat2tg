/** Keep automatic previews from starting every attachment download at once. */
export function createMediaQueue(concurrency = 3) {
  let active = 0
  const pending: (() => void)[] = []
  return function schedule<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = pending.indexOf(start)
        if (index >= 0) pending.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const start = () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {abort(); return}
        active++
        void Promise.resolve().then(operation).then(resolve, reject).finally(() => {
          active--
          pending.shift()?.()
        })
      }
      if (signal.aborted) {abort(); return}
      if (active < concurrency) start()
      else {pending.push(start); signal.addEventListener('abort', abort, {once: true})}
    })
  }
}
