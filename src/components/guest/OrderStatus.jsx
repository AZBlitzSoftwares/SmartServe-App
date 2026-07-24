import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function mapStatus(raw) {
  if (!raw) return 'placed'
  if (['pending','placed'].includes(raw)) return 'placed'
  if (['in_progress','in_preparation','ready'].includes(raw)) return 'on_the_way'
  if (raw === 'delivered') return 'delivered'
  return 'placed'
}

const STATUS_CONFIG = {
  placed:     { label:'Order Placed',      icon:'📋', color:'#D97706', desc:'Your order has been received and will be assigned shortly.' },
  on_the_way: { label:'Waiter On The Way', icon:'🏃', color:'#2563EB', desc:'Your food is being brought to your table.' },
  delivered:  { label:'Delivered',         icon:'✓',  color:'#16A34A', desc:'Enjoy your meal!' },
}

export default function OrderStatus({ orderId, tableNumber, onBack }) {
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orderId || orderId.startsWith('offline-')) { setLoading(false); return }
    fetchOrder()
    const sub = supabase.channel('order-status-' + orderId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.'+orderId }, payload => {
        setOrder(prev => ({ ...prev, ...payload.new }))
      }).subscribe()
    const interval = setInterval(fetchOrder, 6000)
    return () => { supabase.removeChannel(sub); clearInterval(interval) }
  }, [orderId])

  async function fetchOrder() {
    if (!orderId) return
    const { data } = await supabase.from('orders')
      .select('*, order_items(quantity, menu_items(name))').eq('id', orderId).single()
    if (data) setOrder(data)
    setLoading(false)
  }

  if (orderId?.startsWith('offline-')) return (
    <div style={{ minHeight:'100vh', background:'#F5F5F5', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 20px', background:'#1A0A0A' }}>
        <button onClick={onBack} style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer', color:'#fff' }}>← Back</button>
        <h2 style={{ fontSize:17, fontWeight:800, color:'#fff' }}>Track Order</h2>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
        <div style={{ fontSize:56, marginBottom:16 }}>📶</div>
        <h3 style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>Order Queued Offline</h3>
        <p style={{ color:'#888', fontSize:14, lineHeight:1.6 }}>Will sync automatically when internet is restored</p>
        <button onClick={onBack} style={{ marginTop:24, background:'#1A0A0A', color:'#fff', border:'none', borderRadius:12, padding:'14px 28px', fontSize:15, fontWeight:700, cursor:'pointer' }}>← Back to Menu</button>
      </div>
    </div>
  )

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', color:'#888' }}>Loading...</div>

  const displayStatus = mapStatus(order?.status)
  const cfg = STATUS_CONFIG[displayStatus]
  const allStatuses = ['placed','on_the_way','delivered']
  const currentIdx = allStatuses.indexOf(displayStatus)

  return (
    <div style={{ minHeight:'100vh', background:'#F5F5F5', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'#1A0A0A' }}>
        <button onClick={onBack} style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer', color:'#fff' }}>← Back</button>
        <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1 }}>Track Order</h2>
        <div style={{ background:'#E8890C', color:'#fff', fontSize:12, fontWeight:800, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
      </div>
      <div style={{ padding:20, flex:1 }}>
        <div style={{ background:'#fff', borderRadius:24, padding:28, marginBottom:16, textAlign:'center', boxShadow:'0 4px 16px rgba(0,0,0,0.08)', border:'2px solid '+cfg.color+'30' }}>
          <div style={{ width:80, height:80, borderRadius:'50%', background:cfg.color+'15', border:'3px solid '+cfg.color, display:'flex', alignItems:'center', justifyContent:'center', fontSize: displayStatus==='delivered'?32:36, margin:'0 auto 16px', fontWeight:900, color:cfg.color }}>
            {cfg.icon}
          </div>
          <div style={{ fontSize:22, fontWeight:900, color:cfg.color, marginBottom:8 }}>{cfg.label}</div>
          <div style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>{cfg.desc}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', marginBottom:20, background:'#fff', borderRadius:16, padding:'16px 20px', boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
          {allStatuses.map((s, idx) => {
            const sCfg = STATUS_CONFIG[s]
            const done = idx < currentIdx, active = idx === currentIdx
            return (
              <div key={s} style={{ display:'flex', alignItems:'center' }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:done?'#16A34A':active?sCfg.color:'#E5E7EB', border:'2px solid '+(done?'#16A34A':active?sCfg.color:'#D1D5DB'), display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, color:done||active?'#fff':'#9CA3AF', fontWeight:900, transition:'all 0.3s' }}>
                    {done ? '✓' : sCfg.icon}
                  </div>
                  <span style={{ fontSize:9, fontWeight:active?800:500, color:active?sCfg.color:done?'#16A34A':'#9CA3AF', whiteSpace:'nowrap', maxWidth:56, textAlign:'center' }}>{sCfg.label}</span>
                </div>
                {idx < 2 && <div style={{ width:36, height:2, background:done?'#16A34A':'#E5E7EB', margin:'0 4px 18px', transition:'background 0.3s' }} />}
              </div>
            )
          })}
        </div>
        {order?.order_items?.length > 0 && (
          <div style={{ background:'#fff', borderRadius:16, padding:18, boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:12 }}>Items Ordered</div>
            {order.order_items.map((oi, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #F0F0F0', fontSize:14 }}>
                <span style={{ fontWeight:600 }}>{oi.menu_items?.name}</span>
                <span style={{ fontWeight:800, color:'#888' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onBack} style={{ width:'100%', marginTop:20, background:'#1A0A0A', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>← Back to Menu</button>
      </div>
    </div>
  )
}
