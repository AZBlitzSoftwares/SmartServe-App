import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { armOrderBeep, playOrderBeep, orderSoundOn, setOrderSound } from '../../lib/orderBeep'
import { printKotWindow, kotAsOrder, helpAsOrder } from '../../lib/kotSlip'
import { AutoAssignBadge } from './AutoAssign'

// A waiter who has had an order this long without delivering it shows DELAY
const DELAY_MIN = 5

// The number called across the hall: waiter_number, else the "(07)" in "Raju (07)", else the name
function waiterNo(w) {
  if (!w) return ''
  if (w.waiter_number != null && String(w.waiter_number).trim() !== '') return String(w.waiter_number).trim()
  const m = String(w.name || '').match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : String(w.name || '')
}
const normNo = v => String(v ?? '').trim().replace(/^0+(?=\d)/, '').toLowerCase()
// 1, 2, 3 ... 10, 11 in number order, then any names
function byWaiterNo(a, b) {
  const x = parseInt(waiterNo(a), 10), y = parseInt(waiterNo(b), 10)
  if (!isNaN(x) && !isNaN(y) && x !== y) return x - y
  if (!isNaN(x) !== !isNaN(y)) return isNaN(x) ? 1 : -1
  return waiterNo(a).localeCompare(waiterNo(b), undefined, { numeric: true })
}

/* The pick list: every waiter of the event in number order, the busy ones showing where
   they are (they can still be picked), and a box to type a number. A number nobody has
   yet can be added and assigned in one go. */
function WaiterPicker({ waiters, busyOf, title, sub, current, allowNone, onPick, onNone, onAdd, onClose }) {
  const [typed, setTyped] = useState('')
  const list = [...waiters].sort(byWaiterNo)
  const t = typed.trim()
  const match = t ? list.find(w => normNo(waiterNo(w)) === normNo(t) || normNo(w.name) === normNo(t)) : null
  const touch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer:coarse)').matches
  const go = () => { if (match) onPick(match); else if (t) onAdd(t) }
  return (
    <div className="wp-bg" onClick={onClose}>
      <div className="wp" onClick={e => e.stopPropagation()}>
        <div className="wp-h">
          <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
          <button className="wp-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="wp-type">
          <input value={typed} onChange={e => setTyped(e.target.value)} autoFocus={!touch} inputMode="numeric"
            placeholder="Type a waiter number" onKeyDown={e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') onClose() }} />
          {t && (match
            ? <button className="wp-go" onClick={() => onPick(match)}>Assign {waiterNo(match)}</button>
            : <button className="wp-go add" onClick={() => onAdd(t)}>Add waiter {t} and assign</button>)}
        </div>
        <div className="wp-grid">
          {list.map(w => {
            const busy = busyOf(w.id)
            const on = match && match.id === w.id
            return (
              <button key={w.id} className={'wp-w' + (busy ? ' busy' : '') + (on ? ' on' : '') + (current === w.id ? ' cur' : '')}
                onClick={() => onPick(w)} title={w.name}>
                <b>{waiterNo(w)}</b>
                <small>{current === w.id ? 'now' : busy ? busy : 'free'}</small>
              </button>
            )
          })}
          {!list.length && <div className="wp-empty">No waiters yet: type a number above to add one.</div>}
        </div>
        <div className="wp-f">
          {allowNone && <button className="wp-none" onClick={onNone}>No waiter</button>}
          <button className="wp-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const BUILD_VERSION = 'v2.7 \u00B7 2026-10-24'

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
  // the waiter pick list: { kind: 'order' | 'sos' | 'kot', rec }
  const [picker, setPicker] = useState(null)
  // One KOT per category (event switch): the KOTs and the event's printers
  const kotMode = !!eventData?.kot_per_category
  const [kots, setKots] = useState([])
  const [printers, setPrinters] = useState([])
  const [soundOn, setSoundOn] = useState(orderSoundOn)
  useEffect(() => { armOrderBeep() }, [])
  const [showCancelDialog, setShowCancelDialog] = useState(null) // order id being cancelled
  const [cancelReason, setCancelReason] = useState('')
  const [cancelCustomReason, setCancelCustomReason] = useState('')
  const [waiterFilter, setWaiterFilter] = useState(null)
  const [tableFilter, setTableFilter] = useState(null)
  const [now, setNow] = useState(Date.now())
  const prevCount = useRef(-1)

  /* The order list gets a measured height so it scrolls inside itself and
     the controls above it stay put.

     Measured rather than hard-coded because the waiter strip wraps to two or
     three lines as waiters are added - any fixed figure is wrong the moment
     the team grows. Sticky was tried first and failed silently: an ancestor
     with overflow set switches it off with no error at all.

     Placed here, below every piece of state it reads. Higher up it threw
     "Cannot access 'waiterFilter' before initialization" - a const cannot be
     read before its own declaration line has run. */
  const listRef = useRef(null)
  const [listHeight, setListHeight] = useState(null)

  useEffect(() => {
    function measure() {
      const el = listRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      // 28 covers the 24px of bottom padding the page wrapper adds under this
      // list, plus a little slack. Without it the page ends up ~24px taller
      // than the screen and gets its own scrollbar behind the list - which is
      // how the header ended up scrolled half out of view on an empty board.
      // getBoundingClientRect().top is viewport-relative, so this stays
      // correct whatever the page scroll happens to be when it measures.
      const h = window.innerHeight - top - 28
      // Below this the list is too short to be worth capping, and on a small
      // screen a whole-page scroll reads better than a cramped inner one.
      setListHeight(h > 240 ? h : null)
    }
    measure()
    const t = setTimeout(measure, 150) // after fonts and images settle
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [waiters.length, waiterFilter, tableFilter, filter, loading])

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
      .select('*, tables(table_number), sos_request_items(item_name, quantity), captains(name)').eq('event_id', eventData.id)
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
      .select('*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name), captains(name), assigned_at')
      .eq('event_id', eventData.id).order('created_at', { ascending: false })
    const all = data || []
    if (eventData.kot_per_category) {
      const [k, ks] = await Promise.all([
        supabase.from('kots').select('id,order_id,kitchen_id,kot_no,table_number,captain_name,category_name,items,status,print_status,last_error,waiter_id,waiter_label,assigned_at,delivered_at,cancelled_at,created_at,printed_at')
          .eq('event_id', eventData.id).eq('kind', 'order').order('created_at', { ascending:false }),
        supabase.from('kitchens').select('id,name,printer_ip,printer_status,is_active').eq('event_id', eventData.id),
      ])
      if (!k.error) setKots(k.data || [])
      if (!ks.error) setPrinters(ks.data || [])
    }
    const activeCount = all.filter(o => !['delivered','cancelled'].includes(o.status)).length
    if (prevCount.current >= 0 && activeCount > prevCount.current) {
      // a beep; the new card itself flashes NEW ORDER (no banner across the top)
      if (onNewOrder) onNewOrder(all.find(o => o.status === 'placed'))
      playOrderBeep()
    }
    prevCount.current = activeCount; setOrders(all); onOrderCountChange(activeCount)
    if (showSpinner) setLoading(false)
  }

  function toggleSound() {
    const v = !soundOn
    setSoundOn(v); setOrderSound(v)
    if (v) setTimeout(playOrderBeep, 50)
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
          .select('*, tables(table_number), waiters(name), captains(name), order_items(quantity, menu_items(name, is_veg))')
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
          .select('*, tables(table_number), waiters(name), captains(name), sos_request_items(item_name, quantity)')
          .eq('id', sosId).single()
        if (fresh && autoPrint) setTimeout(() => printHelpKOT(fresh), 300)
      } catch (e) { /* never block assignment if printing fails */ }
    }
  }

  // Reshape a help request into the object printKOT already understands,
  // so both slips come off one code path and cannot drift apart.
  function printHelpKOT(sos) { printKOT(helpAsOrder(sos), true) }

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
  function printKOT(order, isHelp) { return printKotWindow(order, isHelp, eventData?.name) }

  // Waiters busy on orders OR on active help requests, and where (shown on the pick list
  // and the waiter strip). There is no "next waiter" suggestion: the operator picks whoever
  // is standing there.
  const busyAt = {}
  const noteBusy = (wid, tn) => { if (!wid) return; (busyAt[wid] ||= []).push(tn != null ? 'T' + tn : 'busy') }
  orders.filter(o => o.status === 'in_progress' && o.waiter_id).forEach(o => noteBusy(o.waiter_id, o.tables?.table_number))
  sosRequests.filter(r => r.status === 'in_progress' && r.waiter_id).forEach(r => noteBusy(r.waiter_id, r.tables?.table_number ?? r.table_number))
  if (kotMode) kots.filter(k => k.status === 'open' && k.waiter_id).forEach(k => noteBusy(k.waiter_id, k.table_number))
  const busyWaiterIds = Object.keys(busyAt)
  const busyOf = wid => (busyAt[wid] ? [...new Set(busyAt[wid])].join(' ') : '')

  const splitOrders = new Set(kotMode ? kots.map(k => k.order_id) : [])
  const filteredKots = !kotMode ? [] : kots.filter(k => {
    const matchFilter = filter === 'active' ? k.status === 'open' : filter === 'delivered' ? k.status === 'delivered'
      : filter === 'cancelled' ? k.status === 'cancelled' : true
    return matchFilter && (!waiterFilter || k.waiter_id === waiterFilter) && (!tableFilter || k.table_number === tableFilter)
  })
  const filteredOrders = orders.filter(o => !splitOrders.has(o.id)).filter(o => {
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
  // new = nobody on it yet · progress = a waiter has it · delay = a waiter has had it
  // DELAY_MIN minutes and it is not delivered · done / void = finished
  function cardState(rec, isSos, isKot) {
    if (isKot) {
      if (rec.status === 'delivered') return 'done'
      if (rec.status === 'cancelled') return 'void'
      if (!rec.waiter_id) return 'new'
    } else if (isSos) {
      if (rec.status === 'resolved') return 'done'
      if (rec.status === 'cancelled') return 'void'
      if (rec.status === 'open' || (!rec.waiter_id && rec.status !== 'in_progress')) return 'new'
    } else {
      if (rec.status === 'delivered') return 'done'
      if (rec.status === 'cancelled') return 'void'
      if (!rec.waiter_id && ['pending', 'placed'].includes(rec.status)) return 'new'
    }
    const since = rec.assigned_at ? (nowTs - new Date(rec.assigned_at).getTime()) / 60000 : 0
    return since >= DELAY_MIN ? 'delay' : 'progress'
  }
  const RANK = { new: 0, delay: 1, progress: 2, done: 3, void: 4 }
  const timeline = [
    ...filteredSOS.map(r => ({ kind:'sos', at:r.created_at, sos:r, st:cardState(r, true) })),
    ...filteredOrders.map(o => ({ kind:'order', at:o.created_at, order:o, st:cardState(o, false) })),
    ...filteredKots.map(k => ({ kind:'kot', at:k.created_at, kot:k, st:cardState(k, false, true) })),
  ].sort((a, b) => filter === 'active'
    ? (RANK[a.st] - RANK[b.st]) || (new Date(a.at) - new Date(b.at))
    : new Date(b.at) - new Date(a.at))
  timelineRef.current = timeline.length

  const CANCEL_REASONS = [
    'Item not available',
    'Food preparation issue',
    'Guest changed their mind',
    'Duplicate order',
    'Event ended',
    'other'
  ]

  // ---- One KOT per category: each KOT has its own waiter, print and Delivered
  const printerOf = k => printers.find(p => p.id === k.kitchen_id) || null
  function printKotSlip(k, label) { printKOT(kotAsOrder(k, label)) }
  async function assignKot(k, waiterId) {
    setAssigning('kot-' + k.id)
    const { data, error } = await supabase.rpc('ss_kot_assign', { p_kot_id: k.id, p_waiter_id: waiterId })
    setAssigning(null)
    if (error) { alert('Could not assign: ' + (error.message || 'try again')); loadOrders(false); return }
    loadOrders(false)
    // no kitchen printer for this category: printed here, as the desk always did
    if (data?.print === 'desk' && autoPrint) setTimeout(() => printKotSlip(k, data.waiter), 300)
  }
  async function deliverKot(k) {
    await supabase.rpc('ss_kot_deliver', { p_kot_id: k.id })
    loadOrders(false); clearFiltersIfEmpty(timelineRef.current - 1)
  }
  async function cancelKot(k) {
    if (!window.confirm('Cancel KOT ' + (k.kot_no || '') + ' (' + (k.category_name || '') + ') for table ' + (k.table_number ?? '?') + '?' +
      (['printed', 'printing'].includes(k.print_status) && k.kitchen_id ? '\n\nA CANCELLED slip prints on its printer.' : ''))) return
    await supabase.rpc('ss_kot_cancel', { p_kot_id: k.id })
    loadOrders(false); clearFiltersIfEmpty(timelineRef.current - 1)
  }
  async function reprintKot(k) {
    const { data } = await supabase.rpc('ss_kot_reprint', { p_kot_id: k.id })
    if (data === 'desk' || !k.kitchen_id) printKotSlip(k)
    loadOrders(false)
  }

  // Open the pick list for an order, a help request or a KOT
  const openPicker = (kind, rec) => setPicker({ kind, rec })
  async function pickWaiter(w) {
    const p = picker; setPicker(null)
    if (!p || !w) return
    if (p.kind === 'sos') await assignSOSWaiter(p.rec.id, w.id)
    else if (p.kind === 'kot') await assignKot(p.rec, w.id)
    else await assignWaiter(p.rec.id, w.id)
  }
  // A number nobody has yet: added to the event's waiters and assigned in one go
  async function addAndPick(num) {
    const n = String(num).trim()
    if (!n) return
    const { data, error } = await supabase.from('waiters')
      .insert({ event_id: eventData.id, name: n, waiter_number: n, is_active: true }).select().single()
    if (error || !data) { alert('Could not add waiter ' + n + (error?.message ? ': ' + error.message : '')); return }
    setWaiters(list => [...list, data])
    await pickWaiter(data)
  }

  return (
    <div>
      {/* Frozen block. Heading, waiter strip and filters hold at the top of
          the screen while the orders scroll beneath - a supervisor twenty
          orders down could not otherwise see who was free or reach a filter.
          top is the tab bar's height; the negative margins and matching
          padding let the background run edge to edge through the 16px page
          padding, so rows do not show through at the sides as they pass. */}
      <div style={{ background:'var(--bg)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h2 style={{ fontSize:20, fontWeight:800, display:'flex', alignItems:'baseline', gap:8 }}>
          Live Orders
          {/* Answers "which build are you on?" in one glance, instead of
              guessing when someone cannot see a change. */}
          <span style={{ fontSize:11, fontWeight:600, color:'var(--ink2)', opacity:0.65 }}>
            {BUILD_VERSION}
          </span>
        </h2>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', justifyContent:'flex-end' }}>
          <AutoAssignBadge eventData={eventData} />
          <button onClick={() => { const v = !autoPrint; setAutoPrint(v); localStorage.setItem('ss_autoprint', v ? 'on' : 'off') }}
            title="Print the KOT automatically when a waiter is assigned"
            style={{ background: autoPrint ? '#DCFCE7' : '#F3F4F6',
              border:'1px solid ' + (autoPrint ? '#86EFAC' : '#E5E7EB'),
              color: autoPrint ? '#15803D' : '#6B7280', borderRadius:10,
              padding:'7px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            🖨 Auto-print {autoPrint ? 'ON' : 'OFF'}
          </button>
          <button onClick={toggleSound} title="Beep when a new order comes in"
            style={{ background: soundOn ? '#EFF6FF' : '#F3F4F6', border:'1px solid ' + (soundOn ? '#BFDBFE' : '#E5E7EB'),
              color: soundOn ? '#1D4ED8' : '#6B7280', borderRadius:10, padding:'7px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            {soundOn ? '🔔 Sound ON' : '🔕 Sound OFF'}
          </button>
          <button onClick={()=>{ loadOrders(false); loadSOS() }} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'7px 14px', fontSize:13, fontWeight:700 }}>Refresh</button>
        </div>
      </div>

      {waiters.length > 0 && (
        <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:14, boxShadow:'var(--shadow)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>Waiter Status</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {[...waiters].sort(byWaiterNo).map(w => {
              const busy = busyWaiterIds.includes(w.id)
              const sel = waiterFilter === w.id
              return (
                <div key={w.id} onClick={()=>setWaiterFilter(sel?null:w.id)} title={w.name}
                  style={{ background: sel ? '#1E293B' : busy ? '#EFF6FF' : '#F0FDF4', border:'1.5px solid',
                    borderColor: sel ? '#1E293B' : busy ? '#BFDBFE' : '#BBF7D0', borderRadius:9, padding:'4px 10px', fontSize:12, cursor:'pointer' }}>
                  <span style={{ fontWeight:800, color: sel ? '#fff' : busy ? '#1D4ED8' : '#15803D' }}>{waiterNo(w)}</span>
                  {busy && <span style={{ color: sel ? '#CBD5E1' : '#64748B', marginLeft:6 }}>→ {busyOf(w.id)}</span>}
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

      <div style={{ display:'flex', gap:8, paddingBottom:14 }}>
        {[['active','Active'],['delivered','Delivered'],['cancelled','Cancelled'],['all','All']].map(([val,label]) => (
          <button key={val} onClick={()=>setFilter(val)} style={{ flex:1, padding:'8px 4px', background:filter===val?'var(--ink)':'#fff', color:filter===val?'#fff':'var(--ink)', border:'1.5px solid', borderColor:filter===val?'var(--ink)':'var(--line)', borderRadius:10, fontSize:13, fontWeight:700 }}>{label}</button>
        ))}
      </div>
      </div>
      {/* end frozen block */}

      {/* Everything below this line scrolls; everything above it does not.
          overflowY auto rather than scroll so no empty scrollbar shows when
          there are only three orders on the board. */}
      <div ref={listRef} style={{ height: listHeight ? listHeight + 'px' : 'auto',
        overflowY:'auto', overflowX:'hidden', WebkitOverflowScrolling:'touch' }}>
      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div> : (
        <>
          {timeline.length === 0 && (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ fontSize:48, marginBottom:12 }}>📭</div>
              <div style={{ color:'var(--ink2)', fontWeight:600 }}>Nothing here yet</div>
            </div>
          )}

          {/* Tiles, 3 to 4 to a row. Calm colours: a white card, and one small band at the
              top that says what to do. Only two things flash: NEW ORDER (light blue) until a
              waiter is on it, and DELAY (soft red) when a waiter has had it DELAY_MIN minutes
              and it is not delivered. On the Active tab new orders come first, then delayed
              ones, oldest first in each. */}
          <style>{`
            .kt-grid { display:grid; grid-template-columns:1fr; gap:12px; align-items:start; padding:2px 2px 8px; }
            @media (min-width: 600px)  { .kt-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
            @media (min-width: 900px)  { .kt-grid { grid-template-columns:repeat(3, minmax(0,1fr)); } }
            @media (min-width: 1280px) { .kt-grid { grid-template-columns:repeat(4, minmax(0,1fr)); } }
            .kt { background:#fff; border:1px solid #E5E7EB; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 2px rgba(15,23,42,.05); }
            .kt.st-new { border-color:#93C5FD; }
            .kt.st-delay { border-color:#FCA5A5; }
            .kt.st-done, .kt.st-void { opacity:.78; }
            .kt-band { font-size:11.5px; font-weight:900; letter-spacing:.08em; padding:5px 10px; text-align:center; text-transform:uppercase; }
            .kt-band.b-progress { background:#F1F5F9; color:#334155; }
            .kt-band.b-done { background:#F0FDF4; color:#15803D; }
            .kt-band.b-void { background:#F3F4F6; color:#6B7280; }
            @keyframes ktNew { 0%,49.9% { background:#DBEAFE; color:#1E40AF; } 50%,100% { background:#3B82F6; color:#fff; } }
            @keyframes ktDelay { 0%,49.9% { background:#FEE2E2; color:#B91C1C; } 50%,100% { background:#EF4444; color:#fff; } }
            .kt-band.b-new { background:#DBEAFE; color:#1E40AF; animation:ktNew 1.2s steps(1,end) infinite; }
            .kt-band.b-delay { background:#FEE2E2; color:#B91C1C; animation:ktDelay 1.2s steps(1,end) infinite; }
            @media (prefers-reduced-motion: reduce) { .kt-band.b-new, .kt-band.b-delay { animation:none; } }
            .kt-body { padding:9px 11px 6px; cursor:pointer; }
            .kt-head { display:flex; align-items:center; gap:8px; }
            .kt-t { font-size:22px; font-weight:900; color:#0F172A; border-radius:7px; padding:0 4px; margin-left:-4px; }
            .kt-t.on { background:#1E293B; color:#fff; }
            .kt-lbl { font-size:11px; font-weight:800; color:#475569; background:#F1F5F9; border-radius:999px; padding:2px 8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:46%; }
            .kt-lbl.help { background:#FEF3C7; color:#92400E; }
            .kt-lbl.cat { background:#EEF2FF; color:#3730A3; font-size:12px; text-transform:uppercase; letter-spacing:.02em; }
            .kt-meta .prn { color:#64748B; font-size:11.5px; }
            .kt-meta .prn.bad { color:#B91C1C; font-weight:700; }
            .kt-w { margin-left:auto; min-width:40px; text-align:center; border-radius:8px; padding:1px 8px; font-size:18px; font-weight:900; font-variant-numeric:tabular-nums; border:1.5px solid #0F172A; color:#0F172A; background:#fff; }
            .kt-w.none { border:1.5px dashed #CBD5E1; color:#94A3B8; font-size:16px; }
            .kt-meta { font-size:12px; color:#64748B; margin-top:4px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
            .kt-meta .clk { font-weight:800; color:#334155; font-variant-numeric:tabular-nums; }
            .kt-meta .cap { color:#2563EB; font-weight:700; }
            .kt-items { list-style:none; margin:7px 0 0; padding:0; font-size:13px; color:#1E293B; }
            .kt-items li { display:flex; gap:6px; padding:1px 0; }
            .kt-items li b { min-width:24px; color:#0F172A; }
            .kt-items li span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .kt-items .more { color:#64748B; font-size:12px; }
            .kt-act { display:flex; gap:6px; padding:6px 11px 10px; margin-top:auto; }
            .kt-act button { border-radius:9px; padding:8px 10px; font-size:13px; font-weight:800; cursor:pointer; }
            .kt-assign { flex:1; background:#1E3A8A; color:#fff; border:none; }
            .kt-deliver { flex:1; background:#fff; color:#15803D; border:1.5px solid #16A34A; }
            .kt-more { background:#fff; color:#475569; border:1px solid #E2E8F0; min-width:40px; }
            .kt-detail { border-top:1px solid #F1F5F9; background:#FAFAFA; padding:9px 11px 11px; font-size:13px; }
            .kt-detail .ln { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #F0F0F0; }
            .kt-detail .btns { display:flex; gap:6px; flex-wrap:wrap; margin-top:9px; }
            .kt-detail .btns button { border-radius:9px; padding:7px 11px; font-size:12.5px; font-weight:800; cursor:pointer; background:#fff; border:1px solid #E2E8F0; color:#334155; }
            .kt-detail .btns .red { color:#B91C1C; border-color:#FECACA; background:#FEF2F2; }
            .kt-detail .btns .grn { color:#15803D; border-color:#BBF7D0; background:#F0FDF4; }
            .wp-bg { position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:300; display:flex; align-items:center; justify-content:center; padding:16px; }
            .wp { background:#fff; border-radius:16px; width:100%; max-width:760px; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,.35); }
            .wp-h { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:16px 18px 8px; }
            .wp-h b { font-size:18px; font-weight:900; color:#0F172A; display:block; }
            .wp-h small { font-size:12.5px; color:#64748B; }
            .wp-x { background:#F1F5F9; border:none; border-radius:999px; width:36px; height:36px; font-size:16px; cursor:pointer; }
            .wp-type { display:flex; gap:8px; padding:4px 18px 10px; }
            .wp-type input { flex:1; min-width:0; border:1.5px solid #CBD5E1; border-radius:10px; padding:10px 12px; font-size:16px; font-weight:700; outline:none; }
            .wp-type input:focus { border-color:#3B82F6; }
            .wp-go { background:#1E3A8A; color:#fff; border:none; border-radius:10px; padding:0 14px; font-size:14px; font-weight:800; cursor:pointer; white-space:nowrap; }
            .wp-go.add { background:#0F766E; }
            .wp-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(74px, 1fr)); gap:8px; padding:4px 18px 12px; overflow-y:auto; }
            .wp-w { border:1.5px solid #CBD5E1; background:#fff; border-radius:12px; padding:9px 4px 7px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:1px; }
            .wp-w b { font-size:22px; font-weight:900; color:#0F172A; font-variant-numeric:tabular-nums; line-height:1.1; }
            .wp-w small { font-size:10.5px; color:#16A34A; font-weight:700; }
            .wp-w.busy { background:#F8FAFC; border-color:#E2E8F0; }
            .wp-w.busy b { color:#64748B; }
            .wp-w.busy small { color:#2563EB; }
            .wp-w.cur { border-color:#94A3B8; background:#F1F5F9; }
            .wp-w.on { border-color:#2563EB; box-shadow:0 0 0 3px #BFDBFE; }
            .wp-w:hover { border-color:#3B82F6; }
            .wp-empty { grid-column:1/-1; color:#64748B; font-size:13px; padding:10px 0; }
            .wp-f { display:flex; gap:8px; justify-content:flex-end; padding:10px 18px 16px; border-top:1px solid #F1F5F9; }
            .wp-f button { border-radius:10px; padding:10px 16px; font-size:14px; font-weight:800; cursor:pointer; background:#fff; border:1px solid #E2E8F0; color:#334155; }
          `}</style>
          <div className="kt-grid">
          {timeline.map(row => {
            const isSos  = row.kind === 'sos'
            const isKot  = row.kind === 'kot'
            const rec    = isSos ? row.sos : isKot ? row.kot : row.order
            const id     = (isSos ? 'sos-' : isKot ? 'kot-' : 'ord-') + rec.id
            const open   = expandedRow === id
            const st     = row.st
            // a KOT keeps its dishes as [{ name, qty, note }]
            const lines_ = isSos ? (rec.sos_request_items || []) : isKot
              ? (Array.isArray(rec.items) ? rec.items : []).map(i => ({ quantity: i.qty || i.quantity || 1, note: i.note || '', menu_items: { name: i.name } }))
              : (rec.order_items || [])
            const count  = isSos ? lines_.length : lines_.reduce((n, li) => n + (li.quantity || 1), 0)
            const w      = waiters.find(x => x.id === rec.waiter_id)
            const waiterName = rec.waiters?.name || w?.name || (isKot ? rec.waiter_label || '' : '')
            const waiterLabel = w ? waiterNo(w) : (isKot && rec.waiter_label ? rec.waiter_label : waiterName ? waiterNo({ name: waiterName }) : '')
            // Only ever set on a captain event
            const captainName = (isKot ? rec.captain_name : rec.captains?.name) || ''
            const tn = rec.tables?.table_number ?? rec.table_number ?? null
            const prn = isKot ? printerOf(rec) : null
            const prnText = !isKot ? '' : !rec.waiter_id ? (prn ? '🖨 ' + prn.name : '🖨 desk')
              : rec.print_status === 'printed' ? '🖨 ' + (prn ? prn.name : 'desk') + ' ✓'
              : rec.print_status === 'desk' ? '🖨 printed at the desk'
              : rec.print_status === 'failed' ? '🖨 not printed - ' + (prn ? prn.name : 'printer')
              : ['queued', 'printing'].includes(rec.print_status) ? '🖨 printing on ' + (prn ? prn.name : 'printer') + '…' : ''
            const tOn = tn != null && tableFilter === tn
            const timeStr = new Date(rec.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
            // Since the order came in (frozen once finished) - what the guest has waited
            const endTs = rec.delivered_at || rec.resolved_at
            const elapsedSec = Math.max(0, Math.floor(((endTs ? new Date(endTs).getTime() : nowTs) - new Date(rec.created_at).getTime()) / 1000))
            const clock = Math.floor(elapsedSec / 60) + ':' + String(elapsedSec % 60).padStart(2, '0')
            // Since the waiter got it - what DELAY is measured on
            const withMin = rec.assigned_at ? Math.max(0, Math.floor((nowTs - new Date(rec.assigned_at).getTime()) / 60000)) : 0
            const band = st === 'new' ? (isSos ? 'New help request' : 'New order')
                       : st === 'delay' ? 'Delay · ' + withMin + ' min with waiter ' + (waiterLabel || '')
                       : st === 'progress' ? (waiterLabel ? 'Waiter ' + waiterLabel + ' · ' + withMin + ' min' : 'In progress')
                       : st === 'done' ? (isSos ? 'Done ✓' : 'Delivered ✓')
                       : 'Cancelled'
            const shown = lines_.slice(0, 4)
            const nameOf = li => isSos ? li.item_name : (li.menu_items?.name || 'Item')
            return (
              <div key={id} className={'kt st-' + st} data-card={id}>
                <div className={'kt-band b-' + st}>{band}</div>
                <div className="kt-body" onClick={() => setExpandedRow(open ? null : id)}>
                  <div className="kt-head">
                    <span className={'kt-t' + (tOn ? ' on' : '')} title={tn != null ? 'Show only table ' + tn : ''}
                      onClick={e => { e.stopPropagation(); if (tn != null) setTableFilter(tOn ? null : tn) }}>T{tn ?? '?'}</span>
                    <span className={'kt-lbl' + (isSos ? ' help' : isKot ? ' cat' : '')} title={isKot ? rec.kot_no : ''}>
                      {isSos ? '🔔 Help' : isKot ? (rec.category_name || 'KOT') + ' · ' + count : count + (count === 1 ? ' item' : ' items')}</span>
                    <span className={'kt-w' + (waiterLabel ? '' : ' none')} title={waiterName ? 'Waiter ' + waiterName : 'No waiter yet'}>{waiterLabel || '–'}</span>
                  </div>
                  <div className="kt-meta">
                    <span>{timeStr}</span><span className="clk">⏱ {clock}{endTs ? ' ✓' : ''}</span>
                    {captainName && <span className="cap">🧑 {captainName}</span>}
                    {isKot && <span className={'prn' + (rec.print_status === 'failed' ? ' bad' : '')}>{rec.kot_no} · {prnText}</span>}
                  </div>
                  <ul className="kt-items">
                    {shown.map((li, k) => <li key={k}><b>{li.quantity || 1}×</b><span>{nameOf(li)}</span></li>)}
                    {lines_.length > shown.length && <li className="more">+ {lines_.length - shown.length} more</li>}
                  </ul>
                </div>
                <div className="kt-act">
                  {st === 'new' && <button className="kt-assign" disabled={assigning === (isSos ? 'sos-' : isKot ? 'kot-' : '') + rec.id} onClick={() => openPicker(isSos ? 'sos' : isKot ? 'kot' : 'order', rec)}>Assign waiter</button>}
                  {(st === 'progress' || st === 'delay') && (
                    <button className="kt-deliver" onClick={() => isSos ? resolveSOSRequest(rec.id) : isKot ? deliverKot(rec) : markDelivered(rec)}>✓ {isSos ? 'Done' : 'Delivered'}</button>
                  )}
                  <button className="kt-more" onClick={() => setExpandedRow(open ? null : id)} title="Details, print, cancel">{open ? '▲' : '⋯'}</button>
                </div>
                {open && (
                  <div className="kt-detail">
                    {captainName && <div style={{ color:'#2563EB', fontWeight:700, marginBottom:6 }}>Order taken by captain {captainName}</div>}
                    {waiterName && <div style={{ color:'#475569', fontWeight:700, marginBottom:6 }}>Waiter {waiterName}</div>}
                    {lines_.map((li, k) => (
                      <div className="ln" key={k}><span style={{ fontWeight:600 }}>{nameOf(li)}{li.note ? <em style={{ marginLeft:6, fontStyle:'normal', background:'#0F172A', color:'#fff', borderRadius:4, padding:'0 5px', fontSize:11 }}>{li.note}</em> : null}</span><span style={{ color:'#64748B' }}>x{li.quantity || 1}</span></div>
                    ))}
                    <div className="btns">
                      <button onClick={() => isSos ? printHelpKOT(rec) : isKot ? reprintKot(rec) : printKOT(rec)}>🖨 {isSos ? 'Print help slip' : 'Print KOT'}</button>
                      {(st === 'progress' || st === 'delay') && <button onClick={() => openPicker(isSos ? 'sos' : isKot ? 'kot' : 'order', rec)}>Change waiter</button>}
                      {!['delivered','cancelled','resolved'].includes(rec.status) && (
                        <button className="red" onClick={() => isSos ? cancelSOSRequest(rec.id) : isKot ? cancelKot(rec) : setShowCancelDialog(rec.id)}>✕ {isKot ? 'Cancel this KOT' : 'Cancel'}</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </>
      )}
      </div>
      {/* end scrolling list */}

      {picker && (
        <WaiterPicker waiters={waiters} busyOf={busyOf} current={picker.rec.waiter_id}
          title={'Assign waiter · Table ' + (picker.rec.tables?.table_number ?? picker.rec.table_number ?? '?') + (picker.kind === 'kot' ? ' · ' + (picker.rec.category_name || 'KOT') : '')}
          sub={picker.kind === 'sos' ? 'Help request'
            : picker.kind === 'kot' ? 'KOT ' + (picker.rec.kot_no || '') + ' · ' + (Array.isArray(picker.rec.items) ? picker.rec.items.reduce((n, i) => n + (i.qty || 1), 0) : 0) + ' items'
            : (picker.rec.order_items || []).reduce((n, li) => n + (li.quantity || 1), 0) + ' items · ' + new Date(picker.rec.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
          allowNone={picker.kind === 'order' && !picker.rec.waiter_id}
          onPick={pickWaiter} onAdd={addAndPick}
          onNone={() => { const r = picker.rec; setPicker(null); assignWaiter(r.id, null) }}
          onClose={() => setPicker(null)} />
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
