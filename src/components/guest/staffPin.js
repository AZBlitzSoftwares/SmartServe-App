import { supabase } from '../../lib/supabase'
import { serviceDates } from './deviceEntry'

/* The supervisor or admin PIN asked before a tablet's server or set-up is
   changed (Device tools, the "Laptop server is on" offer). */

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}

/* Staff are standing at the tablet waiting, so the PIN check answers fast:
   no automatic retries (the client retries a failed read three times, about
   7 seconds) and at most 6 seconds per request. */
const QUICK_MS = 6000
function quick(query) {
  let signal
  try { signal = AbortSignal.timeout(QUICK_MS) } catch {
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), QUICK_MS)
    signal = ctl.signal
  }
  return query.retry(false).abortSignal(signal)
}

/* The events a supervisor PIN has to belong to: the one this tablet is set
   up for, or else any event running today. Admin PINs work everywhere -
   the same rule as the exit gate. */
async function eventIdsForThisTablet() {
  const saved = readJson('ss_captain_event') || readJson('ss_setup_event')
  if (saved?.id) return [saved.id]
  const { data, error } = await quick(supabase.from('events').select('id').in('date', serviceDates()))
  if (error) throw error
  return (data || []).map(e => e.id)
}

/** 'ok' | 'wrong' | 'offline' */
export async function checkStaffPin(pin) {
  try {
    const { data: admins, error: e1 } = await quick(supabase.from('admins')
      .select('id').eq('pin', pin).eq('is_active', true))
    if (e1) return 'offline'
    if (admins?.length > 0) return 'ok'
    const { data: sups, error: e2 } = await quick(supabase.from('supervisors')
      .select('id, event_id').eq('pin', pin).eq('is_active', true))
    if (e2) return 'offline'
    if (!sups?.length) return 'wrong'
    const ids = await eventIdsForThisTablet()
    return sups.some(s => ids.includes(s.event_id)) ? 'ok' : 'wrong'
  } catch {
    return 'offline'
  }
}
