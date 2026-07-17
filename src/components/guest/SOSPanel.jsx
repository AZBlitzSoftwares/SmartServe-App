import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [status, setStatus] = useState(null)

  // Poll for status once sent
  useEffect(() => {
    if (!sent || !tableData) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('sos_requests')
        .select('*').eq('table_id', tableData.id)
        .eq('status', 'open').order('created_at', { ascending:false }).limit(1)
      if (data?.[0]) setStatus(data[0].status)
      else setStatus('resolved')
    }, 4000)
    return () => clearInterval(interval)
  }, [sent, tableData])

  async function callWaiter() {
    if (sending || sent) return
    setSending(true)
    try {
      await supabase.from('sos_requests').insert({
        event_id: eventData?.id,
        table_id: tableData?.id,
        request_type: 'call_waiter',
        status: 'open'
      })
      setSent(true)
    } catch(e) { console.error(e) }
    finally { setSending(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'32px 24px 48px' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 24px' }}></div>

        {!sent ? (
          <>
            <div style={{ textAlign:'center', marginBottom:28 }}>
              <div style={{ fontSize:64, marginBottom:12 }}>🛎️</div>
              <h3 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Need Assistance?</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>Tap the button below and a waiter will come to your table shortly</p>
            </div>
            <button onClick={callWaiter} disabled={sending}
              style={{ width:'100%', background:sending?'#999':'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'20px', fontSize:20, fontWeight:800, cursor:sending?'wait':'pointer', marginBottom:16, boxShadow:'0 8px 24px rgba(232,137,12,0.4)' }}>
              {sending ? 'Calling...' : '🛎️ Call Waiter'}
            </button>
            <button onClick={onClose} style={{ width:'100%', background:'#f5f5f5', border:'none', borderRadius:14, padding:'14px', fontSize:15, fontWeight:600, color:'#888' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ textAlign:'center', marginBottom:28 }}>
              <div style={{ fontSize:64, marginBottom:12 }}>✅</div>
              <h3 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Waiter Called!</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>
                {status === 'resolved'
                  ? 'Your request has been attended to.'
                  : 'A waiter will be with you shortly. Please wait.'}
              </p>
              {status !== 'resolved' && (
                <div style={{ marginTop:16, display:'inline-flex', alignItems:'center', gap:8, background:'#FEF3C7', padding:'8px 16px', borderRadius:999, fontSize:13, color:'#92400E', fontWeight:600 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#F59E0B', display:'inline-block', animation:'pulse 1s infinite' }}></span>
                  Supervisor notified
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width:'100%', background:'var(--ink)', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800 }}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}
