import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const SOS_TYPES = [
  { type:'sos',          emoji:'🆘', label:'Call Waiter',   desc:'Need immediate assistance', bg:'#FEF2F2', color:'#DC2626' },
  { type:'clean_table',  emoji:'🧹', label:'Clean Table',   desc:'Please clean our table',    bg:'#EFF6FF', color:'#2563EB' },
  { type:'extra_cutlery',emoji:'🍴', label:'Extra Cutlery', desc:'Spoons, forks, bowls, plates', bg:'#F5F3FF', color:'#7C3AED' },
  { type:'water_refill', emoji:'💧', label:'Water Refill',  desc:'Water bottle or refill',    bg:'#ECFEFF', color:'#0891B2' },
]
const STATUS_INFO = {
  open:         { label:'⏳ Sent — waiting for supervisor', color:'#D97706' },
  acknowledged: { label:'✅ Acknowledged — help is coming!', color:'#2563EB' },
  resolved:     { label:'🎉 Resolved',                       color:'#16A34A' },
}

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(null)
  const [sent, setSent] = useState([])
  const [lastSent, setLastSent] = useState(null)
  const [myRequests, setMyRequests] = useState([])

  // Load past requests immediately on open + poll every 5s
  useEffect(() => {
    if (!tableData) return
    fetchMyRequests()
    const interval = setInterval(fetchMyRequests, 5000)
    return () => clearInterval(interval)
  }, [tableData])

  async function fetchMyRequests() {
    if (!tableData?.id) return
    const { data } = await supabase.from('sos_requests')
      .select('*').eq('table_id', tableData.id)
      .order('created_at', { ascending: false }).limit(10)
    if (data) {
      setMyRequests(data)
      // Mark already-sent types so buttons show sent state
      setSent(data.filter(r => r.status !== 'resolved').map(r => r.request_type))
    }
  }

  async function sendRequest(type) {
    if (sending) return
    setSending(type)
    try {
      if (tableData && eventData) {
        await supabase.from('sos_requests').insert({ event_id:eventData.id, table_id:tableData.id, request_type:type, status:'open' })
        await fetchMyRequests()
      }
      setLastSent(type)
      setTimeout(() => setLastSent(null), 3000)
    } catch(e) { console.error(e) }
    finally { setSending(null) }
  }

  const getLabel = (type) => SOS_TYPES.find(s => s.type === type)?.label || type
  const activeRequests = myRequests.filter(r => r.status !== 'resolved')
  const resolvedRequests = myRequests.filter(r => r.status === 'resolved').slice(0,3)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 40px', maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 20px' }}></div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Quick Requests</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
        </div>
        <p style={{ fontSize:13, color:'var(--ink2)', marginBottom:20 }}>Tap a button — your request goes directly to the supervisor</p>

        {lastSent && (
          <div style={{ background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:20 }}>✅</span>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:'#16A34A' }}>Request sent!</div>
              <div style={{ fontSize:12, color:'#16A34A' }}>{getLabel(lastSent)} — supervisor has been notified</div>
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
          {SOS_TYPES.map(s => {
            const isSent = sent.includes(s.type)
            const isSending = sending === s.type
            return (
              <button key={s.type} onClick={() => sendRequest(s.type)} disabled={isSending}
                style={{ background: isSent ? '#F0FDF4' : s.bg, border: isSent ? '2px solid #BBF7D0' : '2px solid '+s.color+'20', borderRadius:16, padding:'18px 12px', textAlign:'center', cursor: isSending ? 'wait' : 'pointer', opacity: isSending ? 0.7 : 1, position:'relative', transition:'all 0.2s' }}>
                {isSent && <div style={{ position:'absolute', top:8, right:8, background:'#16A34A', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800 }}>✓</div>}
                <div style={{ fontSize:36, marginBottom:8 }}>{isSending ? '⏳' : s.emoji}</div>
                <div style={{ fontWeight:800, fontSize:14, color: isSent ? '#16A34A' : s.color, marginBottom:4 }}>{isSent ? 'Sent!' : s.label}</div>
                <div style={{ fontSize:11, color:'var(--ink2)', lineHeight:1.4 }}>{isSending ? 'Sending...' : s.desc}</div>
              </button>
            )
          })}
        </div>

        {(activeRequests.length > 0 || resolvedRequests.length > 0) && (
          <div style={{ background:'var(--bg)', borderRadius:14, padding:16 }}>
            <div style={{ fontWeight:800, fontSize:14, marginBottom:12 }}>Your Request Status</div>
            {activeRequests.map(req => {
              const info = STATUS_INFO[req.status] || { label:req.status, color:'#999' }
              const typeInfo = SOS_TYPES.find(s => s.type === req.request_type)
              return (
                <div key={req.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'10px 0', borderBottom:'1px solid var(--line)', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:20 }}>{typeInfo?.emoji || '📣'}</span>
                    <span style={{ fontWeight:700, fontSize:13 }}>{typeInfo?.label || req.request_type}</span>
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:info.color, textAlign:'right', flex:1 }}>{info.label}</span>
                </div>
              )
            })}
            {resolvedRequests.map(req => {
              const typeInfo = SOS_TYPES.find(s => s.type === req.request_type)
              return (
                <div key={req.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)', opacity:0.5 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:20 }}>{typeInfo?.emoji || '📣'}</span>
                    <span style={{ fontWeight:600, fontSize:13 }}>{typeInfo?.label || req.request_type}</span>
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:'#16A34A' }}>🎉 Resolved</span>
                </div>
              )
            })}
          </div>
        )}

        {sent.length > 0 && (
          <button onClick={onClose} style={{ width:'100%', marginTop:20, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
