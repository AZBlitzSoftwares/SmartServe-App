/* Getting a new version of the app onto tablets that never reload.

   A captain's tablet, a guest tablet or the kitchen screen can stay open on
   one page for a whole evening, so a fix deployed at 6 pm would otherwise
   only reach them the next day. Every few minutes (and whenever the screen
   wakes up or the network comes back) the app asks for index.html, straight
   from the network, and compares the main script it names with the one it
   is running. When they differ a newer version is ready, and the page is
   reloaded at a safe moment:
     - as the screen wakes up (the tablet was put down; nobody is mid-tap), or
     - after a quiet spell with no taps,
   but never while something unsaved is on the screen (a guest's cart, a
   half-typed field). The person can also tap "Update" themselves.

   Nothing is cached by this check: the service worker passes it straight to
   the network (sw.js only answers page navigations and /assets/). */

const CHECK_EVERY_MS = 4 * 60 * 1000
const QUIET_RELOAD_MS = 8 * 60 * 1000

let unsavedCheck = () => false
/** A screen with unsaved work registers a check: true = do not reload now. */
export function setUnsavedCheck(fn) { unsavedCheck = typeof fn === 'function' ? fn : () => false }

export function runningEntry(doc = document) {
  const s = doc.querySelector('script[type="module"][src*="/assets/"]')
  return s ? s.getAttribute('src') : null
}

export function entryInHtml(html) {
  const m = /<script\b[^>]*\bsrc="([^"]*\/assets\/[^"]+\.js)"/i.exec(String(html || ''))
  return m ? m[1] : null
}

export async function newerVersion() {
  const mine = runningEntry()
  if (!mine) return false                     // development server: nothing to compare
  try {
    const res = await fetch('/index.html?check=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return false
    const latest = entryInHtml(await res.text())
    return !!latest && latest !== mine
  } catch { return false }                    // offline: try again later
}

function typing() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) && String(el.value ?? el.textContent ?? '').trim() !== ''
}
export function safeToReload() {
  try { return !unsavedCheck() && !typing() } catch { return false }
}

/** Starts the watcher. onReady(true) when a newer version is waiting. Returns stop(). */
export function watchForUpdates(onReady) {
  if (!runningEntry()) return () => {}
  let ready = false
  let lastTouch = Date.now()
  let stopped = false
  const reload = () => { try { window.location.reload() } catch { /* ignore */ } }

  async function check() {
    if (stopped || ready) return
    if (await newerVersion()) { ready = true; onReady(true) }
  }
  const touch = () => { lastTouch = Date.now() }
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    if (ready && safeToReload()) return reload()
    check().then(() => { if (ready && safeToReload()) reload() })
  }
  const timer = setInterval(() => {
    if (ready && Date.now() - lastTouch > QUIET_RELOAD_MS && safeToReload()) return reload()
    check()
  }, CHECK_EVERY_MS)
  const first = setTimeout(check, 20 * 1000)

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', check)
  window.addEventListener('pointerdown', touch, true)
  window.addEventListener('keydown', touch, true)
  return () => {
    stopped = true
    clearInterval(timer); clearTimeout(first)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', check)
    window.removeEventListener('pointerdown', touch, true)
    window.removeEventListener('keydown', touch, true)
  }
}

/** "Reset this tablet": the app's saved files too, not only its settings. */
export async function clearAppCaches() {
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k)
  } catch { /* not available */ }
  try {
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
  } catch { /* not available */ }
}

/* Why a saved sign-in ended, shown once on the sign-in screen. */
const REASON_KEY = 'ss_signed_out_reason'
export function setSignOutReason(text) { try { sessionStorage.setItem(REASON_KEY, text) } catch { /* blocked */ } }
export function takeSignOutReason() {
  try { const t = sessionStorage.getItem(REASON_KEY); sessionStorage.removeItem(REASON_KEY); return t || '' } catch { return '' }
}
