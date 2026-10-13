import { useEffect, useState } from 'react'
import { createStation, onStationChange, onStats, setStation, stationEventId, stationLabel, setStationLabel, stationStatus, takeStation } from '../../lib/printStation'

/* "Print from this laptop": the Control Desk prints the event's KOTs itself, straight to the
   Epson printers (src/lib/printStation.js). PrintStationRunner lives on every tab of the
   supervisor app, so printing goes on whichever tab is open; the switch is in
   Control › Kitchens & printers (PrintStationSwitch). */

function useStationEvent() {
  const [id, setId] = useState(() => stationEventId())
  useEffect(() => onStationChange(() => setId(stationEventId())), [])
  return id
}
function useStats() {
  const [s, setS] = useState(null)
  useEffect(() => onStats(setS), [])
  return s
}

// Runs for the event it was switched on for, whichever event the desk is showing, until it is
// switched off (also after a reload: the switch is remembered on this laptop).
export default function PrintStationRunner() {
  const on = useStationEvent()
  const s = useStats()
  useEffect(() => {
    if (!on) return
    return createStation({ eventId: on })
  }, [on])
  if (!on || !s) return null
  const bad = s.error || (s.last && !s.last.ok)
  return (
    <div data-testid="print-station-pill" style={{ position:'fixed', left:12, bottom:12, zIndex:900, maxWidth:'min(520px, calc(100vw - 180px))',
      background: bad ? '#7F1D1D' : '#0F766E', color:'#fff', borderRadius:12, padding:'8px 12px', fontSize:12.5, fontWeight:700,
      boxShadow:'0 6px 18px rgba(0,0,0,0.25)', lineHeight:1.4 }}>
      <div>🖨 This laptop prints the KOTs · {s.printed} printed{s.failed ? ` · ${s.failed} failed` : ''}</div>
      {(s.error || s.last) && (
        <div style={{ fontWeight:600, opacity:0.9, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {s.error || (s.last.ok ? 'Last: ' : 'Failed: ') + s.last.text}</div>
      )}
    </div>
  )
}

const box = { border:'1.5px solid var(--line)', borderRadius:12, padding:'12px 14px', marginTop:12, background:'#fff' }

const secs = t => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000))
const ago = t => { const n = secs(t); return n < 60 ? n + ' s ago' : Math.round(n / 60) + ' min ago' }
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/* The switch, with one printing laptop per event: while another laptop (or a Print Hub) prints and
   answers, this one shows who prints and can take printing over only with an admin PIN. */
export function PrintStationSwitch({ eventId, children }) {
  const on = useStationEvent() === eventId
  const s = useStats()
  const [holder, setHolder] = useState(null)      // ps_status of the event
  const [askPin, setAskPin] = useState(false)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(() => stationLabel())
  const [, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    const look = () => stationStatus(eventId).then(h => { if (alive) setHolder(h) }, () => {})
    look()
    const t = setInterval(() => { look(); setTick(n => n + 1) }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [eventId, on])

  const noLock = holder?.error === 'no-sql'
  const other = holder && holder.station && !holder.mine && holder.active
  const staleOther = holder && holder.station && !holder.mine && !holder.active

  async function switchOn(withPin) {
    setMsg(null); setBusy(true)
    setStationLabel(name)
    const r = await takeStation(eventId, withPin ? pin : null)
    setBusy(false)
    if (r.ok) {
      setAskPin(false); setPin('')
      if (r.took_over) setMsg({ ok: true, text: `Printing moved here from “${r.took_over}”. That laptop stops printing within a few seconds.` })
      setStation(eventId, true)
      stationStatus(eventId).then(setHolder, () => {})
      return
    }
    if (r.error) { setMsg({ ok: false, text: 'Could not reach the server: ' + r.error }); return }
    setHolder({ station: r.station, label: r.label, taken_at: r.taken_at, seen_at: r.seen_at, active: true, mine: false })
    if (r.wrong_pin) setMsg({ ok: false, text: 'That is not an admin PIN. Printing stays on the other laptop.' })
    else setAskPin(true)
  }

  return (
    <div data-testid="print-station" style={{ ...box, borderColor: on ? '#0F766E' : other ? '#F59E0B' : 'var(--line)', background: on ? '#F0FDFA' : other ? '#FFFBEB' : '#fff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:'1 1 320px', minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:900 }}>Print from this laptop <span style={{ fontSize:11, fontWeight:800, color:'#0F766E' }}>· no Print Hub, nothing to install</span></div>
          <div style={{ fontSize:12.5, color:'var(--ink2)', lineHeight:1.5, marginTop:2 }}>
            Switch on at <b>one</b> laptop that is on the printers’ Wi-Fi (Chrome). It prints every KOT of this event straight to
            the kitchens’ Epson printers. Keep this page open on that laptop. Other laptops and tablets can use the Control Desk
            and set-up as usual; only this one prints. If Chrome asks to look for <b>devices on your local network</b>, click <b>Allow</b>.
          </div>
        </div>
        {on ? (
          <button data-testid="print-station-toggle" onClick={() => { setStation(eventId, false); setMsg(null) }}
            style={{ height:38, padding:'0 16px', borderRadius:10, border:'none', cursor:'pointer', fontSize:13.5, fontWeight:900, background:'#0F766E', color:'#fff', whiteSpace:'nowrap' }}>
            ● On · switch off</button>
        ) : other ? (
          <button data-testid="print-station-move" onClick={() => { setAskPin(a => !a); setMsg(null) }}
            style={{ height:38, padding:'0 14px', borderRadius:10, border:'1.5px solid #B45309', cursor:'pointer', fontSize:13, fontWeight:900, background:'#fff', color:'#92400E', whiteSpace:'nowrap' }}>
            Move printing to this laptop…</button>
        ) : (
          <button data-testid="print-station-toggle" disabled={busy} onClick={() => switchOn(false)}
            style={{ height:38, padding:'0 16px', borderRadius:10, border:'none', cursor:'pointer', fontSize:13.5, fontWeight:900, background:'var(--ink)', color:'#fff', whiteSpace:'nowrap' }}>
            {busy ? 'Switching on…' : 'Switch on'}</button>
        )}
      </div>

      {!on && (
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:8, fontSize:12.5 }}>
          <span style={{ fontWeight:800 }}>This laptop’s name</span>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} data-testid="print-station-name"
            style={{ height:30, border:'1.5px solid var(--line)', borderRadius:8, padding:'0 9px', fontSize:13, fontWeight:700, width:200 }} />
          <span style={{ color:'var(--ink2)' }}>shown to the other laptops while this one prints</span>
        </div>
      )}

      {other && !on && (
        <div data-testid="print-station-other" style={{ marginTop:8, fontSize:13, fontWeight:700, color:'#92400E', lineHeight:1.5 }}>
          🖨 Printing is on at <b>“{holder.label || holder.station}”</b> since {clock(holder.taken_at)} (answered {ago(holder.seen_at)}).
          This laptop does not print. Only one laptop prints for an event.
        </div>
      )}
      {staleOther && !on && (
        <div style={{ marginTop:8, fontSize:12.5, fontWeight:700, color:'var(--ink2)' }}>
          The last printing laptop, “{holder.label || holder.station}”, stopped answering {ago(holder.seen_at)}. Switch on here to print.
        </div>
      )}
      {askPin && !on && (
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:8 }}>
          <span style={{ fontSize:12.5, fontWeight:800 }}>Admin PIN to move printing here</span>
          <input type="password" inputMode="numeric" value={pin} autoFocus onChange={e => setPin(e.target.value.replace(/\s/g, '').slice(0, 12))}
            onKeyDown={e => { if (e.key === 'Enter' && pin) switchOn(true) }} data-testid="print-station-pin"
            style={{ height:34, border:'1.5px solid var(--line)', borderRadius:8, padding:'0 10px', fontSize:15, fontWeight:800, width:120 }} />
          <button disabled={!pin || busy} onClick={() => switchOn(true)}
            style={{ height:34, padding:'0 14px', borderRadius:8, border:'none', background:'#B45309', color:'#fff', fontWeight:900, cursor:'pointer' }}>
            {busy ? 'Moving…' : 'Move printing here'}</button>
          <button onClick={() => { setAskPin(false); setPin('') }}
            style={{ height:34, padding:'0 12px', borderRadius:8, border:'1.5px solid var(--line)', background:'#fff', fontWeight:800, cursor:'pointer' }}>Cancel</button>
        </div>
      )}
      {msg && <div style={{ marginTop:8, fontSize:12.5, fontWeight:800, color: msg.ok ? '#15803D' : '#B91C1C' }}>{msg.text}</div>}
      {s?.notice && !on && <div style={{ marginTop:8, fontSize:12.5, fontWeight:800, color:'#B45309' }}>{s.notice}</div>}
      {noLock && <div style={{ marginTop:8, fontSize:12, fontWeight:700, color:'#92400E' }}>One-printing-laptop check is not active yet: run 2026-10-14_maestro_v6.sql in Supabase.</div>}

      {on && s && (
        <div style={{ marginTop:8, fontSize:12.5, color:'var(--ink)', lineHeight:1.5 }} data-testid="print-station-status">
          <b>{s.running ? 'Printing from this laptop' : 'Starting…'}</b> as “{stationLabel()}”: {s.printed} printed{s.failed ? `, ${s.failed} failed` : ''}.
          {s.error && <div style={{ color:'#B91C1C', fontWeight:700 }}>{s.error}</div>}
          {s.last && <div style={{ color: s.last.ok ? '#15803D' : '#B91C1C', fontWeight:700 }}>{s.last.ok ? 'Last: ' : 'Failed: '}{s.last.text}</div>}
          <div style={{ color:'var(--ink2)' }}>Use <b>Test print</b> on a kitchen to check its printer. Other laptops see that this one prints and cannot switch on without an admin PIN.</div>
        </div>
      )}
      {children}
    </div>
  )
}
