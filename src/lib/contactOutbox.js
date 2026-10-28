import { supabase } from './supabase'
import { newOrderId } from './placeOrder'

/* Contact us: the name, WhatsApp number and/or email guests leave on the tablet.

   A number is never lost. It is kept on the tablet (localStorage, so it moves
   with the tablet between the cloud and the event laptop) until the server
   has it, and sent again every 30 s - also when the database update for this
   (db/2026-10-29_contact_requests.sql) has not been run yet. Each number has
   its own id made on the tablet, so sending it again never saves it twice. */

const KEY = 'ss_contact_outbox'
// kept for a month: long enough for any "the update was not run yet" gap
const MAX_AGE_MS = 30 * 24 * 3600e3

function readBox() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function writeBox(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* private mode / full: kept in memory only */ }
}

function timeoutSignal(ms) {
  try { if (AbortSignal.timeout) return AbortSignal.timeout(ms) } catch { /* older browser */ }
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal
}

// true = the server has it · false = try again later · 'skip' = this row is
// refused for itself (keep it, but do not let it hold up the others)
const LATER = /^(PGRST20[05]|42P01|SS503|PGRST00\d|57014|53300|53400|40001|40P01|08\d{3}|5\d\d)$/
async function sendOne(row) {
  const { error } = await supabase.from('contact_requests').insert(row).abortSignal(timeoutSignal(10000))
  // 23505: this id is already saved (an earlier send got through)
  if (!error || error.code === '23505') return true
  // no answer (an aborted fetch comes back as code 20), busy, or the table is not there yet
  if (!error.code || LATER.test(String(error.code)) || /abort|fetch|network|timeout|load failed/i.test(error.message || '')) return false
  return 'skip'
}

export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null
}

// Indian mobile numbers: 10 digits starting 6-9, with or without +91 / 0 in
// front, kept as the 10 digits. Another country: typed with its + code
// (e.g. +971 50 123 4567), kept as "+971501234567".
export function cleanPhone(v) {
  const raw = String(v || '').trim()
  let d = raw.replace(/\D/g, '')
  if (raw.startsWith('+') && !raw.startsWith('+91')) return /^\d{7,15}$/.test(d) ? '+' + d : null
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d) ? d : null
}

// how a saved number is shown / exported
export const showPhone = p => !p ? '' : String(p).startsWith('+') ? String(p) : '+91 ' + p

/* Saves the number (or keeps it on the tablet to send later).
   Resolves true when the server has it now, false when it is waiting on the tablet. */
export async function saveContact({ eventId, tableId, tableNumber, phone, email, name }) {
  const row = {
    id: newOrderId(), event_id: eventId || null, table_id: tableId || null,
    table_number: tableNumber ?? null, phone: phone || null, email: email || null, name: (name || '').trim() || null,
    created_at: new Date().toISOString(),
  }
  writeBox([...readBox(), row])
  let ok
  try { ok = await sendOne(row) } catch { ok = false }
  if (ok === true) writeBox(readBox().filter(r => r.id !== row.id))
  return ok === true
}

let flushing = false
export async function flushContactOutbox() {
  if (flushing) return
  flushing = true
  try {
    const now = Date.now()
    for (const row of readBox()) {
      if (now - new Date(row.created_at).getTime() > MAX_AGE_MS) { writeBox(readBox().filter(r => r.id !== row.id)); continue }
      let ok
      try { ok = await sendOne(row) } catch { ok = false }
      if (ok === 'skip') continue   // refused for itself: the others still go
      if (!ok) break                // server not answering: try again on the next round
      writeBox(readBox().filter(r => r.id !== row.id))
    }
  } finally { flushing = false }
}
