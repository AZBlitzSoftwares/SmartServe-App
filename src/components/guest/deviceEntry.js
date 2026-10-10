import { supabase } from '../../lib/supabase'

/* How a tablet decides what it is.

   On a fresh start - no saved guest table and no saved captain session -
   the tablet looks at TODAY's events and nothing else:

     captain-type events only  ->  Captain Sign In          ('captain')
     self-service events only  ->  guest table set-up       ('setup')
     both kinds                ->  the chooser, every time  ('entry')
     none                      ->  "No event today"         ('noevent')

   A choice made on the chooser is remembered (ss_device_mode) only so the
   chooser can highlight it. It never skips the chooser: remembering
   "guest" and skipping straight to guest set-up is exactly what opened
   Captain Service events in guest mode.                                   */
export function entryFor(captainEvents, selfEvents) {
  const cap = captainEvents.length > 0
  const self = selfEvents.length > 0
  if (cap && self) return 'entry'
  if (cap) return 'captain'
  if (self) return 'setup'
  return 'noevent'
}

export const isCaptainEvent = (e) => e?.service_mode === 'captain'

// The four keys of a guest tablet's saved table, and the two of a captain's
// saved sign-in. Switching mode clears only the OTHER mode's keys.
export const GUEST_KEYS = ['ss_setup_complete', 'ss_setup_event', 'ss_setup_table', 'ss_setup_table_number']
export const CAPTAIN_KEYS = ['ss_captain_session', 'ss_captain_event']
export const MODE_KEY = 'ss_device_mode'

function removeKeys(keys) {
  keys.forEach(k => { try { localStorage.removeItem(k) } catch { /* blocked */ } })
}
export const clearGuestKeys = () => removeKeys(GUEST_KEYS)
export const clearCaptainKeys = () => removeKeys(CAPTAIN_KEYS)

export function rememberMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode) } catch { /* blocked */ }
}
export function rememberedMode() {
  try { return localStorage.getItem(MODE_KEY) } catch { return null }
}

/** Every ss_* and ms_* (Maestro) key this app keeps on this device - "Reset this tablet". */
export function clearAllDeviceKeys() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith('ss_') || k.startsWith('ms_'))) keys.push(k)
    }
    removeKeys(keys)
  } catch { /* blocked */ }
}

/** Local calendar date, YYYY-MM-DD - the same form events.date uses. */
export function todayISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0')
}

/* A SAVED session is still current when its event is today. Until 5 am an
   event dated yesterday also counts: receptions run past midnight, and a
   tablet that restarts at 00:30 must carry on with the event that is still
   being served rather than throw its captain or table away. This applies
   only to resuming a saved session; new set-ups and sign-ins use today. */
export const LATE_NIGHT_UNTIL_HOUR = 5
export function sessionStillCurrent(dateStr, now = new Date()) {
  if (!dateStr) return false
  if (dateStr === todayISO(now)) return true
  if (now.getHours() < LATE_NIGHT_UNTIL_HOUR) {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    return dateStr === todayISO(y)
  }
  return false
}

/** Today's events split by kind. ok:false when the server could not be read. */
export async function loadTodaysEvents() {
  try {
    const { data, error } = await supabase.from('events').select('*').eq('date', todayISO())
    if (error) return { ok: false, captainEvents: [], selfEvents: [] }
    const list = data || []
    return {
      ok: true,
      captainEvents: list.filter(isCaptainEvent),
      selfEvents: list.filter(e => !isCaptainEvent(e)),
    }
  } catch {
    return { ok: false, captainEvents: [], selfEvents: [] }
  }
}

/** "Tuesday, 7 October 2026" */
export function prettyToday(d = new Date()) {
  try {
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return todayISO(d)
  }
}
