import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_LABELS = { pending:'New Order', placed:'New Order', in_progress:'In Progress', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }

export default function KOTDashboard({ eventData, onOrderCountChange, onNewOrder }) {
  const [orders, setOrders] = useState([])
  const [waiters, setWaiters] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  const [waiterFilter, setWaiterFilter] = useState(null)
  const [tableFilter, setTableFilter] = useState(null) // table number to filter
  const [now, setNow] = useState(Date.now())
  const prevCount = useRef(-1)
  const audioEnabled = useRef(false)

  // Tick every second for live timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

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

  function formatTimer(assignedAt) {
    if (!assignedAt) return null
    const secs = Math.floor((Date.now() - new Date(assignedAt).getTime()) / 1000)
    const m = Math.floor(secs/60)
    const s = secs % 60
    return { str: m + ':' + String(s).padStart(2,'0'), mins: m, secs }
  }

  async function loadOrders(showSpinner = false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders')
      .select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name), assigned_at')
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
      waiter_id: waiterId || null,
      assigned_at: waiterId ? new Date().toISOString() : null
    }).eq('id', orderId)
    // Also upsert to food_master when marking in progress
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
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>KOT ${orderId}</title>
<style>body{font-family:'Courier New',monospace;font-size:13px;padding:16px;width:280px;margin:0 auto;color:#000}.app{font-size:15px;font-weight:bold;text-align:center;text-transform:uppercase;letter-spacing:1px}.event{font-size:12px;text-align:center;margin-bottom:6px;font-weight:bold}.divider{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}.table-num{font-size:26px;font-weight:900;text-align:center;border:2px solid #000;padding:6px;margin:8px 0;letter-spacing:3px}.waiter{text-align:center;font-size:14px;font-weight:bold;border:1px solid #000;padding:4px;margin:6px 0}.item{font-size:13px;padding:3px 0}.status{text-align:center;border:1px solid #000;padding:5px;font-weight:bold;text-transform:uppercase;font-size:12px;margin-top:8px}.footer{text-align:center;font-size:10px;color:#666;margin-top:10px}</style>
</head><body>
<div class="app">Janu's Smart Serve</div>
<div class="event">${eventName}</div>
<div class="divider"></div>
<div class="row"><span>Date:</span><span>${dateStr}</span></div>
<div class="row"><span>Time:</span><span>${timeStr}</span></div>
<div class="row"><span>Order:</span><span>${orderId}</span></div>
<div class="divider"></div>
<div class="table-num">TABLE ${tableNum}</div>
<div class="waiter">Waiter: ${waiterName}</div>
<div class="divider"></div>
${(order.order_items||[]).map(i=>`<div class="item">• ${i.menu_items?.name} x${i.quantity}${i.menu_items?.is_live_counter?' [Live]':''}</div>`).join('')}
<div class="divider"></div>
<div class="status">In Progress</div>
<div class="footer">Powered by Janu's Smart Serve</div>
</body></html>`)
    w.document.close(); w.focus(); setTimeout(()=>{ w.print(); w.close() },300)
  }

  // Available waiters = not assigned to any in_progress order
  const busyWaiterIds = orders.filter(o=>o.status==='in_progress' && o.waiter_id).map(o=>o.waiter_id)
  const busyWaiters = waiters.filter(w => busyWaiterIds.includes(w.id))

  // Sequential/round-robin: sort available waiters by how many total orders they've done
  // Waiter with fewest completed orders goes first — ensures fair distribution
  const waiterOrderCount = {}
  waiters.forEach(w => { waiterOrderCount[w.id] = 0 })
  orders.forEach(o => { if (o.waiter_id && waiterOrderCount[o.waiter_id] !== undefined) waiterOrderCount[o.waiter_id]++ })
  const availableWaiters = waiters
    .filter(w => !busyWaiterIds.includes(w.id))
    .sort((a,b) => (waiterOrderCount[a.id]||0) - (waiterOrderCount[b.id]||0))

  const filtered = orders.filter(o => {
    const matchFilter = filter==='active' ? !['delivered','cancelled'].includes(o.status) : filter==='delivered' ? o.status==='delivered' : true
    const matchWaiter = !waiterFilter || o.waiter_id===waiterFilter
    const matchTable = !tableFilter || o.tables?.table_number===tableFilter
    return matchFilter && matchWaiter && matchTable
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
                <div key={w.id} onClick={()=>setWaiterFilter(waiterFilter===w.id?null:w.id)}
                  style={{ background: waiterFilter===w.id?'#1A0A0A':busy?'#FEF2F2':'#F0FDF4', border:'2px solid', borderColor:waiterFilter===w.id?'#E8890C':busy?'#FECACA':'#BBF7D0', borderRadius:10, padding:'6px 12px', fontSize:12, cursor:'pointer', transition:'all 0.15s' }}>
                  <span style={{ fontWeight:800, color:waiterFilter===w.id?'#E8890C':busy?'#DC2626':'#16A34A' }}>{w.name}</span>
                  {busy && assignedOrder && <span style={{ color:waiterFilter===w.id?'rgba(255,255,255,0.6)':'#888', marginLeft:6 }}>→ T{assignedOrder.tables?.table_number}</span>}
                  <span style={{ marginLeft:6, fontSize:11 }}>{busy?'🔴 Busy':'🟢 Free'}</span>
                  {waiterFilter===w.id && <span style={{ marginLeft:6, fontSize:10, color:'#E8890C', fontWeight:800 }}>● Filtered</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table + Waiter filter indicators */}
      {(waiterFilter || tableFilter) && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'8px 14px', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
          <span style={{ fontWeight:700, color:'#92400E' }}>
            🔍 {waiterFilter && <>Waiter: {waiters.find(w=>w.id===waiterFilter)?.name}</>}
            {waiterFilter && tableFilter && <span> · </span>}
            {tableFilter && <>Table: {tableFilter}</>}
          </span>
          <button onClick={()=>{ setWaiterFilter(null); setTableFilter(null) }} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer', fontSize:13 }}>Clear All ✕</button>
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
            <div style={{ flex:1 }}>
              {/* Top row: Table + Timer side by side */}
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                {/* Clickable table number */}
                <button onClick={()=>setTableFilter(tableFilter===order.tables?.table_number?null:order.tables?.table_number)}
                  style={{ fontSize:22, fontWeight:900, background: tableFilter===order.tables?.table_number?'#1A0A0A':'transparent', color:tableFilter===order.tables?.table_number?'#E8890C':'#1A1A1A', border:'none', padding:tableFilter===order.tables?.table_number?'2px 10px':'0', borderRadius:8, cursor:'pointer', lineHeight:1 }}>
                  Table {order.tables?.table_number}
                </button>
                {/* Timer inline */}
                {order.status==='in_progress' && order.assigned_at && (() => {
                  const t = formatTimer(order.assigned_at)
                  if (!t) return null
                  const bg = t.mins>=15?'#FEF2F2':t.mins>=10?'#FEF3C7':'#F0FDF4'
                  const col = t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A'
                  const bord = t.mins>=15?'#FECACA':t.mins>=10?'#FCD34D':'#BBF7D0'
                  return (
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:bg, border:'2px solid '+bord, borderRadius:10, padding:'5px 14px' }}>
                      <span style={{ fontSize:16 }}>⏱</span>
                      <span style={{ fontSize:24, fontWeight:900, color:col, fontVariantNumeric:'tabular-nums' }}>{t.str}</span>
                      {t.mins>=15 && <span style={{ fontSize:11, background:'#DC2626', color:'#fff', padding:'1px 7px', borderRadius:999, fontWeight:700 }}>⚠️ Slow</span>}
                      {t.mins>=10 && t.mins<15 && <span style={{ fontSize:11, color:'#D97706', fontWeight:700 }}>Check</span>}
                    </div>
                  )
                })()}
              </div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:4 }}>
                {new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}
              </div>
              {/* Clickable waiter name */}
              {order.waiters?.name && (
                <button onClick={()=>setWaiterFilter(waiterFilter===order.waiter_id?null:order.waiter_id)}
                  style={{ fontSize:14, fontWeight:800, color: waiterFilter===order.waiter_id?'#fff':'#2563EB', background: waiterFilter===order.waiter_id?'#2563EB':'#EFF6FF', border:'none', borderRadius:8, padding:'3px 12px', marginTop:4, cursor:'pointer' }}>
                  👤 {order.waiters.name} {waiterFilter===order.waiter_id?'✕':''}
                </button>
              )}
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
          {['pending','placed'].includes(order.status) && (
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:6 }}>
                Assign Waiter {availableWaiters.length === 0 && waiters.length > 0 ? <span style={{ color:'#DC2626' }}>— All waiters busy</span> : ''}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                {availableWaiters.map((w, idx) => (
                  <button key={w.id} onClick={()=>assignWaiter(order.id, w.id)} disabled={assigning===order.id}
                    style={{ background: idx===0?'#16A34A':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', position:'relative' }}>
                    {idx===0 && <span style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background:'#E8890C', color:'#fff', fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:999, whiteSpace:'nowrap' }}>Suggested</span>}
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
            {['pending','placed'].includes(order.status) && (
              <button onClick={()=>cancelOrder(order.id)} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:12, padding:'12px 14px', fontSize:13, fontWeight:700 }}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
