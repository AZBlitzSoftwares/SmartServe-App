import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getDeviceId } from '../../lib/deviceId'
import {
  describeServer, isLaptopOrigin, normaliseBase, probeLaptop, switchToLaptop,
  switchToCloud, getSavedLaptop, appBuildLabel, DEFAULT_LAPTOP_BASE,
} from '../../lib/serverSwitch'
import { clearAllDeviceKeys, todayISO } from './deviceEntry'

/* Staff tools for one tablet: what it is set up as, a clean reset, and
   which server it uses. Opened from the "⚙ Device" button in the bottom
   corner, or by holding the logo for 2 seconds, on the Setup, Captain
   Sign In, chooser and No-event screens. Supervisor or admin PIN first. */

const OVERLAY = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 500,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  fontFamily: 'Manrope, sans-serif',
}
const CARD = {
  width: '100%', maxWidth: 420, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
  background: '#fff', borderRadius: 22, padding: '24px 22px 20px',
  boxShadow: '0 24px 60px rgba(0,0,0,0.35)', boxSizing: 'border-box',
}
const BTN = {
  width: '100%', border: 'none', borderRadius: 14, padding: '15px', fontSize: 15,
  fontWeight: 800, cursor: 'pointer', marginBottom: 10, fontFamily: 'inherit',
}
const DARK = { ...BTN, background: '#1A0A0A', color: '#fff' }
const GREY = { ...BTN, background: '#F3F4F6', color: '#374151' }
const RED = { ...BTN, background: '#fff', color: '#B91C1C', border: '2px solid #FCA5A5' }
const INPUT = {
  width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 20, fontWeight: 800,
  padding: '14px 12px', borderRadius: 14, border: '2px solid #E5E7EB', outline: 'none',
  marginBottom: 12, fontFamily: 'inherit',
}
const NOTE = { fontSize: 13, color: '#6B7280', lineHeight: 1.55, marginBottom: 14 }
const ERR = {
  background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px',
  fontSize: 13, color: '#B91C1C', fontWeight: 700, marginBottom: 14, lineHeight: 1.5,
}

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
  const { data, error } = await quick(supabase.from('events').select('id').eq('date', todayISO()))
  if (error) throw error
  return (data || []).map(e => e.id)
}

/** 'ok' | 'wrong' | 'offline' */
async function checkStaffPin(pin) {
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

function deviceState() {
  const cap = readJson('ss_captain_session')
  const capEv = readJson('ss_captain_event')
  const guestEv = readJson('ss_setup_event')
  const table = (() => { try { return localStorage.getItem('ss_setup_table_number') } catch { return null } })()
  const guestDone = (() => { try { return localStorage.getItem('ss_setup_complete') } catch { return null } })()
  const remembered = (() => { try { return localStorage.getItem('ss_device_mode') } catch { return null } })()

  let mode = 'Not set up'
  let event = '—'
  let who = '—'
  if (cap && capEv) {
    mode = 'Captain tablet'
    event = capEv.name + (capEv.date ? ' (' + capEv.date + ')' : '')
    who = 'Captain ' + (cap.name || '?')
  } else if (guestDone && guestEv) {
    mode = 'Guest tablet'
    event = guestEv.name + (guestEv.date ? ' (' + guestEv.date + ')' : '')
    who = 'Table ' + (table || '?')
  } else if (remembered) {
    mode = 'Not set up (last chosen: ' + (remembered === 'captain' ? 'Captain' : 'Guest tablet') + ')'
  }
  return { mode, event, who }
}

/* ── Shared bits for the entry screens (the hook is in useDeviceTools.jsx) ── */

/** Shown on every entry screen while this page comes from the event laptop. */
export function LaptopPill({ inline = false }) {
  if (!isLaptopOrigin()) return null
  const host = window.location.host
  return (
    <div data-testid="laptop-pill"
      style={{
        ...(inline ? { display: 'inline-flex', marginBottom: 14 }
          : { position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 50, display: 'flex' }),
        alignItems: 'center', gap: 6, background: '#0F766E', color: '#fff',
        borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 900,
        letterSpacing: '0.6px', whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        fontFamily: 'Manrope, sans-serif',
      }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: '#5EEAD4' }} />
      LAPTOP SERVER
      <span style={{ fontWeight: 700, opacity: 0.75, letterSpacing: 0 }}>· {host}</span>
    </div>
  )
}

/* ── The panel ─────────────────────────────────────────────────────────── */

export default function DeviceTools({ onClose }) {
  // 'pin' -> 'tools'. 'offline' is the PIN step when the server cannot be
  // reached at all: only the server switch is offered then, because moving
  // to the laptop is exactly what a tablet with no internet needs and it
  // changes nothing on this tablet that cannot be switched back.
  const [step, setStep] = useState('pin')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(false)

  // Inside 'tools': null | 'reset' | 'laptop'
  const [panel, setPanel] = useState(null)
  const [resetting, setResetting] = useState(false)
  const [address, setAddress] = useState(() => getSavedLaptop()?.base ||
    (isLaptopOrigin() ? window.location.origin : DEFAULT_LAPTOP_BASE))
  const [laptopMsg, setLaptopMsg] = useState('')
  const [laptopBusy, setLaptopBusy] = useState(false)
  const [unreachable, setUnreachable] = useState(null)   // normalised base that did not answer

  const server = describeServer()
  const state = deviceState()

  async function verify() {
    const p = pin.trim()
    if (!p) { setErr('Enter the supervisor or admin PIN.'); return }
    setChecking(true); setErr('')
    const r = await checkStaffPin(p)
    setChecking(false)
    if (r === 'ok') { setStep('tools'); setPin(''); return }
    if (r === 'offline') { setStep('offline'); setPin(''); return }
    setErr('Incorrect PIN.')
    setPin('')
  }

  async function doReset() {
    setResetting(true)
    // Give back any table this tablet holds, so it can be chosen again at
    // once - by this tablet or another - instead of showing IN USE for an
    // hour. Best effort: no answer in 3 seconds and we reset anyway.
    try {
      const id = getDeviceId()
      await Promise.race([
        supabase.from('tables')
          .update({ claimed_by_device: null, claimed_at: null, last_seen_at: null })
          .eq('claimed_by_device', id),
        new Promise(res => setTimeout(res, 3000)),
      ])
    } catch { /* offline: the claim expires by itself */ }
    clearAllDeviceKeys()
    window.location.reload()
  }

  async function connectLaptop(force) {
    const base = normaliseBase(address)
    if (!base) { setLaptopMsg('That is not an address. Type it like 192.168.1.10:8080'); return }
    setLaptopMsg(''); setUnreachable(null)
    if (isLaptopOrigin() && base === window.location.origin) {
      setLaptopMsg('This tablet is already using that laptop server.')
      return
    }
    if (!force) {
      setLaptopBusy(true)
      const r = await probeLaptop(base)
      setLaptopBusy(false)
      if (r === 'unreachable') { setUnreachable(base); return }
    }
    setLaptopBusy(true)
    switchToLaptop(base)
  }

  const onCloud = server.kind === 'cloud'
  const cloudInUse = onCloud && !server.savedLaptop

  const serverButtons = (
    <>
      <button style={DARK} onClick={() => { setPanel('laptop'); setLaptopMsg(''); setUnreachable(null) }}>
        Use laptop server…
      </button>
      <button style={{ ...GREY, ...(cloudInUse ? { opacity: 0.55, cursor: 'default' } : {}) }}
        disabled={cloudInUse}
        onClick={() => switchToCloud()}>
        {cloudInUse ? '✓ Using cloud server' : 'Use cloud server'}
      </button>
    </>
  )

  const laptopPanel = (
    <div style={{ border: '2px solid #E5E7EB', borderRadius: 16, padding: 16, marginBottom: 12 }}>
      <div style={{ fontWeight: 800, color: '#1A0A0A', marginBottom: 6 }}>Laptop address</div>
      <div style={NOTE}>
        As shown in the laptop's Local Server window. This tablet must be on the same Wi-Fi as the laptop.
      </div>
      <input value={address} onChange={e => { setAddress(e.target.value); setLaptopMsg(''); setUnreachable(null) }}
        onKeyDown={e => { if (e.key === 'Enter' && !laptopBusy) connectLaptop(false) }}
        inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        data-testid="laptop-address"
        style={{ ...INPUT, fontSize: 17 }} />
      {laptopMsg && <div style={ERR}>{laptopMsg}</div>}
      {unreachable ? (
        <>
          <div style={ERR}>
            No answer from {unreachable}. Check the laptop's Local Server window is open and
            this tablet is on the same Wi-Fi.
          </div>
          <button style={DARK} disabled={laptopBusy} onClick={() => connectLaptop(false)}>Try again</button>
          <button style={GREY} disabled={laptopBusy} onClick={() => connectLaptop(true)}>Go anyway</button>
        </>
      ) : (
        <button style={DARK} disabled={laptopBusy} onClick={() => connectLaptop(false)}>
          {laptopBusy ? 'Connecting…' : 'Connect →'}
        </button>
      )}
      <button style={{ ...GREY, marginBottom: 0 }} onClick={() => setPanel(null)}>Cancel</button>
    </div>
  )

  return (
    <div style={OVERLAY} data-testid="device-tools">
      <div style={CARD}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <LaptopPill inline />
          <div style={{ fontSize: 21, fontWeight: 900, color: '#1A0A0A' }}>⚙ This tablet</div>
        </div>

        {step === 'pin' && (
          <>
            <div style={{ ...NOTE, textAlign: 'center' }}>Supervisor or admin PIN</div>
            <input type="password" inputMode="numeric" autoFocus value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setErr('') }}
              onKeyDown={e => { if (e.key === 'Enter' && !checking) verify() }}
              placeholder="••••" data-testid="device-pin"
              style={{ ...INPUT, letterSpacing: 10, fontSize: 26,
                borderColor: err ? '#FECACA' : '#E5E7EB' }} />
            {err && <div style={ERR}>{err}</div>}
            <button style={{ ...DARK, background: checking ? '#999' : '#1A0A0A' }}
              disabled={checking} onClick={verify}>
              {checking ? 'Checking…' : 'Open'}
            </button>
            <button style={GREY} onClick={onClose}>Cancel</button>
          </>
        )}

        {step === 'offline' && (
          <>
            <div style={ERR}>
              Can't check the PIN: this tablet can't reach the server right now.
              Reset needs the server. You can still switch servers.
            </div>
            <StateTable state={state} server={server} />
            {panel === 'laptop' ? laptopPanel : serverButtons}
            <button style={GREY} onClick={() => { setStep('pin'); setPanel(null) }}>Try the PIN again</button>
            <button style={GREY} onClick={onClose}>Close</button>
          </>
        )}

        {step === 'tools' && (
          <>
            <StateTable state={state} server={server} />

            {panel === 'reset' ? (
              <div style={{ border: '2px solid #FCA5A5', borderRadius: 16, padding: 16, marginBottom: 12 }}>
                <div style={{ fontWeight: 800, color: '#B91C1C', marginBottom: 6 }}>Reset this tablet?</div>
                <div style={NOTE}>
                  It forgets its table or captain sign-in and its saved choices, and starts again
                  like a new tablet. Orders already sent are not touched.
                </div>
                <button style={{ ...BTN, background: '#B91C1C', color: '#fff' }}
                  disabled={resetting} onClick={doReset}>
                  {resetting ? 'Resetting…' : 'Yes, reset this tablet'}
                </button>
                <button style={{ ...GREY, marginBottom: 0 }} disabled={resetting}
                  onClick={() => setPanel(null)}>Cancel</button>
              </div>
            ) : panel === 'laptop' ? laptopPanel : (
              <>
                <button style={RED} onClick={() => setPanel('reset')}>Reset this tablet</button>
                {serverButtons}
              </>
            )}

            <button style={GREY} onClick={onClose}>Close</button>
          </>
        )}
      </div>
    </div>
  )
}

function StateTable({ state, server }) {
  const rows = [
    ['Mode', state.mode],
    ['Event', state.event],
    ['Table / captain', state.who],
    ['Server', server.kind === 'laptop'
      ? 'LAPTOP · ' + server.address
      : 'Cloud · ' + server.address + (server.savedLaptop ? ' (laptop ' + server.savedLaptop + ' saved, not reached)' : '')],
    ['App build', appBuildLabel()],
    ['Device ID', (() => { try { return getDeviceId() } catch { return '—' } })()],
  ]
  return (
    <div data-testid="device-state"
      style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 14,
        padding: '6px 14px', marginBottom: 14 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10, padding: '7px 0',
          borderBottom: k === 'Device ID' ? 'none' : '1px solid #EEF0F2', fontSize: 13 }}>
          <div style={{ width: 108, flexShrink: 0, color: '#6B7280', fontWeight: 700 }}>{k}</div>
          <div style={{ flex: 1, minWidth: 0, color: '#111827', fontWeight: 800,
            overflowWrap: 'anywhere' }}>{v}</div>
        </div>
      ))}
    </div>
  )
}
