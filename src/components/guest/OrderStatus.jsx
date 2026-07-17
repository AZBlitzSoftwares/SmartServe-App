import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STEPS = [
  { key:'in_progress', label:'In Progress',  icon:'👨‍🍳', desc:'Your order is being prepared and will be delivered shortly' },
  { key:'delivered',   label:'Delivered',    icon:'🎉', desc:'Enjoy your meal!' },
]
const STATUS_ORDER = ['in_progress', 'delivered']

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
      .select('*, order_items(quantity, menu_items(name))')
      .eq('id', orderId).single()
    if (data) setOrder(data)
    setLoading(false)
  }

  if (orderId?.startsWith('offline-')) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 20px', background:'#fff', borderBottom:'1px solid var(--line)' }}>
        <button onClick={onBack} style={{ background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer' }}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:800 }}>Order Status</h2>
        <div style={{ marginLeft:'auto', background:'rgba(255,255,255,0.15)', color:'var(--ink)', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999, border:'1px solid var(--line)' }}>TABLE {tableNumber}</div>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, textAlign:'center' }}>
        <div style={{ fontSize:64, marginBottom:16 }}>📶</div>
        <h3 style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Order Queued Offline</h3>
        <p style={{ color:'var(--ink2)', fontSize:14, lineHeight:1.6 }}>Will sync automatically when internet is restored</p>
      </div>
    </div>
  )

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'var(--ink2)' }}>Loading...</div></div>

  // Map old statuses to new 2-step display
  const displayStatus = ['pending','placed','in_preparation','ready'].includes(order?.status) ? 'in_progress' : order?.status
  const currentStep = STATUS_ORDER.indexOf(displayStatus)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'16px 20px', background:'#fff', borderBottom:'1px solid var(--line)' }}>
        <button onClick={onBack} style={{ background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer' }}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:800 }}>Order Status</h2>
        <div style={{ marginLeft:'auto', background:'rgba(255,255,255,0.15)', color:'var(--ink)', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999, border:'1px solid var(--line)' }}>TABLE {tableNumber}</div>
      </div>

      <div style={{ padding:24, flex:1 }}>
        {/* Status timeline */}
        <div style={{ background:'#fff', borderRadius:20, padding:24, marginBottom:20, boxShadow:'var(--shadow)' }}>
          {STEPS.map((step, idx) => {
            const done = currentStep > idx
            const active = currentStep === idx
            return (
              <div key={step.key} style={{ display:'flex', gap:16, alignItems:'flex-start', marginBottom: idx < STEPS.length-1 ? 8 : 0 }}>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
                  <div style={{ width:48, height:48, borderRadius:'50%', background: done?'#16A34A': active?'#E8890C':'#F3F4F6', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, border: active?'3px solid #E8890C':'3px solid transparent', transition:'all 0.4s' }}>
                    {done ? '✓' : step.icon}
                  </div>
                  {idx < STEPS.length-1 && <div style={{ width:2, height:40, background: done?'#16A34A':'#E5E7EB', marginTop:4, transition:'background 0.4s' }}></div>}
                </div>
                <div style={{ paddingTop:10, flex:1 }}>
                  <div style={{ fontWeight: active||done ? 800 : 500, fontSize:16, color: done?'#16A34A': active?'#E8890C':'#9CA3AF' }}>{step.label}</div>
                  {active && <div style={{ fontSize:13, color:'#888', marginTop:4, lineHeight:1.5 }}>{step.desc}</div>}
                </div>
              </div>
            )
          })}
        </div>

        {/* Items */}
        {order?.order_items?.length > 0 && (
          <div style={{ background:'#fff', borderRadius:16, padding:20, boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:14 }}>Items Ordered</div>
            {order.order_items.map((oi, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--line)', fontSize:15 }}>
                <span style={{ fontWeight:500 }}>{oi.menu_items?.name}</span>
                <span style={{ fontWeight:700 }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
        )}

        {/* Delivered message */}
        {displayStatus === 'delivered' && (
          <div style={{ background:'#F0FDF4', border:'1.5px solid #BBF7D0', borderRadius:16, padding:20, marginTop:16, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:8 }}>🎉</div>
            <div style={{ fontWeight:800, fontSize:18, color:'#16A34A', marginBottom:4 }}>Order Delivered!</div>
            <div style={{ fontSize:14, color:'#888' }}>Thank you for ordering with Janu's Smart Serve</div>
          </div>
        )}

        <button onClick={onBack} style={{ width:'100%', marginTop:20, background:'var(--ink)', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
          ← Back to Menu
        </button>
      </div>
    </div>
  )
}
