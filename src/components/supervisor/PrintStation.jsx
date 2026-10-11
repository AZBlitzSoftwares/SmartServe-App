import { useEffect, useState } from 'react'
import { createStation, onStationChange, onStats, setStation, stationEventId, stationName } from '../../lib/printStation'

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

export function PrintStationSwitch({ eventId, children }) {
  const on = useStationEvent() === eventId
  const s = useStats()
  return (
    <div data-testid="print-station" style={{ ...box, borderColor: on ? '#0F766E' : 'var(--line)', background: on ? '#F0FDFA' : '#fff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:'1 1 320px', minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:900 }}>Print from this laptop <span style={{ fontSize:11, fontWeight:800, color:'#0F766E' }}>· no Print Hub, nothing to install</span></div>
          <div style={{ fontSize:12.5, color:'var(--ink2)', lineHeight:1.5, marginTop:2 }}>
            Switch on at the desk laptop that is on the printers’ Wi-Fi (Chrome). It prints every KOT of this event straight to
            the kitchens’ Epson printers. Keep this page open on that laptop, and close any Print Hub. If Chrome asks to look
            for <b>devices on your local network</b>, click <b>Allow</b>.
          </div>
        </div>
        <button data-testid="print-station-toggle" onClick={() => setStation(eventId, !on)}
          style={{ height:38, padding:'0 16px', borderRadius:10, border:'none', cursor:'pointer', fontSize:13.5, fontWeight:900,
            background: on ? '#0F766E' : 'var(--ink)', color:'#fff', whiteSpace:'nowrap' }}>
          {on ? '● On · switch off' : 'Switch on'}</button>
      </div>
      {on && s && (
        <div style={{ marginTop:8, fontSize:12.5, color:'var(--ink)', lineHeight:1.5 }} data-testid="print-station-status">
          <b>{s.running ? 'Printing from this laptop' : 'Starting…'}</b> as “{stationName()}”: {s.printed} printed{s.failed ? `, ${s.failed} failed` : ''}.
          {s.error && <div style={{ color:'#B91C1C', fontWeight:700 }}>{s.error}</div>}
          {s.last && <div style={{ color: s.last.ok ? '#15803D' : '#B91C1C', fontWeight:700 }}>{s.last.ok ? 'Last: ' : 'Failed: '}{s.last.text}</div>}
          <div style={{ color:'var(--ink2)' }}>Use <b>Test print</b> on a kitchen to check its printer.</div>
        </div>
      )}
      {children}
    </div>
  )
}
