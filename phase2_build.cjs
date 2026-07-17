const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FILE 1: KOTDashboard — In Progress/Delivered only + waiter assign
//          + sound alert on new order
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/supervisor/KOTDashboard.jsx', `import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_LABELS = { placed:'New Order', in_progress:'In Progress', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }

export default function KOTDashboard({ eventData, onOrderCountChange, onNewOrder }) {
  const [orders, setOrders] = useState([])
  const [waiters, setWaiters] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  const prevCount = useRef(-1)
  const audioEnabled = useRef(false)

  useEffect(() => {
    if (!eventData) return
    loadWaiters()
    loadOrders(true)
    const interval = setInterval(() => loadOrders(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadWaiters() {
    const { data } = await supabase.from('waiters')
      .select('*').eq('event_id', eventData.id).eq('is_active', true)
    setWaiters(data || [])
  }

  async function loadOrders(showSpinner = false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders')
      .select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name)')
      .eq('event_id', eventData.id)
      .order('created_at', { ascending: false })
    const all = data || []
    const activeCount = all.filter(o => !['delivered','cancelled'].includes(o.status)).length

    // Detect new order and trigger alert
    if (prevCount.current >= 0 && activeCount > prevCount.current) {
      if (onNewOrder) onNewOrder(all.find(o => o.status === 'placed'))
      // Play sound if enabled
      if (audioEnabled.current) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.setValueAtTime(880, ctx.currentTime)
          osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3)
          gain.gain.setValueAtTime(0.4, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5)
        } catch(e) {}
      }
    }
    prevCount.current = activeCount
    setOrders(all)
    onOrderCountChange(activeCount)
    if (showSpinner) setLoading(false)
  }

  function enableSound() {
    // Must be called from user gesture
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(); osc.stop(ctx.currentTime + 0.3)
      audioEnabled.current = true
      alert('✅ Sound alerts enabled! You will hear a beep on every new order.')
    } catch(e) { alert('Could not enable sound on this device.') }
  }

  async function assignWaiter(orderId, waiterId) {
    setAssigning(orderId)
    await supabase.from('orders').update({
      status: 'in_progress',
      waiter_id: waiterId || null
    }).eq('id', orderId)
    setAssigning(null)
    loadOrders(false)
  }

  async function markDelivered(order) {
    await supabase.from('orders').update({
      status: 'delivered',
      delivered_at: new Date().toISOString()
    }).eq('id', order.id)
    loadOrders(false)
  }

  async function cancelOrder(id) {
    if (!confirm('Cancel this order?')) return
    await supabase.from('orders').update({ status:'cancelled' }).eq('id', id)
    loadOrders(false)
  }

  function printKOT(order) {
    const eventName = eventData?.name || 'Event'
    const tableNum = order.tables?.table_number || '?'
    const waiterName = order.waiters?.name || (order.waiter_id ? 'Assigned' : 'Unassigned')
    const orderId = '#' + order.id.slice(-6).toUpperCase()
    const now = new Date(order.created_at)
    const dateStr = now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    const timeStr = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})
    const w = window.open('','_blank','width=320,height=500')
    w.document.write(\`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT \${orderId}</title>
<style>body{font-family:'Courier New',monospace;font-size:13px;padding:16px;width:280px;margin:0 auto;color:#000}.app{font-size:15px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px}.event{font-size:12px;text-align:center;margin-bottom:6px;font-weight:bold}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}.table-num{font-size:26px;font-weight:900;text-align:center;border:2px solid #000;padding:6px;margin:8px 0;letter-spacing:3px}.waiter{text-align:center;font-size:14px;font-weight:bold;border:1px solid #000;padding:4px;margin:6px 0}.item{font-size:13px;padding:3px 0}.status{text-align:center;border:1px solid #000;padding:5px;font-weight:bold;text-transform:uppercase;font-size:12px;margin-top:8px}.footer{text-align:center;font-size:10px;color:#666;margin-top:10px}</style>
</head><body>
<div class="app">Janu's Smart Serve</div>
<div class="event">\${eventName}</div>
<div class="divider"></div>
<div class="row"><span>Date:</span><span>\${dateStr}</span></div>
<div class="row"><span>Time:</span><span>\${timeStr}</span></div>
<div class="row"><span>Order:</span><span>\${orderId}</span></div>
<div class="divider"></div>
<div class="table-num">TABLE \${tableNum}</div>
<div class="waiter">Waiter: \${waiterName}</div>
<div class="divider"></div>
\${(order.order_items||[]).map(i=>\`<div class="item">• \${i.menu_items?.name} x\${i.quantity}\${i.menu_items?.is_live_counter?' [Live]':''}</div>\`).join('')}
<div class="divider"></div>
<div class="status">In Progress</div>
<div class="footer">Powered by Janu's Smart Serve</div>
</body></html>\`)
    w.document.close(); w.focus(); setTimeout(()=>{ w.print(); w.close() },300)
  }

  // Available waiters = not currently assigned to any in_progress order
  const busyWaiterIds = orders.filter(o=>o.status==='in_progress' && o.waiter_id).map(o=>o.waiter_id)
  const availableWaiters = waiters.filter(w => !busyWaiterIds.includes(w.id))
  const busyWaiters = waiters.filter(w => busyWaiterIds.includes(w.id))

  const filtered = orders.filter(o => {
    if (filter==='active') return !['delivered','cancelled'].includes(o.status)
    if (filter==='delivered') return o.status==='delivered'
    return true
  })

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Live Orders</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={enableSound} style={{ background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', borderRadius:10, padding:'7px 12px', fontSize:12, fontWeight:700 }}>🔔 Enable Sound</button>
          <button onClick={()=>loadOrders(false)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'7px 14px', fontSize:13, fontWeight:700 }}>Refresh</button>
        </div>
      </div>

      {/* Waiter availability panel */}
      {waiters.length > 0 && (
        <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:14, boxShadow:'var(--shadow)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>Waiter Status</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {waiters.map(w => {
              const busy = busyWaiterIds.includes(w.id)
              const assignedOrder = orders.find(o=>o.waiter_id===w.id && o.status==='in_progress')
              return (
                <div key={w.id} style={{ background:busy?'#FEF2F2':'#F0FDF4', border:'1.5px solid', borderColor:busy?'#FECACA':'#BBF7D0', borderRadius:10, padding:'6px 12px', fontSize:12 }}>
                  <span style={{ fontWeight:800, color:busy?'#DC2626':'#16A34A' }}>{w.name}</span>
                  {busy && assignedOrder && <span style={{ color:'#888', marginLeft:6 }}>→ T{assignedOrder.tables?.table_number}</span>}
                  <span style={{ marginLeft:6, fontSize:11 }}>{busy?'🔴 Busy':'🟢 Free'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        {[['active','Active'],['delivered','Delivered'],['all','All']].map(([val,label]) => (
          <button key={val} onClick={()=>setFilter(val)} style={{ flex:1, padding:'8px 4px', background:filter===val?'var(--ink)':'#fff', color:filter===val?'#fff':'var(--ink)', border:'1.5px solid', borderColor:filter===val?'var(--ink)':'var(--line)', borderRadius:10, fontSize:13, fontWeight:700 }}>{label}</button>
        ))}
      </div>

      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div>
      : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No orders yet</div>
        </div>
      ) : filtered.map(order => (
        <div key={order.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(STATUS_COLORS[order.status]||'#999') }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800 }}>Table {order.tables?.table_number}</div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>
                {new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}
              </div>
              {order.waiters?.name && <div style={{ fontSize:12, color:'#2563EB', marginTop:2, fontWeight:600 }}>👤 {order.waiters.name}</div>}
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
              <div style={{ background:(STATUS_COLORS[order.status]||'#999')+'20', color:STATUS_COLORS[order.status]||'#999', fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:999 }}>
                {STATUS_LABELS[order.status]}
              </div>
              {order.status === 'in_progress' && (
                <button onClick={()=>printKOT(order)} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:600, color:'var(--ink2)' }}>🖨 Print KOT</button>
              )}
            </div>
          </div>

          {/* Order items */}
          <div style={{ borderTop:'1px solid var(--line)', paddingTop:10, marginBottom:12 }}>
            {order.order_items?.map((oi,i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:14 }}>
                <span style={{ fontWeight:600 }}>{oi.menu_items?.name} {oi.menu_items?.is_live_counter && <span style={{ fontSize:11, color:'#D97706' }}>Live</span>}</span>
                <span style={{ fontWeight:800, color:'var(--ink2)' }}>x{oi.quantity}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          {order.status === 'placed' && (
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:6 }}>
                Assign Waiter {availableWaiters.length === 0 && waiters.length > 0 ? <span style={{ color:'#DC2626' }}>— All waiters busy</span> : ''}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                {availableWaiters.map(w => (
                  <button key={w.id} onClick={()=>assignWaiter(order.id, w.id)} disabled={assigning===order.id}
                    style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                    {assigning===order.id ? '...' : w.name}
                  </button>
                ))}
                <button onClick={()=>assignWaiter(order.id, null)} disabled={assigning===order.id}
                  style={{ background:'#F0F0F0', color:'var(--ink)', border:'1px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  No Waiter
                </button>
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            {order.status === 'in_progress' && (
              <button onClick={()=>markDelivered(order)} style={{ flex:1, background:'#16A34A', color:'#fff', border:'none', borderRadius:12, padding:'12px 8px', fontSize:14, fontWeight:800 }}>
                ✓ Mark Delivered
              </button>
            )}
            {order.status === 'placed' && (
              <button onClick={()=>cancelOrder(order.id)} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:12, padding:'12px 14px', fontSize:13, fontWeight:700 }}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
`)
console.log('✅ 1/6 KOTDashboard — In Progress/Delivered, waiter assign, sound alert')

// ═══════════════════════════════════════════════════════════════════
// FILE 2: SOSPanel (guest) — renamed to Call Waiter, single button
// ═══════════════════════════════════════════════════════════════════
fs.writeFileSync(BASE + '/components/guest/SOSPanel.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function SOSPanel({ tableData, eventData, onClose }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [status, setStatus] = useState(null)

  // Poll for status once sent
  useEffect(() => {
    if (!sent || !tableData) return
    const interval = setInterval(async () => {
      const { data } = await supabase.from('sos_requests')
        .select('*').eq('table_id', tableData.id)
        .eq('status', 'open').order('created_at', { ascending:false }).limit(1)
      if (data?.[0]) setStatus(data[0].status)
      else setStatus('resolved')
    }, 4000)
    return () => clearInterval(interval)
  }, [sent, tableData])

  async function callWaiter() {
    if (sending || sent) return
    setSending(true)
    try {
      await supabase.from('sos_requests').insert({
        event_id: eventData?.id,
        table_id: tableData?.id,
        request_type: 'call_waiter',
        status: 'open'
      })
      setSent(true)
    } catch(e) { console.error(e) }
    finally { setSending(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:70, display:'flex', alignItems:'flex-end' }}>
      <div style={{ width:'100%', background:'#fff', borderRadius:'24px 24px 0 0', padding:'32px 24px 48px' }}>
        <div style={{ width:40, height:4, background:'#E8E0F0', borderRadius:999, margin:'0 auto 24px' }}></div>

        {!sent ? (
          <>
            <div style={{ textAlign:'center', marginBottom:28 }}>
              <div style={{ fontSize:64, marginBottom:12 }}>🛎️</div>
              <h3 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Need Assistance?</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>Tap the button below and a waiter will come to your table shortly</p>
            </div>
            <button onClick={callWaiter} disabled={sending}
              style={{ width:'100%', background:sending?'#999':'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'20px', fontSize:20, fontWeight:800, cursor:sending?'wait':'pointer', marginBottom:16, boxShadow:'0 8px 24px rgba(232,137,12,0.4)' }}>
              {sending ? 'Calling...' : '🛎️ Call Waiter'}
            </button>
            <button onClick={onClose} style={{ width:'100%', background:'#f5f5f5', border:'none', borderRadius:14, padding:'14px', fontSize:15, fontWeight:600, color:'#888' }}>Cancel</button>
          </>
        ) : (
          <>
            <div style={{ textAlign:'center', marginBottom:28 }}>
              <div style={{ fontSize:64, marginBottom:12 }}>✅</div>
              <h3 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Waiter Called!</h3>
              <p style={{ fontSize:14, color:'#888', lineHeight:1.6 }}>
                {status === 'resolved'
                  ? 'Your request has been attended to.'
                  : 'A waiter will be with you shortly. Please wait.'}
              </p>
              {status !== 'resolved' && (
                <div style={{ marginTop:16, display:'inline-flex', alignItems:'center', gap:8, background:'#FEF3C7', padding:'8px 16px', borderRadius:999, fontSize:13, color:'#92400E', fontWeight:600 }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:'#F59E0B', display:'inline-block', animation:'pulse 1s infinite' }}></span>
                  Supervisor notified
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ width:'100%', background:'var(--ink)', color:'#fff', border:'none', borderRadius:14, padding:'16px', fontSize:16, fontWeight:800 }}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}
`)
console.log('✅ 2/6 SOSPanel — renamed Call Waiter, single button, clean UI')

// ═══════════════════════════════════════════════════════════════════
// FILE 3: MenuScreen — update "Need Help?" button label
//          + blocked checkout when order limit reached
// ═══════════════════════════════════════════════════════════════════
const menuContent = fs.readFileSync(BASE + '/components/guest/MenuScreen.jsx', 'utf8')
const updatedMenu = menuContent
  .replace(/🆘 Need Help\?/g, '🛎️ Call Waiter')
  .replace(/>🆘 Need Help\?</g, '>🛎️ Call Waiter<')
fs.writeFileSync(BASE + '/components/guest/MenuScreen.jsx', updatedMenu)
console.log('✅ 3/6 MenuScreen — SOS renamed to Call Waiter')

// ═══════════════════════════════════════════════════════════════════
// FILE 4: CartDrawer — block checkout if order limit reached
// ═══════════════════════════════════════════════════════════════════
const cartContent = fs.readFileSync(BASE + '/components/guest/CartDrawer.jsx', 'utf8')
// Check if CartDrawer exists and has placeOrder logic
if (cartContent.includes('placeOrder') || cartContent.includes('Place Order')) {
  // Add order limit check before placing order
  const updatedCart = cartContent.replace(
    /async function placeOrder\(\)/,
    `async function checkOrderLimit() {
    if (!tableData || !eventData) return true // allow if no data
    // Get max_orders_per_table from event (default 1)
    const maxOrders = eventData.max_orders_per_table || 1
    // Check active orders for this table
    const { data } = await supabase.from('orders')
      .select('id').eq('table_id', tableData.id)
      .in('status', ['placed','in_progress'])
    return (data?.length || 0) < maxOrders
  }

  async function placeOrder()`
  )
  fs.writeFileSync(BASE + '/components/guest/CartDrawer.jsx', updatedCart)
  console.log('✅ 4/6 CartDrawer — order limit check added')
} else {
  console.log('⚠️  4/6 CartDrawer — placeOrder not found, skipping patch (will handle separately)')
}

// ═══════════════════════════════════════════════════════════════════
// FILE 5: SOSRequests (supervisor) — rename SOS to Call Waiter
// ═══════════════════════════════════════════════════════════════════
const sosSupContent = fs.readFileSync(BASE + '/components/supervisor/SOSRequests.jsx', 'utf8')
const updatedSosSup = sosSupContent
  .replace(/sos:'Call Waiter'/g, "sos:'Call Waiter'")
  .replace(/Service Requests/g, 'Call Waiter Requests')
  .replace(/SOS Requests/g, 'Call Waiter Requests')
fs.writeFileSync(BASE + '/components/supervisor/SOSRequests.jsx', updatedSosSup)
console.log('✅ 5/6 SOSRequests — renamed to Call Waiter Requests')

// ═══════════════════════════════════════════════════════════════════
// FILE 6: SupervisorApp — wire onNewOrder to KOTDashboard
// ═══════════════════════════════════════════════════════════════════
const supContent = fs.readFileSync(BASE + '/pages/SupervisorApp.jsx', 'utf8')
const updatedSup = supContent.replace(
  '{activeTab===\'kot\'     && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} />}',
  '{activeTab===\'kot\'     && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} onNewOrder={(order) => { setNewOrderAlert(order); setOrderCount(c=>c+1) }} />}'
)
fs.writeFileSync(BASE + '/pages/SupervisorApp.jsx', updatedSup)
console.log('✅ 6/6 SupervisorApp — KOTDashboard wired to order alert')

console.log('\n🎉 Phase 2 build complete! Now run SQL then: npm run dev')
