/* Printing straight from the Control Desk (no Print Hub to install).

   When "Print from this laptop" is on, this browser does what the Print Hub does: it takes the
   event's queued KOTs from the server (hub_claim_kots), prints each one on its kitchen's Epson
   printer with Epson's web printing (ePOS-Print, the same request as "Test print from this
   browser"), falls back to the kitchen's backup printer, reports the result (hub_report) and
   the printer's status (hub_printer_status: "online" also re-sends KOTs that failed on it).
   The KOT is the Print Hub's own layout (printhub/escpos.mjs), sent as raw ESC/POS.

   Needs: this laptop on the printers' Wi-Fi, Chrome (allow "devices on your local network"),
   and this page open. Only one printer of the event's KOTs should be running: a Print Hub
   elsewhere would take KOTs too (the desk warns about two). */
import { supabase } from './supabase'
import { eposBase, eposCommandXml, eposSend } from './eposPrint'

const KEY = 'ss_print_station'
const NAME_KEY = 'ss_print_station_name'
const CHANGED = 'ss-print-station'

// ---- on / off, per laptop and event --------------------------------------------------------
function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}
export function stationOn(eventId) {
  const s = read()
  return !!(s && eventId && s.eventId === eventId)
}
export function setStation(eventId, on) {
  try {
    if (on) localStorage.setItem(KEY, JSON.stringify({ eventId, at: Date.now() }))
    else localStorage.removeItem(KEY)
  } catch { /* private window: on for this page only */ }
  memory = on ? eventId : null
  window.dispatchEvent(new Event(CHANGED))
}
let memory = null
export function stationEventId() {
  return read()?.eventId || memory
}
export function onStationChange(fn) {
  window.addEventListener(CHANGED, fn)
  window.addEventListener('storage', fn)
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener('storage', fn) }
}

/** This laptop's name in the KOT log and the desk's "two Print Hubs" warning. */
export function stationName() {
  let n = null
  try { n = localStorage.getItem(NAME_KEY) } catch { /* no storage */ }
  if (!n) {
    n = 'browser-' + Math.random().toString(36).slice(2, 6)
    try { localStorage.setItem(NAME_KEY, n) } catch { /* no storage */ }
  }
  return n
}

// ---- live numbers for the screen ------------------------------------------------------------
const listeners = new Set()
export const stats = { printed: 0, failed: 0, last: null, error: null, running: false }
function changed() { for (const f of listeners) f({ ...stats }) }
export function onStats(fn) { listeners.add(fn); fn({ ...stats }); return () => listeners.delete(fn) }

// ---- printing ---------------------------------------------------------------------------------
let escpos = null
async function kotBytes(job, printer, backup) {
  if (!escpos) escpos = await import('../../printhub/escpos.mjs')
  return escpos.buildKot(job, { printer, backup, now: new Date() })
}

// "192.168.0.201" + port 9100, or "192.168.0.201:9105" (port written in the IP field)
function endpoint(ip, port) {
  const t = String(ip || '').trim()
  if (!t) return null
  const m = t.match(/^(.+):(\d{1,5})$/)
  return m ? { host: m[1], port: Number(m[2]) } : { host: t, port: Number(port) || 9100 }
}
const label = ep => (ep.port === 9100 ? ep.host : `${ep.host}:${ep.port}`)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function printOn(ep, job, backup) {
  const bytes = await kotBytes(job, `${ep.host}:${ep.port}`, backup)
  const xml = eposCommandXml(bytes)
  let r
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(1500)
    r = await eposSend(eposBase(ep.host, ep.port), xml)
    if (r.ok || r.kind === 'printer') break // paper out / cover open: a second try will not help
  }
  return r
}

export function createStation({ eventId, onLog = () => {} }) {
  const hub = stationName()
  const status = new Map() // "host:port" -> last status told to the server
  let stopped = false
  let busy = false
  let again = false

  async function tellStatus(ep, st) {
    const k = `${ep.host}:${ep.port}`
    if (status.get(k) === st) return
    status.set(k, st)
    const { error } = await supabase.rpc('hub_printer_status', { p_event_id: eventId, p_printer_ip: ep.host, p_printer_port: ep.port, p_status: st })
    if (error) status.delete(k)
  }

  async function printJob(job) {
    const kitchen = job.kitchen_name || 'this kitchen'
    const main = endpoint(job.target_ip, job.target_port)
    if (!main) return { ok: false, error: `No printer IP set for ${kitchen}` }
    const first = await printOn(main, job, false)
    tellStatus(main, first.status).catch(() => {})
    if (first.ok) return { ok: true, printer: label(main) }
    // a test print must come out of the printer being tested, never the backup
    const b = job.kind === 'test' ? null : endpoint(job.backup_ip, 9100)
    if (!b || (b.host === main.host && b.port === main.port)) return { ok: false, error: first.error }
    const second = await printOn(b, job, true)
    tellStatus(b, second.status).catch(() => {})
    if (second.ok) return { ok: true, printer: label(b), backup: true }
    return { ok: false, error: `${first.error}; backup: ${second.error}` }
  }

  // Like the Print Hub, say every printer's status again each minute: the desk reads that as
  // "the printing laptop is alive", and the ready check as "printer answered lately".
  let lastBeat = Date.now()
  async function heartbeat() {
    if (Date.now() - lastBeat < 60000) return
    lastBeat = Date.now()
    for (const [k, st] of [...status]) {
      const [host, port] = [k.slice(0, k.lastIndexOf(':')), Number(k.slice(k.lastIndexOf(':') + 1))]
      await supabase.rpc('hub_printer_status', { p_event_id: eventId, p_printer_ip: host, p_printer_port: port, p_status: st })
    }
  }

  async function round() {
    if (stopped) return
    heartbeat().catch(() => {})
    if (busy) { again = true; return }
    busy = true
    try {
      do {
        again = false
        const { data, error } = await supabase.rpc('hub_claim_kots', { p_event_id: eventId, p_hub: hub, p_limit: 2 })
        if (error) throw new Error(error.message)
        stats.error = null
        for (const job of data || []) {
          if (stopped) return
          const r = await printJob(job).catch(e => ({ ok: false, error: String(e?.message || e) }))
          const what = job.kind === 'test' ? 'Test print' : job.kind === 'cancel' ? 'Cancel slip' : job.kot_no || 'KOT'
          await supabase.rpc('hub_report', { p_kot_id: job.id, p_ok: !!r.ok, p_error: r.ok ? null : r.error, p_hub: hub })
          if (r.ok) stats.printed++
          else stats.failed++
          stats.last = { ok: !!r.ok, text: r.ok ? `${what} · ${job.kitchen_name || ''} on ${r.printer}${r.backup ? ' (backup)' : ''}` : `${what} · ${r.error}`, at: Date.now() }
          onLog(stats.last)
          changed()
          if ((data || []).length >= 2) again = true
        }
      } while (again && !stopped)
    } catch (e) {
      stats.error = 'Could not reach the server: ' + (e?.message || e)
      changed()
    } finally {
      busy = false
    }
  }

  // A worker ticks every 1.5 s: a page's own timers are slowed down to once a minute when the
  // page has been in the background for a while, a worker's are not.
  let worker = null
  let timer = null
  try {
    const src = 'setInterval(function(){postMessage(0)},1500)'
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    worker.onmessage = () => round()
  } catch {
    timer = setInterval(round, 1500)
  }
  // and new KOTs wake it at once
  let channel = null
  try {
    channel = supabase.channel('print-station-' + eventId + '-' + Math.random().toString(36).slice(2, 7))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kots', filter: 'event_id=eq.' + eventId }, p => {
        if (p.new && p.new.print_status === 'queued') round()
      })
      .subscribe()
  } catch { /* polling is enough */ }

  stats.running = true
  stats.error = null
  changed()
  round()

  return function stop() {
    stopped = true
    stats.running = false
    changed()
    if (worker) worker.terminate()
    if (timer) clearInterval(timer)
    if (channel) supabase.removeChannel(channel)
  }
}
