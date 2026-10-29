import { useState, useEffect, useRef, memo } from 'react'
import { supabase } from '../../lib/supabase'
import { armOrderBeep, playOrderBeep, orderSoundOn, setOrderSound } from '../../lib/orderBeep'
import { printKotWindow, kotAsOrder, helpAsOrder } from '../../lib/kotSlip'
import { AutoAssignBadge } from './AutoAssign'
import { watchChanges } from '../../lib/liveRev'

// A waiter who has had an order this long without delivering it shows DELAY
const DELAY_MIN = 5

/* The running clock on each card. Only these little clocks change every
   second; the rest of the screen is redrawn when an order changes (and every
   15 s for the DELAY minutes). Redrawing every card each second cost a slow
   tablet about 0.3 s a time, so taps waited behind it. One shared timer. */
const tickers = new Set()
let tickTimer = null
function useNowEverySecond() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const f = t => setNow(t)
    tickers.add(f)
    if (!tickTimer) tickTimer = setInterval(() => { const t = Date.now(); tickers.forEach(g => g(t)) }, 1000)
    return () => { tickers.delete(f); if (!tickers.size) { clearInterval(tickTimer); tickTimer = null } }
  }, [])
  return now
}
// m:ss, and h:mm:ss from an hour (an order left open overnight read "3170:27")
const clockText = sec => sec >= 3600
  ? Math.floor(sec / 3600) + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0')
  : Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')
const secsBetween = (a, b) => Math.max(0, Math.floor((b - new Date(a).getTime()) / 1000))
function RunningClock({ from }) {
  return clockText(secsBetween(from, useNowEverySecond()))
}
// Frozen once delivered / resolved: what the guest waited
function CardClock({ from, to }) {
  return to ? clockText(secsBetween(from, new Date(to).getTime())) + ' ✓' : <RunningClock from={from} />
}

// The number called across the hall: waiter_number, else the "(07)" in "Raju (07)", else the name
function waiterNo(w) {
  if (!w) return ''
  if (w.waiter_number != null && String(w.waiter_number).trim() !== '') return String(w.waiter_number).trim()
  const m = String(w.name || '').match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : String(w.name || '')
}
const normNo = v => String(v ?? '').trim().replace(/^0+(?=\d)/, '').toLowerCase()
// A KOT's number as people say it: "22", "k22", "K-022", "P1-022" -> "22" (the last number in it)
const kotKey = v => { const m = String(v ?? '').match(/(\d+)\D*$/); return m ? String(parseInt(m[1], 10)) : '' }
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

/* One card on Live Orders. Drawn again only when its own record, state or
   waiter changes (memo): with 150+ cards on a slow tablet, redrawing them all
   for every tap or new order is what made Delivered take seconds. The buttons
   call the screen's handlers through act (always the current ones). */
const Card = memo(function Card({ id, kind, rec, st, open, w, tOn, busy, prn, withMin, act }) {
  const isSos  = kind === 'sos'
  const isKot  = kind === 'kot'
  // a KOT keeps its dishes as [{ name, qty, note }]
  const lines_ = isSos ? (rec.sos_request_items || []) : isKot
    ? (Array.isArray(rec.items) ? rec.items : []).map(i => ({ quantity: i.qty || i.quantity || 1, note: i.note || '', menu_items: { name: i.name } }))
    : (rec.order_items || [])
  const count  = isSos ? lines_.length : lines_.reduce((n, li) => n + (li.quantity || 1), 0)
  const waiterName = rec.waiters?.name || w?.name || (isKot ? rec.waiter_label || '' : '')
  const waiterLabel = w ? waiterNo(w) : (isKot && rec.waiter_label ? rec.waiter_label : waiterName ? waiterNo({ name: waiterName }) : '')
  // Only ever set on a captain event
  const captainName = (isKot ? rec.captain_name : rec.captains?.name) || ''
  const tn = rec.tables?.table_number ?? rec.table_number ?? null
  const prnText = !isKot ? '' : !rec.waiter_id ? (prn ? '🖨 ' + prn.name : '🖨 desk')
    : rec.print_status === 'printed' ? '🖨 ' + (prn ? prn.name : 'desk') + ' ✓'
    : rec.print_status === 'desk' ? '🖨 printed at the desk'
    : rec.print_status === 'failed' ? '🖨 not printed - ' + (prn ? prn.name : 'printer')
    : ['queued', 'printing'].includes(rec.print_status) ? '🖨 printing on ' + (prn ? prn.name : 'printer') + '…' : ''
  const timeStr = new Date(rec.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
  // Since the order came in (frozen once finished) - what the guest has waited
  const endTs = rec.delivered_at || rec.resolved_at
  const band = st === 'new' ? (isSos ? 'New help request' : 'New order')
             : st === 'delay' ? 'Delay · ' + withMin + ' min with waiter ' + (waiterLabel || '')
             : st === 'progress' ? (waiterLabel ? 'Waiter ' + waiterLabel + ' · ' + withMin + ' min' : 'In progress')
             : st === 'done' ? (isSos ? 'Done ✓' : 'Delivered ✓')
             : 'Cancelled'
  const shown = lines_.slice(0, 4)
  const nameOf = li => isSos ? li.item_name : (li.menu_items?.name || 'Item')
  return (
    <div className={'kt st-' + st} data-card={id}>
      <div className={'kt-band b-' + st}>{band}</div>
      <div className="kt-body" onClick={() => act.current.toggle(id)}>
        <div className="kt-head">
          {isKot && rec.kot_no && <span className="kt-no" title={'KOT ' + rec.kot_no}>{rec.kot_no}</span>}
          {/* one slip per order (no KOT numbers): the order number, as printed on the slip */}
          {!isKot && !isSos && <span className="kt-no" title={'Order ' + String(rec.id).slice(-6).toUpperCase()}>{String(rec.id).slice(-6).toUpperCase()}</span>}
          <span className={'kt-t' + (tOn ? ' on' : '')} title={tn != null ? 'Show only table ' + tn : ''}
            onClick={e => { e.stopPropagation(); if (tn != null) act.current.table(tOn ? null : tn) }}>T{tn ?? '?'}</span>
          {!isKot && <span className={'kt-lbl' + (isSos ? ' help' : '')}>
            {isSos ? '🔔 Help' : count + (count === 1 ? ' item' : ' items')}</span>}
          <span className={'kt-w' + (waiterLabel ? '' : ' none')} title={waiterName ? 'Waiter ' + waiterName : 'No waiter yet'}>{waiterLabel || '–'}</span>
        </div>
        {isKot && <div className="kt-cat">{(rec.category_name || 'KOT') + ' · ' + count}</div>}
        <div className="kt-meta">
          <span>{timeStr}</span><span className="clk">⏱ <CardClock from={rec.created_at} to={endTs} /></span>
          {captainName && <span className="cap">🧑 {captainName}</span>}
          {isKot && <span className={'prn' + (rec.print_status === 'failed' ? ' bad' : '')}>{prnText}</span>}
        </div>
        <ul className="kt-items">
          {shown.map((li, k) => <li key={k}><b>{li.quantity || 1}×</b><span>{nameOf(li)}</span></li>)}
          {lines_.length > shown.length && <li className="more">+ {lines_.length - shown.length} more</li>}
        </ul>
      </div>
      <div className="kt-act">
        {st === 'new' && <button className="kt-assign" disabled={busy} onClick={() => act.current.openPicker(isSos ? 'sos' : isKot ? 'kot' : 'order', rec)}>Assign waiter</button>}
        {(st === 'progress' || st === 'delay') && (
          <button className="kt-deliver" onClick={() => isSos ? act.current.resolveSOSRequest(rec.id) : isKot ? act.current.deliverKot(rec) : act.current.markDelivered(rec)}>✓ {isSos ? 'Done' : 'Delivered'}</button>
        )}
        <button className="kt-more" onClick={() => act.current.toggle(id)} title="Details, print, cancel">{open ? '▲' : '⋯'}</button>
      </div>
      {open && (
        <div className="kt-detail">
          {captainName && <div style={{ color:'#2563EB', fontWeight:700, marginBottom:6 }}>Order taken by captain {captainName}</div>}
          {waiterName && <div style={{ color:'#475569', fontWeight:700, marginBottom:6 }}>Waiter {waiterName}</div>}
          {lines_.map((li, k) => (
            <div className="ln" key={k}><span style={{ fontWeight:600 }}>{nameOf(li)}{li.note ? <em style={{ marginLeft:6, fontStyle:'normal', background:'#0F172A', color:'#fff', borderRadius:4, padding:'0 5px', fontSize:11 }}>{li.note}</em> : null}</span><span style={{ color:'#64748B' }}>x{li.quantity || 1}</span></div>
          ))}
          <div className="btns">
            <button onClick={() => isSos ? act.current.printHelpKOT(rec) : isKot ? act.current.reprintKot(rec) : act.current.printKOT(rec)}>🖨 {isSos ? 'Print help slip' : 'Print KOT'}</button>
            {(st === 'progress' || st === 'delay') && <button onClick={() => act.current.openPicker(isSos ? 'sos' : isKot ? 'kot' : 'order', rec)}>Change waiter</button>}
            {!['delivered','cancelled','resolved'].includes(rec.status) && (
              <button className="red" onClick={() => isSos ? act.current.cancelSOSRequest(rec.id) : isKot ? act.current.cancelKot(rec) : act.current.cancelOrder(rec.id)}>✕ {isKot ? 'Cancel this KOT' : 'Cancel'}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

const BUILD_VERSION = 'v2.10.1 \u00B7 2026-10-29'
// this device's Live Orders tab (new / assigned)
const LIVE_TAB_KEY = 'ss_live_tab'

const STATUS_LABELS = { pending:'Order Received', placed:'Order Received', in_progress:'Waiter On The Way', delivered:'Delivered', cancelled:'Cancelled' }
const STATUS_COLORS = { pending:'#D97706', placed:'#D97706', in_progress:'#2563EB', delivered:'#16A34A', cancelled:'#DC2626' }

export default function KOTDashboard({ eventData, onOrderCountChange, onNewOrder }) {
  const [orders, setOrders] = useState([])
  const [sosRequests, setSosRequests] = useState([])
  const [waiters, setWaiters] = useState([])
  /* Tabs. "Active" is split in two, so one person can work only the new orders
     (assign a waiter) and another only the assigned ones (mark Delivered):
       new       - nobody on it yet
       assigned  - a waiter has it (incl. DELAY)
     Both load the same open orders; the split is on screen only. Each device
     remembers its own tab (new / assigned), so the helper's tablet always
     opens on "To deliver". filter is what is downloaded: active = both. */
  const [tab, setTabState] = useState(() => {
    try { const v = localStorage.getItem(LIVE_TAB_KEY); return v === 'assigned' ? 'assigned' : 'new' } catch { return 'new' }
  })
  const setTab = v => {
    setTabState(v)
    if (v === 'new' || v === 'assigned') { try { localStorage.setItem(LIVE_TAB_KEY, v) } catch { /* private mode */ } }
  }
  const openTab = () => { try { return localStorage.getItem(LIVE_TAB_KEY) === 'assigned' ? 'assigned' : 'new' } catch { return 'new' } }
  const filter = tab === 'new' || tab === 'assigned' ? 'active' : tab
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState(null)
  // Only one row open at a time, so the list cannot grow unmanageable
  const [expandedRow, setExpandedRow] = useState(null)
  // Handlers run before the reload lands, so they read the count from here
  const timelineRef = useRef(0)
  const [nowTs, setNowTs] = useState(Date.now())
  // DELAY and "n min with waiter" are whole minutes: 15 s is plenty (the clocks tick on their own)
  useEffect(() => { const t = setInterval(() => setNowTs(Date.now()), 15000); return () => clearInterval(t) }, [])
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
  // Find a KOT by its number (runners and counters work by KOT number): "22", "k22", "K-022"
  const [kotQuery, setKotQuery] = useState('')
  const [tableFilter, setTableFilter] = useState(null)
  // the Table box shows the table filter, also when it was set by tapping T7 on a card
  const [tableText, setTableText] = useState('')
  const tableShown = tableFilter == null ? '' : tableText !== '' && parseInt(tableText, 10) === tableFilter ? tableText : String(tableFilter)
  const prevCount = useRef(-1)
  const splitRef = useRef(new Set()) // orders split into KOTs: their KOT cards stand for them

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

  /* What Live Orders downloads.

     It used to download EVERY order and KOT of the evening, with all their
     dishes, every 4 seconds: about 1.3 MB per refresh by the end of a 500-order
     evening, on every desk, over the event Wi-Fi. A desk that is not the
     laptop itself (an iPad, a second laptop) then fell behind: taps waited
     behind those downloads and Delivered took 20-30 seconds.

     Now: the Active tab downloads only what is still open (orders not yet
     delivered, open KOTs, open help requests) - a few KB. Delivered /
     Cancelled / All download the latest 100 when that tab is opened. On the
     laptop the lists reload only when something changed (lib/liveRev). */
  const ACTIVE_ORDER = ['pending', 'placed', 'in_progress']
  const HISTORY_LIMIT = 100
  const filterRef = useRef(filter)
  filterRef.current = filter
  const lastSig = useRef({})
  const kotQRef = useRef('')
  const [foundKots, setFoundKots] = useState(null) // KOT finder results (any status), from the server
  // Records tapped Delivered / Done here: off the Active list at once, while the server saves it
  const [doneLocal, setDoneLocal] = useState(() => new Set())
  const inflight = useRef(new Set())
  // Every load is numbered; an answer older than one already shown is dropped
  const seq = useRef({ orders: 0, ordersShown: 0, sos: 0, sosShown: 0 })
  const [actionErr, setActionErr] = useState('')

  /* The list to show, or null when nothing in it changed (no redraw at all).
     A record that is exactly as before keeps its old object, so its card is
     not redrawn either: a new order redraws one card, not the whole board. */
  const settle = (key, list) => {
    const last = lastSig.current[key] || { byId: new Map(), list: null }
    const byId = new Map()
    const out = list.map(x => {
      const sig = JSON.stringify(x)
      const id = x?.id ?? sig
      const had = last.byId.get(id)
      const keep = had && had[0] === sig ? had[1] : x
      byId.set(id, [sig, keep])
      return keep
    })
    const same = last.list && last.list.length === out.length && last.list.every((x, i) => x === out[i])
    lastSig.current[key] = { byId, list: same ? last.list : out }
    return same ? null : out
  }

  useEffect(() => {
    if (!eventData) return
    lastSig.current = {}
    loadWaiters(); loadOrders(true); loadSOS()
    // on the laptop: the change counter is checked every second, so a new order shows within about a second
    const stop = watchChanges(() => Promise.all([loadOrders(false), loadSOS()]), { cloudMs: 4000, everyMs: 1000 })
    return stop
  }, [eventData])

  // a history tab reloads its list when it is opened
  useEffect(() => { if (eventData) { loadOrders(false); loadSOS() } }, [filter])

  async function loadWaiters() {
    const { data } = await supabase.from('waiters').select('*').eq('event_id', eventData.id).eq('is_active', true)
    setWaiters(data || [])
  }

  async function loadSOS() {
    if (!eventData) return
    const sel = '*, tables(table_number), sos_request_items(item_name, quantity), captains(name)'
    const f = filterRef.current
    const my = ++seq.current.sos
    const active = supabase.from('sos_requests').select(sel).eq('event_id', eventData.id)
      .not('status', 'in', '(resolved,cancelled)').order('created_at', { ascending: false })
    const hist = f === 'active' ? null : (() => {
      let q = supabase.from('sos_requests').select(sel).eq('event_id', eventData.id)
      if (f === 'delivered') q = q.eq('status', 'resolved')
      else if (f === 'cancelled') q = q.eq('status', 'cancelled')
      return q.order('created_at', { ascending: false }).limit(HISTORY_LIMIT)
    })()
    const [a, h] = await Promise.all([active, hist || Promise.resolve({ data: [] })])
    if (a.error || h.error) return
    if (my < seq.current.sosShown) return // a newer answer is already on screen
    seq.current.sosShown = my
    const byId = new Map()
    for (const r of [...(a.data || []), ...(h.data || [])]) byId.set(r.id, r)
    const list = [...byId.values()].sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    const sl = settle('sos', list)
    if (sl) setSosRequests(sl)
  }

  function formatTimer(assignedAt) {
    if (!assignedAt) return null
    const secs = Math.floor((Date.now() - new Date(assignedAt).getTime()) / 1000)
    const m = Math.floor(secs/60), s = secs % 60
    return { str: m + ':' + String(s).padStart(2,'0'), mins: m }
  }

  // Which of these orders were split into KOTs (their cards are the KOTs)
  async function kotOrderIds(ids) {
    const out = new Set()
    for (let i = 0; i < ids.length; i += 60) {
      const { data, error } = await supabase.from('kots').select('order_id').eq('kind', 'order').in('order_id', ids.slice(i, i + 60))
      if (error) return null
      for (const r of data || []) out.add(r.order_id)
    }
    return out
  }

  async function loadOrders(showSpinner = false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const f = filterRef.current
    const my = ++seq.current.orders
    const OSEL = '*, tables(table_number), order_items(quantity, menu_items(name, is_live_counter)), waiters(name), captains(name), assigned_at'
    const KSEL = 'id,order_id,kitchen_id,kot_no,table_number,captain_name,category_name,items,status,print_status,last_error,waiter_id,waiter_label,assigned_at,delivered_at,cancelled_at,created_at,printed_at'
    const histStatus = f === 'delivered' ? 'delivered' : f === 'cancelled' ? 'cancelled' : null
    const qs = [
      supabase.from('orders').select(OSEL).eq('event_id', eventData.id).in('status', ACTIVE_ORDER).order('created_at', { ascending: false }),
      f === 'active' ? null : (() => {
        let q = supabase.from('orders').select(OSEL).eq('event_id', eventData.id)
        if (histStatus) q = q.eq('status', histStatus)
        return q.order('created_at', { ascending: false }).limit(HISTORY_LIMIT)
      })(),
    ]
    if (eventData.kot_per_category) {
      qs.push(supabase.from('kots').select(KSEL).eq('event_id', eventData.id).eq('kind', 'order').eq('status', 'open').order('created_at', { ascending: false }))
      qs.push(f === 'active' ? null : (() => {
        let q = supabase.from('kots').select(KSEL).eq('event_id', eventData.id).eq('kind', 'order')
        if (histStatus) q = q.eq('status', histStatus)
        return q.order('created_at', { ascending: false }).limit(HISTORY_LIMIT * 2)
      })())
      qs.push(supabase.from('kitchens').select('id,name,printer_ip,printer_status,is_active').eq('event_id', eventData.id))
    }
    const res = await Promise.all(qs.map(q => q || Promise.resolve({ data: [] })))
    if (res.some(r => r.error)) { if (showSpinner) setLoading(false); return } // keep what is on screen
    const [ao, ho, ak, hk, ks] = res
    const fresh = () => my >= seq.current.ordersShown
    const oById = new Map()
    for (const o of [...(ao.data || []), ...(ho.data || [])]) oById.set(o.id, o)
    const all = [...oById.values()].sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    if (eventData.kot_per_category) {
      const kById = new Map()
      for (const k of [...(ak.data || []), ...(hk.data || [])]) kById.set(k.id, k)
      const kl = [...kById.values()].sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
      // orders whose KOTs are not in the lists above (older KOTs of a history order)
      const known = new Set(kl.map(k => k.order_id))
      const ask = all.filter(o => !known.has(o.id)).map(o => o.id)
      const split = ask.length ? await kotOrderIds(ask) : new Set()
      if (!fresh()) { if (showSpinner) setLoading(false); return } // a newer answer is already on screen
      seq.current.ordersShown = my
      if (split) for (const id of split) known.add(id)
      splitRef.current = known
      // the KOT finder's cards follow the same reloads
      if (kotQRef.current) searchKots(kotQRef.current)
      const kNew = settle('kots', kl)
      if (kNew) setKots(kNew)
      const pNew = ks.error ? null : settle('printers', ks.data || [])
      if (pNew) setPrinters(pNew)
    }
    if (!eventData.kot_per_category) {
      if (!fresh()) { if (showSpinner) setLoading(false); return }
      seq.current.ordersShown = my
    }
    const activeList = ao.data || []
    const activeCount = activeList.length
    if (prevCount.current >= 0 && activeCount > prevCount.current) {
      // a beep; the new card itself flashes NEW ORDER (no banner across the top)
      if (onNewOrder) onNewOrder(activeList.find(o => o.status === 'placed'))
      playOrderBeep()
    }
    prevCount.current = activeCount
    const oNew = settle('orders', all)
    if (oNew) setOrders(oNew)
    onOrderCountChange(activeCount)
    // records tapped here that the server now shows as finished: no longer needed
    setDoneLocal(prev => {
      if (!prev.size) return prev
      const open = new Set([...activeList.map(o => 'ord-' + o.id), ...((ak && ak.data) || []).map(k => 'kot-' + k.id)])
      const next = new Set([...prev].filter(k => k.startsWith('sos-') || open.has(k) || inflight.current.has(k)))
      return next.size === prev.size ? prev : next
    })
    if (showSpinner) setLoading(false)
  }

  // KOT finder: asks the server, any status, so it works on a long evening too
  useEffect(() => {
    const q = kotKey(kotQuery)
    kotQRef.current = q
    if (!q || !eventData?.kot_per_category) { setFoundKots(null); return }
    const t = setTimeout(() => searchKots(q), 250)
    return () => clearTimeout(t)
  }, [kotQuery, eventData?.id, eventData?.kot_per_category])

  async function searchKots(q) {
    const { data, error } = await supabase.from('kots')
      .select('id,order_id,kitchen_id,kot_no,table_number,captain_name,category_name,items,status,print_status,last_error,waiter_id,waiter_label,assigned_at,delivered_at,cancelled_at,created_at,printed_at')
      .eq('event_id', eventData.id).eq('kind', 'order').ilike('kot_no', '%-' + q.padStart(3, '0')).order('created_at', { ascending: false }).limit(40)
    if (kotQRef.current !== q) return
    if (!error) setFoundKots(data || [])
  }

  /* Delivered / Done / Cancel KOT: the card leaves the Active list at once and
     the save goes on in the background (tried again if the network drops).
     A second tap on the same card does nothing - and the save itself is safe
     to repeat. */
  async function actNow(key, fn, label) {
    if (inflight.current.has(key)) return
    inflight.current.add(key)
    setDoneLocal(prev => new Set(prev).add(key))
    let ok = false, lastErr = null
    // no code = no answer; SS503 / PGRST00x / 5xx-type codes = the server was busy: try again
    const retryable = e => !e?.code || /^(SS503|PGRST00\d|57014|53300|40001|40P01)$/.test(e.code)
    for (let n = 0; n < 4 && !ok; n++) {
      try {
        const r = await fn()
        if (r && r.error) { lastErr = r.error; if (!retryable(r.error)) break } else ok = true
      } catch (e) { lastErr = e }
      if (!ok) await new Promise(r => setTimeout(r, 1000 * (n + 1)))
    }
    inflight.current.delete(key)
    if (!ok) {
      setDoneLocal(prev => { const next = new Set(prev); next.delete(key); return next })
      // a banner, not a pop-up: a pop-up would stop this desk's auto-assign and printing until someone taps OK
      setActionErr('Not saved: ' + label + '. The card is back - tap it again.' + (lastErr?.message ? ' (' + lastErr.message + ')' : ''))
    } else setActionErr('')
    await Promise.all([loadOrders(false), loadSOS()])
  }

  function toggleSound() {
    const v = !soundOn
    setSoundOn(v); setOrderSound(v)
    if (v) setTimeout(playOrderBeep, 50)
  }

  /* Save the waiter and get the saved row back in the same request. If that
     answer is lost (Wi-Fi), ask once more: the row is returned only if it now
     has this waiter (then the slip still prints); null = not confirmed. */
  // openOnly: save only while the order is still open. A guest can now cancel an
  // order a waiter already has, so a late "Change waiter" must not bring a
  // cancelled order back. Returns 'closed' when it was no longer open.
  async function saveAndRead(table, id, patch, sel, waiterId, openOnly) {
    try {
      let q = supabase.from(table).update(patch).eq('id', id)
      if (openOnly) q = q.in('status', ACTIVE_ORDER)
      const { data, error } = await q.select(sel)
      const row = !error && (Array.isArray(data) ? data[0] : data)
      if (row) return row
      if (!error && openOnly && Array.isArray(data) && !data.length) return 'closed'
    } catch { /* asked again below */ }
    if (!waiterId) return null
    try {
      const { data } = await supabase.from(table).select(sel).eq('id', id).maybeSingle()
      return data && data.waiter_id === waiterId && (!openOnly || ACTIVE_ORDER.includes(data.status)) ? data : null
    } catch { return null }
  }

  async function assignWaiter(orderId, waiterId) {
    setAssigning(orderId)
    // Auto-print the KOT the moment a waiter is assigned. The saved order comes
    // back in the same answer (one trip to the server, not two) and prints at
    // once. The manual "Print KOT" button stays for reprints, printer outages,
    // network drops or power cuts - nothing about it changes.
    const SEL = '*, tables(table_number), waiters(name), captains(name), order_items(quantity, menu_items(name, is_veg))'
    const fresh = await saveAndRead('orders', orderId,
      { status:'in_progress', waiter_id:waiterId||null, assigned_at:waiterId?new Date().toISOString():null }, SEL, waiterId, true)
    setAssigning(null)
    if (fresh === 'closed') {
      setActionErr('Table ' + (orders.find(o => o.id === orderId)?.tables?.table_number ?? '?') + ': this order was already cancelled or delivered, so no waiter was assigned.')
      loadOrders(false)
      return
    }
    if (waiterId && fresh && autoPrint) { try { printKOT(fresh) } catch { /* never block assignment if printing fails */ } }
    if (waiterId && !fresh) setActionErr('Waiter not confirmed for table ' + (orders.find(o => o.id === orderId)?.tables?.table_number ?? '?') + ' (no answer from the server). Check the card: assign again, or tap Print KOT once it shows the waiter.')
    loadOrders(false)
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
    // Help requests auto-print exactly like orders do, so the waiter
    // walks over already knowing what to carry. Same single trip as orders.
    const SEL = '*, tables(table_number), waiters(name), captains(name), sos_request_items(item_name, quantity)'
    const fresh = await saveAndRead('sos_requests', sosId,
      { status:'in_progress', waiter_id:waiterId||null, assigned_at:waiterId?new Date().toISOString():null }, SEL, waiterId)
    setAssigning(null)
    if (waiterId && fresh && autoPrint) { try { printHelpKOT(fresh) } catch { /* never block assignment if printing fails */ } }
    if (waiterId && !fresh) setActionErr('Waiter not confirmed for the help request at table ' + (sosRequests.find(r => r.id === sosId)?.tables?.table_number ?? '?') + ' (no answer from the server). Check the card: assign again, or tap Print help slip once it shows the waiter.')
    loadSOS()
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
    setWaiterFilter(null); setTableFilter(null)
    setTabState(openTab())
  }

  function markDelivered(order) {
    // timeline still holds the record just actioned, hence the minus one
    clearFiltersIfEmpty(timelineRef.current - 1)
    return actNow('ord-' + order.id, () => supabase.from('orders')
      .update({ status:'delivered', delivered_at:new Date().toISOString() }).eq('id', order.id).in('status', ACTIVE_ORDER), 'Delivered')
  }

  function resolveSOSRequest(sosId) {
    clearFiltersIfEmpty(timelineRef.current - 1)
    return actNow('sos-' + sosId, () => supabase.from('sos_requests')
      .update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', sosId).not('status', 'in', '(resolved,cancelled)'), 'Done')
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
    }).eq('id', showCancelDialog).in('status', ACTIVE_ORDER)
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

  const splitOrders = kotMode ? new Set([...kots.map(k => k.order_id), ...splitRef.current]) : new Set()
  const kotQ = kotKey(kotQuery)
  const hiddenNow = key => filter === 'active' && doneLocal.has(key)
  const filteredKots = !kotMode ? [] : kotQ ? (foundKots || kots).filter(k => kotKey(k.kot_no) === kotQ && !inflight.current.has('kot-' + k.id)) : kots.filter(k => {
    if (hiddenNow('kot-' + k.id)) return false
    const matchFilter = filter === 'active' ? k.status === 'open' : filter === 'delivered' ? k.status === 'delivered'
      : filter === 'cancelled' ? k.status === 'cancelled' : true
    return matchFilter && (!waiterFilter || k.waiter_id === waiterFilter) && (!tableFilter || k.table_number === tableFilter)
  })
  const filteredOrders = kotQ ? [] : orders.filter(o => !splitOrders.has(o.id) && !hiddenNow('ord-' + o.id)).filter(o => {
    const matchFilter = filter==='active'?!['delivered','cancelled'].includes(o.status):filter==='delivered'?o.status==='delivered':filter==='cancelled'?o.status==='cancelled':true
    const matchWaiter = !waiterFilter||o.waiter_id===waiterFilter
    const matchTable = !tableFilter||o.tables?.table_number===tableFilter
    return matchFilter&&matchWaiter&&matchTable
  })

  // Help requests follow the same tab rules as orders, so a supervisor can
  // look back at what was handled instead of only what is outstanding.
  const filteredSOS = kotQ ? [] : sosRequests.filter(r => {
    if (hiddenNow('sos-' + r.id)) return false
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
  const timelineAll = [
    ...filteredSOS.map(r => ({ kind:'sos', at:r.created_at, sos:r, st:cardState(r, true) })),
    ...filteredOrders.map(o => ({ kind:'order', at:o.created_at, order:o, st:cardState(o, false) })),
    ...filteredKots.map(k => ({ kind:'kot', at:k.created_at, kot:k, st:cardState(k, false, true) })),
  ].sort((a, b) => filter === 'active'
    ? (RANK[a.st] - RANK[b.st]) || (new Date(a.at) - new Date(b.at))
    : new Date(b.at) - new Date(a.at))
  // New / Assigned: the same open list, split (the KOT finder shows its KOT on any tab)
  const isNewRow = r => r.st === 'new'
  const isAssignedRow = r => r.st === 'progress' || r.st === 'delay'
  const countNew = filter === 'active' && !kotQ ? timelineAll.filter(isNewRow).length : null
  const countAssigned = filter === 'active' && !kotQ ? timelineAll.filter(isAssignedRow).length : null
  const timeline = filter !== 'active' || kotQ ? timelineAll : timelineAll.filter(tab === 'new' ? isNewRow : isAssignedRow)
  // what is left to act on under the filters: both New and Assigned (a table
  // filter stays while that table still has a new order on the other tab)
  timelineRef.current = timelineAll.length

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
    if (error) { setActionErr('Not assigned: KOT ' + (k.kot_no || '') + ' - tap it again.' + (error.message ? ' (' + error.message + ')' : '')); loadOrders(false); return }
    // no kitchen printer for this category: printed here, at once, as the desk always did
    if (data?.print === 'desk' && autoPrint) { try { printKotSlip(k, data.waiter) } catch { /* the reprint button stays */ } }
    loadOrders(false)
  }
  function deliverKot(k) {
    clearFiltersIfEmpty(timelineRef.current - 1)
    return actNow('kot-' + k.id, () => supabase.rpc('ss_kot_deliver', { p_kot_id: k.id }), 'Delivered for KOT ' + (k.kot_no || ''))
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

  // what the cards' buttons call: refreshed on every draw, so a card that was not redrawn still calls the current handlers
  const actRef = useRef(null)
  actRef.current = {
    toggle: id => setExpandedRow(cur => cur === id ? null : id),
    table: tn => setTableFilter(tn),
    openPicker, resolveSOSRequest, deliverKot, markDelivered, printHelpKOT, reprintKot, printKOT, cancelSOSRequest, cancelKot,
    cancelOrder: oid => setShowCancelDialog(oid),
  }

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
                <div key={w.id} onClick={()=>{ setWaiterFilter(sel?null:w.id); if (!sel && tab === 'new') setTabState('assigned'); if (sel && filter === 'active') setTabState(openTab()) }} title={w.name}
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

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
          {/* Table: only that table's orders, on every tab ("where is my order?") */}
          <div style={{ display:'flex', alignItems:'center', gap:6, background:'#fff', border:'2px solid ' + (tableFilter != null ? '#0F172A' : '#CBD5E1'),
            borderRadius:12, padding:'4px 6px 4px 12px', boxShadow:'var(--shadow)' }}>
            <span style={{ fontSize:13, fontWeight:900, color:'#0F172A' }}>Table</span>
            <input data-testid="table-find" value={tableShown} inputMode="numeric" placeholder="e.g. 7"
              onChange={e => { const v = e.target.value.replace(/[^\d]/g, '').slice(0, 4); setTableText(v); setTableFilter(v === '' ? null : parseInt(v, 10)) }}
              onKeyDown={e => { if (e.key === 'Escape') setTableFilter(null) }}
              style={{ width:64, border:'none', outline:'none', fontSize:20, fontWeight:900,
                fontVariantNumeric:'tabular-nums', padding:'4px 2px', background:'transparent' }} />
            {tableFilter != null && <button onClick={() => setTableFilter(null)} title="All tables again"
              style={{ border:'none', background:'#F1F5F9', borderRadius:999, width:30, height:30, fontSize:14, cursor:'pointer' }}>✕</button>}
          </div>
        {kotMode && (
          <div style={{ display:'flex', alignItems:'center', gap:6, background:'#fff', border:'2px solid ' + (kotQ ? '#0F172A' : '#CBD5E1'),
            borderRadius:12, padding:'4px 6px 4px 12px', boxShadow:'var(--shadow)' }}>
            <span style={{ fontSize:13, fontWeight:900, color:'#0F172A' }}>KOT no.</span>
            <input data-testid="kot-find" value={kotQuery} onChange={e => setKotQuery(e.target.value)} inputMode="numeric"
              onKeyDown={e => { if (e.key === 'Escape') setKotQuery('') }}
              placeholder="e.g. 22" style={{ width:90, border:'none', outline:'none', fontSize:20, fontWeight:900,
                fontVariantNumeric:'tabular-nums', padding:'4px 2px', background:'transparent' }} />
            {kotQuery && <button onClick={() => setKotQuery('')} title="Show all again"
              style={{ border:'none', background:'#F1F5F9', borderRadius:999, width:30, height:30, fontSize:14, cursor:'pointer' }}>✕</button>}
          </div>
        )}
          {kotQ && <span style={{ fontSize:13, fontWeight:700, color: filteredKots.length ? '#15803D' : '#B91C1C' }}>
            {filteredKots.length ? 'Showing KOT ' + kotQ + ' (any status). Tap Delivered on it.' : 'No KOT with number ' + kotQ + '.'}</span>}
      </div>

      {!kotMode && (
        <div data-testid="no-kot-numbers" style={{ background:'#FFFBEB', border:'1.5px solid #FCD34D', borderRadius:10, padding:'7px 12px', marginBottom:10, fontSize:13, color:'#92400E', fontWeight:700 }}>
          This event prints one slip per order, so there are no KOT numbers. For KOT numbers (by category or course, like the guest events): Control › KOT printing › One KOT per category.
        </div>
      )}

      {actionErr && (
        <div role="alert" data-testid="action-error" style={{ background:'#FEF2F2', border:'1.5px solid #FCA5A5', borderRadius:10, padding:'8px 12px', marginBottom:10,
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, fontSize:13, fontWeight:700, color:'#B91C1C' }}>
          <span>{actionErr}</span>
          <button onClick={() => setActionErr('')} style={{ background:'none', border:'none', color:'#B91C1C', fontWeight:900, cursor:'pointer' }}>✕</button>
        </div>
      )}

      {(waiterFilter||tableFilter) && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10, padding:'8px 14px', marginBottom:10, display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
          <span style={{ fontWeight:700, color:'#92400E' }}>🔍 {waiterFilter&&<>Waiter: {waiters.find(w=>w.id===waiterFilter)?.name}</>}{waiterFilter&&tableFilter&&' · '}{tableFilter&&<>Table: {tableFilter}</>}</span>
          <button onClick={()=>{ setWaiterFilter(null); setTableFilter(null) }} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer' }}>Clear ✕</button>
        </div>
      )}

      <div className="lo-tabs" style={{ display:'flex', gap:8, paddingBottom:14 }}>
        {[['new','🆕 New','to assign', countNew, '#1D4ED8'],
          ['assigned','🚶 Assigned','to deliver', countAssigned, '#15803D'],
          ['delivered','Delivered'],['cancelled','Cancelled'],['all','All']].map(([val, label, sub, n, col]) => {
          const on = tab === val
          return (
            <button key={val} data-testid={'tab-' + val} onClick={() => setTab(val)}
              style={{ flex: sub ? 1.6 : 1, padding:'7px 4px', minWidth:0,
                background: on ? (col || 'var(--ink)') : '#fff', color: on ? '#fff' : (col || 'var(--ink)'),
                border:'1.5px solid', borderColor: on ? (col || 'var(--ink)') : (col ? col + '66' : 'var(--line)'),
                borderRadius:10, fontSize:13, fontWeight:800, lineHeight:1.15, display:'flex', flexDirection:'column', alignItems:'center' }}>
              <span style={{ whiteSpace:'nowrap' }}>{label}{n != null && <span data-testid={'count-' + val} style={{ marginLeft:6, background: on ? 'rgba(255,255,255,0.25)' : col + '1A',
                borderRadius:999, padding:'0 7px', fontSize:12.5 }}>{n}</span>}</span>
              {sub && <span style={{ fontSize:10.5, fontWeight:700, opacity:0.8 }}>{sub}</span>}
            </button>
          )
        })}
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
            .kt { background:#fff; border:1px solid #E5E7EB; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 1px 2px rgba(15,23,42,.05);
                  content-visibility:auto; contain-intrinsic-size:auto 190px; }
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
            .kt-no { font-size:28px; font-weight:900; color:#fff; background:#0F172A; border-radius:8px; padding:1px 9px; letter-spacing:.5px; font-variant-numeric:tabular-nums; white-space:nowrap; }
            .kt-cat { display:inline-block; margin-top:6px; font-size:12px; font-weight:800; color:#3730A3; background:#EEF2FF; border-radius:999px; padding:2px 9px; text-transform:uppercase; letter-spacing:.02em; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
            .kt-deliver { flex:1; background:#16A34A; color:#fff; border:none; font-size:16px !important; padding:11px 10px !important; }
            .kt-deliver:active { background:#15803D; }
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
            const rec = row.kind === 'sos' ? row.sos : row.kind === 'kot' ? row.kot : row.order
            const id  = (row.kind === 'sos' ? 'sos-' : row.kind === 'kot' ? 'kot-' : 'ord-') + rec.id
            const tn  = rec.tables?.table_number ?? rec.table_number ?? null
            return (
              <Card key={id} id={id} kind={row.kind} rec={rec} st={row.st}
                open={expandedRow === id}
                w={waiters.find(x => x.id === rec.waiter_id) || null}
                tOn={tn != null && tableFilter === tn}
                busy={assigning === (row.kind === 'sos' ? 'sos-' : row.kind === 'kot' ? 'kot-' : '') + rec.id}
                prn={row.kind === 'kot' ? printerOf(rec) : null}
                withMin={rec.assigned_at ? Math.max(0, Math.floor((nowTs - new Date(rec.assigned_at).getTime()) / 60000)) : 0}
                act={actRef} />
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
