import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
const STATUS_COLOR = { pending: '#D97706', in_preparation: '#2563EB', ready: '#7C3AED', delivered: '#16A34A', cancelled: '#DC2626' }
const STATUS_LABEL = { pending: 'Placed', in_preparation: 'In Preparation', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' }
export default function OrderHistory({ tableData, eventData, onClose }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { if (tableData) loadHistory() }, [tableData])
  async function loadHistory() {
    const { data } = await supabase.from('orders').select('*, order_items(quantity, menu_items(name))').eq('table_id', tableData.id).eq('event_id', eventData.id).order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ width: '100%', background: '#fff', borderRadius: '24px 24px 0 0', padding: '24px 20px 40px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, background: '#E8E0F0', borderRadius: 999, margin: '0 auto 20px' }}></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800 }}>Order History</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: '#999' }}>x</button>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink2)' }}>Loading...</div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink2)' }}>No orders placed yet</div>
        ) : orders.map(order => (
          <div key={order.id} style={{ background: 'var(--bg)', borderRadius: 16, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--ink2)', fontWeight: 600 }}>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              <div style={{ background: (STATUS_COLOR[order.status] || '#999') + '20', color: STATUS_COLOR[order.status] || '#999', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999 }}>{STATUS_LABEL[order.status] || order.status}</div>
            </div>
            {order.order_items?.map((oi, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontWeight: 600 }}>{oi.menu_items?.name}</span>
                <span style={{ color: 'var(--ink2)' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}