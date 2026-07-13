import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function SupervisorLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(finalPin) {
    setLoading(true)
    setError('')
    try {
      const { data } = await supabase.from('supervisors').select('*').eq('pin', finalPin).eq('is_active', true).limit(1)
      if (data?.length) { onLogin(data[0]); return }
      if (finalPin === '1234') { onLogin({ name: 'Demo Supervisor' }); return }
      setError('Incorrect PIN. Please try again.')
      setPin('')
    } catch(e) {
      if (finalPin === '1234') { onLogin({ name: 'Demo Supervisor' }); return }
      setError('Connection error. Try again.')
    } finally { setLoading(false) }
  }

  function pressKey(k) {
    if (k === 'del') { setPin(p => p.slice(0, -1)); return }
    if (pin.length >= 4) return
    const newPin = pin + k
    setPin(newPin)
    if (newPin.length === 4) setTimeout(() => handleLogin(newPin), 150)
  }

  const KEYS = ['1','2','3','4','5','6','7','8','9','','0','del']

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #2A1B2E 0%, #4A2340 50%, #8E2A5C 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>👨‍💼</div>
      <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 800, marginBottom: 4 }}>Smart<span style={{ color: '#E8890C' }}>Serve</span></h1>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 40 }}>Supervisor Access</p>
      <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 24, padding: '32px 24px', width: '100%', maxWidth: 320 }}>
        <p style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontSize: 14, marginBottom: 20 }}>Enter your PIN</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 32 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: pin.length > i ? '#E8890C' : 'rgba(255,255,255,0.2)', transition: 'background 0.2s' }}></div>
          ))}
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 10, padding: '8px 12px', color: '#FCA5A5', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {KEYS.map((k, i) => (
            <button key={i} onClick={() => k !== '' && pressKey(k)} style={{ background: k === '' ? 'transparent' : 'rgba(255,255,255,0.1)', border: k === '' ? 'none' : '1px solid rgba(255,255,255,0.15)', borderRadius: 14, padding: '18px 8px', color: '#fff', fontSize: k === 'del' ? 18 : 22, fontWeight: 700, cursor: k === '' ? 'default' : 'pointer' }}>
              {k === 'del' ? 'del' : k}
            </button>
          ))}
        </div>
        <p style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', fontSize: 12, marginTop: 20 }}>Demo PIN: 1234</p>
      </div>
    </div>
  )
}