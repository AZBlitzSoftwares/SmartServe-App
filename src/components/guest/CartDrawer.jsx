import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { queueOrder } from '../../lib/offlineQueue'
export default function CartDrawer({ cart, tableData, eventData, isOnline, onOrderPlaced, onRemove, onAdd }) {
  const [open, setOpen] = useState(false)
  const [placing, setPlacing] = useState(false)
  const total = cart.reduce((s, i) => s + i.quantity, 0)
  async function placeOrder() {
    if (!tableData || !eventData) return
    setPlacing(true)
    try {
      if (isOnline === false) {
        await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
        onOrderPlaced('offline-' + Date.now())
        return
      }
      const { data: order } = await supabase.from('orders').insert({ event_id: eventData.id, table_id: tableData.id, status: 'pending' }).select().single()
      if (order) {
        await supabase.from('order_items').insert(cart.map(i => ({ order_id: order.id, menu_item_id: i.id, quantity: i.quantity })))
        onOrderPlaced(order.id)
      }
    } catch(e) {
      await queueOrder({ event_id: eventData.id, table_id: tableData.id, items: cart })
      onOrderPlaced('offline-' + Date.now())
    } finally { setPlacing(false) }
  }
  return (
    <>
      <div onClick={() => setOpen(true)} style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 480, background: '#E8890C', borderRadius: 16, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', zIndex: 50, boxShadow: '0 14px 36px rgba(232,137,12,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 14 }}>{total}</div>
          <span style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>View Cart</span>
        </div>
        <span style={{ color: '#fff', fontWeight: 800, fontSize: 18 }}>Go</span>
      </div>
      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60 }} onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '24px 24px 0 0', padding: '24px 20px 36px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ width: 40, height: 4, background: '#E8E0F0', borderRadius: 999, margin: '0 auto 20px' }}></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800 }}>Your Order</h3>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 22, color: '#999' }}>x</button>
            </div>
            {cart.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{item.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={() => onRemove(item.id)} style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg)', border: '1.5px solid var(--line)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>-</button>
                  <span style={{ fontWeight: 800, fontSize: 16, minWidth: 20, textAlign: 'center' }}>{item.quantity}</span>
                  <button onClick={() => onAdd(item)} style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ink)', border: 'none', color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>+</button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>
              <span>Total items</span><span>{total}</span>
            </div>
            {isOnline === false && <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#92400E', marginBottom: 16, fontWeight: 600 }}>Offline - order will sync when connected</div>}
            <button onClick={placeOrder} disabled={placing} style={{ width: '100%', background: placing ? '#999' : 'var(--ink)', color: '#fff', border: 'none', borderRadius: 14, padding: '18px', fontSize: 17, fontWeight: 800 }}>
              {placing ? 'Placing Order...' : 'Place Order'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}