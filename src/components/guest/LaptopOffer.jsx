import { useEffect, useState } from 'react'
import { isLaptopOrigin, switchToLaptop } from '../../lib/serverSwitch'
import { agoText, deviceEventId, publishedLaptops } from '../../lib/laptopFinder'
import { checkStaffPin } from './staffPin'

/* "The laptop server is on for today's event" on a device still using the
   cloud. The laptop's Local Server tells the cloud its address every minute
   while it has any internet, so nobody types an IP.

   Only the laptop of this device's own event (a set-up guest tablet or a
   signed-in captain); on the entry screens, the laptops of today's events.
   Moving to the laptop is the supervisor's decision, so it asks for the
   supervisor or admin PIN, as Device tools does. The switch keeps this
   device's sign-in and table (switchToLaptop).

     variant 'banner'  entry screens (Setup, Captain Sign In, the chooser)
             'row'     inside the captain's table screen                  */
export default function LaptopOffer({ variant = 'banner' }) {
  const [list, setList] = useState([])
  const [asking, setAsking] = useState(null) // the base whose PIN is being asked
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isLaptopOrigin()) return undefined
    let live = true
    const load = () => publishedLaptops({ eventId: deviceEventId() }).then(l => { if (live) setList(l) })
    load()
    const t = setInterval(load, 60000)
    return () => { live = false; clearInterval(t) }
  }, [])

  if (isLaptopOrigin() || !list.length) return null

  async function confirm(base) {
    if (!pin.trim()) { setMsg('Enter the supervisor PIN.'); return }
    setBusy(true); setMsg('')
    const r = await checkStaffPin(pin.trim())
    if (r === 'ok') { switchToLaptop(base); return }
    setBusy(false); setPin('')
    setMsg(r === 'offline' ? "Can't check the PIN right now. Use ⚙ Device instead." : 'Incorrect PIN.')
  }

  const line = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
  const btn = { flexShrink: 0, background: '#fff', color: '#0F766E', border: 'none', borderRadius: 10,
    padding: '9px 12px', fontSize: 13, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit' }
  const rows = list.slice(0, 2).map(l => (
    <div key={l.base} style={{ background: '#0F766E', color: '#fff', borderRadius: 14, padding: '8px 10px 8px 14px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }} title={l.events.join(', ')}>
          <div style={{ ...line, fontSize: 13, fontWeight: 900 }}>
            💻 Laptop server is on · {l.base.replace(/^http:\/\//, '')}
          </div>
          <div style={{ ...line, fontSize: 11.5, fontWeight: 600, opacity: 0.85 }}>
            {(l.label ? l.label + ' · ' : '') + (l.events.length > 2 ? l.events.length + ' events' : l.events.join(', ')) + ' · seen ' + agoText(l.ageSeconds)}
          </div>
        </div>
        {asking !== l.base && (
          <button style={btn} onClick={() => { setAsking(l.base); setPin(''); setMsg('') }}>Use laptop server</button>
        )}
      </div>
      {asking === l.base && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <input type="password" inputMode="numeric" autoFocus value={pin} placeholder="Supervisor PIN" data-testid="laptop-offer-pin"
            onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setMsg('') }}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) confirm(l.base) }}
            style={{ flex: '1 1 140px', minWidth: 0, height: 38, borderRadius: 10, border: 'none', padding: '0 12px',
              fontSize: 16, fontWeight: 800, letterSpacing: 4, fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button style={btn} disabled={busy} onClick={() => confirm(l.base)}>{busy ? 'Opening…' : 'Switch'}</button>
          <button style={{ ...btn, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)' }}
            disabled={busy} onClick={() => { setAsking(null); setMsg('') }}>Cancel</button>
          {msg && <div style={{ flexBasis: '100%', fontSize: 12.5, fontWeight: 800, color: '#FDE68A' }}>{msg}</div>}
        </div>
      )}
    </div>
  ))

  if (variant === 'row') {
    return <div data-testid="laptop-offer" style={{ padding: '10px 16px 0', flexShrink: 0, fontFamily: 'Manrope, sans-serif' }}>{rows}</div>
  }
  return (
    <div data-testid="laptop-offer"
      style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 60,
        width: 'calc(100% - 24px)', maxWidth: 520, fontFamily: 'Manrope, sans-serif' }}>
      {rows}
    </div>
  )
}
