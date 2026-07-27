import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(false)
  const [activeRequest, setActiveRequest] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tableData?.id) return
    loadAll()
    const sub = supabase.channel('sos-watch-' + tableData.id)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'sos_requests' }, payload => {
        if (payload.new.table_id !== tableData.id) return
        if (payload.new.status === 'resolved') {
          setActiveRequest(null)
          loadAll()
        } else {
          setActiveRequest(payload.new)
        }
      })
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'sos_requests' }, payload => {
        if (payload.new.table_id === tableData.id) setActiveRequest(payload.new)
      })
      .subscribe()
    const poll = setInterval(loadAll, 6000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [tableData?.id])

  async function loadAll() {
    if (!tableData?.id) return
    // Only last 8 hours — prevents stale old requests from blocking button
    const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
    const { data } = await supabase.from('sos_requests')
      .select('*')
      .eq('table_id', tableData.id)
      .eq('event_id', eventData?.id)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(20)

    const all = data || []
    const active = all.find(r => ['open','in_progress'].includes(r.status))
    const resolved = all.filter(r => r.status === 'resolved')
    setActiveRequest(active || null)
    setHistory(resolved)
    setLoading(false)
  }

  async function callWaiter() {
    if (sending || activeRequest) return
    if (!tableData?.id || !eventData?.id) {
      alert('Table not set up. Please ask your supervisor.')
      return
    }
    setSending(true)
    try {
      const { data, error } = await supabase.from('sos_requests').insert({
        event_id: eventData.id,
        table_id: tableData.id,
        table_number: tableData.table_number,
        request_type: 'call_waiter',
        status: 'open'
      }).select().single()
      if (error) {
        console.error('SOS error:', error.message)
        alert('Could not send request. Please try again.')
        return
      }
      if (data) setActiveRequest(data)
    } catch(e) {
      console.error('SOS exception:', e)
    } finally {
      setSending(false)
    }
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
  }

  function getStatusDisplay() {
    if (!activeRequest) return null
    if (activeRequest.status === 'open') return {
      icon: '⏳', title: 'Request Received', color: '#D97706', bg: '#FEF3C7',
      desc: 'Your request has been sent. Please wait.',
      badge: 'Supervisor Notified'
    }
    if (activeRequest.status === 'in_progress') return {
      icon: '🏃', title: 'Help Is On The Way', color: '#2563EB', bg: '#EFF6FF',
      desc: 'A waiter has been assigned and is coming to your table.',
      badge: 'Waiter On The Way'
    }
    return null
  }

  const statusDisplay = getStatusDisplay()

  if (loading) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'32px 24px 48px', textAlign:'center' }}>
        <div style={{ color:'#888' }}>Loading...</div>
      </div>
    </div>
  )

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'28px 24px 44px', maxHeight:'85vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 24px' }}></div>

        {/* No active request — show call button */}
        {!activeRequest && (
          <>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <div style={{ fontSize:56, marginBottom:12 }}>🛎️</div>
              <h3 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Need Assistance?</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>Tap the button below and a waiter will come to your table shortly</p>
            </div>
            <button onClick={callWaiter} disabled={sending}
              style={{ width:'100%', background:sending?'#999':'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'18px', fontSize:18, fontWeight:800, cursor:sending?'wait':'pointer', marginBottom:12, boxShadow:'0 8px 24px rgba(232,137,12,0.35)' }}>
              {sending ? 'Sending...' : '🛎️ Call Waiter'}
            </button>
            <button onClick={onClose} style={{ width:'100%', background:'#f5f5f5', border:'none', borderRadius:14, padding:'14px', fontSize:15, fontWeight:600, color:'#888', cursor:'pointer' }}>Cancel</button>
          </>
        )}

        {/* Active request status */}
        {activeRequest && statusDisplay && (
          <>
            <div style={{ textAlign:'center', marginBottom:20 }}>
              <div style={{ fontSize:48, marginBottom:10 }}>{statusDisplay.icon}</div>
              <h3 style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>{statusDisplay.title}</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6, marginBottom:14 }}>{statusDisplay.desc}</p>
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:statusDisplay.bg, padding:'8px 16px', borderRadius:999, fontSize:13, color:statusDisplay.color, fontWeight:700 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:statusDisplay.color, display:'inline-block' }}></span>
                {statusDisplay.badge}
              </div>
            </div>

            {/* Timeline */}
            <div style={{ background:'#F8F8F8', borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#888', marginBottom:10, textTransform:'uppercase' }}>Timeline</div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: activeRequest.status==='in_progress'?10:0 }}>
                <div style={{ width:28,height:28,borderRadius:'50%',background:'#16A34A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#fff',flexShrink:0 }}>✓</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700 }}>Request Sent</div>
                  <div style={{ fontSize:11, color:'#888' }}>{formatTime(activeRequest.created_at)}</div>
                </div>
              </div>
              {activeRequest.status === 'in_progress' && (
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:28,height:28,borderRadius:'50%',background:'#2563EB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'#fff',flexShrink:0 }}>🏃</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700 }}>Waiter Assigned</div>
                    <div style={{ fontSize:11, color:'#888' }}>Help is on the way</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ background:'#FFF8EE',border:'1px solid rgba(232,137,12,0.3)',borderRadius:12,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#C06A00',textAlign:'center' }}>
              🔒 Cannot place another request until this one is resolved
            </div>
            <button onClick={onClose} style={{ width:'100%',background:'#1A0A0A',color:'#fff',border:'none',borderRadius:14,padding:'16px',fontSize:16,fontWeight:800,cursor:'pointer' }}>
              Close
            </button>
          </>
        )}

        {/* Request History */}
        {history.length > 0 && (
          <div style={{ marginTop: activeRequest ? 20 : 16 }}>
            <div style={{ fontSize:12, fontWeight:700, color:'#888', marginBottom:10, textTransform:'uppercase', letterSpacing:'0.5px' }}>
              Previous Requests ({history.length})
            </div>
            {history.map((req, i) => (
              <div key={req.id} style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:12, padding:'12px 14px', marginBottom:8, display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background:'#16A34A', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:'#fff', flexShrink:0 }}>✓</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#16A34A' }}>Request Resolved</div>
                  <div style={{ fontSize:11, color:'#888' }}>Raised at {formatTime(req.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
