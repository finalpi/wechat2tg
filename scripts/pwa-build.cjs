/* eslint-disable @typescript-eslint/no-var-requires */
/* global self, caches */
const fs = require('node:fs')
const path = require('node:path')
const {createHash} = require('node:crypto')

const publicFiles = ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']
const hashedAsset = /^\/assets\/[a-zA-Z0-9_-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2?|png|svg|webp|jpg|jpeg|gif|ico)$/

// Serialized into the generated root worker; no runtime dependencies or private data.
function worker({cacheName, urls, assetPattern}) {
  const prefix = 'wechat2tg-public-'
  const allowed = new Set(urls)
  const hashedAsset = new RegExp(assetPattern)
  const routes = new Set(['/', '/chat', '/manage'])
  const generations = async () => (await caches.keys()).filter(name => name.startsWith(prefix))
  // One small local metadata entry (cache names only, never a network response).
  const stateCache = 'wechat2tg-pwa-state'
  const stateKey = '/.pwa-active-generation'
  const readState = async () => {
    const response = await (await caches.open(stateCache)).match(stateKey)
    return response ? response.json() : {}
  }

  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      const existed = await caches.has(cacheName)
      const cache = await caches.open(cacheName)
      // Requests omit credentials, reject redirects, and never copy navigation/API responses.
      // addAll is atomic: an incomplete download cannot leave a partial generation.
      try {
        await cache.addAll(urls.map(url => new Request(new URL(url, self.location.origin), {
          credentials: 'omit', cache: 'reload', redirect: 'error',
        })))
      } catch (error) {
        if (!existed) await caches.delete(cacheName)
        throw error
      }
    })())
  })
  self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
  })
  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      const state = await readState()
      const previous = state.current === cacheName ? state.previous : state.current
      // Retain the last ACTIVE generation, not a superseded waiting installation.
      await (await caches.open(stateCache)).put(stateKey, new Response(JSON.stringify({current: cacheName, previous})))
      await Promise.all((await generations()).filter(name => name !== cacheName && name !== previous)
        .map(name => caches.delete(name)))
      // No clients.claim(), navigate(), or forced reload of any tab.
    })())
  })
  self.addEventListener('fetch', event => {
    const request = event.request
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== self.location.origin || request.url.includes('?')
      || request.headers.has('Authorization') || request.headers.has('Range')) return
    if (request.mode === 'navigate') {
      if (!routes.has(url.pathname)) return
      event.respondWith((async () => {
        try { return await fetch(request) }
        catch (error) {
          const shell = await (await caches.open(cacheName)).match('/index.html')
          if (shell) return shell
          throw error
        }
      })())
      return
    }
    if (!allowed.has(url.pathname) && !hashedAsset.test(url.pathname)) return
    event.respondWith((async () => {
      if (allowed.has(url.pathname)) {
        const response = await (await caches.open(cacheName)).match(url.pathname)
        if (response) return response
      } else {
        // The previous cache's keys ARE its build-generated allowlist. Only exact hashed
        // asset hits qualify; no old HTML/icons, runtime caching, or global caches.match().
        const {previous} = await readState()
        if (previous?.startsWith(prefix) && await caches.has(previous)) {
          const response = await (await caches.open(previous)).match(url.pathname)
          if (response) return response
        }
      }
      return fetch(request)
    })())
  })
}

function generateServiceWorker(directory) {
  const assets = fs.readdirSync(path.join(directory, 'assets')).map(name => 'assets/' + name)
    .filter(name => hashedAsset.test('/' + name))
  const files = [...publicFiles, ...assets].sort()
  const hash = createHash('sha256').update(worker.toString()).update(hashedAsset.source)
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(directory, file))
    hash.update(JSON.stringify([file, bytes.length])).update(bytes)
  }
  const cacheName = 'wechat2tg-public-' + hash.digest('hex').slice(0, 24)
  const urls = files.map(file => '/' + file)
  const script = '(' + worker.toString() + ')(' + JSON.stringify({cacheName, urls, assetPattern: hashedAsset.source}) + ')\n'
  fs.writeFileSync(path.join(directory, 'sw.js'), script)
  return {cacheName, urls, script}
}

module.exports = {generateServiceWorker}