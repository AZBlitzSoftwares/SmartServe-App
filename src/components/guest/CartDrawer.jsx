import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { queueOrder } from '../../lib/offlineQueue'

export default function CartDrawer({ cart, tableData, eventData, isOnline, onOrderPlaced, onRemove, onAdd }) {
  const [open, setOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState('')
  const [activeOrderCount, setActiveOrderCount] = useState(0)
  const total = cart.reduce((s, i) => s + i.quantity, 0)

  const maxOrders = eventData?.max_orders_per_table || 1
  const orderLimitHit = activeOrderCount >= maxOrders

  // Real-time watch active orders for this table
  useEffect(() => {
    if (!tableData?.id || !eventData?.id) return
    checkActiveOrders()
    // Watch for changes — update count whenever order status changes
    const sub = supabase.channel('cart-order-watch-' + tableData.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => checkActiveOrders())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => checkActiveOrders())
      .subscribe()
    // Also poll every 5s as fallback
    const poll = setInterval(checkActiveOrders, 5000)
    return () => { supabase.removeChannel(sub); clearInterval(poll) }
  }, [tableData?.id, eventData?.id])

  async function checkActiveOrders() {
    if (!tableData?.id) return
    const { data } = await supabase.from('orders')
      .select('id').eq('table_id', tableData.id)
      .in('status', ['pending', 'placed', 'in_progress'])
    setActiveOrderCount(data?.length || 0)
  }

  async function placeOrder() {
    setError('')
    if (placing) return

    // Re-check live count before placing
    await checkActiveOrders()
    if (orderLimitHit) return

    if (isOnline === false) {
      if (eventData && tableData) await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
      onOrderPlaced('offline-' + Date.now()); setOpen(false); return
    }

    if (!tableData || !eventData) {
      setError('Table setup in progress... please try again in a moment'); return
    }

    setPlacing(true)
    try {
      const { data: order, error: orderError } = await supabase
        .from('orders').insert({ event_id: eventData.id, table_id: tableData.id, status: 'pending' }).select().single()
      if (orderError) throw orderError
      const { error: itemsError } = await supabase.from('order_items')
        .insert(cart.map(i => ({ order_id: order.id, menu_item_id: i.id, quantity: i.quantity })))
      if (itemsError) throw itemsError
      await checkActiveOrders()
      onOrderPlaced(order.id); setOpen(false)
    } catch(e) {
      try {
        await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
        onOrderPlaced('offline-' + Date.now()); setOpen(false)
      } catch(e2) { setError('Order failed. Please call a waiter.') }
    } finally { setPlacing(false) }
  }

  return (
    <>
      <div onClick={() => setOpen(true)} style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', width:'calc(100% - 32px)', maxWidth:480, background:'#E8890C', borderRadius:16, padding:'16px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer', zIndex:50, boxShadow:'0 14px 36px rgba(232,137,12,0.55)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ background:'rgba(255,255,255,0.25)', borderRadius:999, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'#fff', fontSize:14 }}>{total}</div>
          <span style={{ color:'#fff', fontWeight:800, fontSize:16 }}>View Cart</span>
        </div>
        <span style={{ color:'#fff', fontWeight:800, fontSize:18 }}>→</span>
      </div>

      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:60 }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position:'absolute', bottom:0, left:0, right:0, background:'#fff', borderRadius:'24px 24px 0 0', padding:'24px 20px 36px', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#E5E7EB', borderRadius:999, margin:'0 auto 20px' }} />
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h3 style={{ fontSize:20, fontWeight:800 }}>Your Order</h3>
              <button onClick={() => setOpen(false)} style={{ background:'none', border:'none', fontSize:22, color:'#999', cursor:'pointer' }}>✕</button>
            </div>

            {cart.map(item => (
              <div key={item.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 0', borderBottom:'1px solid #F0F0F0' }}>
                <div style={{ fontWeight:700, fontSize:15, flex:1 }}>{item.name}</div>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <button onClick={() => onRemove(item.id)} style={{ width:28, height:28, borderRadius:'50%', background:'#F5F5F5', border:'1.5px solid #E5E7EB', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>−</button>
                  <span style={{ fontWeight:800, fontSize:16, minWidth:20, textAlign:'center' }}>{item.quantity}</span>
                  <button onClick={() => onAdd(item)} style={{ width:28, height:28, borderRadius:'50%', background:'#1A0A0A', border:'none', color:'#fff', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, cursor:'pointer' }}>+</button>
                </div>
              </div>
            ))}

            <div style={{ marginTop:20, display:'flex', justifyContent:'space-between', fontSize:16, fontWeight:700, marginBottom:16 }}>
              <span>Total items</span><span>{total}</span>
            </div>

            {isOnline === false && (
              <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#92400E', marginBottom:12, fontWeight:600 }}>
                📶 Offline — order will sync when connected
              </div>
            )}

            {orderLimitHit && (
              <div style={{ background:'#FFF1F2', border:'2px solid #FDA4AF', borderRadius:16, padding:'20px 18px', marginBottom:12, textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:8 }}>⏳</div>
                <div style={{ fontWeight:900, fontSize:22, color:'#BE123C', marginBottom:6 }}>Waiting</div>
                <div style={{ fontSize:14, color:'#9F1239', lineHeight:1.6, marginBottom:14 }}>
                  {activeOrderCount === 1
                    ? 'Your current order is still being delivered.'
                    : activeOrderCount + ' orders are being delivered.'}
                  {' '}Place Order will unlock once one is delivered.
                </div>
                <button onClick={() => setOpen(false)}
                  style={{ background:'#1A0A0A', color:'#E8890C', border:'none', borderRadius:12, padding:'11px 20px', fontSize:14, fontWeight:800, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
                  🍽️ Browse Menu
                </button>
              </div>
            )}

            {error && (
              <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#DC2626', marginBottom:12, fontWeight:600 }}>
                ⚠️ {error}
              </div>
            )}

            <button onClick={placeOrder} disabled={placing || orderLimitHit}
              style={{ width:'100%', background: placing ? '#999' : orderLimitHit ? '#E5E7EB' : '#1A0A0A', color: orderLimitHit ? '#9CA3AF' : '#fff', border:'none', borderRadius:14, padding:'18px', fontSize:17, fontWeight:800, cursor: placing || orderLimitHit ? 'not-allowed' : 'pointer', transition:'all 0.2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {placing
                ? '⏳ Placing Order...'
                : orderLimitHit
                  ? '🔒 Locked — Waiting for Delivery'
                  : '✓ Place Order'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
