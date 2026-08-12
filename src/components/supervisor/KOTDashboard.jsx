import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const BUILD_VERSION = 'v2.1 \u00B7 2026-08-10'

const STATUS_LABELS = { pending:'Order Received', placed:'Order Received', in_progress:'Waiter On The Way', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }

export default function KOTDashboard({ eventData, onOrderCountChange, onNewOrder }) {
  const [orders, setOrders] = useState([])
  const [sosRequests, setSosRequests] = useState([])
  const [waiters, setWaiters] = useState([])
  const [filter, setFilter] = useState('active')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  // Only one row open at a time, so the list cannot grow unmanageable
  const [expandedRow, setExpandedRow] = useState(null)
  // Handlers run before the reload lands, so they read the count from here
  const timelineRef = useRef(0)
  const [nowTs, setNowTs] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 1000); return () => clearInterval(t) }, [])
  // Remembered, so a supervisor away from the printer stays silenced
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem('ss_autoprint') !== 'off')
  const [showAllWaiters, setShowAllWaiters] = useState(null)
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
        if (fresh && autoPrint) setTimeout(() => printKOT(fresh), 300)
      } catch (e) { /* never block assignment if printing fails */ }
    }
  }

  // Cancelling and resolving are different outcomes and must not share a
  // button - closing a dropped request as 'resolved' makes the reports lie.
  async function cancelSOSRequest(sosId) {
    if (!window.confirm('Cancel this help request?')) return
    await supabase.from('sos_requests').update({ status:'cancelled' }).eq('id', sosId)
    loadSOS(); clearFiltersIfEmpty(timelineRef.current - 1)
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
        if (fresh && autoPrint) setTimeout(() => printHelpKOT(fresh), 300)
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

  // Filtering by waiter to find their table and then delivering it used to
  // leave the filter on, so the same table looked like it was still there.
  // Clear only when nothing is left to act on. Clearing after every action
  // suits a waiter filter, which usually holds one item, but fights a table
  // filter holding five - you would have to re-apply it after each one.
  function clearFiltersIfEmpty(remaining) {
    if (!waiterFilter && !tableFilter) return
    if (remaining > 0) return
    setWaiterFilter(null); setTableFilter(null); setFilter('active')
  }

  async function markDelivered(order) {
    await supabase.from('orders').update({ status:'delivered', delivered_at:new Date().toISOString() }).eq('id', order.id)
    loadOrders(false)
    // timeline still holds the record just actioned, hence the minus one
    clearFiltersIfEmpty(timelineRef.current - 1)
  }

  async function resolveSOSRequest(sosId) {
    await supabase.from('sos_requests').update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', sosId)
    loadSOS(); clearFiltersIfEmpty(timelineRef.current - 1)
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
    clearFiltersIfEmpty(timelineRef.current - 1)
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
    // A blocked popup returns null, and the next line would throw with no
    // sign to the supervisor - the waiter gets assigned and nothing prints.
    if (!w) {
      alert('The print window was blocked by the browser.\n\n' +
        'Allow pop-ups for this site, then use Print KOT on the order card.\n\n' +
        'Look for the blocked pop-up icon at the right of the address bar.')
      return
    }
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
  // Jobs done, not orders done. A waiter returning from a help run had been
  // reading as zero jobs and jumping back to the front of the queue.
  const waiterOrderCount = {}
  const waiterLastAt = {}
  waiters.forEach(w => { waiterOrderCount[w.id] = 0; waiterLastAt[w.id] = 0 })

  function tally(list) {
    list.forEach(x => {
      if (!x.waiter_id || waiterOrderCount[x.waiter_id] === undefined) return
      waiterOrderCount[x.waiter_id]++
      // Latest of assigned or finished. A waiter who delivered two minutes
      // ago must rank behind one assigned an hour ago and still out.
      const times = [x.assigned_at, x.delivered_at, x.resolved_at]
        .filter(Boolean).map(v => new Date(v).getTime())
      const t = times.length ? Math.max(...times) : 0
      if (t > waiterLastAt[x.waiter_id]) waiterLastAt[x.waiter_id] = t
    })
  }
  tally(orders)
  tally(sosRequests)

  // Purely last activity, oldest first. Job count is deliberately NOT used:
  // with every waiter free and every order delivered the counts go equal, the
  // tie-break takes over, and the order collapses back toward 1,2,3,4,5.
  //
  // Sorting on time alone means whoever came back most recently goes last and
  // whoever has been idle longest goes first, which holds whether waiters are
  // busy or all free. That is the first come first go rule.
  //
  // A waiter who has never worked has 0, so they lead until they do.
  const availableWaiters = waiters
    .filter(w => !busyWaiterIds.includes(w.id))
    .sort((a, b) => (waiterLastAt[a.id] || 0) - (waiterLastAt[b.id] || 0))

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

  // A help request from 22:39 must not sit above an order from 22:40 just
  // because it is a different type. During a rush the supervisor reads top
  // to bottom and needs true chronological order.
  const timeline = [
    ...filteredSOS.map(r => ({ kind:'sos', at:r.created_at, sos:r })),
    ...filteredOrders.map(o => ({ kind:'order', at:o.created_at, order:o })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at))
  timelineRef.current = timeline.length

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
        <h2 style={{ fontSize:20, fontWeight:800, display:'flex', alignItems:'baseline', gap:8 }}>
          Live Orders
          {/* Answers "which build are you on?" in one glance, instead of
              guessing when someone cannot see a change. */}
          <span style={{ fontSize:11, fontWeight:600, color:'var(--ink2)', opacity:0.65 }}>
            {BUILD_VERSION}
          </span>
        </h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => { const v = !autoPrint; setAutoPrint(v); localStorage.setItem('ss_autoprint', v ? 'on' : 'off') }}
            title="Print the KOT automatically when a waiter is assigned"
            style={{ background: autoPrint ? '#DCFCE7' : '#F3F4F6',
              border:'1px solid ' + (autoPrint ? '#86EFAC' : '#E5E7EB'),
              color: autoPrint ? '#15803D' : '#6B7280', borderRadius:10,
              padding:'7px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            🖨 Auto-print {autoPrint ? 'ON' : 'OFF'}
          </button>
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
                  style={{ background:waiterFilter===w.id?'#1A0A0A':busy?'#FEF2F2':'#F0FDF4', border:'2px solid', borderColor:waiterFilter===w.id?'#E8890C':busy?'#FECACA':'#BBF7D0', borderRadius:9, padding:'4px 10px', fontSize:12, cursor:'pointer' }}>
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
          {timeline.length === 0 && (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
              <div style={{ color:'var(--ink2)', fontWeight:600 }}>Nothing here yet</div>
            </div>
          )}

          {/* Compact rows. Colour carries the state because that is what gets
              scanned on a busy screen; the text is for confirming, not finding. */}
          {/* Split in half rather than flowing across rows, so the first half
              reads down the left column and the second down the right. Row-major
              would put the newest top-left and the next top-right, which destroys
              the chronological read. */}
          <style>{`
            .ss-kot-cols { display:grid; grid-template-columns:1fr; gap:10px; align-items:start; }
            @media (min-width: 1100px) { .ss-kot-cols { grid-template-columns:1fr 1fr; } }
          `}</style>
          <div className="ss-kot-cols">
          {[timeline.slice(0, Math.ceil(timeline.length/2)),
            timeline.slice(Math.ceil(timeline.length/2))].map((col, ci) => (
          <div key={ci} style={{ background:'#fff', borderRadius:14, overflow:'hidden',
            boxShadow:'var(--shadow)', display: col.length ? 'block' : 'none' }}>
          {col.map(row => {
            const isSos  = row.kind === 'sos'
            const rec    = isSos ? row.sos : row.order
            const id     = (isSos ? 'sos-' : 'ord-') + rec.id
            const open   = expandedRow === id
            const status = isSos
              ? (rec.status === 'open' ? 'new' : rec.status === 'resolved' ? 'done'
                 : rec.status === 'cancelled' ? 'void' : 'progress')
              : (!rec.waiter_id && !['delivered','cancelled'].includes(rec.status) ? 'new'
                 : rec.status === 'delivered' ? 'done'
                 : rec.status === 'cancelled' ? 'void' : 'progress')

            const tone = status === 'new'  ? { bg:'#FEF2F2', fg:'#B91C1C', bar:'#DC2626' }
                       : status === 'done' ? { bg:'#F0FDF4', fg:'#15803D', bar:'#16A34A' }
                       : status === 'void' ? { bg:'#F3F4F6', fg:'#6B7280', bar:'#9CA3AF' }
                       : { bg:'#FFF7ED', fg:'#C2410C', bar:'#E8890C' }

            const lines_ = isSos ? (rec.sos_request_items || []) : (rec.order_items || [])
            const count = isSos ? lines_.length
              : lines_.reduce((n, li) => n + (li.quantity || 1), 0)
            const waiterName = rec.waiters?.name || (waiters.find(w => w.id === rec.waiter_id)?.name) || ''
            const timeStr = new Date(rec.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
            const chips = showAllWaiters === id ? availableWaiters : availableWaiters.slice(0, 3)

            // Two inline, because a row in a two column grid has no space for
            // three plus More. The rest live behind the chevron.
            const inlineChips = availableWaiters.slice(0, 2)

            // From when the order was received, not from assignment - the guest
            // has been waiting since they ordered, and that is the number that
            // matters. Frozen once delivered or resolved.
            const endTs = rec.delivered_at || rec.resolved_at
            const elapsedSec = Math.max(0, Math.floor(((endTs ? new Date(endTs).getTime() : nowTs)
              - new Date(rec.created_at).getTime()) / 1000))
            const elapsedMin = Math.floor(elapsedSec / 60)
            const clock = elapsedMin + ':' + String(elapsedSec % 60).padStart(2, '0')
            const running = !endTs && !['delivered','cancelled','resolved'].includes(rec.status)
            const timerTone = elapsedMin <= 5 ? { bg:'#DCFCE7', fg:'#15803D' }
                            : elapsedMin <= 10 ? { bg:'#FEF3C7', fg:'#B45309' }
                            : { bg:'#FEE2E2', fg:'#B91C1C' }

            return (
              <div key={id} style={{ borderLeft:'4px solid '+tone.bar,
                borderBottom:'1px solid var(--line)' }}>

                <div onClick={() => { setExpandedRow(open ? null : id); setShowAllWaiters(null) }}
                  style={{ display:'flex', alignItems:'center', gap:9, padding:'6px 12px',
                    cursor:'pointer', minHeight:36, boxSizing:'border-box' }}>
                  {/* Filters to this table, the same as tapping a waiter chip.
                      stopPropagation so filtering does not also expand the row. */}
                  {(() => {
                    const tn = rec.tables?.table_number ?? rec.table_number ?? null
                    const on = tn != null && tableFilter === tn
                    return (
                      <span onClick={e => { e.stopPropagation(); if (tn != null) setTableFilter(on ? null : tn) }}
                        title={tn != null ? 'Show only table ' + tn : ''}
                        style={{ fontSize:14, fontWeight:800, minWidth:34, cursor:'pointer',
                          borderRadius:6, padding:'2px 5px', flexShrink:0,
                          background: on ? '#1A0A0A' : 'transparent',
                          color: on ? '#E8890C' : 'inherit' }}>T{tn ?? '?'}</span>
                    )
                  })()}
                  <span style={{ fontSize:12, color:'var(--ink2)', minWidth:42 }}>{timeStr}</span>
                  <span style={{ fontSize:11, fontWeight:800, padding:'3px 9px', borderRadius:999,
                    background:tone.bg, color:tone.fg, minWidth:58, textAlign:'center', flexShrink:0 }}>
                    {isSos ? 'HELP' : count + (count === 1 ? ' item' : ' items')}
                  </span>
                  {/* Dish names are deliberately NOT on the collapsed row. What
                      gets scanned here is table, time, count, timer and who is on
                      it. The names are listed in full with quantities once the row
                      is open. This space is left free so the timer and the action
                      buttons are not crushed against a wall of text. */}
                  <span style={{ flex:1, minWidth:0 }} />
                  <span style={{ flexShrink:0, background:timerTone.bg, color:timerTone.fg,
                    borderRadius:999, padding:'2px 9px', fontSize:11, fontWeight:800,
                    fontVariantNumeric:'tabular-nums', minWidth:46, textAlign:'center' }}>
                    {clock}{running ? '' : ' \u2713'}
                  </span>
                  {/* Inline actions. Unassigned shows chips, assigned shows the
                      waiter and Deliver - so which rows still need a waiter is
                      obvious without opening anything. */}
                  <span onClick={e => e.stopPropagation()}
                    style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                    {status === 'new' ? (
                      <>
                        {inlineChips.map((w, wi) => (
                          <button key={w.id}
                            onClick={() => isSos ? assignSOSWaiter(rec.id, w.id) : assignWaiter(rec.id, w.id)}
                            title={'Assign ' + w.name}
                            style={{ background: wi === 0 ? '#16A34A' : '#1A0A0A', color:'#fff',
                              border:'none', borderRadius:8, padding:'5px 10px', fontSize:12,
                              fontWeight:800, cursor:'pointer' }}>{w.waiter_number || w.name}</button>
                        ))}
                        <button onClick={() => setExpandedRow(open ? null : id)}
                          title="More waiters"
                          style={{ background:'var(--bg)', border:'1px solid var(--line)',
                            borderRadius:8, padding:'5px 8px', fontSize:12, fontWeight:700,
                            color:'var(--ink2)', cursor:'pointer' }}>⋯</button>
                      </>
                    ) : status === 'progress' ? (
                      <>
                        <span style={{ fontSize:12, fontWeight:800, color:'var(--ink2)' }}>{waiterName || '—'}</span>
                        <button onClick={() => isSos ? resolveSOSRequest(rec.id) : markDelivered(rec)}
                          style={{ background:'#16A34A', color:'#fff', border:'none', borderRadius:8,
                            padding:'5px 12px', fontSize:12, fontWeight:800, cursor:'pointer' }}>
                          ✓ {isSos ? 'Done' : 'Deliver'}
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize:12, fontWeight:700, color:'var(--ink2)' }}>{waiterName || '—'}</span>
                    )}
                  </span>
                  <span style={{ fontSize:11, color:'#999', transform:'rotate('+(open?180:0)+'deg)',
                    transition:'transform 0.15s', flexShrink:0 }}>▼</span>
                </div>

                {open && (
                  <div style={{ padding:'0 12px 12px', background:'#FAFAFA' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, margin:'2px 0 8px' }}>
                      <span style={{ background:timerTone.bg, color:timerTone.fg, borderRadius:999,
                        padding:'3px 11px', fontSize:12, fontWeight:800 }}>
                        ⏱ {clock}{running ? '' : ' final'}
                      </span>
                      <span style={{ fontSize:11, color:'var(--ink2)' }}>since order received</span>
                    </div>
                    <div style={{ marginBottom:10 }}>
                      {lines_.map((li, i) => (
                        <div key={i} style={{ display:'flex', justifyContent:'space-between',
                          fontSize:13, padding:'3px 0', borderBottom:'1px solid #F0F0F0' }}>
                          <span style={{ fontWeight:600 }}>{isSos ? li.item_name : li.menu_items?.name}</span>
                          <span style={{ color:'#888' }}>x{li.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {status === 'new' ? (
                      <div style={{ marginBottom:10 }}>
                        <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:6, fontWeight:600 }}>
                          Assign waiter{availableWaiters.length ? ' \u00B7 ' + availableWaiters[0].name + ' suggested' : ''}
                        </div>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                          {chips.map((w, idx) => (
                            <button key={w.id}
                              onClick={() => isSos ? assignSOSWaiter(rec.id, w.id) : assignWaiter(rec.id, w.id)}
                              disabled={assigning === (isSos ? 'sos-' : '') + rec.id}
                              style={{ background: idx===0 && showAllWaiters!==id ? '#16A34A' : '#1A0A0A',
                                color:'#fff', border:'none', borderRadius:10, padding:'9px 16px',
                                fontSize:13, fontWeight:800, cursor:'pointer' }}>
                              {w.waiter_number || w.name}
                            </button>
                          ))}
                          {availableWaiters.length > 3 && (
                            <button onClick={e => { e.stopPropagation(); setShowAllWaiters(showAllWaiters===id ? null : id) }}
                              style={{ background:'var(--bg)', border:'1px solid var(--line)',
                                borderRadius:10, padding:'9px 14px', fontSize:13, fontWeight:700,
                                color:'var(--ink2)', cursor:'pointer' }}>
                              {showAllWaiters===id ? 'Less' : 'More'}
                            </button>
                          )}
                          {!isSos && (
                            <button onClick={() => assignWaiter(rec.id, null)}
                              style={{ background:'var(--bg)', border:'1px solid var(--line)',
                                borderRadius:10, padding:'9px 14px', fontSize:13, fontWeight:700,
                                color:'var(--ink2)', cursor:'pointer' }}>No Waiter</button>
                          )}
                        </div>
                      </div>
                    ) : waiterName ? (
                      <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:10, fontWeight:600 }}>
                        Waiter {waiterName} assigned
                      </div>
                    ) : null}

                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <button onClick={() => isSos ? printHelpKOT(rec) : printKOT(rec)}
                        style={{ background:'var(--bg)', border:'1px solid var(--line)', borderRadius:10,
                          padding:'9px 16px', fontSize:13, fontWeight:700, color:'var(--ink2)',
                          cursor:'pointer' }}>
                        🖨 {isSos ? 'Print Help Slip' : 'Print KOT'}
                      </button>

                      {!['delivered','cancelled','resolved'].includes(rec.status) && (
                        <>
                          {isSos ? (
                            rec.status !== 'open' && (
                              <button onClick={() => resolveSOSRequest(rec.id)}
                                style={{ flex:1, minWidth:140, background:'#16A34A', color:'#fff',
                                  border:'none', borderRadius:10, padding:'9px 16px', fontSize:13,
                                  fontWeight:800, cursor:'pointer' }}>✓ Mark Resolved</button>
                            )
                          ) : (
                            rec.waiter_id && (
                              <button onClick={() => markDelivered(rec)}
                                style={{ flex:1, minWidth:140, background:'#16A34A', color:'#fff',
                                  border:'none', borderRadius:10, padding:'9px 16px', fontSize:13,
                                  fontWeight:800, cursor:'pointer' }}>✓ Mark Delivered</button>
                            )
                          )}
                          <button onClick={() => isSos ? cancelSOSRequest(rec.id) : setShowCancelDialog(rec.id)}
                            style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C',
                              borderRadius:10, padding:'9px 16px', fontSize:13, fontWeight:800,
                              cursor:'pointer' }}>✕ Cancel</button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div>
          ))}
          </div>
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
