import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
const STATUS_STEPS = ['pending', 'in_preparation', 'ready', 'delivered']
const STATUS_LABELS = { pending: 'Order Placed', in_preparation: 'In Preparation', ready: 'Ready for Delivery', delivered: 'Delivered' }
const STATUS_ICONS = { pending: '📋', in_preparation: '👨‍🍳', ready: '✅', delivered: '🎉' }
const STATUS_DESC = { pending: 'Your order has been received', in_preparation: 'The kitchen is preparing your food', ready: 'Your food is ready - waiter is on the way', delivered: 'Enjoy your meal!' }
export default function OrderStatus({ orderId, tableNumber, onBack }) {
  const [order, setOrder] = useState(null)
  const [items, setItems] = useState([])
  useEffect(() => {
    if (!orderId || orderId.startsWith('offline-')) return
    loadOrder()
    const sub = supabase.channel('order-' + orderId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'id=eq.' + orderId }, payload => {
        setOrder(prev => ({ ...prev, ...payload.new }))
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [orderId])
  async function loadOrder() {
    const { data } = await supabase.from('orders').select('*').eq('id', orderId).single()
    if (data) setOrder(data)
    const { data: oi } = await supabase.from('order_items').select('*, menu_items(name)').eq('order_id', orderId)
    if (oi) setItems(oi)
  }
  const isOffline = orderId?.startsWith('offline-')
  const currentStatus = order?.status || 'pending'
  const currentStep = STATUS_STEPS.indexOf(currentStatus)
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '20px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: '#fff', border: '1.5px solid var(--line)', borderRadius: 12, padding: '8px 16px', fontWeight: 700, fontSize: 14 }}>Back</button>
        <h2 style={{ fontSize: 20, fontWeight: 800 }}>Order Status</h2>
        <div style={{ background: 'rgba(42,27,46,0.08)', fontSize: 13, fontWeight: 700, padding: '6px 14px', borderRadius: 999, marginLeft: 'auto' }}>TABLE {tableNumber}</div>
      </div>
      {isOffline ? (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 16, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📶</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Order queued offline</div>
          <div style={{ fontSize: 14, color: '#92400E' }}>Will sync automatically when internet is restored</div>
        </div>
      ) : (
        <>
          <div style={{ background: '#fff', borderRadius: 20, padding: 24, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
            {STATUS_STEPS.map((step, i) => {
              const done = i <= currentStep
              const active = i === currentStep
              return (
                <div key={step} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: i < STATUS_STEPS.length - 1 ? 24 : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: done ? (active ? 'var(--marigold)' : 'var(--ink)') : '#E8E0F0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: active ? '0 0 0 4px rgba(232,137,12,0.25)' : 'none' }}>
                      {STATUS_ICONS[step]}
                    </div>
                    {i < STATUS_STEPS.length - 1 && <div style={{ width: 2, height: 24, background: i < currentStep ? 'var(--ink)' : '#E8E0F0', marginTop: 4 }}></div>}
                  </div>
                  <div style={{ paddingTop: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: done ? 'var(--ink)' : '#999' }}>{STATUS_LABELS[step]}</div>
                    {active && <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 4 }}>{STATUS_DESC[step]}</div>}
                  </div>
                </div>
              )
            })}
          </div>
          {items.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 20, padding: 20, boxShadow: 'var(--shadow)' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Items Ordered</div>
              {items.map(oi => (
                <div key={oi.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{oi.menu_items?.name}</span>
                  <span style={{ color: 'var(--ink2)', fontWeight: 700 }}>x{oi.quantity}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}