import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { unlockChime, playChatChime } from '../lib/chime'
import janusLogo from '../assets/janus_logo.jpg'
import { setSignOutReason, takeSignOutReason } from '../lib/appUpdate'

/* Kitchen waiter phone - /waiter. Multi-kitchen events only.

   Each kitchen (Indian, Arabic, Italian...) has its own waiters. A waiter
   opens this on their own Android phone, sees the open KOTs of THEIR
   kitchen, carries the plate with the printed slip to the table and chair,
   and taps Delivered. That is the only thing a waiter can do here.

   Built for a busy hall on venue Wi-Fi:
   - Realtime on kots for speed, plus a 5 s poll because realtime drops
     quietly on bad Wi-Fi. Whichever arrives first wins; the newer
     updated_at always wins over an older copy of the same KOT.
   - Delivered is optimistic. The card leaves at once and an Undo sits at
     the bottom for 6 s. If the server says no, the card comes back with a
     red "Not saved" strip so a waiter who has walked away still sees it.
   - Nothing here runs outside this route: no module level listeners, no
     changes to shared files, so guest and captain flows are untouched.
   - Works over plain http from the local laptop server: every secure
     context API (wake lock, user activation) is feature checked.        */

const SESSION_KEY = 'ss_waiter_session'
const DISMISSED_KEY = 'ss_waiter_dismissed'
const LAST_NAME_KEY = 'ss_waiter_last_name'

const POLL_MS = 5000
const TICK_MS = 30000
const FETCH_TIMEOUT_MS = 8000
const RPC_TIMEOUT_MS = 12000
const CANCEL_SHOW_MS = 15 * 60 * 1000
const UNDO_SNACK_MS = 6000
const UNDO_LIMIT_MS = 110 * 1000        // the server allows 2 minutes; keep a margin
const PRINT_GRACE_MS = 30 * 1000
const DOUBLE_TAP_GUARD_MS = 700         // the next card slides under the thumb
const LATE_NIGHT_HOUR = 4               // a 13 Oct event still counts at 1 am on the 14th
const DELIVERED_SHOWN = 15
const AMBER_MIN = 10
const RED_MIN = 15

const KOT_COLS = 'id,event_id,order_id,kitchen_id,kind,kot_no,table_number,chairs,captain_name,' +
  'kitchen_name,items,status,delivered_at,delivered_by,delivered_by_name,cancelled_at,' +
  'print_status,printed_at,last_error,created_at,updated_at'

const C = {
  dark: '#1A0A0A', marigold: '#E8890C', green: '#16A34A', greenDark: '#15803D',
  red: '#DC2626', amber: '#F59E0B',
}

/* ── small helpers ─────────────────────────────────────────────────── */

function dayStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0')
}

// Today in local time - and, before 4 am, yesterday too, so a reception
// that runs past midnight does not lock its waiters out on a reload.
function serviceDays() {
  const now = new Date()
  const days = [dayStr(now)]
  if (now.getHours() < LATE_NIGHT_HOUR) {
    const y = new Date(now.getTime())
    y.setDate(y.getDate() - 1)
    days.push(dayStr(y))
  }
  return days
}

function readJSON(key, fallback) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback } catch (e) { return fallback }
}
function writeJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch (e) { /* private mode or storage full - the screen still works */ }
}
function readStr(key) {
  try { return localStorage.getItem(key) || '' } catch (e) { return '' }
}
function writeStr(key, v) {
  try { localStorage.setItem(key, v) } catch (e) { /* ignore */ }
}

// REST gives "2026-10-13T19:02:11.123456+00:00"; realtime has been seen to
// give "2026-10-13 19:02:11.123456+00". Both become epoch ms here.
function ms(ts) {
  if (ts == null || ts === '') return null
  if (typeof ts === 'number') return ts
  let s = String(ts).trim()
  if (s.length > 10 && s.charAt(10) === ' ') s = s.slice(0, 10) + 'T' + s.slice(11)
  s = s.replace(/(\.\d{3})\d+/, '$1')
  if (s.indexOf('T') > 0) s = s.replace(/([+-]\d{2})$/, '$1:00')
  const t = Date.parse(s)
  return isNaN(t) ? null : t
}

function fmtTime(ts) {
  const t = ms(ts)
  if (t == null) return ''
  try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } catch (e) { return '' }
}

function toChairList(chairs) {
  let arr = chairs
  if (typeof arr === 'string') {               // "{2,3}" if a payload ever arrives raw
    arr = arr.replace(/[{}[\]\s]/g, '').split(',').filter(Boolean)
  }
  if (!Array.isArray(arr)) return []
  const nums = arr.map(Number).filter(n => Number.isFinite(n))
  return Array.from(new Set(nums)).sort((a, b) => a - b)
}

// [2,3] -> "2, 3"   [1,2,3,4,5,8] -> "1–5, 8"
function chairsText(chairs) {
  const list = toChairList(chairs)
  if (list.length < 4) return list.join(', ')
  const out = []
  let i = 0
  while (i < list.length) {
    let j = i
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++
    if (j - i >= 2) out.push(list[i] + '–' + list[j])
    else for (let k = i; k <= j; k++) out.push(String(list[k]))
    i = j + 1
  }
  return out.join(', ')
}

function chairsLabel(chairs) {
  const t = chairsText(chairs)
  if (!t) return ''
  return (toChairList(chairs).length === 1 ? 'Chair ' : 'Chairs ') + t
}

function itemsOf(k) {
  let it = k && k.items
  if (typeof it === 'string') { try { it = JSON.parse(it) } catch (e) { it = [] } }
  return Array.isArray(it) ? it.filter(Boolean) : []
}

function tableOf(k) {
  return k && k.table_number != null ? k.table_number : '?'
}

function kotLabel(k) {
  return 'Table ' + tableOf(k) + (k.kot_no ? ' · KOT ' + k.kot_no : '')
}

function asRow(data) {
  let d = data
  if (typeof d === 'string') { try { d = JSON.parse(d) } catch (e) { return null } }
  if (Array.isArray(d)) d = d[0]
  return d && typeof d === 'object' && d.id ? d : null
}

// a is strictly newer than b
function isNewer(a, b) {
  const x = ms(a && a.updated_at), y = ms(b && b.updated_at)
  return x != null && y != null && x > y
}

function mergeRow(cur, inc) {
  if (!cur) return inc
  if (isNewer(cur, inc)) return cur
  const out = { ...cur }
  for (const key of Object.keys(inc)) if (inc[key] !== undefined) out[key] = inc[key]
  return out
}

function isNetworkError(err) {
  if (!err) return false
  const m = String(err.message || err).toLowerCase()
  return !err.code || err.code === 'TIMEOUT' || /fetch|network|abort|timeout|load failed/.test(m)
}

/* Every request gets a deadline. On venue Wi-Fi a request can hang for a
   minute; without this the poll would stall behind it and the screen would
   look healthy while showing a stale list. */
function timed(builder, limit) {
  return new Promise(resolve => {
    let done = false
    let ctrl = null
    let b = builder
    try {
      if (typeof AbortController === 'function' && b && typeof b.abortSignal === 'function') {
        ctrl = new AbortController()
        b = b.abortSignal(ctrl.signal)
      }
    } catch (e) { ctrl = null }
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r) } }
    const timer = setTimeout(() => {
      try { if (ctrl) ctrl.abort() } catch (e) { /* ignore */ }
      finish({ data: null, error: { message: 'timeout', code: 'TIMEOUT' } })
    }, limit)
    try {
      Promise.resolve(b).then(
        r => finish(r || { data: null, error: { message: 'empty response' } }),
        e => finish({ data: null, error: e || { message: 'failed' } }))
    } catch (e) {
      finish({ data: null, error: e })
    }
  })
}

function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern) } catch (e) { /* ignore */ }
}

// Set by a listener the root component installs (never at module load,
// because this module is imported on every route).
let gestureSeen = false
function hasGesture() {
  try {
    if (navigator.userActivation && typeof navigator.userActivation.hasBeenActive === 'boolean') {
      return navigator.userActivation.hasBeenActive || gestureSeen
    }
  } catch (e) { /* ignore */ }
  return gestureSeen
}

function restoreSession() {
  const s = readJSON(SESSION_KEY, null)
  const ok = s && s.waiter && s.waiter.id && s.waiter.kitchen_id && s.event && s.event.id &&
    serviceDays().includes(String(s.event.date))
  if (!ok) { if (s) writeJSON(SESSION_KEY, null); return null }
  return s
}

const tap = { WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', fontFamily: 'Manrope, sans-serif' }

const CSS = `
@keyframes ssWFresh {
  0%   { box-shadow: 0 0 0 0 rgba(232,137,12,0.95); background:#FFF1DA; }
  25%  { box-shadow: 0 0 0 7px rgba(232,137,12,0.55); background:#FFF1DA; }
  100% { box-shadow: 0 2px 10px rgba(42,27,46,0.08); background:#FFFFFF; }
}
.ss-w-fresh { animation: ssWFresh 4.5s ease-out 1; }
@keyframes ssWIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
.ss-w-in { animation: ssWIn .18s ease-out; }
@keyframes ssWShrink { from { transform:scaleX(1); } to { transform:scaleX(0); } }
@keyframes ssWSpin { to { transform: rotate(360deg); } }
.ss-w-btn:active { transform: scale(0.985); filter: brightness(0.93); }
@media (prefers-reduced-motion: reduce) { .ss-w-fresh, .ss-w-in { animation: none; } }
`

/* ── root ──────────────────────────────────────────────────────────── */

export default function WaiterApp() {
  const [session, setSession] = useState(() => restoreSession())

  // Arm the chime on the first tap (signing in is a tap), and note that a
  // gesture happened for browsers without navigator.userActivation.
  useEffect(() => {
    const stop = unlockChime()
    const seen = () => { gestureSeen = true }
    document.addEventListener('pointerdown', seen, true)
    return () => {
      try { stop() } catch (e) { /* ignore */ }
      document.removeEventListener('pointerdown', seen, true)
    }
  }, [])

  if (!session) {
    return <SignIn onSignedIn={s => { writeJSON(SESSION_KEY, s); setSession(s) }} />
  }
  return (
    <Board key={session.waiter.id + ':' + session.waiter.kitchen_id} session={session}
      onSignOut={() => { writeJSON(SESSION_KEY, null); setSession(null) }} />
  )
}

/* ── sign in ───────────────────────────────────────────────────────── */

const shell = {
  position: 'fixed', inset: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
  background: 'linear-gradient(160deg, #1A0A0A, #2D1010)',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  padding: '28px 16px', fontFamily: 'Manrope, sans-serif'
}
const glass = {
  background: 'rgba(255,255,255,0.06)', borderRadius: 24,
  padding: '26px 20px', width: '100%', maxWidth: 420,
  border: '1px solid rgba(255,255,255,0.1)'
}

function Brand() {
  return (
    <>
      <img src={janusLogo} alt="Janu's Smart Serve"
        style={{ width: 76, height: 76, borderRadius: 18, objectFit: 'contain', marginBottom: 12,
          border: '2px solid rgba(232,137,12,0.4)', background: 'rgba(232,137,12,0.1)' }} />
      <div style={{ color: '#fff', fontSize: 21, fontWeight: 900, marginBottom: 22 }}>
        Janu's <span style={{ color: C.marigold }}>Smart Serve</span>
      </div>
    </>
  )
}

function SignIn({ onSignedIn }) {
  const [notice] = useState(() => takeSignOutReason())   // why the last sign-in ended, if the desk ended it
  const [phase, setPhase] = useState('loading')   // loading | error | none | choose | form
  const [events, setEvents] = useState([])
  const [event, setEvent] = useState(null)
  const [name, setName] = useState(() => readStr(LAST_NAME_KEY))
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pinRef = useRef(null)

  async function loadEvents() {
    setPhase('loading'); setError('')
    const { data, error: err } = await timed(
      supabase.from('events').select('*').eq('multi_kitchen', true).in('date', serviceDays()),
      FETCH_TIMEOUT_MS)
    if (err) {
      setError(isNetworkError(err) ? '' : (err.message || 'server error'))
      setPhase('error')
      return
    }
    const list = (data || []).slice().sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(a.name || '').localeCompare(String(b.name || '')))
    setEvents(list)
    if (!list.length) setPhase('none')
    else if (list.length === 1) { setEvent(list[0]); setPhase('form') }
    else setPhase('choose')
  }

  useEffect(() => { loadEvents() }, [])

  async function signIn() {
    if (busy) return
    const n = name.trim(), p = pin.trim()
    if (!n) { setError('Enter your name or waiter number.'); return }
    if (!p) { setError('Enter your PIN.'); return }
    setBusy(true); setError('')
    const { data, error: err } = await timed(
      supabase.rpc('mk_waiter_login', { p_event_id: event.id, p_name: n, p_pin: p }), RPC_TIMEOUT_MS)
    setBusy(false)
    if (err) {
      setError(isNetworkError(err)
        ? 'No connection. Check the Wi-Fi and try again.'
        : 'Sign-in did not work. Please tell the supervisor. (' + (err.message || 'server error') + ')')
      return
    }
    const w = asRow(data)
    if (!w) {
      setPin('')
      setError('Name or number and PIN do not match. Check with the supervisor.')
      try { pinRef.current && pinRef.current.focus() } catch (e) { /* ignore */ }
      return
    }
    if (!w.kitchen_id) {
      setError('You are not linked to a kitchen yet. Ask the supervisor to set your kitchen, then sign in again.')
      return
    }
    writeStr(LAST_NAME_KEY, n)
    onSignedIn({
      waiter: { id: w.id, name: w.name, waiter_number: w.waiter_number,
        kitchen_id: w.kitchen_id, kitchen_name: w.kitchen_name, pin: p },
      event: { id: event.id, name: event.name, date: event.date,
        catering_company: event.catering_company || null, venue: event.venue || null },
    })
  }

  const input = {
    ...tap, width: '100%', background: 'rgba(255,255,255,0.08)',
    border: '1.5px solid rgba(255,255,255,0.18)', borderRadius: 14,
    padding: '0 14px', height: 58, fontSize: 19, color: '#fff', textAlign: 'center',
    fontWeight: 800, outline: 'none', boxSizing: 'border-box', marginBottom: 12
  }
  const bigBtn = {
    ...tap, width: '100%', minHeight: 56, background: C.marigold, color: '#fff', border: 'none',
    borderRadius: 14, fontSize: 18, fontWeight: 900, cursor: 'pointer'
  }
  const ghostBtn = {
    ...tap, width: '100%', minHeight: 48, background: 'transparent',
    border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12,
    color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 10
  }

  return (
    <div style={shell}>
      <style>{CSS}</style>
      <Brand />
      <div style={glass}>
        {phase === 'loading' && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', padding: 24, fontSize: 16 }}>
            <Spinner /> Finding today's event…
          </div>
        )}

        {notice && !error && (
          <div style={{ color: '#FBD38D', background: 'rgba(232,137,12,0.15)', border: '1px solid rgba(232,137,12,0.4)',
            borderRadius: 12, padding: '10px 12px', fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>
            {notice}
          </div>
        )}
        {phase === 'error' && (
          <div style={{ textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 38, marginBottom: 10 }}>📶</div>
            <div style={{ color: '#FC8181', fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
              {error ? 'The server could not load the event' : 'Could not reach the server'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, marginBottom: 18,
              wordBreak: 'break-word' }}>
              {error
                ? 'Please tell the supervisor. (' + error + ')'
                : 'Check the phone is on the venue Wi-Fi, then try again.'}
            </div>
            <button className="ss-w-btn" onClick={loadEvents} style={bigBtn}>Retry</button>
          </div>
        )}

        {phase === 'none' && (
          <div style={{ textAlign: 'center', padding: '8px 4px' }}>
            <div style={{ fontSize: 38, marginBottom: 10 }}>📅</div>
            <div style={{ color: '#fff', fontWeight: 900, fontSize: 19, marginBottom: 8 }}>
              No multi-kitchen event today
            </div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
              Ask the supervisor to check the event date and that Multi-kitchen is switched on for it.
            </div>
            <button className="ss-w-btn" onClick={loadEvents} style={bigBtn}>Retry</button>
          </div>
        )}

        {phase === 'choose' && (
          <>
            <div style={{ color: '#fff', fontSize: 19, fontWeight: 900, marginBottom: 6, textAlign: 'center' }}>
              Which event are you at?
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginBottom: 18 }}>
              More than one multi-kitchen event is running today
            </div>
            {events.map(ev => (
              <button key={ev.id} className="ss-w-btn"
                onClick={() => { setEvent(ev); setError(''); setPhase('form') }}
                style={{ ...tap, width: '100%', minHeight: 64, background: 'rgba(255,255,255,0.06)',
                  border: '1.5px solid rgba(255,255,255,0.16)', borderRadius: 14,
                  padding: '14px 16px', marginBottom: 10, textAlign: 'left', cursor: 'pointer' }}>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: 17 }}>{ev.name}</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 3 }}>
                  {[ev.catering_company, ev.venue].filter(Boolean).join(' · ') || ev.date}
                </div>
              </button>
            ))}
          </>
        )}

        {phase === 'form' && event && (
          <>
            <div style={{ color: '#fff', fontSize: 20, fontWeight: 900, marginBottom: 4, textAlign: 'center' }}>
              🍽️ Waiter Sign In
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginBottom: 18 }}>
              Your kitchen is found from your name
            </div>

            <div style={{ background: 'rgba(232,137,12,0.15)', border: '1px solid rgba(232,137,12,0.3)',
              borderRadius: 12, padding: '10px 14px', marginBottom: 18, textAlign: 'center' }}>
              <div style={{ color: C.marigold, fontWeight: 800, fontSize: 12, letterSpacing: 0.5 }}>
                TODAY'S EVENT
              </div>
              <div style={{ color: '#fff', fontWeight: 900, fontSize: 17, marginTop: 2 }}>{event.name}</div>
              {event.catering_company && (
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 }}>
                  {event.catering_company}
                </div>
              )}
            </div>

            <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13,
              fontWeight: 700, marginBottom: 6 }}>Name or waiter number</label>
            <input value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { try { pinRef.current.focus() } catch (x) { /* ignore */ } } }}
              placeholder="e.g. Ravi or 7" autoCapitalize="none" autoCorrect="off" autoComplete="off"
              spellCheck={false} enterKeyHint="next" style={input} />

            <label style={{ display: 'block', color: 'rgba(255,255,255,0.6)', fontSize: 13,
              fontWeight: 700, marginBottom: 6 }}>PIN</label>
            <input ref={pinRef} value={pin} type="password" inputMode="numeric" pattern="[0-9]*"
              autoComplete="off" maxLength={6} enterKeyHint="go"
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => { if (e.key === 'Enter') signIn() }}
              placeholder="4 digits"
              style={{ ...input, letterSpacing: pin ? 14 : 0, fontSize: pin ? 26 : 19 }} />

            {error && (
              <div role="alert" style={{ color: '#FCA5A5', background: 'rgba(220,38,38,0.15)',
                border: '1px solid rgba(220,38,38,0.4)', borderRadius: 12, padding: '10px 12px',
                fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 12, lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            <button className="ss-w-btn" onClick={signIn} disabled={busy}
              style={{ ...bigBtn, background: busy ? '#6B5A4A' : C.marigold, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Signing in…' : 'Sign In →'}
            </button>

            {events.length > 1 && (
              <button onClick={() => { setPhase('choose'); setError('') }} style={ghostBtn}>
                ← Change event
              </button>
            )}
          </>
        )}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: 11, marginTop: 22 }}>
        Powered by Janu's Smart Serve
      </div>
    </div>
  )
}

function Spinner({ color = 'currentColor', size = 16 }) {
  return (
    <span style={{ display: 'inline-block', width: size, height: size, verticalAlign: '-3px',
      border: '2.5px solid ' + color, borderRightColor: 'transparent', borderRadius: '50%',
      animation: 'ssWSpin 0.8s linear infinite', marginRight: 8, opacity: 0.8 }} />
  )
}

/* ── the board ─────────────────────────────────────────────────────── */

function Board({ session, onSignOut }) {
  const { waiter, event } = session
  const kid = waiter.kitchen_id

  /* A sign-in the supervisor has ended - waiter removed, new PIN, moved to
     another kitchen - must not carry on from the phone's memory. */
  useEffect(() => {
    let stop = false
    async function check() {
      try {
        const { data, error } = await supabase.from('waiters').select('id, is_active, pin, kitchen_id').eq('id', waiter.id).maybeSingle()
        if (stop || error) return
        const reason = !data || data.is_active === false ? 'You were signed out: you were removed at the desk.'
          : waiter.pin && data.pin != null && String(data.pin) !== String(waiter.pin) ? 'Your PIN was changed at the desk. Sign in with the new PIN.'
          : data.kitchen_id !== waiter.kitchen_id ? 'You were moved to another kitchen. Sign in again to see its orders.'
          : null
        if (reason) { setSignOutReason(reason); onSignOut() }
      } catch (e) { /* offline: carry on */ }
    }
    check()
    const t = setInterval(check, 60000)
    const vis = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', vis)
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [waiter.id])
  const kitchenName = waiter.kitchen_name || 'Kitchen'

  // The live picture is kept in refs so async callbacks never act on a
  // stale copy; `snap` is what the screen renders.
  const rowsRef = useRef(new Map())          // id -> kot row (open, recent cancelled, recent delivered)
  const localAtRef = useRef(new Map())       // id -> when realtime / an RPC last told us about it
  const sendingRef = useRef(new Set())       // Delivered tapped, server not answered yet
  const seenRef = useRef(new Set())          // open KOTs already announced
  const seenCancelRef = useRef(new Set())
  const freshRef = useRef(new Set())         // arrived after first load -> highlight
  const primedRef = useRef(false)
  const minObsRef = useRef(null)             // phone clock minus server clock, best estimate
  const lastOkRef = useRef(0)
  const lastAlertRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const lastTapRef = useRef(0)
  const jobsRef = useRef(new Map())          // id -> Promise<boolean> of the deliver call
  const undoingRef = useRef(new Set())
  const soonRef = useRef(null)
  const snackSeq = useRef(0)
  const dismissedRef = useRef(null)

  const [snap, setSnap] = useState(() => ({ rows: new Map(), sending: new Set() }))
  const [failed, setFailed] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [failCount, setFailCount] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const [lastOkAt, setLastOkAt] = useState(0)
  const [, setTick] = useState(0)
  const [snack, setSnack] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set(readJSON(DISMISSED_KEY, [])))
  const [confirmOut, setConfirmOut] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [needsTap, setNeedsTap] = useState(() => !hasGesture())
  const [wakeSupported] = useState(() => {
    try { return !!(navigator.wakeLock && typeof navigator.wakeLock.request === 'function') } catch (e) { return false }
  })
  if (dismissedRef.current === null) dismissedRef.current = dismissed

  // Phone clocks drift and some are set by hand. Each realtime INSERT gives
  // "phone time minus created_at" = clock skew + delivery delay. A NEGATIVE
  // value can only mean the phone is behind the server, so that is
  // corrected (otherwise every wait would read too short). A positive value
  // could just be a slow delivery, so it is ignored: a phone that runs fast
  // shows waits a little long, which errs on the side of hurrying.
  function skewMs() {
    const m = minObsRef.current
    return (m != null && m < -10000 && m > -12 * 3600 * 1000) ? m : 0
  }
  function serverNow() { return Date.now() - skewMs() }

  function commit() {
    setSnap({ rows: rowsRef.current, sending: new Set(sendingRef.current) })
  }

  function showSnack(s, onlyIfKotId) {
    snackSeq.current += 1
    const next = { ...s, seq: snackSeq.current }
    if (onlyIfKotId) setSnack(cur => (!cur || cur.kotId === onlyIfKotId) ? next : cur)
    else setSnack(next)
  }

  // Announce what is new: buzz + chime for a new KOT, a long buzz for a
  // cancellation. Nothing is announced for what was already there when the
  // screen first loaded.
  function noticeNew() {
    const primed = primedRef.current
    const cutoff = serverNow() - CANCEL_SHOW_MS
    let newOpen = false, newCancel = false
    for (const r of rowsRef.current.values()) {
      if (r.status === 'open') {
        if (seenRef.current.has(r.id)) continue
        seenRef.current.add(r.id)
        if (primed) { freshRef.current.add(r.id); newOpen = true }
      } else if (r.status === 'cancelled') {
        if (seenCancelRef.current.has(r.id)) continue
        seenCancelRef.current.add(r.id)
        if (primed && !dismissedRef.current.has(r.id) && (ms(r.cancelled_at) || 0) >= cutoff) newCancel = true
      }
    }
    if ((newOpen || newCancel) && Date.now() - lastAlertRef.current > 1500) {
      lastAlertRef.current = Date.now()
      buzz(newOpen ? [200, 100, 200] : [500, 150, 500])
      if (newOpen) { try { playChatChime() } catch (e) { /* ignore */ } }
    }
  }

  function applyPoll(list, startedAt) {
    const cur = rowsRef.current
    const la = localAtRef.current
    const next = new Map()
    for (const r of list) {
      if (!r || !r.id) continue
      const c = cur.get(r.id)
      next.set(r.id, c && isNewer(c, r) ? c : r)
    }
    // Something realtime or an RPC told us about after this poll left
    // (a brand new KOT, say) is kept rather than wiped by older news.
    for (const [id, c] of cur) {
      if (!next.has(id) && (la.get(id) || 0) > startedAt) next.set(id, c)
    }
    const now = Date.now()
    for (const [id, t] of la) if (now - t > 60000) la.delete(id)
    rowsRef.current = next
    noticeNew()
    primedRef.current = true
    commit()
  }

  function applyLocal(row) {
    if (!row || !row.id) return
    if (row.kitchen_id && row.kitchen_id !== kid) return
    if (row.kind && row.kind !== 'order') return
    const cur = rowsRef.current.get(row.id)
    const merged = mergeRow(cur, row)
    if (merged === cur) return
    const next = new Map(rowsRef.current)
    next.set(row.id, merged)
    rowsRef.current = next
    localAtRef.current.set(row.id, Date.now())
    noticeNew()
    commit()
  }

  function dropRow(id) {
    if (!rowsRef.current.has(id)) return
    const next = new Map(rowsRef.current)
    next.delete(id)
    rowsRef.current = next
    commit()
  }

  async function refresh() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const startedAt = Date.now()
    try {
      const since = new Date(serverNow() - CANCEL_SHOW_MS).toISOString()
      const q = () => supabase.from('kots').select(KOT_COLS).eq('kitchen_id', kid).eq('kind', 'order')
      const [a, b, c] = await Promise.all([
        timed(q().eq('status', 'open').order('created_at', { ascending: true }).limit(300), FETCH_TIMEOUT_MS),
        timed(q().eq('status', 'cancelled').gte('cancelled_at', since)
          .order('cancelled_at', { ascending: false }).limit(50), FETCH_TIMEOUT_MS),
        timed(q().eq('status', 'delivered').order('delivered_at', { ascending: false })
          .limit(DELIVERED_SHOWN), FETCH_TIMEOUT_MS),
      ])
      if (!mountedRef.current) return
      if (a.error || b.error || c.error) { setFailCount(n => n + 1); return }
      applyPoll([...(a.data || []), ...(b.data || []), ...(c.data || [])], startedAt)
      lastOkRef.current = Date.now()
      setLastOkAt(lastOkRef.current)
      setFailCount(0)
      setLoaded(true)
    } catch (e) {
      if (mountedRef.current) setFailCount(n => n + 1)
    } finally {
      inFlightRef.current = false
    }
  }

  function refreshSoon() {
    clearTimeout(soonRef.current)
    soonRef.current = setTimeout(() => { refresh() }, 400)
  }

  function onRealtime(payload) {
    const row = payload && payload.new
    if (!row || !row.id || row.kitchen_id !== kid) return
    if (row.kind && row.kind !== 'order') return
    if (payload.eventType === 'INSERT') {
      const c = ms(row.created_at)
      if (c != null) {
        const obs = Date.now() - c
        minObsRef.current = minObsRef.current == null ? obs : Math.min(minObsRef.current, obs)
      }
    }
    applyLocal(row)
    refreshSoon()
  }

  // The handlers below only touch refs and state setters, so the first
  // render's copies are as good as any; the ref just keeps lint quiet.
  const fnRef = useRef(null)
  fnRef.current = { refresh, onRealtime }

  /* polling + clock */
  useEffect(() => {
    mountedRef.current = true
    fnRef.current.refresh()
    const poll = setInterval(() => fnRef.current.refresh(), POLL_MS)
    const tick = setInterval(() => setTick(t => t + 1), TICK_MS)
    return () => {
      mountedRef.current = false
      clearInterval(poll); clearInterval(tick)
      clearTimeout(soonRef.current)
    }
  }, [kid])

  /* realtime */
  useEffect(() => {
    let ch = null
    try {
      const handler = p => { try { fnRef.current.onRealtime(p) } catch (e) { /* the poll covers it */ } }
      ch = supabase.channel('waiter-kots-' + kid + '-' + Math.random().toString(36).slice(2, 9))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kots', filter: 'kitchen_id=eq.' + kid }, handler)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'kots', filter: 'kitchen_id=eq.' + kid }, handler)
        .subscribe()
    } catch (e) { ch = null }
    return () => { try { if (ch) supabase.removeChannel(ch) } catch (e) { /* ignore */ } }
  }, [kid])

  /* connection + coming back to the screen */
  useEffect(() => {
    const on = () => { setOnline(true); fnRef.current.refresh() }
    const off = () => setOnline(false)
    const vis = () => { if (document.visibilityState === 'visible') fnRef.current.refresh() }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  /* keep the screen on - only where the browser offers it (https) */
  useEffect(() => {
    if (!wakeSupported) return
    let lock = null, stopped = false
    const get = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      if (lock && !lock.released) return
      try { lock = await navigator.wakeLock.request('screen') } catch (e) { lock = null }
      if (stopped && lock) { try { lock.release() } catch (e) { /* ignore */ } }
    }
    get()
    const vis = () => { if (document.visibilityState === 'visible') get() }
    document.addEventListener('visibilitychange', vis)
    document.addEventListener('pointerdown', get, true)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', vis)
      document.removeEventListener('pointerdown', get, true)
      try { if (lock) lock.release() } catch (e) { /* ignore */ }
    }
  }, [wakeSupported])

  /* after a reload nothing can buzz or chime until the waiter taps once */
  useEffect(() => {
    if (!needsTap) return
    const clear = () => setNeedsTap(false)
    document.addEventListener('pointerdown', clear, true)
    return () => document.removeEventListener('pointerdown', clear, true)
  }, [needsTap])

  /* snackbar lifetime */
  useEffect(() => {
    if (!snack) return
    const seq = snack.seq
    const t = setTimeout(() => setSnack(s => (s && s.seq === seq ? null : s)), snack.ms || 4000)
    return () => clearTimeout(t)
  }, [snack])

  /* ── actions ── */

  function markDelivered(k) {
    const t = Date.now()
    if (t - lastTapRef.current < DOUBLE_TAP_GUARD_MS) return
    if (sendingRef.current.has(k.id)) return
    lastTapRef.current = t
    sendingRef.current.add(k.id)
    setFailed(f => { if (!f[k.id]) return f; const n = { ...f }; delete n[k.id]; return n })
    commit()
    const label = kotLabel(k)
    showSnack({ kind: 'undo', kotId: k.id, label, text: label + ' marked delivered', ms: UNDO_SNACK_MS })

    const job = timed(supabase.rpc('mk_mark_delivered', { p_kot_id: k.id, p_waiter_id: waiter.id }), RPC_TIMEOUT_MS)
      .then(({ data, error }) => {
        sendingRef.current.delete(k.id)
        const row = error ? null : asRow(data)
        if (row) applyLocal(row)
        commit()
        if (row && row.status === 'delivered' && row.delivered_by === waiter.id) return true
        if (row && row.status === 'delivered') {
          showSnack({ kind: 'info', text: label + ' was already delivered by ' +
            (row.delivered_by_name || 'someone else') + '.', ms: 5000 }, k.id)
          return false
        }
        if (row && row.status === 'cancelled') {
          showSnack({ kind: 'error', text: label + ' was CANCELLED. Do not deliver it.', ms: 9000 })
          return false
        }
        if (!error && !row) {
          dropRow(k.id)
          showSnack({ kind: 'info', text: label + ' is no longer on the list.', ms: 5000 }, k.id)
          return false
        }
        setFailed(f => ({ ...f, [k.id]: true }))
        showSnack({ kind: 'error', text: 'Not saved. ' + label + ' is back on your list — tap Delivered again.', ms: 9000 })
        return false
      })
    jobsRef.current.set(k.id, job)
  }

  async function undo(kotId, label) {
    if (undoingRef.current.has(kotId)) return
    undoingRef.current.add(kotId)
    showSnack({ kind: 'busy', kotId, text: 'Undoing ' + label + '…', ms: 20000 })
    try {
      const job = jobsRef.current.get(kotId)
      if (job) { const ok = await job; if (!ok) return }
      const { data, error } = await timed(
        supabase.rpc('mk_undo_delivered', { p_kot_id: kotId, p_waiter_id: waiter.id }), RPC_TIMEOUT_MS)
      const row = error ? null : asRow(data)
      if (row) applyLocal(row)
      if (row && row.status === 'open') {
        jobsRef.current.delete(kotId)
        showSnack({ kind: 'info', text: label + ' is back on your list.', ms: 3000 })
      } else if (error) {
        showSnack({ kind: 'error', text: 'Could not undo — no connection. Try again from Delivered today below.', ms: 8000 })
      } else {
        showSnack({ kind: 'error', text: 'Too late to undo ' + label + '. Tell the supervisor.', ms: 8000 })
      }
    } finally {
      undoingRef.current.delete(kotId)
    }
  }

  function dismiss(id) {
    const next = new Set(dismissedRef.current)
    next.add(id)
    dismissedRef.current = next
    setDismissed(next)
    writeJSON(DISMISSED_KEY, Array.from(next).slice(-300))
  }

  /* ── what to show ── */

  const tNow = serverNow()
  const all = Array.from(snap.rows.values())
  const open = all
    .filter(r => r.status === 'open' && !snap.sending.has(r.id))
    .sort((a, b) => ((ms(a.created_at) || 0) - (ms(b.created_at) || 0)) ||
      String(a.kot_no || '').localeCompare(String(b.kot_no || '')))
  const cancelled = all
    .filter(r => r.status === 'cancelled' && !dismissed.has(r.id) &&
      (ms(r.cancelled_at) || 0) >= tNow - CANCEL_SHOW_MS)
    .sort((a, b) => (ms(b.cancelled_at) || 0) - (ms(a.cancelled_at) || 0))
  const done = all
    .filter(r => r.status === 'delivered')
    .sort((a, b) => (ms(b.delivered_at) || 0) - (ms(a.delivered_at) || 0))
    .slice(0, DELIVERED_SHOWN)

  const offline = !online || failCount >= 2
  const waiterLine = [waiter.name,
    waiter.waiter_number != null && String(waiter.waiter_number) !== String(waiter.name) ? '#' + waiter.waiter_number : null]
    .filter(Boolean).join(' · ')

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'Manrope, sans-serif' }}>
      <style>{CSS}</style>

      {/* header */}
      <div style={{ background: C.dark, flexShrink: 0,
        padding: 'calc(10px + env(safe-area-inset-top, 0px)) 12px 12px 14px',
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.marigold, fontSize: 11, fontWeight: 800, letterSpacing: 1.6 }}>KITCHEN</div>
          <div style={{ color: '#fff', fontSize: 27, fontWeight: 900, lineHeight: 1.1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {kitchenName}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: 700, marginTop: 3,
            display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span title={offline ? 'Offline' : 'Live'} style={{ width: 8, height: 8, borderRadius: '50%',
              flexShrink: 0, background: offline ? C.amber : '#22C55E' }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{waiterLine}</span>
          </div>
        </div>
        <div aria-label={open.length + ' open'} style={{ flexShrink: 0, textAlign: 'center', minWidth: 62,
          borderRadius: 14, padding: '6px 10px',
          background: open.length ? C.marigold : 'rgba(255,255,255,0.1)',
          color: open.length ? '#fff' : 'rgba(255,255,255,0.6)' }}>
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1 }}>{open.length}</div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, marginTop: 2 }}>OPEN</div>
        </div>
        <button className="ss-w-btn" onClick={() => setConfirmOut(v => !v)} aria-label="Sign out"
          style={{ ...tap, flexShrink: 0, minHeight: 48, minWidth: 48, padding: '0 10px',
            background: confirmOut ? 'rgba(255,255,255,0.14)' : 'transparent',
            border: '1.5px solid rgba(255,255,255,0.22)', borderRadius: 12,
            color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 800, lineHeight: 1.15, cursor: 'pointer' }}>
          Sign<br />out
        </button>
      </div>

      {confirmOut && (
        <div className="ss-w-in" style={{ background: '#2D1010', flexShrink: 0, padding: '10px 12px 12px 14px',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ flex: '1 1 140px', color: '#fff', fontWeight: 800, fontSize: 15, lineHeight: 1.3 }}>
            Sign out of {kitchenName} on this phone?
          </div>
          <button className="ss-w-btn" onClick={() => setConfirmOut(false)}
            style={{ ...tap, minHeight: 48, padding: '0 18px', borderRadius: 12, cursor: 'pointer',
              background: 'rgba(255,255,255,0.1)', color: '#fff',
              border: '1.5px solid rgba(255,255,255,0.25)', fontWeight: 800, fontSize: 15 }}>
            Stay
          </button>
          <button className="ss-w-btn" onClick={onSignOut}
            style={{ ...tap, minHeight: 48, padding: '0 18px', borderRadius: 12, cursor: 'pointer',
              background: C.red, color: '#fff', border: 'none', fontWeight: 900, fontSize: 15 }}>
            Sign out
          </button>
        </div>
      )}

      {offline && (
        <div role="status" style={{ background: C.amber, color: C.dark, flexShrink: 0,
          padding: '9px 14px', fontSize: 15, fontWeight: 900,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span><Spinner size={14} />No connection — retrying</span>
          {lastOkAt > 0 && (
            <span style={{ fontWeight: 700, fontSize: 13, opacity: 0.8 }}>
              List as of {fmtTime(lastOkAt)}
            </span>
          )}
        </div>
      )}

      {needsTap && (
        <button className="ss-w-btn"
          onClick={() => { setNeedsTap(false); try { playChatChime() } catch (e) { /* ignore */ } }}
          style={{ ...tap, flexShrink: 0, width: '100%', minHeight: 48, border: 'none',
            borderBottom: '1px solid #FCD9A8', background: '#FFF4E3', color: '#9A4F00',
            fontSize: 15, fontWeight: 900, cursor: 'pointer', padding: '8px 14px' }}>
          🔔 Tap here to turn on order alerts
        </button>
      )}

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain', padding: '12px 12px 150px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>

          {cancelled.map(k => (
            <CancelledCard key={'c' + k.id} k={k} onOk={() => dismiss(k.id)} />
          ))}

          {!loaded ? (
            <div style={{ textAlign: 'center', padding: '56px 16px', color: 'var(--ink2)',
              fontSize: 17, fontWeight: 700 }}>
              <Spinner />{failCount >= 2 ? 'Could not load orders yet — retrying…' : 'Loading orders…'}
            </div>
          ) : open.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '44px 16px 36px' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#DCFCE7', color: C.green,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 38, fontWeight: 900, marginBottom: 14 }}>✓</div>
              <div style={{ fontSize: 21, fontWeight: 900, marginBottom: 6 }}>Nothing to deliver</div>
              <div style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.6, maxWidth: 300, margin: '0 auto' }}>
                New {kitchenName} orders appear here and the phone buzzes.
              </div>
            </div>
          ) : (
            open.map(k => (
              <KotCard key={k.id} k={k} now={tNow} fresh={freshRef.current.has(k.id)}
                failed={!!failed[k.id]} onDelivered={() => markDelivered(k)} />
            ))
          )}

          {loaded && (
            <DeliveredSection rows={done} open={showDone} onToggle={() => setShowDone(v => !v)}
              now={tNow} waiterId={waiter.id} onUndo={k => undo(k.id, kotLabel(k))} />
          )}

          <div style={{ textAlign: 'center', color: 'var(--ink2)', opacity: 0.75, fontSize: 12,
            lineHeight: 1.6, marginTop: 22, padding: '0 8px' }}>
            {[event.name, event.catering_company].filter(Boolean).join(' · ')}
            {!wakeSupported && (
              <div style={{ marginTop: 6 }}>
                This phone's screen may switch off on its own here. Set Screen timeout to 10 minutes in
                the phone's Settings.
              </div>
            )}
          </div>
        </div>
      </div>

      {snack && (
        <Snackbar snack={snack} onClose={() => setSnack(null)}
          onUndo={snack.kind === 'undo' ? () => undo(snack.kotId, snack.label) : null} />
      )}
    </div>
  )
}

/* ── pieces ────────────────────────────────────────────────────────── */

function waitStyle(min) {
  if (min >= RED_MIN) return { bg: C.red, fg: '#fff', card: C.red, border: C.red }
  if (min >= AMBER_MIN) return { bg: '#FEF3C7', fg: '#92400E', card: C.amber, border: '#FCD34D' }
  return { bg: '#F3F0F7', fg: 'var(--ink2)', card: 'var(--line)', border: 'var(--line)' }
}

function printChip(k, now) {
  const st = k.print_status
  if (st === 'printed') return { text: 'Slip printed', warn: false }
  const age = now - (ms(k.created_at) || now)
  if (st === 'failed' || st === 'skipped' || age > PRINT_GRACE_MS) {
    return { text: 'Slip not printed — read from phone', warn: true }
  }
  return { text: 'Printing slip…', warn: false }
}

function VegMark({ veg }) {
  if (veg !== true && veg !== false) return <span style={{ width: 16, flexShrink: 0 }} />
  const c = veg ? C.green : '#9A3412'
  return (
    <span aria-label={veg ? 'Veg' : 'Non-veg'} style={{ width: 16, height: 16, flexShrink: 0, marginTop: 5,
      border: '2px solid ' + c, borderRadius: 3, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
    </span>
  )
}

function NoteBadge({ note }) {
  const t = String(note || '').trim()
  if (!t) return null
  const shout = t.length <= 24
  return (
    <span style={{ display: 'inline-block', marginTop: 5, background: '#FDE047', color: '#422006',
      border: '1.5px solid #EAB308', borderRadius: 8, padding: '2px 10px', fontSize: 15,
      fontWeight: 900, lineHeight: 1.4, letterSpacing: shout ? 0.6 : 0,
      textTransform: shout ? 'uppercase' : 'none', wordBreak: 'break-word' }}>
      {t}
    </span>
  )
}

function ItemLines({ items, muted }) {
  if (!items.length) {
    return <div style={{ fontSize: 15, color: 'var(--ink2)', padding: '8px 0' }}>No dishes listed — check the slip.</div>
  }
  return items.map((it, i) => {
    const qty = it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)
    return (
      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0',
        borderTop: i ? '1px solid #F1ECF6' : 'none' }}>
        <span style={{ fontSize: 20, fontWeight: 900, minWidth: 42, lineHeight: 1.3,
          color: muted ? '#7F1D1D' : 'var(--ink)', whiteSpace: 'nowrap' }}>{qty} ×</span>
        <VegMark veg={it.veg} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.3, wordBreak: 'break-word',
            color: muted ? '#7F1D1D' : 'var(--ink)' }}>{it.name || 'Item'}</div>
          {it.note ? <NoteBadge note={it.note} /> : null}
        </div>
      </div>
    )
  })
}

function KotCard({ k, now, fresh, failed, onDelivered }) {
  const created = ms(k.created_at)
  const min = created == null ? 0 : Math.max(0, Math.floor((now - created) / 60000))
  const ws = waitStyle(min)
  const chairs = chairsLabel(k.chairs)
  const pc = printChip(k, now)
  const items = itemsOf(k)

  return (
    <div className={fresh ? 'ss-w-fresh' : undefined}
      style={{ background: '#fff', borderRadius: 18, marginBottom: 14, overflow: 'hidden',
        // Same 2px everywhere so nothing shifts when a card turns amber
        border: '2px solid ' + (failed ? C.red : ws.card),
        boxShadow: '0 2px 10px rgba(42,27,46,0.08)' }}>

      {failed && (
        <div style={{ background: '#FEE2E2', color: '#991B1B', fontSize: 14, fontWeight: 800,
          padding: '8px 14px', borderBottom: '1px solid #FECACA', lineHeight: 1.4 }}>
          Not saved — check the connection, then tap Delivered again.
        </div>
      )}

      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, lineHeight: 1 }}>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: 1, color: 'var(--ink2)' }}>TABLE</span>
              <span style={{ fontSize: 54, fontWeight: 900, letterSpacing: -1, color: 'var(--ink)' }}>
                {tableOf(k)}
              </span>
            </div>
            {chairs && (
              <div style={{ fontSize: 25, fontWeight: 800, marginTop: 6, lineHeight: 1.2,
                color: 'var(--ink)', wordBreak: 'break-word' }}>
                {chairs}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, textAlign: 'center', background: ws.bg, color: ws.fg,
            border: '1.5px solid ' + ws.border, borderRadius: 12, padding: '6px 10px', minWidth: 64 }}>
            <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{min < 1 ? '<1' : min}</div>
            <div style={{ fontSize: 12, fontWeight: 900, marginTop: 2 }}>min</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {k.kot_no && (
            <span style={{ background: C.dark, color: C.marigold, borderRadius: 8, padding: '3px 10px',
              fontSize: 15, fontWeight: 900, letterSpacing: 0.4 }}>{k.kot_no}</span>
          )}
          {k.captain_name && (
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink2)' }}>
              Captain {k.captain_name}
            </span>
          )}
        </div>

        <div style={{ marginTop: 10, paddingTop: 4, borderTop: '2px dashed var(--line)' }}>
          <ItemLines items={items} />
        </div>

        <div style={{ marginTop: 8 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999,
            padding: pc.warn ? '5px 12px' : '3px 10px', fontSize: pc.warn ? 14 : 12, fontWeight: 800,
            background: pc.warn ? '#FEF3C7' : '#F3F4F6', color: pc.warn ? '#92400E' : '#6B7280',
            border: '1px solid ' + (pc.warn ? '#FCD34D' : '#E5E7EB') }}>
            {pc.warn ? '⚠' : '\u{1F5A8}'} {pc.text}
          </span>
        </div>

        <button className="ss-w-btn" onClick={onDelivered}
          style={{ ...tap, width: '100%', minHeight: 62, marginTop: 12, background: C.green, color: '#fff',
            border: 'none', borderRadius: 14, fontSize: 21, fontWeight: 900, letterSpacing: 0.4,
            boxShadow: '0 3px 0 ' + C.greenDark, cursor: 'pointer' }}>
          ✓ Delivered
        </button>
      </div>
    </div>
  )
}

function CancelledCard({ k, onOk }) {
  const chairs = chairsLabel(k.chairs)
  return (
    <div className="ss-w-in" role="alert" style={{ background: '#FEF2F2', border: '2px solid ' + C.red,
      borderRadius: 18, marginBottom: 14, overflow: 'hidden',
      boxShadow: '0 3px 14px rgba(220,38,38,0.18)' }}>
      <div style={{ background: C.red, color: '#fff', padding: '10px 14px', fontSize: 18,
        fontWeight: 900, letterSpacing: 0.4 }}>
        ✕ CANCELLED — do not deliver
      </div>
      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: '#991B1B', lineHeight: 1.15 }}>
          Table {tableOf(k)}
        </div>
        {chairs && (
          <div style={{ fontSize: 22, fontWeight: 800, color: '#991B1B', marginTop: 3 }}>{chairs}</div>
        )}
        <div style={{ fontSize: 14, fontWeight: 700, color: '#B91C1C', marginTop: 6 }}>
          {[k.kot_no ? 'KOT ' + k.kot_no : null,
            k.cancelled_at ? 'cancelled ' + fmtTime(k.cancelled_at) : null].filter(Boolean).join(' · ')}
        </div>
        <div style={{ marginTop: 8, paddingTop: 4, borderTop: '2px dashed #FCA5A5' }}>
          <ItemLines items={itemsOf(k)} muted />
        </div>
        <button className="ss-w-btn" onClick={onOk}
          style={{ ...tap, width: '100%', minHeight: 54, marginTop: 12, background: '#fff', color: C.red,
            border: '2px solid ' + C.red, borderRadius: 14, fontSize: 19, fontWeight: 900, cursor: 'pointer' }}>
          OK
        </button>
      </div>
    </div>
  )
}

function DeliveredSection({ rows, open, onToggle, now, waiterId, onUndo }) {
  return (
    <div style={{ marginTop: 10, background: '#fff', borderRadius: 16, border: '1px solid var(--line)',
      overflow: 'hidden' }}>
      <button className="ss-w-btn" onClick={onToggle} aria-expanded={open}
        style={{ ...tap, width: '100%', minHeight: 54, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--ink)', textAlign: 'left' }}>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 900 }}>
          Delivered today
          <span style={{ fontWeight: 700, color: 'var(--ink2)', fontSize: 13 }}>
            {rows.length ? ' · last ' + rows.length : ''}
          </span>
        </span>
        <span style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 800,
          transform: 'rotate(' + (open ? 180 : 0) + 'deg)', transition: 'transform 0.15s' }}>▼</span>
      </button>
      {open && (
        rows.length === 0 ? (
          <div style={{ padding: '4px 16px 16px', fontSize: 14, color: 'var(--ink2)' }}>
            Nothing delivered yet.
          </div>
        ) : rows.map(k => {
          const at = ms(k.delivered_at)
          const canUndo = k.delivered_by === waiterId && at != null && now - at < UNDO_LIMIT_MS
          const chairs = chairsLabel(k.chairs)
          return (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
              borderTop: '1px solid #F1ECF6' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)', minWidth: 62 }}>
                {fmtTime(k.delivered_at)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.25 }}>
                  Table {tableOf(k)}
                  {chairs && <span style={{ fontWeight: 700, color: 'var(--ink2)', fontSize: 15 }}> · {chairs}</span>}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 600, marginTop: 1 }}>
                  {[k.kot_no, k.delivered_by_name ? 'by ' + k.delivered_by_name : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              {canUndo && (
                <button className="ss-w-btn" onClick={() => onUndo(k)}
                  style={{ ...tap, flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 10,
                    background: '#FFF8EE', color: '#C06A00', border: '2px solid ' + C.marigold,
                    fontSize: 14, fontWeight: 900, cursor: 'pointer' }}>
                  Undo
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

function Snackbar({ snack, onUndo, onClose }) {
  const bg = snack.kind === 'error' ? '#B91C1C' : C.dark
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, zIndex: 50, display: 'flex', justifyContent: 'center',
      bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', padding: '0 10px', pointerEvents: 'none' }}>
      <div key={snack.seq} className="ss-w-in" role="status"
        style={{ pointerEvents: 'auto', width: '100%', maxWidth: 540, background: bg, color: '#fff',
          borderRadius: 16, boxShadow: '0 8px 28px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 16px', minHeight: 60 }}>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 800, lineHeight: 1.35, padding: '4px 0' }}>
            {snack.kind === 'busy' && <Spinner size={14} />}
            {snack.text}
          </div>
          {onUndo ? (
            <button className="ss-w-btn" onClick={onUndo}
              style={{ ...tap, flexShrink: 0, minHeight: 48, minWidth: 84, padding: '0 14px', borderRadius: 12,
                background: 'transparent', border: '2px solid ' + C.marigold, color: C.marigold,
                fontSize: 17, fontWeight: 900, letterSpacing: 1, cursor: 'pointer' }}>
              UNDO
            </button>
          ) : snack.kind !== 'busy' ? (
            <button className="ss-w-btn" onClick={onClose} aria-label="Close"
              style={{ ...tap, flexShrink: 0, minHeight: 48, minWidth: 56, padding: '0 12px', borderRadius: 12,
                background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff',
                fontSize: 15, fontWeight: 900, cursor: 'pointer' }}>
              OK
            </button>
          ) : null}
        </div>
        {snack.kind === 'undo' && (
          <div style={{ height: 4, background: 'rgba(255,255,255,0.12)' }}>
            <div style={{ height: '100%', background: C.marigold, transformOrigin: 'left center',
              animation: 'ssWShrink ' + (snack.ms || UNDO_SNACK_MS) + 'ms linear forwards' }} />
          </div>
        )}
      </div>
    </div>
  )
}
