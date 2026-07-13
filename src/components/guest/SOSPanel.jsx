import { useState } from 'react'
import { supabase } from '../../lib/supabase'
const SOS_TYPES = [
  { type: 'sos', emoji: '🆘', label: 'Call Waiter', desc: 'Need immediate assistance', color: '#DC2626', bg: '#FEF2F2' },
  { type: 'clean_table', emoji: '🧹', label: 'Clean Table', desc: 'Please clean our table', color: '#2563EB', bg: '#EFF6FF' },
  { type: 'extra_cutlery', emoji: '🍴', label: 'Extra Cutlery', desc: 'Spoons, forks, bowls, plates', color: '#7C3AED', bg: '#F5F3FF' },
  { type: 'water_refill', emoji: '💧', label: 'Water Refill', desc: 'Water bottle or refill', color: '#0891B2', bg: '#ECFEFF' },
]
export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sent, setSent] = useState(null)
  const [loading, setLoading] = useState(false)
  async function sendRequest(type) {
    if (!tableData || !eventData) return
    setLoading(type)
    try {
      await supabase.from('sos_requests').insert({ event_id: eventData.id, table_id: tableData.id, request_type: type, status: 'open' })
      setSent(type)
      setTimeout(() => { setSent(null); onClose() }, 3000)
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: '#fff', borderRadius: '24px 24px 0 0', padding: '24px 20px 40px' }}>
        <div style={{ width: 40, height: 4, background: '#E8E0F0', borderRadius: 999, margin: '0 auto 20px' }}></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800 }}>Quick Requests</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#999' }}>x</button>
        </div>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Request Sent!</div>
            <div style={{ fontSize: 14, color: 'var(--ink2)' }}>The supervisor has been notified</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {SOS_TYPES.map(s => (
              <button key={s.type} onClick={() => sendRequest(s.type)} disabled={loading === s.type}
                style={{ background: s.bg, border: '2px solid ' + s.color + '20', borderRadius: 18, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', opacity: loading === s.type ? 0.7 : 1 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>{s.emoji}</div>
                <div style={{ fontWeight: 800, fontSize: 15, color: s.color, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: 'var(--ink2)', lineHeight: 1.4 }}>{s.desc}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}