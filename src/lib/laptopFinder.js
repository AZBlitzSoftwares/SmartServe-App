import { supabase } from './supabase'
import { serviceDates } from '../components/guest/deviceEntry'
import { isLaptopOrigin, isLocalBase, normaliseBase, DEFAULT_LAPTOP_PORT } from './serverSwitch'

/* Finding the event laptop without typing its address.

   The laptop's address is decided by whichever router it joins, so it is
   different at every venue and can change during an event. Two ways to
   find it:

   1. Through the cloud. While it has any internet, the laptop's Local
      Server tells the cloud its address every minute (ls_announce, see
      db/2026-10-21_local_server_address.sql). publishedLaptops() asks the
      cloud for the laptops of today's events.

   2. On the Wi-Fi. searchWifi() asks every address of a network
      (192.168.0.1 ... .254) for the Smart Serve laptop's /ss-local.json.
      From a laptop page (plain http) that always works. From the cloud page
      (https) the browser may block it: Chrome 142 and newer asks once to
      allow "devices on your local network"; other browsers and app
      wrappers may refuse, which searchWifi() reports as blocked.          */

const timeoutSignal = (ms) => {
  try { return AbortSignal.timeout(ms) } catch {
    const c = new AbortController()
    setTimeout(() => c.abort(), ms)
    return c.signal
  }
}

function groupByBase(rows, eventIds) {
  const byBase = new Map()
  for (const r of rows || []) {
    if (eventIds && eventIds.length && !eventIds.includes(r.event_id)) continue
    const base = normaliseBase(r.base_url)
    if (!base || !isLocalBase(base)) continue
    const cur = byBase.get(base) || { base, label: r.label || '', events: [], eventIds: [], ageSeconds: r.age_seconds ?? 0 }
    if (r.event_name && !cur.events.includes(r.event_name)) cur.events.push(r.event_name)
    if (r.event_id && !cur.eventIds.includes(r.event_id)) cur.eventIds.push(r.event_id)
    cur.ageSeconds = Math.min(cur.ageSeconds, r.age_seconds ?? cur.ageSeconds)
    byBase.set(base, cur)
  }
  return [...byBase.values()]
}

/* The event this device is set up for (a captain sign-in or a guest table). */
export function deviceEventId() {
  for (const k of ['ss_captain_event', 'ss_setup_event']) {
    try { const e = JSON.parse(localStorage.getItem(k) || 'null'); if (e && e.id) return e.id } catch { /* unreadable */ }
  }
  return null
}

/** The laptops running now for today's events, as the cloud knows them:
    [{ base, label, events: [names], eventIds, ageSeconds }], newest first.
    Only the laptop of `eventId` when given. [] on a laptop page, without
    internet, or before the SQL update. */
export async function publishedLaptops({ eventId = null } = {}) {
  if (isLaptopOrigin()) return []
  try {
    let q = supabase.rpc('ls_find', { p_dates: serviceDates() })
    if (typeof q.retry === 'function') q = q.retry(false)
    const { data, error } = await q.abortSignal(timeoutSignal(6000))
    if (error || !Array.isArray(data)) return []
    return groupByBase(data, eventId ? [eventId] : null)
  } catch {
    return []
  }
}

/** From a laptop page: ask the cloud directly (its address is built into the
    app) where the laptop of these events is now. Works whenever the venue has
    any internet; [] otherwise. */
export async function cloudLaptopsFor(eventIds) {
  const url = import.meta.env && import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key || !eventIds || !eventIds.length) return []
  try {
    const res = await fetch(String(url).replace(/\/+$/, '') + '/rest/v1/rpc/ls_find', {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_dates: serviceDates() }),
      signal: timeoutSignal(6000),
    })
    if (!res.ok) return []
    return groupByBase(await res.json(), eventIds)
  } catch {
    return []
  }
}

/** "12 s ago", "3 min ago" */
export function agoText(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

// The networks venue, office and phone-hotspot routers usually hand out.
export const COMMON_NETS = ['192.168.1', '192.168.0', '192.168.29', '192.168.31', '192.168.68', '192.168.2',
  '192.168.43', '192.168.100', '192.168.10', '10.0.0', '172.20.10']

/** "http://192.168.0.199:8080" -> "192.168.0" (IP addresses only; 127.x only
    when asked: a page opened on the laptop itself, as in a test) */
export function netOf(base, { loopback = false } = {}) {
  if (!isLocalBase(base)) return null
  try {
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(new URL(normaliseBase(base)).hostname)
    if (!m || m[1].startsWith('169.254')) return null
    return !m[1].startsWith('127.') || loopback ? m[1] : null
  } catch { return null }
}

/** The networks to search, most likely first: this laptop page's own, the hints given, then the usual ones. */
export function netsToSearch(hints = []) {
  const own = isLaptopOrigin() ? netOf(window.location.origin, { loopback: true }) : null
  return [...new Set([own, ...hints.map(netOf), ...COMMON_NETS].filter(Boolean))]
}

/** Is a Smart Serve laptop answering at this address? Its /ss-local.json, or null. */
export async function askLaptop(base, timeoutMs = 3000) {
  try {
    const res = await fetch(normaliseBase(base) + '/ss-local.json', { cache: 'no-store', signal: timeoutSignal(timeoutMs) })
    const j = await res.json()
    return j && j.local === true ? j : null
  } catch {
    return null
  }
}

/* Search networks for a Smart Serve laptop.
     nets        ['192.168.0', ...] (netsToSearch)
     port        the laptop server's port (8080)
     wantEvents  event ids: only a laptop carrying one of them counts (null = any)
     skip        an address to leave out (the laptop that stopped answering)
     onProgress  ({ net, index, of, checked })
     isStopped   () => true to stop early
   Resolves { found: [{ base, events }], blocked, nets } - stops at the first
   network where a laptop answered.                                          */
export async function searchWifi({ nets, port = DEFAULT_LAPTOP_PORT, wantEvents = null, skip = null,
  onProgress = () => {}, isStopped = () => false, timeoutMs = 1500, concurrency = 24, jitterMs = 0 } = {}) {
  const found = []
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  let fastFails = 0
  let tried = 0
  const searched = []
  for (const [index, net] of nets.entries()) {
    if (isStopped()) break
    searched.push(net)
    const ips = Array.from({ length: 254 }, (_, i) => `http://${net}.${i + 1}:${port}`).filter(b => b !== skip)
    let next = 0
    let checked = 0
    onProgress({ net, index, of: nets.length, checked })
    const worker = async () => {
      while (next < ips.length && !isStopped() && !found.length) {
        const base = ips[next++]
        if (jitterMs) await new Promise(r => setTimeout(r, Math.random() * jitterMs))
        const t0 = Date.now()
        const j = await askLaptop(base, timeoutMs)
        tried++
        if (!j && Date.now() - t0 < 150) fastFails++
        checked++
        if (checked % 16 === 0) onProgress({ net, index, of: nets.length, checked })
        if (j) {
          const ids = Array.isArray(j.events) ? j.events.map(e => e && e.id).filter(Boolean) : []
          if (!wantEvents || !wantEvents.length || ids.some(id => wantEvents.includes(id))) {
            found.push({ base, events: Array.isArray(j.events) ? j.events : [] })
          }
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    if (found.length) break
    // From the cloud page every address refused at once: the browser blocks the search.
    if (secure && tried > 0 && fastFails === tried) return { found, blocked: true, nets: searched }
  }
  return { found, blocked: false, nets: searched }
}
