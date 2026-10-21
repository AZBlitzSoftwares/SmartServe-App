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
   Absent      = cloud.

   The laptop's address depends on the router it joins, so it can change
   between venues and even during an event. Three things deal with that:
   - ss_server_last keeps the last laptop address used here (also after
     "Use cloud server"), so the address box starts with it;
   - a laptop page that loses its laptop finds it again on the Wi-Fi
     (laptopWatch.js) and moves there with moveToLaptop(); a device that
     came from the cloud app (the APK) goes by way of the cloud address
     (?ss_server=laptop:<new address>), so the cloud origin saves the new
     address too and the next app start opens it;
   - a switch carries this device's saved sign-in, table and choices (its
     ss_* and ms_* keys) in the address fragment (#ss_carry=...), so a
     captain stays signed in and a guest tablet keeps its table: every
     laptop address is a separate origin with its own empty storage.
     The carry always goes from the origin holding the device's newest
     state: laptop -> laptop (a move), laptop -> cloud ("Use cloud
     server"), and cloud -> laptop only while the cloud's copy is the
     newest (ss_server_fresh, cleared whenever the device goes to a
     laptop). Each origin keeps its own unsent outbox, clock skew, print
     station and menu cache: those never travel.
   Only private network addresses (10.x, 172.16-31.x, 192.168.x, 100.64-127.x,
   127.x) are ever followed automatically; a typed address can be anything. */

export const CLOUD_BASE = (import.meta.env && import.meta.env.VITE_CLOUD_BASE) || 'https://smart-serve-app.vercel.app'
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
const LAST_KEY = 'ss_server_last'
// On a laptop page: this device was sent here by the cloud app (the APK).
const VIA_KEY = 'ss_via_cloud'
const VIA_PARAM = 'ss_via'
const CARRY = 'ss_carry'
// On the cloud origin: its saved state is this device's newest (never sent to a
// laptop, or just back from one with the laptop's state).
const FRESH_KEY = 'ss_server_fresh'

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

/** True for an address that may be followed without anyone typing it: plain
    http to a private network address (or this machine). A public address or
    a web name never is: nobody can point tablets at a server on the internet. */
export function isLocalBase(base) {
  const b = normaliseBase(base)
  if (!b || !b.startsWith('http://')) return false
  let h
  try { h = new URL(b).hostname } catch { return false }
  if (h === 'localhost') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m || m.slice(1).some(x => Number(x) > 255)) return false
  const [a, b2] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b2 === 168) || (a === 172 && b2 >= 16 && b2 <= 31) ||
    (a === 100 && b2 >= 64 && b2 <= 127)
}

/** The last laptop address used on this device (kept after "Use cloud server"). */
export function lastLaptopBase() {
  const v = normaliseBase(read(LAST_KEY))
  if (v) return v
  return getSavedLaptop()?.base || null
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

/* This device's saved state (sign-in, table, choices), for the next address. */
// Not carried: the server settings, and what belongs to one server only - its
// unsent outbox, the clock offset to it, its print station, its menu cache.
const carriedKey = k => !!k && /^(ss|ms)_/.test(k) && !/^(ss_server|ss_mk_clock_skew|ss_print_station|ss_menu_v|ms_outbox_)/.test(k)
function carryFragment() {
  const out = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (carriedKey(k)) out[k] = localStorage.getItem(k)
    }
  } catch { /* storage blocked: nothing to bring */ }
  return Object.keys(out).length ? '#' + CARRY + '=' + encodeURIComponent(JSON.stringify(out)) : ''
}

/* The state a #ss_carry= fragment brings replaces this origin's copy (only
   the carried kinds of key: an unsent outbox here is never touched). */
function importCarry(hash) {
  const m = /^#ss_carry=(.*)$/.exec(hash || '')
  if (!m) return false
  let data
  try { data = JSON.parse(decodeURIComponent(m[1])) } catch { data = null }
  if (!data || typeof data !== 'object') return false
  const old = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (carriedKey(k)) old.push(k) }
  old.forEach(remove)
  for (const [k, v] of Object.entries(data)) if (carriedKey(k) && typeof v === 'string') write(k, v)
  return true
}

/* On a laptop page at start: what the address brought with it. */
function takeArrival() {
  try {
    const params = new URLSearchParams(window.location.search)
    const via = params.get(VIA_PARAM) === 'cloud'
    const hash = window.location.hash || ''
    const carry = /^#ss_carry=/.test(hash)
    if (!via && !carry) return
    params.delete(VIA_PARAM)
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? '?' + qs : ''))
    if (carry) importCarry(hash)
    if (via) write(VIA_KEY, '1')
  } catch { /* an odd address is no reason not to start */ }
}

/** Leave for the laptop now. From here on the laptop holds the newest state. */
function goToLaptop(base, fragment = '') {
  write(SENT_KEY, String(Date.now()))
  remove(FRESH_KEY)
  let url = base + pathHere()
  try {
    const u = new URL(url)
    u.searchParams.set(VIA_PARAM, 'cloud')
    url = u.toString()
  } catch { /* keep the plain address */ }
  const go = () => window.location.replace(url + fragment)
  // In the tablet app, after a moment, so the link rules that keep the laptop
  // inside the app are in place first (medianLinks.js).
  if (typeof window.__ssLinkRulesAt === 'number') setTimeout(go, Math.max(0, 300 - (Date.now() - window.__ssLinkRulesAt)))
  else go()
}

/** From a laptop page to the laptop's new address, keeping this device's
    state. A device that came from the cloud app goes by way of the cloud
    address, which saves the new address for the next app start. */
export function moveToLaptop(base) {
  const b = normaliseBase(base)
  if (!b) return false
  const frag = carryFragment()
  if (read(VIA_KEY) === '1') {
    window.location.replace(CLOUD_BASE + window.location.pathname + '?' + CLOUD_FLAG + '=' +
      encodeURIComponent('laptop:' + b) + frag)
  } else {
    window.location.replace(b + window.location.pathname + window.location.search + frag)
  }
  return true
}

/* Run once in main.jsx, before React renders.
     'render'   carry on and draw the app here
     'redirect' we are leaving for the laptop: draw nothing
     'go'       set to a laptop: main.jsx checks the cloud for a new address,
                then calls goToSavedLaptop - draw nothing
     'ask'      we sent this device to the laptop a moment ago and it is
                back here - show the choice instead of redirecting again  */
export function startupServerCheck() {
  if (typeof window === 'undefined') return 'render'

  // The laptop page itself: take in what the address brought. It never sends anyone anywhere.
  if (isLaptopOrigin()) { takeArrival(); return 'render' }

  // Back from the laptop: forget it on this origin, then tidy the address.
  // Or the laptop moved (?ss_server=laptop:<address>): save it here and go there.
  try {
    const params = new URLSearchParams(window.location.search)
    const flag = params.get(CLOUD_FLAG) || ''
    if (flag.startsWith('laptop:')) {
      const base = normaliseBase(flag.slice('laptop:'.length))
      const frag = /^#ss_carry=/.test(window.location.hash || '') ? window.location.hash : ''
      params.delete(CLOUD_FLAG)
      const qs = params.toString()
      window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? '?' + qs : ''))
      // Only for a device that already uses a laptop, and only to a private address:
      // a link can never point a cloud-only tablet somewhere else.
      if (base && isLocalBase(base) && getSavedLaptop()) {
        write(KEY, JSON.stringify({ mode: 'laptop', base }))
        write(LAST_KEY, base)
        goToLaptop(base, frag)
        return 'redirect'
      }
      return 'render'
    }
    if (params.has(CLOUD_FLAG)) {
      const hash = window.location.hash || ''
      if (params.get(CLOUD_FLAG) === 'cloud') {
        // Back from the laptop with its state (only a device that was on one):
        // the cloud's copy is the newest again.
        const wasOnLaptop = !!getSavedLaptop()
        remove(KEY); remove(SENT_KEY)
        if (wasOnLaptop && importCarry(hash)) write(FRESH_KEY, '1')
      }
      params.delete(CLOUD_FLAG)
      const qs = params.toString()
      window.history.replaceState(window.history.state, '',
        window.location.pathname + (qs ? '?' + qs : '') + (/^#ss_carry=/.test(hash) ? '' : hash))
      return 'render'
    }
  } catch { /* an odd address is no reason not to start */ }

  const saved = getSavedLaptop()
  if (!saved) return 'render'
  let target
  try { target = new URL(saved.base) } catch { return 'render' }
  if (target.origin === window.location.origin) return 'render'

  const sentAt = Number(read(SENT_KEY)) || 0
  if (sentAt && Date.now() - sentAt < RESEND_PAUSE_MS) return 'ask'

  // main.jsx asks the cloud first whether this event's laptop has a new
  // address (goToSavedLaptop), then leaves: draw nothing meanwhile.
  return 'go'
}

/* Leaving for the saved laptop at start-up. With any internet the cloud may
   know that this event's laptop now has another address (another router, a
   new address from the same router): go there instead of into an error page
   at the old one. `moved` = that address, or null (no internet, nothing
   known, the same address). Only to a private address, and only for a device
   already set to a laptop, as with ?ss_server=laptop:. */
export function goToSavedLaptop(moved = null) {
  const saved = getSavedLaptop()
  if (!saved) return false
  const base = normaliseBase(moved)
  if (base && base !== saved.base && isLocalBase(base)) {
    write(KEY, JSON.stringify({ mode: 'laptop', base }))
    write(LAST_KEY, base)
    goToLaptop(base)
  } else {
    goToLaptop(saved.base)
  }
  return true
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

/** Save the laptop address on this origin and go there, bringing this
    device's sign-in and table along. On a laptop page: move to that address. */
export function switchToLaptop(base) {
  const b = normaliseBase(base)
  if (!b) return false
  if (isLaptopOrigin()) return moveToLaptop(b)
  // Bring this device's state only while the cloud's copy is its newest: never
  // sent to a laptop yet, or just back from one. Otherwise the laptop keeps its own.
  const fresh = read(FRESH_KEY) === '1' || (!read(LAST_KEY) && !getSavedLaptop())
  const carry = fresh ? carryFragment() : ''
  write(KEY, JSON.stringify({ mode: 'laptop', base: b }))
  write(LAST_KEY, b)
  goToLaptop(b, carry)
  return true
}

/** Back to the cloud. From the laptop that means a trip to the cloud
    address with the flag that makes the cloud origin forget the laptop,
    bringing this device's state along (the laptop's is the newest). */
export function switchToCloud() {
  remove(KEY); remove(SENT_KEY)
  if (isLaptopOrigin()) {
    window.location.replace(CLOUD_BASE + window.location.pathname + '?' + CLOUD_FLAG + '=cloud' + carryFragment())
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
