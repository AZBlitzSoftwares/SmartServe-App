/* Which server this device talks to: the cloud, or the event laptop.

   The APK always opens the cloud address. To run a tablet from the laptop
   we remember the laptop's address on the cloud origin, and on every start
   main.jsx sends the tablet straight on to the laptop before the app draws
   anything. The laptop's own server marks its pages with
   window.__SS_LOCAL__, so on the laptop nothing redirects anywhere.

   localStorage belongs to one origin. The laptop (http://192.168.1.10:8080)
   and the cloud (https://smart-serve-app.vercel.app) therefore each keep
   their own copy of everything, including this setting. Coming back from
   the laptop is done with a flag in the address (?ss_server=cloud) that
   tells the cloud origin to forget the laptop.

   Stored as:  ss_server = { "mode": "laptop", "base": "http://192.168.1.10:8080" }
   Absent      = cloud.                                                       */

export const CLOUD_BASE = 'https://smart-serve-app.vercel.app'
export const DEFAULT_LAPTOP_BASE = 'http://192.168.1.10:8080'
export const DEFAULT_LAPTOP_PORT = '8080'

const KEY = 'ss_server'
// When we last sent this device to the laptop. If the cloud page opens again
// soon after, the laptop most likely did not answer (or the app was simply
// reopened): instead of redirecting blindly again, main.jsx shows a screen
// with "Open laptop server" and "Use cloud server instead", so a dead laptop
// can never trap a tablet in an error page.
const SENT_KEY = 'ss_server_sent_at'
export const RESEND_PAUSE_MS = 3 * 60 * 1000
const CLOUD_FLAG = 'ss_server'

function read(key) {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key, value) {
  try { localStorage.setItem(key, value) } catch { /* storage blocked */ }
}
function remove(key) {
  try { localStorage.removeItem(key) } catch { /* storage blocked */ }
}

/** True when this page was served by the event laptop. */
export function isLaptopOrigin() {
  return typeof window !== 'undefined' && !!window.__SS_LOCAL__
}

/** "192.168.1.10", "192.168.1.10:8080", "http://192.168.1.10:8080/x" ->
    "http://192.168.1.10:8080". A bare address gets port 8080. null if it
    cannot be an address. */
export function normaliseBase(input) {
  let s = String(input == null ? '' : input).trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname || /\s/.test(u.hostname)) return null
  const authority = (/^[a-z]+:\/\/([^/?#]*)/i.exec(s) || [])[1] || ''
  const typedPort = /:\d+$/.test(authority.replace(/^.*@/, ''))
  // The laptop server is plain http on 8080; an https address is something
  // else entirely and keeps its own default port.
  if (typedPort || u.protocol === 'https:') return u.origin
  return u.protocol + '//' + u.hostname + ':' + DEFAULT_LAPTOP_PORT
}

/** The saved laptop setting on THIS origin, or null for cloud. */
export function getSavedLaptop() {
  try {
    const v = JSON.parse(read(KEY) || 'null')
    if (v && v.mode === 'laptop') {
      const base = normaliseBase(v.base)
      if (base) return { mode: 'laptop', base }
    }
  } catch { /* unreadable = not set */ }
  return null
}

/** What DeviceTools and the pill show. */
export function describeServer() {
  if (isLaptopOrigin()) {
    return { kind: 'laptop', address: window.location.origin, savedLaptop: null }
  }
  const saved = getSavedLaptop()
  return {
    kind: 'cloud',
    address: window.location.host,
    // Saved but not in use: the laptop did not answer and staff chose to stay.
    savedLaptop: saved && saved.base !== window.location.origin ? saved.base : null,
  }
}

function pathHere() {
  return window.location.pathname + window.location.search
}

/** Leave for the laptop now. */
function goToLaptop(base) {
  write(SENT_KEY, String(Date.now()))
  window.location.replace(base + pathHere())
}

/* Run once in main.jsx, before React renders.
     'render'   carry on and draw the app here
     'redirect' we are leaving for the laptop: draw nothing
     'ask'      we sent this device to the laptop a moment ago and it is
                back here - show the choice instead of redirecting again  */
export function startupServerCheck() {
  if (typeof window === 'undefined') return 'render'

  // Back from the laptop: forget it on this origin, then tidy the address.
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.has(CLOUD_FLAG)) {
      if (params.get(CLOUD_FLAG) === 'cloud') { remove(KEY); remove(SENT_KEY) }
      params.delete(CLOUD_FLAG)
      const qs = params.toString()
      window.history.replaceState(window.history.state, '',
        window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
      return 'render'
    }
  } catch { /* an odd address is no reason not to start */ }

  // The laptop itself never sends anyone anywhere.
  if (isLaptopOrigin()) return 'render'

  const saved = getSavedLaptop()
  if (!saved) return 'render'
  let target
  try { target = new URL(saved.base) } catch { return 'render' }
  if (target.origin === window.location.origin) return 'render'

  const sentAt = Number(read(SENT_KEY)) || 0
  if (sentAt && Date.now() - sentAt < RESEND_PAUSE_MS) return 'ask'

  goToLaptop(saved.base)
  return 'redirect'
}

/** "Open laptop server" on the ask screen. */
export function retryLaptop() {
  const saved = getSavedLaptop()
  if (saved) goToLaptop(saved.base)
}

/* Can this page reach the laptop? Only an http page can ask: from the https
   cloud page the browser blocks any request to an http address (mixed
   content), so there we skip the check and simply go.
     'ok' | 'unreachable' | 'skipped'                                      */
export async function probeLaptop(base, timeoutMs = 4000) {
  if (window.location.protocol !== 'http:') return 'skipped'
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => { try { ctl && ctl.abort() } catch { /* ignore */ } }, timeoutMs)
  try {
    // no-cors: any answer at all (even a 404) proves something is listening.
    await fetch(base + '/ss-local.json', { mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    return 'ok'
  } catch {
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}

/** Save the laptop address on this origin and go there. */
export function switchToLaptop(base) {
  const b = normaliseBase(base)
  if (!b) return false
  write(KEY, JSON.stringify({ mode: 'laptop', base: b }))
  goToLaptop(b)
  return true
}

/** Back to the cloud. From the laptop that means a trip to the cloud
    address with the flag that makes the cloud origin forget the laptop. */
export function switchToCloud() {
  remove(KEY); remove(SENT_KEY)
  if (isLaptopOrigin()) {
    window.location.replace(CLOUD_BASE + window.location.pathname + '?' + CLOUD_FLAG + '=cloud')
    return
  }
  window.location.reload()
}

/** Forget the laptop on this origin without going anywhere (ask screen). */
export function forgetLaptop() {
  remove(KEY); remove(SENT_KEY)
}

/** Identifies the build running now: VITE_BUILD_TIME if the build set one,
    otherwise the hashed name of the main bundle, which changes every build. */
export function appBuildLabel() {
  try {
    const t = import.meta.env && import.meta.env.VITE_BUILD_TIME
    if (t) return String(t)
  } catch { /* not defined */ }
  try {
    const s = document.querySelector('script[type="module"][src]')
    const src = s ? s.getAttribute('src') : ''
    const m = /([^/]+)\.js$/.exec(src || '')
    if (m) return m[1]
  } catch { /* no DOM */ }
  return 'unknown'
}
