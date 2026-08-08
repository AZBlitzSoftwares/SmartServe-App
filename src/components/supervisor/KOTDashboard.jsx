import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const STATUS_LABELS = { pending:'Order Received', placed:'Order Received', in_progress:'Waiter On The Way', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }

export default function KOTDashboard({ eventData, onOrderCountChange, onNewOrder }) {
  const [orders, setOrders] = useState([])
  const [sosRequests, setSosRequests] = useState([])
  const [waiters, setWaiters] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  const [showCancelDialog, setShowCancelDialog] = useState(null) // order id being cancelled
  const [cancelReason, setCancelReason] = useState('')
  const [cancelCustomReason, setCancelCustomReason] = useState('')
  const [waiterFilter, setWaiterFilter] = useState(null)
  const [tableFilter, setTableFilter] = useState(null)
  const [now, setNow] = useState(Date.now())
  const prevCount = useRef(-1)
  const audioEnabled = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  useEffect(() => {
    if (!eventData) return
    loadWaiters(); loadOrders(true); loadSOS()
    const interval = setInterval(() => { loadOrders(false); loadSOS() }, 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadWaiters() {
    const { data } = await supabase.from('waiters').select('*').eq('event_id', eventData.id).eq('is_active', true)
    setWaiters(data || [])
  }

  async function loadSOS() {
    if (!eventData) return
    const { data } = await supabase.from('sos_requests')
      .select('*, tables(table_number), sos_request_items(item_name, quantity)').eq('event_id', eventData.id)
      // No filters at all. Every request of every type and status belongs
      // here - the tabs below decide what is shown. Filtering at the query
      // is what made resolved and cancelled requests invisible.

      .order('created_at', { ascending: false })
    setSosRequests(data || [])
  }

  function formatTimer(assignedAt) {
    if (!assignedAt) return null
    const secs = Math.floor((Date.now() - new Date(assignedAt).getTime()) / 1000)
    const m = Math.floor(secs/60), s = secs % 60
    return { str: m + ':' + String(s).padStart(2,'0'), mins: m }
  }

  async function loadOrders(showSpinner = false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('orders')
      .select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name), assigned_at')
      .eq('event_id', eventData.id).order('created_at', { ascending: false })
    const all = data || []
    const activeCount = all.filter(o => !['delivered','cancelled'].includes(o.status)).length
    if (prevCount.current >= 0 && activeCount > prevCount.current) {
      if (onNewOrder) onNewOrder(all.find(o => o.status === 'placed'))
      if (audioEnabled.current) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          const osc = ctx.createOscillator(), gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.setValueAtTime(880, ctx.currentTime); osc.frequency.setValueAtTime(660, ctx.currentTime+0.15); osc.frequency.setValueAtTime(880, ctx.currentTime+0.3)
          gain.gain.setValueAtTime(0.4, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.5)
          osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.5)
        } catch(e) {}
      }
    }
    prevCount.current = activeCount; setOrders(all); onOrderCountChange(activeCount)
    if (showSpinner) setLoading(false)
  }

  function enableSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880; gain.gain.setValueAtTime(0.2, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.3)
      osc.start(); osc.stop(ctx.currentTime+0.3)
      audioEnabled.current = true; alert('✅ Sound alerts enabled!')
    } catch(e) { alert('Could not enable sound on this device.') }
  }

  async function assignWaiter(orderId, waiterId) {
    setAssigning(orderId)
    await supabase.from('orders').update({ status:'in_progress', waiter_id:waiterId||null, assigned_at:waiterId?new Date().toISOString():null }).eq('id', orderId)
    setAssigning(null); loadOrders(false)

    // Auto-print the KOT the moment a waiter is assigned. The manual
    // "Print KOT" button stays available for reprints, printer outages,
    // network drops or power cuts - nothing about it changes.
    if (waiterId) {
      try {
        const { data: fresh } = await supabase.from('orders')
          .select('*, tables(table_number), waiters(name), order_items(quantity, menu_items(name, is_veg))')
          .eq('id', orderId).single()
        if (fresh) setTimeout(() => printKOT(fresh), 300)
      } catch (e) { /* never block assignment if printing fails */ }
    }
  }

  // Cancelling and resolving are different outcomes and must not share a
  // button - closing a dropped request as 'resolved' makes the reports lie.
  async function cancelSOSRequest(sosId) {
    if (!window.confirm('Cancel this help request?')) return
    await supabase.from('sos_requests').update({ status:'cancelled' }).eq('id', sosId)
    loadSOS()
  }

  async function assignSOSWaiter(sosId, waiterId) {
    setAssigning('sos-'+sosId)
    await supabase.from('sos_requests').update({ status:'in_progress', waiter_id:waiterId||null, assigned_at:waiterId?new Date().toISOString():null }).eq('id', sosId)
    setAssigning(null); loadSOS()

    // Help requests auto-print exactly like orders do, so the waiter
    // walks over already knowing what to carry.
    if (waiterId) {
      try {
        const { data: fresh } = await supabase.from('sos_requests')
          .select('*, tables(table_number), waiters(name), sos_request_items(item_name, quantity)')
          .eq('id', sosId).single()
        if (fresh) setTimeout(() => printHelpKOT(fresh), 300)
      } catch (e) { /* never block assignment if printing fails */ }
    }
  }

  // Reshape a help request into the object printKOT already understands,
  // so both slips come off one code path and cannot drift apart.
  function printHelpKOT(sos) {
    const lines = (sos.sos_request_items || []).length
      ? sos.sos_request_items
      : [{ item_name:'Help Request', quantity:1 }]
    printKOT({
      id: sos.id,
      created_at: sos.created_at,
      tables: sos.tables,
      waiters: sos.waiters,
      order_items: lines.map(li => ({
        quantity: li.quantity,
        menu_items: { name: li.item_name }
      }))
    }, true)
  }

  async function markDelivered(order) {
    await supabase.from('orders').update({ status:'delivered', delivered_at:new Date().toISOString() }).eq('id', order.id)
    loadOrders(false)
  }

  async function resolveSOSRequest(sosId) {
    await supabase.from('sos_requests').update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', sosId)
    loadSOS()
  }

  async function cancelOrder(id) {
    setShowCancelDialog(id)
    setCancelReason('')
    setCancelCustomReason('')
  }

  async function confirmCancel() {
    if (!showCancelDialog) return
    const reason = cancelReason === 'other' ? cancelCustomReason.trim() : cancelReason
    if (!reason) { alert('Please select or enter a reason for cancellation.'); return }
    await supabase.from('orders').update({
      status: 'cancelled',
      cancel_reason: reason
    }).eq('id', showCancelDialog)
    setShowCancelDialog(null)
    setCancelReason('')
    setCancelCustomReason('')
    loadOrders(false)
  }

  // isHelp only swaps the "Order:" label for "Help:". The slip layout,
  // width and margins are deliberately identical so the printer setup
  // and the waiters' habits stay unchanged.
  function printKOT(order, isHelp) {
    const eventName = eventData?.name || 'Event'
    const tableNum = order.tables?.table_number || '?'
    const waiterName = order.waiters?.name || (order.waiter_id ? 'Assigned' : 'Unassigned')
    const orderId = '#' + order.id.slice(-6).toUpperCase()
    const d = new Date(order.created_at)
    const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
    const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})

    // Epson TM-m30III — 58mm printable area, 4mm margins each side
    const w = window.open('','_blank','width=400,height=600')
    w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>KOT ${orderId}</title>
<style>
  @page {
    size: 80mm auto;
    margin: 3mm 4mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt;
    font-weight: bold;
    width: 100%;
    margin: 0;
    padding: 0;
    color: #000000;
    background: #ffffff;
  }
  .app-name {
    font-size: 11pt;
    font-weight: 900;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 1mm;
    color: #000000;
  }
  .event-name {
    font-size: 10pt;
    font-weight: 900;
    text-align: center;
    margin-bottom: 2mm;
    color: #000000;
    word-break: break-word;
  }
  .divider {
    border: none;
    border-top: 1.5px solid #000000;
    margin: 1.5mm 0;
  }
  .divider-dash {
    border: none;
    border-top: 1px dashed #000000;
    margin: 1.5mm 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    font-size: 9.5pt;
    font-weight: bold;
    margin: 0.8mm 0;
    color: #000000;
  }
  .row span:first-child {
    min-width: 14mm;
  }
  .table-box {
    border: 2.5px solid #000000;
    text-align: center;
    padding: 1.5mm;
    margin: 2mm 0;
  }
  .table-label {
    font-size: 10pt;
    font-weight: 900;
    letter-spacing: 2px;
    color: #000000;
  }
  .table-num {
    font-size: 24pt;
    font-weight: 900;
    line-height: 1.1;
    color: #000000;
  }
  .waiter-box {
    border: 1.5px solid #000000;
    text-align: center;
    padding: 1.5mm;
    margin: 1.5mm 0;
    font-size: 10pt;
    font-weight: 900;
    color: #000000;
  }
  .item-row {
    font-size: 10pt;
    font-weight: 900;
    padding: 1mm 0;
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dashed #000000;
    color: #000000;
    word-break: break-word;
  }
  .item-name {
    flex: 1;
    padding-right: 2mm;
  }
  .item-qty {
    font-weight: 900;
    white-space: nowrap;
    color: #000000;
  }
  .item-tag {
    font-size: 8pt;
    font-weight: 900;
    background: #000000;
    color: #ffffff;
    padding: 0 1.5mm;
    margin-left: 1mm;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    font-weight: 900;
    font-size: 11pt;
    margin-top: 1.5mm;
    padding-top: 1mm;
    border-top: 1.5px solid #000000;
    color: #000000;
  }
  .footer {
    text-align: center;
    font-size: 9pt;
    font-weight: bold;
    color: #000000;
    margin-top: 2mm;
  }
</style>
</head>
<body>
<div class="app-name">Janu's Smart Serve</div>
<div class="event-name">${eventName}</div>
<hr class="divider"/>
<div class="row"><span>Date:</span><span>${dateStr}</span></div>
<div class="row"><span>Time:</span><span>${timeStr}</span></div>
<div class="row"><span>${isHelp ? 'Help' : 'Order'}:</span><span>${orderId}</span></div>
<hr class="divider-dash"/>
<div class="table-box">
  <div class="table-label">TABLE</div>
  <div class="table-num">${tableNum}</div>
</div>
<div class="waiter-box">Waiter: ${waiterName}</div>
<hr class="divider"/>
${(order.order_items||[]).map(i => `
<div class="item-row">
  <span class="item-name">${i.menu_items?.name||'Item'}${i.menu_items?.is_live_counter ? '<span class=\"item-tag\">LIVE</span>' : ''}</span>
  <span class="item-qty">x${i.quantity}</span>
</div>`).join('')}
<hr class="divider"/>
<div class="total-row">
  <span>Total Items</span>
  <span>${(order.order_items||[]).reduce((s,i)=>s+i.quantity,0)}</span>
</div>
<div class="footer">-- Janu's Smart Serve --</div>
</body>
</html>`)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print(); w.close() }, 500)
  }

  // Waiters busy on orders OR on active SOS requests
  const busyWaiterIds = [
    ...orders.filter(o=>o.status==='in_progress'&&o.waiter_id).map(o=>o.waiter_id),
    ...sosRequests.filter(s=>s.status==='in_progress'&&s.waiter_id).map(s=>s.waiter_id)
  ].filter(Boolean)
  const waiterOrderCount = {}
  waiters.forEach(w => { waiterOrderCount[w.id] = 0 })
  orders.forEach(o => { if (o.waiter_id && waiterOrderCount[o.waiter_id]!==undefined) waiterOrderCount[o.waiter_id]++ })
  const availableWaiters = waiters.filter(w=>!busyWaiterIds.includes(w.id)).sort((a,b)=>(waiterOrderCount[a.id]||0)-(waiterOrderCount[b.id]||0))

  const filteredOrders = orders.filter(o => {
    const matchFilter = filter==='active'?!['delivered','cancelled'].includes(o.status):filter==='delivered'?o.status==='delivered':filter==='cancelled'?o.status==='cancelled':true
    const matchWaiter = !waiterFilter||o.waiter_id===waiterFilter
    const matchTable = !tableFilter||o.tables?.table_number===tableFilter
    return matchFilter&&matchWaiter&&matchTable
  })

  // Help requests follow the same tab rules as orders, so a supervisor can
  // look back at what was handled instead of only what is outstanding.
  const filteredSOS = sosRequests.filter(r => {
    if (tableFilter && r.tables?.table_number !== tableFilter) return false
    if (filter === 'active')    return !['resolved','cancelled'].includes(r.status)
    if (filter === 'delivered') return r.status === 'resolved'
    if (filter === 'cancelled') return r.status === 'cancelled'
    return true
  })

  const CANCEL_REASONS = [
    'Item not available',
    'Food preparation issue',
    'Guest changed their mind',
    'Duplicate order',
    'Event ended',
    'other'
  ]

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Live Orders</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={enableSound} style={{ background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', borderRadius:10, padding:'7px 12px', fontSize:12, fontWeight:700 }}>🔔 Sound</button>
          <button onClick={()=>{ loadOrders(false); loadSOS() }} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'7px 14px', fontSize:13, fontWeight:700 }}>Refresh</button>
        </div>
      </div>

      {waiters.length > 0 && (
        <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:14, boxShadow:'var(--shadow)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>Waiter Status</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {waiters.map(w => {
              const busy = busyWaiterIds.includes(w.id)
              const assignedOrder = orders.find(o=>o.waiter_id===w.id&&o.status==='in_progress')
              return (
                <div key={w.id} onClick={()=>setWaiterFilter(waiterFilter===w.id?null:w.id)}
                  style={{ background:waiterFilter===w.id?'#1A0A0A':busy?'#FEF2F2':'#F0FDF4', border:'2px solid', borderColor:waiterFilter===w.id?'#E8890C':busy?'#FECACA':'#BBF7D0', borderRadius:10, padding:'6px 12px', fontSize:12, cursor:'pointer' }}>
                  <span style={{ fontWeight:800, color:waiterFilter===w.id?'#E8890C':busy?'#DC2626':'#16A34A' }}>{w.name}</span>
                  {busy&&assignedOrder&&<span style={{ color:'#888', marginLeft:6 }}>→ T{assignedOrder.tables?.table_number}</span>}
                  <span style={{ marginLeft:6, fontSize:11 }}>{busy?'🔴':'🟢'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(waiterFilter||tableFilter) && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'8px 14px', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
          <span style={{ fontWeight:700, color:'#92400E' }}>🔍 {waiterFilter&&<>Waiter: {waiters.find(w=>w.id===waiterFilter)?.name}</>}{waiterFilter&&tableFilter&&' · '}{tableFilter&&<>Table: {tableFilter}</>}</span>
          <button onClick={()=>{ setWaiterFilter(null); setTableFilter(null) }} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer' }}>Clear ✕</button>
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        {[['active','Active'],['delivered','Delivered'],['cancelled','Cancelled'],['all','All']].map(([val,label]) => (
          <button key={val} onClick={()=>setFilter(val)} style={{ flex:1, padding:'8px 4px', background:filter===val?'var(--ink)':'#fff', color:filter===val?'#fff':'var(--ink)', border:'1.5px solid', borderColor:filter===val?'var(--ink)':'var(--line)', borderRadius:10, fontSize:13, fontWeight:700 }}>{label}</button>
        ))}
      </div>

      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div> : (
        <>
          {filteredSOS.map(sos => (
            <div key={'sos-'+sos.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'5px solid #DC2626' }}>
              <div style={{ background:'#FEF2F2', borderRadius:10, padding:'8px 12px', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:20 }}>🛎️</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:900, fontSize:14, color:'#DC2626' }}>CALL WAITER REQUEST</div>
                  <div style={{ fontSize:12, color:'#888', marginTop:1 }}>{new Date(sos.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
                </div>
                <div style={{ background:'#FEF2F2', border:'1.5px solid #FECACA', borderRadius:999, padding:'3px 10px', fontSize:11, fontWeight:800, color:'#DC2626' }}>
                  {sos.status==='open'?'NEW':sos.status==='resolved'?'Completed':sos.status==='cancelled'?'Cancelled':'In Progress'}
                </div>
              </div>
              <button onClick={()=>setTableFilter(tableFilter===sos.tables?.table_number?null:sos.tables?.table_number)}
                style={{ fontSize:24, fontWeight:900, background:tableFilter===sos.tables?.table_number?'#1A0A0A':'transparent', color:tableFilter===sos.tables?.table_number?'#E8890C':'#1A1A1A', border:'none', padding:tableFilter===sos.tables?.table_number?'2px 10px':'0', borderRadius:8, cursor:'pointer', marginBottom:12, display:'block' }}>
                Table {sos.tables?.table_number}
              </button>
              {/* What the table actually asked for, so the waiter carries it in one trip */}
              {sos.sos_request_items?.length > 0 && (
                <div style={{ background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:12,
                  padding:'10px 12px', marginBottom:12 }}>
                  {sos.sos_request_items.map((li, i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between',
                      fontSize:14, fontWeight:700, color:'#9A3412', padding:'3px 0' }}>
                      <span>{li.item_name}</span>
                      <span>x{li.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
              {sos.status==='open' && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:6 }}>Assign Waiter</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {availableWaiters.map((w, idx) => (
                      <button key={w.id} onClick={()=>assignSOSWaiter(sos.id, w.id)} disabled={assigning==='sos-'+sos.id}
                        style={{ background:idx===0?'#16A34A':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', position:'relative' }}>
                        {idx===0&&<span style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background:'#E8890C', color:'#fff', fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:999, whiteSpace:'nowrap' }}>Suggested</span>}
                        {assigning==='sos-'+sos.id?'...':w.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {sos.status!=='open' && (
                <button onClick={()=>printHelpKOT(sos)}
                  style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--line)',
                    borderRadius:12, padding:'10px', fontSize:13, fontWeight:700,
                    color:'var(--ink2)', cursor:'pointer', marginBottom:8 }}>
                  🖨 Print Help Slip
                </button>
              )}
              {/* Resolve appears only once a waiter is assigned. Before that
                  there is nothing to mark as done, and it was far too easy to
                  close a request nobody had acted on. */}
              {!['resolved','cancelled'].includes(sos.status) && (
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>cancelSOSRequest(sos.id)}
                    style={{ flexShrink:0, background:'#FEF2F2', border:'1px solid #FECACA',
                      color:'#B91C1C', borderRadius:12, padding:'12px 18px', fontSize:13,
                      fontWeight:800, cursor:'pointer' }}>
                    ✕ Cancel
                  </button>
                  {sos.status==='open' ? (
                    <div style={{ flex:1, background:'#F3F4F6', borderRadius:12, padding:'12px',
                      fontSize:13, fontWeight:700, color:'#6B7280', textAlign:'center' }}>
                      Assign a waiter first
                    </div>
                  ) : (
                    <button onClick={()=>resolveSOSRequest(sos.id)}
                      style={{ flex:1, background:'#16A34A', color:'#fff', border:'none',
                        borderRadius:12, padding:'12px', fontSize:14, fontWeight:800,
                        cursor:'pointer' }}>
                      ✓ Mark Resolved
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {filteredOrders.length===0&&filteredSOS.length===0 ? (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
              <div style={{ color:'var(--ink2)', fontWeight:600 }}>No orders yet</div>
            </div>
          ) : filteredOrders.map(order => (
            <div key={order.id} style={{ background:'#fff', borderRadius:18, padding:18, marginBottom:14, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(STATUS_COLORS[order.status]||'#999') }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <button onClick={()=>setTableFilter(tableFilter===order.tables?.table_number?null:order.tables?.table_number)}
                      style={{ fontSize:22, fontWeight:900, background:tableFilter===order.tables?.table_number?'#1A0A0A':'transparent', color:tableFilter===order.tables?.table_number?'#E8890C':'#1A1A1A', border:'none', padding:tableFilter===order.tables?.table_number?'2px 10px':'0', borderRadius:8, cursor:'pointer', lineHeight:1 }}>
                      Table {order.tables?.table_number}
                    </button>
                    {order.status==='in_progress'&&order.assigned_at&&(()=>{
                      const t=formatTimer(order.assigned_at); if(!t) return null
                      const bg=t.mins>=15?'#FEF2F2':t.mins>=10?'#FEF3C7':'#F0FDF4'
                      const col=t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A'
                      const bord=t.mins>=15?'#FECACA':t.mins>=10?'#FCD34D':'#BBF7D0'
                      return (<div style={{ display:'inline-flex', alignItems:'center', gap:6, background:bg, border:'2px solid '+bord, borderRadius:10, padding:'5px 14px' }}>
                        <span style={{ fontSize:16 }}>⏱</span>
                        <span style={{ fontSize:24, fontWeight:900, color:col, fontVariantNumeric:'tabular-nums' }}>{t.str}</span>
                        {t.mins>=15&&<span style={{ fontSize:11, background:'#DC2626', color:'#fff', padding:'1px 7px', borderRadius:999, fontWeight:700 }}>⚠️ Slow</span>}
                      </div>)
                    })()}
                  </div>
                  <div style={{ fontSize:12, color:'var(--ink2)', marginTop:4 }}>{new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}</div>
                  {order.waiters?.name&&(<button onClick={()=>setWaiterFilter(waiterFilter===order.waiter_id?null:order.waiter_id)}
                    style={{ fontSize:14, fontWeight:800, color:waiterFilter===order.waiter_id?'#fff':'#2563EB', background:waiterFilter===order.waiter_id?'#2563EB':'#EFF6FF', border:'none', borderRadius:8, padding:'3px 12px', marginTop:4, cursor:'pointer' }}>
                    👤 {order.waiters.name} {waiterFilter===order.waiter_id?'✕':''}
                  </button>)}
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                  <div style={{ background:(STATUS_COLORS[order.status]||'#999')+'20', color:STATUS_COLORS[order.status]||'#999', fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:999 }}>{STATUS_LABELS[order.status]}</div>
                  {order.status==='in_progress'&&(<button onClick={()=>printKOT(order)} style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:600, color:'var(--ink2)' }}>🖨 Print KOT</button>)}
                </div>
              </div>
              <div style={{ borderTop:'1px solid var(--line)', paddingTop:10, marginBottom:12 }}>
                {order.order_items?.map((oi,i)=>(<div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', fontSize:14 }}>
                  <span style={{ fontWeight:600 }}>{oi.menu_items?.name}{oi.menu_items?.is_live_counter&&<span style={{ fontSize:11, color:'#D97706' }}> Live</span>}</span>
                  <span style={{ fontWeight:800, color:'var(--ink2)' }}>x{oi.quantity}</span>
                </div>))}
              </div>
              {['pending','placed'].includes(order.status)&&(
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:6 }}>Assign Waiter {availableWaiters.length===0&&waiters.length>0?<span style={{ color:'#DC2626' }}>— All busy</span>:''}</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                    {availableWaiters.map((w,idx)=>(<button key={w.id} onClick={()=>assignWaiter(order.id,w.id)} disabled={assigning===order.id}
                      style={{ background:idx===0?'#16A34A':'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer', position:'relative' }}>
                      {idx===0&&<span style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background:'#E8890C', color:'#fff', fontSize:9, fontWeight:800, padding:'1px 6px', borderRadius:999, whiteSpace:'nowrap' }}>Suggested</span>}
                      {assigning===order.id?'...':w.name}
                    </button>))}
                    <button onClick={()=>assignWaiter(order.id,null)} disabled={assigning===order.id}
                      style={{ background:'#F0F0F0', color:'var(--ink)', border:'1px solid var(--line)', borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:600, cursor:'pointer' }}>No Waiter</button>
                  </div>
                </div>
              )}
              <div style={{ display:'flex', gap:8 }}>
                {order.status==='in_progress'&&(<button onClick={()=>markDelivered(order)} style={{ flex:1, background:'#16A34A', color:'#fff', border:'none', borderRadius:12, padding:'12px 8px', fontSize:14, fontWeight:800 }}>✓ Mark Delivered</button>)}
                {['pending','placed'].includes(order.status)&&(<button onClick={()=>cancelOrder(order.id)} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:12, padding:'12px 14px', fontSize:13, fontWeight:700 }}>Cancel</button>)}
              </div>
            </div>
          ))}
        </>
      )}
      {/* Cancel reason dialog */}
      {showCancelDialog && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 16px' }}>
          <div style={{ background:'#fff', borderRadius:20, padding:'24px 20px', width:'100%', maxWidth:400, boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }}>
            <h3 style={{ fontSize:18, fontWeight:800, marginBottom:4, color:'#DC2626' }}>❌ Cancel Order</h3>
            <p style={{ fontSize:13, color:'#888', marginBottom:16 }}>Select a reason for cancellation. The guest will be notified.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
              {CANCEL_REASONS.map(r => (
                <button key={r} onClick={() => setCancelReason(r)}
                  style={{ padding:'10px 14px', borderRadius:10, border:'1.5px solid', textAlign:'left',
                    borderColor: cancelReason===r ? '#DC2626' : '#E5E7EB',
                    background: cancelReason===r ? '#FEF2F2' : '#fff',
                    color: cancelReason===r ? '#DC2626' : '#333',
                    fontSize:14, fontWeight: cancelReason===r ? 700 : 500, cursor:'pointer' }}>
                  {r === 'other' ? '✏️ Other (type below)' : r}
                </button>
              ))}
            </div>
            {cancelReason === 'other' && (
              <input value={cancelCustomReason} onChange={e=>setCancelCustomReason(e.target.value)}
                placeholder="Enter reason..."
                style={{ width:'100%', border:'1.5px solid #E5E7EB', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', marginBottom:14, boxSizing:'border-box' }} />
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setShowCancelDialog(null)}
                style={{ flex:1, background:'#F5F5F5', border:'none', borderRadius:12, padding:'13px', fontSize:14, fontWeight:700, color:'#888', cursor:'pointer' }}>
                Back
              </button>
              <button onClick={confirmCancel} disabled={!cancelReason || (cancelReason==='other' && !cancelCustomReason.trim())}
                style={{ flex:2, background: (!cancelReason || (cancelReason==='other' && !cancelCustomReason.trim())) ? '#ccc' : '#DC2626',
                  color:'#fff', border:'none', borderRadius:12, padding:'13px', fontSize:14, fontWeight:800,
                  cursor: (!cancelReason || (cancelReason==='other' && !cancelCustomReason.trim())) ? 'not-allowed' : 'pointer' }}>
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
