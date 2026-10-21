import { useState } from 'react'
import janusLogo from '../../assets/janus_logo.jpg'
import { getSavedLaptop, retryLaptop, forgetLaptop, normaliseBase, switchToLaptop } from '../../lib/serverSwitch'
import { useLaptopAddress } from '../useLaptopAddress'

/* Shown instead of the app when this tablet was sent to the laptop server
   only a few minutes ago and has come back to the cloud address - the
   laptop did not answer, or the app was closed and reopened. Rather than
   bounce to the laptop again (and into the same error page), staff choose.
   After a few minutes the tablet goes to the laptop by itself again.
   The laptop may also have a new address now (another router, a restart):
   "The laptop has a new address" opens the box with the address the cloud
   knows, or a search of this Wi-Fi.                                       */
export default function LaptopServerAsk({ onUseCloud }) {
  const [busy, setBusy] = useState(false)
  const [other, setOther] = useState(false)
  const base = getSavedLaptop()?.base || ''

  return (
    <div data-testid="laptop-ask"
      style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #1A0A0A, #2D1010)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px', fontFamily: 'Manrope, sans-serif', boxSizing: 'border-box' }}>
      <img src={janusLogo} alt="Janu's Smart Serve"
        style={{ width: 80, height: 80, borderRadius: 18, objectFit: 'contain', marginBottom: 20,
          border: '2px solid rgba(232,137,12,0.4)', background: 'rgba(232,137,12,0.1)' }} />
      <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 24, padding: '30px 26px',
        width: '100%', maxWidth: 420, border: '1px solid rgba(255,255,255,0.1)',
        textAlign: 'center', boxSizing: 'border-box' }}>
        <div style={{ color: '#5EEAD4', fontSize: 12, fontWeight: 900, letterSpacing: '0.6px', marginBottom: 8 }}>
          LAPTOP SERVER
        </div>
        <div style={{ color: '#fff', fontSize: 19, fontWeight: 900, marginBottom: 8 }}>
          This tablet is set to use the laptop
        </div>
        <div style={{ color: '#E8890C', fontSize: 15, fontWeight: 800, marginBottom: 14, overflowWrap: 'anywhere' }}>
          {base}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.6, marginBottom: 22 }}>
          If the laptop page did not open, check the laptop's Local Server window is open and this
          tablet is on the same Wi-Fi, then try again.
        </div>
        <button disabled={busy} onClick={() => { setBusy(true); retryLaptop() }}
          style={{ width: '100%', background: '#0F766E', color: '#fff', border: 'none', borderRadius: 12,
            padding: '16px', fontSize: 16, fontWeight: 800, cursor: 'pointer', marginBottom: 10,
            fontFamily: 'inherit' }}>
          {busy ? 'Opening…' : 'Open laptop server →'}
        </button>
        <button disabled={busy} onClick={() => { forgetLaptop(); onUseCloud() }}
          style={{ width: '100%', background: 'transparent', color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.25)', borderRadius: 12, padding: '14px',
            fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Use cloud server instead
        </button>
        {other ? <OtherAddress /> : (
          <button data-testid="laptop-ask-other" disabled={busy} onClick={() => setOther(true)}
            style={{ width: '100%', background: 'transparent', color: '#5EEAD4', border: 'none', marginTop: 12,
              fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            The laptop has a new address…
          </button>
        )}
      </div>
    </div>
  )
}

function OtherAddress() {
  const box = useLaptopAddress()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = () => {
    if (!normaliseBase(box.address)) { setErr('That is not an address. Type it like 192.168.1.10:8080'); return }
    setBusy(true)
    switchToLaptop(box.address)
  }
  const field = { width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 17, fontWeight: 800, padding: '13px 12px',
    borderRadius: 12, border: '2px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff',
    outline: 'none', fontFamily: 'inherit', marginTop: 14 }
  const ghost = { width: '100%', background: 'transparent', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 12, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 10 }
  return (
    <div data-testid="laptop-ask-panel">
      <input value={box.address} onChange={e => { box.setAddress(e.target.value); setErr('') }}
        onKeyDown={e => { if (e.key === 'Enter' && !busy) go() }} aria-label="Laptop server address" data-testid="laptop-address"
        inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={field} />
      {box.note && (
        <div data-testid="laptop-note" style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5, fontWeight: 700,
          color: box.tone === 'ok' ? '#5EEAD4' : box.tone === 'warn' ? '#FBBF24' : 'rgba(255,255,255,0.55)' }}>{box.note}</div>
      )}
      {err && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: '#FCA5A5' }}>{err}</div>}
      <button disabled={busy} onClick={go}
        style={{ width: '100%', background: '#0F766E', color: '#fff', border: 'none', borderRadius: 12, padding: '14px',
          fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 12 }}>
        {busy ? 'Opening…' : 'Open this address →'}
      </button>
      {box.search?.state === 'running'
        ? <button style={ghost} onClick={box.stopSearch}>Stop searching</button>
        : <button style={ghost} data-testid="laptop-search" onClick={box.runSearch}>🔍 Search this Wi-Fi for the laptop</button>}
    </div>
  )
}
