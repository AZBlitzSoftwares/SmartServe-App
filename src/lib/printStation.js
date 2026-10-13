/* Printing straight from the Control Desk (no Print Hub to install).

   When "Print from this laptop" is on, this browser does what the Print Hub does: it takes the
   event's queued KOTs from the server (hub_claim_kots), prints each one on its kitchen's Epson
   printer with Epson's web printing (ePOS-Print, the same request as "Test print from this
   browser"), falls back to the kitchen's backup printer, reports the result (hub_report) and
   the printer's status (hub_printer_status: "online" also re-sends KOTs that failed on it).
   The KOT is the Print Hub's own layout (printhub/escpos.mjs), sent as raw ESC/POS.

   Needs: this laptop on the printers' Wi-Fi, Chrome (allow "devices on your local network"),
   and this page open.

   One printing laptop per event (db/2026-10-14_maestro_v6.sql, print_stations): switching on
   asks the server for the event (ps_take). While another laptop or a Print Hub is printing and
   answering, this one cannot switch on, except with an admin PIN (it then takes printing over and
   the other one stops by itself). A printing laptop silent for 90 seconds can be replaced without
   the PIN. A laptop that loses printing to another one switches itself off and says so. */
import { supabase } from './supabase'
import { eposBase, eposCommandXml, eposLinesXml, eposSend } from './eposPrint'

const KEY = 'ss_print_station'
const NAME_KEY = 'ss_print_station_name'
const LABEL_KEY = 'ss_print_station_label'
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

/** The name people see for this laptop ("Desk laptop"), chosen when printing is switched on. */
export function stationLabel() {
  let n = null
  try { n = localStorage.getItem(LABEL_KEY) } catch { /* no storage */ }
  if (n) return n
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPad|iPhone/i.test(ua) ? 'iPad' : /Mac/i.test(ua) ? 'Mac' : 'This'
  return `${os} laptop ${stationName().slice(-4)}`
}
export function setStationLabel(v) {
  try { localStorage.setItem(LABEL_KEY, String(v || '').trim().slice(0, 40)) } catch { /* no storage */ }
}

/** Who prints for the event: { station, label, taken_at, seen_at, active, mine } (null: unknown). */
export async function stationStatus(eventId) {
  const { data, error } = await supabase.rpc('ps_status', { p_event_id: eventId })
  if (error) return { error: /ps_status|PGRST202|42883|schema cache/i.test(`${error.code} ${error.message}`) ? 'no-sql' : error.message }
  const d = data || {}
  return d.station ? { ...d, mine: d.station === stationName() } : {}
}

/** Ask to be the event's printing laptop; an admin PIN takes it over from a working one. */
export async function takeStation(eventId, pin = null) {
  const { data, error } = await supabase.rpc('ps_take', { p_event_id: eventId, p_station: stationName(), p_label: stationLabel(), p_pin: pin })
  if (error) {
    // the database update is not there yet: printing works as before, without the lock
    if (/ps_take|PGRST202|42883|schema cache/i.test(`${error.code} ${error.message}`)) return { ok: true, noLock: true }
    return { ok: false, error: error.message }
  }
  return data || { ok: false }
}

// ---- live numbers for the screen ------------------------------------------------------------
const listeners = new Set()
export const stats = { printed: 0, failed: 0, last: null, error: null, running: false, notice: null }
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
  let xml = eposCommandXml(bytes)
  let r
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(1500)
    r = await eposSend(eposBase(ep.host, ep.port), xml)
    if (!r.ok && (r.code === 'SchemaError' || r.kind === 'notepos') && !xml.includes('<text ')) {
      // the printer did not take the raw KOT: send the same lines as plain ePOS text
      xml = eposLinesXml(escpos.decodeEscPos(bytes).lines)
      r = await eposSend(eposBase(ep.host, ep.port), xml)
    }
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

  // Still the event's printing laptop? Another one may have taken over with the admin PIN.
  let lastCheck = 0
  async function stillMine() {
    if (Date.now() - lastCheck < 10000) return true
    lastCheck = Date.now()
    const st = await stationStatus(eventId)
    if (st.error || !st.station || st.mine || !st.active) return true
    lose(`Printing moved to “${st.label || st.station}”. This laptop stopped printing.`)
    return false
  }
  function lose(text) {
    stats.notice = text
    changed()
    setStation(eventId, false)   // the runner stops this station
  }

  let ready = false   // the event's printing laptop is settled (takeStation below)
  async function round() {
    if (stopped || !ready) return
    if (!(await stillMine().catch(() => true)) || stopped) return
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
  stats.notice = null
  changed()
  // switched on (or still on after a reload): hold the event, unless another laptop prints
  takeStation(eventId).then(r => {
    if (stopped) return
    if (r.ok) { ready = true; round(); return }
    if (r.error) { stats.error = 'Could not reach the server: ' + r.error; changed(); ready = true; round(); return }
    lose(`Printing is on at “${r.label || r.station}”. This laptop does not print.`)
  }, () => { if (!stopped) { ready = true; round() } })

  return function stop() {
    stopped = true
    stats.running = false
    changed()
    supabase.rpc('ps_release', { p_event_id: eventId, p_station: hub }).then(() => {}, () => {})
    if (worker) worker.terminate()
    if (timer) clearInterval(timer)
    if (channel) supabase.removeChannel(channel)
  }
}
