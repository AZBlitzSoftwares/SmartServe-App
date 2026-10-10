import { useState } from 'react'
import janusLogo from '../../assets/janus_logo.jpg'
import { getSavedLaptop, retryLaptop, forgetLaptop } from '../../lib/serverSwitch'

/* Shown instead of the app when this tablet was sent to the laptop server
   only a few minutes ago and has come back to the cloud address - the
   laptop did not answer, or the app was closed and reopened. Rather than
   bounce to the laptop again (and into the same error page), staff choose.
   After a few minutes the tablet goes to the laptop by itself again. */
export default function LaptopServerAsk({ onUseCloud }) {
  const [busy, setBusy] = useState(false)
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
      </div>
    </div>
  )
}
