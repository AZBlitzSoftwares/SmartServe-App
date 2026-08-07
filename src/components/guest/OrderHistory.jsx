import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function mapStatus(raw) {
  if (!raw) return { label:'Order Received', color:'#D97706' }
  if (['pending','placed'].includes(raw)) return { label:'Order Received', color:'#D97706' }
  if (['in_progress','in_preparation','ready'].includes(raw)) return { label:'Waiter On The Way', color:'#2563EB' }
  if (raw === 'delivered') return { label:'Delivered', color:'#16A34A' }
  if (raw === 'cancelled') return { label:'Cancelled', color:'#DC2626' }
  return { label: raw, color:'#888' }
}

export default function OrderHistory({ tableData, eventData, onClose, addToCart, onReordered }) {
  const [orders, setOrders] = useState([])
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => { loadHistory() }, [tableData])

  async function loadHistory() {
    setLoading(true); setError(false)
    if (!tableData?.id || !eventData?.id) { setLoading(false); return }
    try {
      const { data, error: err } = await supabase
        .from('orders').select('*, order_items(quantity, menu_items(id, name))')
        .eq('table_id', tableData.id).eq('event_id', eventData.id)
        .order('created_at', { ascending: false })
      if (err) setError(true)
      else setOrders(data || [])
    } catch(e) { setError(true) }
    finally { setLoading(false) }
  }


  // Availability is re-checked here rather than trusting what was loaded
  // when History opened - a supervisor may have hidden a dish since then.
  async function reorder(order) {
    if (busyId) return
    setBusyId(order.id); setNotice(null)
    try {
      const lines = (order.order_items || []).filter(oi => oi.menu_items?.id)
      if (!lines.length) {
        setNotice({ type:'error', text:'This order has no dishes that can be reordered.' })
        setBusyId(null); return
      }
      const ids = lines.map(oi => oi.menu_items.id)
      const { data: live } = await supabase.from('menu_items')
        .select('id, name, description, is_veg, category_id')
        .in('id', ids).eq('is_available', true)

      const liveById = {}
      ;(live || []).forEach(m => { liveById[m.id] = m })

      const gone = []
      let added = 0
      lines.forEach(oi => {
        const m = liveById[oi.menu_items.id]
        if (!m) { gone.push(oi.menu_items.name); return }
        for (let i = 0; i < (oi.quantity || 1); i++) addToCart(m)
        added++
      })

      if (added === 0) {
        setNotice({ type:'error',
          text:'Unfortunately none of these dishes are available right now. Please try something else.' })
        setBusyId(null); return
      }
      if (gone.length) {
        // Still open the cart - dropping a dish should not block the rest
        setNotice({ type:'warn', text:'Not available right now: ' + gone.join(', ') })
        setTimeout(() => { setBusyId(null); onReordered?.() }, 2200)
        return
      }
      setBusyId(null)
      onReordered?.()
    } catch (e) {
      console.error('Reorder error:', e)
      setNotice({ type:'error', text:'Could not reorder just now. Please try again.' })
      setBusyId(null)
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 40px', maxHeight:'85vh', overflowY:'auto' }}>
        <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 20px' }} />
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <h3 style={{ fontSize:20, fontWeight:800 }}>Order History</h3>
          <button onClick={onClose} style={{ background:'#1A0A0A', border:'none', borderRadius:999, width:40, height:40, fontSize:19, fontWeight:800, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>✕</button>
        </div>
        {notice && (
          <div style={{ borderRadius:12, padding:'11px 14px', marginBottom:12, fontSize:13,
            fontWeight:700, lineHeight:1.5,
            background: notice.type==='error' ? '#FEF2F2' : '#FEF3C7',
            border: '1.5px solid ' + (notice.type==='error' ? '#FECACA' : '#FCD34D'),
            color: notice.type==='error' ? '#B91C1C' : '#92400E' }}>
            {notice.text}
          </div>
        )}
        {loading ? (
          <div style={{ textAlign:'center', padding:48 }}>
            <div style={{ width:36, height:36, border:'3px solid #E5E7EB', borderTopColor:'#E8890C', borderRadius:'50%', margin:'0 auto 16px', animation:'spin 0.8s linear infinite' }} />
            <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
            <div style={{ color:'#888', fontSize:14 }}>Loading your orders...</div>
          </div>
        ) : error ? (
          <div style={{ textAlign:'center', padding:40 }}>
            <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:8, color:'#DC2626' }}>Couldn't load orders</div>
            <div style={{ color:'#888', fontSize:14, marginBottom:16 }}>Please check your connection and try again.</div>
            <button onClick={loadHistory} style={{ background:'#1A0A0A', color:'#fff', border:'none', borderRadius:10, padding:'10px 20px', fontSize:14, fontWeight:700, cursor:'pointer' }}>Try Again</button>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign:'center', padding:48 }}>
            <div style={{ fontSize:56, marginBottom:16 }}>🍽️</div>
            <div style={{ fontWeight:700, fontSize:17, marginBottom:8 }}>No orders yet</div>
            <div style={{ color:'#888', fontSize:14, lineHeight:1.6 }}>You haven't placed any orders from this table. Browse the menu and place your first order!</div>
          </div>
        ) : orders.map(order => {
          const st = mapStatus(order.status)
          return (
            <div key={order.id} style={{ background:'#F8F8F8', borderRadius:14, padding:16, marginBottom:10, borderLeft:'3px solid '+st.color }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div style={{ fontSize:13, color:'#888', fontWeight:600 }}>{new Date(order.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</div>
                <div style={{ background:st.color+'20', color:st.color, fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:999 }}>{st.label}</div>
              </div>
              {order.order_items?.map((oi, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'4px 0', borderBottom:'1px solid #EDEDED' }}>
                  <span style={{ fontWeight:600 }}>{oi.menu_items?.name}</span>
                  <span style={{ color:'#888' }}>x{oi.quantity}</span>
                </div>
              ))}
              {addToCart && (
                <button onClick={() => reorder(order)} disabled={busyId === order.id}
                  style={{ marginTop:12, width:'100%', background: busyId===order.id ? '#B0741C' : '#E8890C',
                    color:'#fff', border:'none', borderRadius:12, padding:'11px',
                    fontSize:14, fontWeight:800,
                    cursor: busyId===order.id ? 'wait' : 'pointer' }}>
                  {busyId === order.id ? 'Checking availability...' : '\u21BB  Reorder'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
