/* Janu's Smart Serve service worker (ss-perf).
 *
 * What it does, and nothing more:
 *  - Hashed build files (/assets/*): from the tablet's cache first. Their
 *    names change whenever their content changes, so a cached copy is never
 *    out of date.
 *  - Pages (HTML): from the network first, so a new deploy is picked up on
 *    the next load. If the network has not answered in 2.5 s, is down, or
 *    the server errors, the last saved copy of the page opens instead.
 *  - Small static files (icons, manifests, images): from cache at once and
 *    refreshed in the background.
 *  - Everything else - Supabase and every other site, every POST/PATCH,
 *    videos, the laptop server - is never touched: it goes straight to the
 *    network exactly as if this file did not exist.
 *
 * The build writes its stamp and file list between the markers below
 * (vite.config.js, ss-sw-build-manifest). Unbuilt (dev) it runs with the
 * defaults: nothing precached, nothing pruned.
 */
const MANIFEST = /*SS_MANIFEST*/{ build: 'dev', entry: [], all: [] }/*END_SS_MANIFEST*/

const SHELL_CACHE = 'ss-shell-' + MANIFEST.build   // the page itself, per build
const ASSET_CACHE = 'ss-assets'                     // hashed files, shared by builds
const STATIC_CACHE = 'ss-static'                    // icons, manifests, images
const KEEP = [SHELL_CACHE, ASSET_CACHE, STATIC_CACHE]
const SHELL_URL = '/index.html'
const NAV_TIMEOUT_MS = 2500
const STATIC_RE = /\.(?:svg|png|jpe?g|webp|gif|ico|json)$/i

self.addEventListener('install', event => {
  self.skipWaiting()
  event.waitUntil((async () => {
    // The page must be stored, or there is nothing to open offline: if this
    // fails the install fails and the previous worker simply stays.
    const shell = await caches.open(SHELL_CACHE)
    for (const url of ['/', SHELL_URL]) {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!isGoodHtml(res)) throw new Error('shell fetch failed: ' + url)
      await shell.put(url, res)
    }
    // The first screen's files: best effort. Anything missed is stored the
    // first time the page asks for it.
    const assets = await caches.open(ASSET_CACHE)
    await Promise.all(MANIFEST.entry.map(async url => {
      try {
        if (await assets.match(url)) return
        const res = await fetch(url)
        if (isGoodAsset(res)) await assets.put(url, res)
      } catch (e) { /* stored later, on first use */ }
    }))
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Older workers' caches, including the original 'smartserve-v1'.
    for (const name of await caches.keys()) {
      if (!KEEP.includes(name)) await caches.delete(name)
    }
    // Files from older builds. Skipped in dev, where the list is empty.
    if (MANIFEST.all.length) {
      const current = new Set(MANIFEST.all)
      const assets = await caches.open(ASSET_CACHE)
      for (const req of await assets.keys()) {
        if (!current.has(new URL(req.url).pathname)) await assets.delete(req)
      }
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return      // Supabase, fonts, anything off-site
  if (req.headers.has('range')) return                 // video / partial content
  if (url.pathname.startsWith('/downloads/')) return    // the Offline Kit: always from the network

  if (req.mode === 'navigate') {
    event.respondWith(page(event))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, url.pathname))
  } else if (url.pathname !== '/sw.js' && !url.pathname.startsWith('/videos/') && STATIC_RE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, url.pathname))
  }
  // Anything else: not handled here, the browser fetches it normally.
})

function isGoodHtml(res) {
  return !!res && res.ok && !res.redirected &&
    (res.headers.get('content-type') || '').includes('text/html')
}

// The host answers unknown paths with index.html (vercel.json rewrite), so a
// missing file comes back as a 200 HTML page. Never store that as a script.
function isGoodAsset(res) {
  return !!res && res.status === 200 && res.type === 'basic' &&
    !(res.headers.get('content-type') || '').includes('text/html')
}

async function cachedShell() {
  try {
    const c = await caches.open(SHELL_CACHE)
    return (await c.match(SHELL_URL)) || (await c.match('/')) || undefined
  } catch (e) { return undefined }
}

function page(event) {
  let saved = Promise.resolve()
  const network = fetch(event.request).then(res => {
    // Keep the offline copy as fresh as the last page that loaded.
    if (isGoodHtml(res)) {
      const copy = res.clone()
      saved = caches.open(SHELL_CACHE).then(c => c.put(SHELL_URL, copy)).catch(() => {})
    }
    return res
  })
  // Let the network fetch (and the save) finish even if the cached page is
  // shown first, so the next load gets the newest version.
  event.waitUntil(network.then(() => saved, () => {}))

  return new Promise(resolve => {
    let done = false
    const finish = res => { if (!done && res) { done = true; resolve(res) } }
    const timer = setTimeout(() => { cachedShell().then(finish) }, NAV_TIMEOUT_MS)
    network.then(
      res => {
        clearTimeout(timer)
        // Only a server failure falls back; redirects and the rest pass through.
        if (res.status < 500) finish(res)
        else cachedShell().then(c => finish(c || res))
      },
      () => {
        clearTimeout(timer)
        cachedShell().then(c => finish(c || Response.error()))
      })
  })
}

async function cacheFirst(event, key) {
  const cache = await caches.open(ASSET_CACHE)
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await fetch(event.request)
  if (isGoodAsset(res)) {
    const copy = res.clone()
    event.waitUntil(cache.put(key, copy).catch(() => {}))
  }
  return res
}

async function staleWhileRevalidate(event, key) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(key)
  const refresh = fetch(event.request).then(res => {
    if (isGoodAsset(res)) return cache.put(key, res.clone()).then(() => res, () => res)
    return res
  })
  if (hit) {
    event.waitUntil(refresh.catch(() => {}))
    return hit
  }
  return refresh
}
