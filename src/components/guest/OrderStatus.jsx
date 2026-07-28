import { supabase } from '../../lib/supabase'

function mapStatus(raw) {
  if (!raw) return 'placed'
  if (['pending','placed'].includes(raw)) return 'placed'
  if (['in_progress','in_preparation','ready'].includes(raw)) return 'on_the_way'
  if (raw === 'delivered') return 'delivered'
  if (raw === 'cancelled') return 'cancelled'
  return 'placed'
}

const STATUS_CONFIG = {
  placed:     { label:'Order Placed',      icon:'📋', color:'#D97706', bg:'#FEF3C7' },
  on_the_way: { label:'Waiter On The Way', icon:'🏃', color:'#2563EB', bg:'#EFF6FF' },
  delivered:  { label:'Delivered',         icon:'✓',  color:'#16A34A', bg:'#DCFCE7' },
  cancelled:  { label:'Cancelled',         icon:'✕',  color:'#DC2626', bg:'#FEF2F2' },
}

function OrderCard({ order, onCancel }) {
  const status = mapStatus(order?.status)
  const cfg    = STATUS_CONFIG[status] || STATUS_CONFIG.placed
  const statuses = status === 'cancelled'
    ? ['placed','cancelled']
    : ['placed','on_the_way','delivered']
  const currentIdx = statuses.indexOf(status)
  const orderId = order?.id ? '#' + String(order.id).slice(-6).toUpperCase() : '#------'
  const items = Array.isArray(order?.order_items) ? order.order_items : []

  return (
    <div style={{ background:'#fff', borderRadius:20, padding:20, marginBottom:14,
      boxShadow:'0 4px 16px rgba(0,0,0,0.08)', border:'2px solid ' + cfg.color + '33' }}>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <span style={{ fontSize:13, fontWeight:700, color:'#888' }}>{orderId}</span>
        <span style={{ background:cfg.bg, color:cfg.color, fontSize:12, fontWeight:800,
          padding:'4px 12px', borderRadius:999 }}>{cfg.icon} {cfg.label}</span>
      </div>

      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
        {statuses.map((s, idx) => {
          const sCfg = STATUS_CONFIG[s] || STATUS_CONFIG.placed
          const done = idx < currentIdx, active = idx === currentIdx
          return (
            <div key={s} style={{ display:'flex', alignItems:'center' }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                <div style={{ width:32, height:32, borderRadius:'50%',
                  background: done?'#16A34A' : active?sCfg.color : '#E5E7EB',
                  border:'2px solid '+(done?'#16A34A':active?sCfg.color:'#D1D5DB'),
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:13, color:done||active?'#fff':'#9CA3AF', fontWeight:900 }}>
                  {done ? '✓' : sCfg.icon}
                </div>
                <span style={{ fontSize:8, fontWeight:active?800:500,
                  color:active?sCfg.color:done?'#16A34A':'#9CA3AF',
                  whiteSpace:'nowrap', maxWidth:52, textAlign:'center' }}>{sCfg.label}</span>
              </div>
              {idx < statuses.length-1 && (
                <div style={{ width:28, height:2, background:done?'#16A34A':'#E5E7EB',
                  margin:'0 4px 16px', transition:'background 0.3s' }} />
              )}
            </div>
          )
        })}
      </div>

      {status === 'cancelled' && order?.cancel_reason && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10,
          padding:'8px 14px', fontSize:13, color:'#DC2626', fontWeight:600, marginBottom:10 }}>
          Reason: {order.cancel_reason}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ borderTop:'1px solid #F0F0F0', paddingTop:10,
          marginBottom: !order?.waiter_id && status === 'placed' ? 10 : 0 }}>
          {items.map((oi, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between',
              padding:'5px 0', fontSize:13 }}>
              <span style={{ fontWeight:600 }}>{oi?.menu_items?.name || 'Item'}</span>
              <span style={{ fontWeight:800, color:'#888' }}>x{oi?.quantity ?? 1}</span>
            </div>
          ))}
        </div>
      )}

      {!order?.waiter_id && status === 'placed' && (
        <button
          onClick={() => onCancel(order.id)}
          style={{ width:'100%', marginTop:8, background:'transparent',
            border:'1.5px solid #FECACA', borderRadius:10, padding:'10px',
            fontSize:13, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>
          ✕ Cancel Order
        </button>
      )}
    </div>
  )
}

function Header({ tableNumber, onBack }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:'#1A0A0A' }}>
      <button onClick={onBack} style={{ background:'rgba(255,255,255,0.1)', border:'none',
        borderRadius:10, padding:'8px 14px', fontSize:14, fontWeight:600, cursor:'pointer', color:'#fff' }}>← Back</button>
      <h2 style={{ fontSize:17, fontWeight:800, color:'#fff', flex:1 }}>Track Orders</h2>
      <div style={{ background:'#E8890C', color:'#fff', fontSize:12, fontWeight:800,
        padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
    </div>
  )
}

export default function OrderStatus({ activeOrders, tableNumber, onBack }) {
  const orders = Array.isArray(activeOrders) ? activeOrders.filter(Boolean) : []

  async function handleGuestCancel(orderId) {
    try {
      const { data } = await supabase.from('orders')
        .select('waiter_id, status').eq('id', orderId).single()
      if (data?.waiter_id || (data?.status !== 'pending' && data?.status !== 'placed')) {
        alert('This order can no longer be cancelled — a waiter has been assigned.')
        return
      }
      if (!window.confirm('Are you sure you want to cancel this order?')) return
      await supabase.from('orders')
        .update({ status: 'cancelled', cancel_reason: 'Cancelled by guest' })
        .eq('id', orderId)
      if (onBack) onBack()
    } catch (e) {
      alert('Could not cancel right now. Please ask your waiter.')
    }
  }

  if (orders.length === 0) {
    return (
      <div style={{ minHeight:'100vh', background:'#F5F5F5', display:'flex', flexDirection:'column' }}>
        <Header tableNumber={tableNumber} onBack={onBack} />
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', padding:24, textAlign:'center' }}>
          <div style={{ fontSize:48, marginBottom:12 }}>🍽️</div>
          <div style={{ fontSize:18, fontWeight:800, marginBottom:8, color:'#1A0A0A' }}>No active orders</div>
          <div style={{ fontSize:14, color:'#888', marginBottom:24, lineHeight:1.6, maxWidth:300 }}>
            Your order was cancelled or delivered.<br/>Go back to menu to place a new order.
          </div>
          <button onClick={onBack} style={{ background:'#1A0A0A', color:'#fff', border:'none',
            borderRadius:14, padding:'16px 32px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
            ← Back to Menu
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F5F5F5', display:'flex', flexDirection:'column' }}>
      <Header tableNumber={tableNumber} onBack={onBack} />
      <div style={{ flex:1, padding:'16px 14px 90px' }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#888', marginBottom:12, paddingLeft:4 }}>
          {orders.length} active {orders.length === 1 ? 'order' : 'orders'}
        </div>
        {orders.map(o => (
          <OrderCard key={o.id} order={o} onCancel={handleGuestCancel} />
        ))}
        <button onClick={onBack} style={{ width:'100%', marginTop:6, background:'#1A0A0A',
          color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16,
          fontWeight:800, cursor:'pointer' }}>
          ← Back to Menu
        </button>
      </div>
    </div>
  )
}
