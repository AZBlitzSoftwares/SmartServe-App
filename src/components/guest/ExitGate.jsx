import { useState } from 'react'
import { supabase } from '../../lib/supabase'

const OVERLAY = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 300,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
}
const CARD = {
  width: '100%', maxWidth: 380, background: '#fff', borderRadius: 22,
  padding: '28px 24px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', textAlign: 'center'
}

/**
 * Two-step exit gate.
 *   step 'confirm' -> "Are you sure you want to exit?"  Yes / No
 *   step 'pin'     -> supervisor or admin PIN, with a visible Cancel
 * onCancel() returns the guest to the welcome screen untouched.
 * onVerified() is called only after a valid PIN.
 */
export default function ExitGate({ eventId, onCancel, onVerified }) {
  const [step, setStep] = useState('confirm')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(false)

  async function verifyPin() {
    const p = pin.trim()
    if (!p) { setErr('Please enter the PIN'); return }
    setChecking(true); setErr('')
    try {
      let allowed = false

      // Admin PIN — works for any event
      const { data: admins } = await supabase.from('admins')
        .select('id').eq('pin', p).eq('is_active', true)
      if (admins?.length > 0) allowed = true

      // Supervisor PIN — must be assigned to this event
      if (!allowed && eventId) {
        const { data: sups } = await supabase.from('supervisors')
          .select('id, event_id').eq('pin', p).eq('is_active', true)
        if (sups?.some(s => s.event_id === eventId)) allowed = true
      }

      if (!allowed) {
        setErr('Incorrect PIN. The app will stay open.')
        setPin('')
        setChecking(false)
        return
      }
      onVerified()
    } catch (e) {
      setErr('Could not verify right now. Please try again.')
      setChecking(false)
    }
  }

  if (step === 'confirm') {
    return (
      <div style={OVERLAY}>
        <div style={CARD}>
          <div style={{ fontSize: 46, marginBottom: 12 }}>🚪</div>
          <div style={{ fontSize: 21, fontWeight: 800, color: '#1A0A0A', marginBottom: 8 }}>
            Are you sure you want to exit?
          </div>
          <div style={{ fontSize: 14, color: '#888', lineHeight: 1.6, marginBottom: 24 }}>
            Closing the app will stop ordering at this table.
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={onCancel}
              style={{ flex: 1, background: '#F3F4F6', color: '#374151', border: 'none',
                borderRadius: 14, padding: '16px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
              No
            </button>
            <button onClick={() => { setStep('pin'); setErr('') }}
              style={{ flex: 1, background: '#1A0A0A', color: '#fff', border: 'none',
                borderRadius: 14, padding: '16px', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
              Yes
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div style={{ fontSize: 46, marginBottom: 12 }}>🔐</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: '#1A0A0A', marginBottom: 8 }}>
          Enter PIN to exit
        </div>
        <div style={{ fontSize: 14, color: '#888', lineHeight: 1.6, marginBottom: 20 }}>
          Supervisor or admin PIN required.
        </div>

        <input
          type="tel"
          inputMode="numeric"
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter' && !checking) verifyPin() }}
          placeholder="••••"
          autoFocus
          style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', letterSpacing: 10,
            fontSize: 26, fontWeight: 800, padding: '16px 12px', borderRadius: 14,
            border: '2px solid ' + (err ? '#FECACA' : '#E5E7EB'), outline: 'none', marginBottom: 12 }}
        />

        {err && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, color: '#DC2626', fontWeight: 700, marginBottom: 14 }}>
            {err}
          </div>
        )}

        <button onClick={verifyPin} disabled={checking}
          style={{ width: '100%', background: checking ? '#999' : '#1A0A0A', color: '#fff',
            border: 'none', borderRadius: 14, padding: '16px', fontSize: 16, fontWeight: 800,
            cursor: checking ? 'wait' : 'pointer', marginBottom: 10 }}>
          {checking ? 'Verifying...' : 'Exit App'}
        </button>

        <button onClick={onCancel}
          style={{ width: '100%', background: '#F3F4F6', color: '#374151', border: 'none',
            borderRadius: 14, padding: '15px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
          Cancel — Stay in App
        </button>
      </div>
    </div>
  )
}
