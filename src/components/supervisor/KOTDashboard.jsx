import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_FLOW = { pending:'in_preparation', in_preparation:'ready', ready:'delivered' }
const STATUS_LABELS = { pending:'Placed', in_preparation:'In Preparation', ready:'Ready', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', in_preparation:'#2563EB', ready:'#7C3AED', delivered:'#16A34A', cancelled:'#DC2626' }
const STATUS_NEXT_LABEL = { pending:'Mark In Preparation', in_preparation:'Mark Ready', ready:'Mark Delivered' }

export default function KOTDashboard({ eventData, onOrderCountChange }) {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventData) return
    loadOrders(true)
    const interval = setInterval(() => loadOrders(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadOrders(showSpinner=false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders').select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter))').eq('event_id', eventData.id).order('created_at', { ascending:false })
    const all = data || []
    setOrders(all)
    onOrderCountChange(all.filter(o => !['delivered','cancelled'].includes(o.status)).length)
    if (showSpinner) setLoading(false)
  }

  async function updateStatus(order) {
    const next = STATUS_FLOW[order.status]
    if (!next) return
    const { error } = await supabase.from('orders').update({ status:next }).eq('id', order.id)
    if (error) { alert('Update failed: ' + error.message); return }
    loadOrders(false)
  }

  async function cancelOrder(id) {
    if (!confirm('Cancel this order?')) return
    await supabase.from('orders').update({ status:'cancelled', cancelled_at:new Date().toISOString() }).eq('id', id)
    loadOrders()
  }

  function printKOT(order) {
    const eventName = eventData?.name || 'Event'
    const tableNum = order.tables?.table_number || '?'
    const orderId = '#' + order.id.slice(-6).toUpperCase()
    const now = new Date(order.created_at)
    const dateStr = now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })
    const timeStr = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true })
    const w = window.open('', '_blank', 'width=320,height=500')
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT ${orderId}</title>
<style>body{font-family:'Courier New',monospace;font-size:13px;padding:16px;width:280px;margin:0 auto;color:#000}.center{text-align:center}.app{font-size:15px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px}.event{font-size:12px;text-align:center;margin-bottom:6px;font-weight:bold}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}.table-num{font-size:26px;font-weight:900;text-align:center;border:2px solid #000;padding:6px;margin:8px 0;letter-spacing:3px}.item{font-size:13px;padding:3px 0}.status{text-align:center;border:1px solid #000;padding:5px;font-weight:bold;text-transform:uppercase;font-size:12px;margin-top:8px;letter-spacing:1px}.footer{text-align:center;font-size:10px;color:#666;margin-top:10px}</style>
</head><body>
<div class="app">Janu's Smart Serve</div>
<div class="event">${eventName}</div>
<div class="divider"></div>
<div class="row"><span>Date:</span><span>${dateStr}</span></div>
<div class="row"><span>Time:</span><span>${timeStr}</span></div>
<div class="row"><span>Order:</span><span>${orderId}</span></div>
<div class="divider"></div>
<div class="table-num">TABLE ${tableNum}</div>
<div class="divider"></div>
${(order.order_items||[]).map(i => `<div class="item">• ${i.menu_items?.name} x${i.quantity}${i.menu_items?.is_live_counter?' <em>[Live]</em>':''}</div>`).join('')}
<div class="divider"></div>
<div class="status">Status: ${STATUS_LABELS[order.status]||order.status}</div>
<div class="footer">Powered by Janu's Smart Serve</div>
</body></html>`)
    w.document.close(); w.focus(); setTimeout(() => { w.print(); w.close() }, 300)
  }

  const filtered = orders.filter(o => {
    if (filter === 'active') return !['delivered','cancelled'].includes(o.status)
    if (filter === 'delivered') return o.status === 'delivered'
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Live Orders</h2>
        <button onClick={loadOrders} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>Refresh</button>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([val,label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ flex:1, padding:'8px 4px', background:filter===val?'var(--ink)':'#fff', color:filter===val?'#fff':'var(--ink)', border:'1.5px solid', borderColor:filter===val?'var(--ink)':'var(--line)', borderRadius:10, fontSize:13, fontWeight:700 }}>{label}</button>
        ))}
      </div>
      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading orders...</div>
      : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No orders yet</div>
          <div style={{ color:'var(--ink2)', fontSize:13, marginTop:4 }}>Orders from guests will appear here instantly</div>
        </div>
      ) : filtered.map(order => (
        <div key={order.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(STATUS_COLORS[order.status]||'#999') }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800 }}>Table {order.tables?.table_number}</div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>{new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}</div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
              <div style={{ background:(STATUS_COLORS[order.status]||'#999')+'20', color:STATUS_COLORS[order.status]||'#999', fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:999 }}>{STATUS_LABELS[order.status]}</div>
              <button onClick={() => printKOT(order)} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:600, color:'var(--ink2)' }}>🖨 Print KOT</button>
            </div>
          </div>
          <div style={{ borderTop:'1px solid var(--line)', paddingTop:12, marginBottom:12 }}>
            {order.order_items?.map((oi,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:14 }}>
                <span style={{ fontWeight:600 }}>{oi.menu_items?.name} {oi.menu_items?.is_live_counter && <span style={{ fontSize:11, color:'#D97706' }}>Live</span>}</span>
                <span style={{ fontWeight:800, color:'var(--ink2)' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {STATUS_FLOW[order.status] && <button onClick={() => updateStatus(order)} style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px 8px', fontSize:14, fontWeight:800 }}>{STATUS_NEXT_LABEL[order.status]} →</button>}
            {['pending','in_preparation'].includes(order.status) && <button onClick={() => cancelOrder(order.id)} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:12, padding:'12px 14px', fontSize:13, fontWeight:700 }}>Cancel</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
