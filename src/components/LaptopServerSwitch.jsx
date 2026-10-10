import { useState } from 'react'
import {
  describeServer, getSavedLaptop, isLaptopOrigin, normaliseBase, probeLaptop, switchToLaptop, switchToCloud, DEFAULT_LAPTOP_BASE,
} from '../lib/serverSwitch'

/* "Use laptop server" / "Use cloud server" for a screen that is already signed
   in: the kitchen screen's menu and the Control Desk's Offline kit card. The
   tablets have the same switch behind the Device button. The address is the
   one the laptop's "Start Local Server" window shows; this screen remembers it
   and opens there from now on (same page, sign in again). */
export default function LaptopServerSwitch({ dark = false }) {
  const server = describeServer()
  const onLaptop = server.kind === 'laptop'
  const cloudInUse = !onLaptop && !server.savedLaptop
  const [address, setAddress] = useState(() => getSavedLaptop()?.base || (isLaptopOrigin() ? window.location.origin : DEFAULT_LAPTOP_BASE))
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [unreachable, setUnreachable] = useState(false)

  const ink = dark ? '#E8ECF5' : 'var(--ink, #1F2937)'
  const muted = dark ? '#AEB8D0' : 'var(--ink2, #6B7280)'
  const line = dark ? '#2E3B5C' : 'var(--line, #E5E7EB)'
  const btn = { height: 36, padding: '0 14px', borderRadius: 9, border: 'none', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }

  async function connect(force) {
    const base = normaliseBase(address)
    if (!base) { setMsg('That is not an address. Type it like 192.168.1.10:8080'); return }
    setMsg(''); setUnreachable(false)
    if (onLaptop && base === window.location.origin) { setMsg('This screen already uses that laptop.'); return }
    if (!force) {
      setBusy(true)
      const r = await probeLaptop(base)
      setBusy(false)
      if (r === 'unreachable') { setUnreachable(true); return }
    }
    setBusy(true)
    switchToLaptop(base)
  }

  return (
    <div data-testid="laptop-switch" style={{ color: ink }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        This screen uses: <b>{onLaptop ? `the laptop server (${window.location.host})` : 'the cloud'}</b>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={address} onChange={e => { setAddress(e.target.value); setMsg(''); setUnreachable(false) }}
          onKeyDown={e => { if (e.key === 'Enter' && !busy) connect(false) }}
          aria-label="Laptop server address" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          style={{ flex: '1 1 200px', minWidth: 0, height: 36, borderRadius: 9, border: `1.5px solid ${line}`, padding: '0 10px',
            fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: dark ? '#1C2741' : '#fff', color: ink, boxSizing: 'border-box' }} />
        <button disabled={busy} onClick={() => connect(false)} style={{ ...btn, background: '#0F766E', color: '#fff' }}>
          {busy ? 'Opening…' : 'Use laptop server'}
        </button>
        <button disabled={busy || cloudInUse} onClick={() => switchToCloud()}
          style={{ ...btn, background: 'transparent', color: ink, border: `1.5px solid ${line}`, opacity: cloudInUse ? 0.5 : 1 }}>
          {cloudInUse ? '✓ Using cloud server' : 'Use cloud server'}
        </button>
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: '#DC2626' }}>{msg}</div>}
      {unreachable && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: muted, lineHeight: 1.5 }}>
          The laptop did not answer. Is its "Start Local Server" window open, and is this screen on the same Wi-Fi?{' '}
          <button onClick={() => connect(true)} style={{ ...btn, height: 28, padding: '0 10px', fontSize: 12, background: 'transparent', color: ink, border: `1.5px solid ${line}` }}>
            Switch anyway
          </button>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: muted, lineHeight: 1.5 }}>
        Type the address shown in the laptop's "Start Local Server" window. This screen then opens on the laptop
        until you choose the cloud again; sign in again with the same name and PIN.
      </div>
    </div>
  )
}
