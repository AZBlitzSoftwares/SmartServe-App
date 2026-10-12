/* Smart Serve Maestro - Captain App (table captain tablet).

   Two screens, one tap apart:
     Take order    pick the cover, then a cuisine and a course, and tap + on a dish. Every tap is
                   saved at once (no Save button): the dish is held for the cover, nothing reaches
                   a kitchen. Each dish has its own Fire button: fired, it goes to its kitchen as a
                   KOT of its own. Notes and allergies per dish, and a guest note for everything
                   the guest orders. Delivered dishes leave the order after a few minutes (event
                   setting); Show delivered brings them back for a moment.
     Course board  every cover x every course at a glance; tap held dishes, Fire.
   VIP guests: the VIP button lists the event's VIP guests. Choose one and the cover: their
   allergies, dislikes and notes go on every KOT of that cover, and their preferred dishes are
   added to the cover's order. A VIP with a fixed table and cover is loaded by itself when the
   captain opens that cover.
   Two captains can share a table and split its covers (Event set-up > Captains). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import {
  coursesOf, courseRank, lateMinutes, dishStatus, deliveredAt, useLive, useNow, loadMenu, rpc, rpcRetry, errText, newRef,
  QUICK_NOTES, splitNote, joinNote, servedHideMinutes, ago, shortName, tc, coverRange, rangeText, tableRanges, capOrder,
} from './msData'

const FOODS = ['#7DAA6A', '#7A3B2A', '#D5532F', '#A66A2C', '#C9A15B', '#B5582A', '#8E6BBF', '#3F8F8A', '#C98B2E']
const ALL = '__all'
const SHOW_DELIVERED_MS = 10000   // Show delivered: 10 seconds to read them, then they hide again

function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

// Small square photo for the menu rows (the plate drawing when there is no photo)
function DishThumb({ dish }) {
  const [broken, setBroken] = useState(false)
  if (dish.photo_url && !broken) {
    return <div className="thumb"><img src={dish.photo_url} alt="" loading="lazy" onError={() => setBroken(true)} /></div>
  }
  const f = FOODS[hash(dish.name) % FOODS.length]
  return (
    <div className="thumb" style={{ background: 'linear-gradient(135deg,#F0E4CC,#fff)' }}>
      <div className="food" style={{ width: 30, height: 30, margin: '-15px 0 0 -15px', background: `radial-gradient(circle at 35% 35%,${f}cc,${f})` }} />
    </div>
  )
}

// Cancel a dish already sent: a second tap, because it prints a CANCEL slip in the kitchen.
function CancelFired({ disabled, onCancel }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return armed
    ? <button className="x arm" disabled={disabled} onClick={() => { setArmed(false); onCancel() }}>Cancel?</button>
    : <button className="x" disabled={disabled} onClick={() => setArmed(true)} title="Cancel this dish (sent by mistake)">✕</button>
}

// A second tap for actions that undo the guest's order (New guest, Remove VIP)
function Sure({ label, sure, disabled, onYes, cls = 'minib' }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return armed
    ? <button className={cls + ' arm'} disabled={disabled} onClick={() => { setArmed(false); onYes() }}>{sure}</button>
    : <button className={cls} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>
}

function Veg({ veg }) { return <span className={'veg' + (veg === false ? ' nv' : '')} /> }

// My covers | All covers (like My dishes | Entire kitchen on the kitchen screen)
function Scope({ myRange, showAll, onToggle }) {
  if (!myRange) return null
  return (
    <div className="scope">
      <button className={showAll ? '' : 'a'} onClick={() => showAll && onToggle()}>My covers · {rangeText(myRange)}</button>
      <button className={showAll ? 'a' : ''} onClick={() => !showAll && onToggle()}>All covers</button>
    </div>
  )
}

// A short message that goes by itself (2.5 s; a problem 4 s). Nothing to tap: no Undo, so a
// busy captain cannot undo something by mistake. A tap on it closes it sooner.
function Toast({ toast, onClose }) {
  // Timed on the toast alone: the screen re-renders on every poll, and a new
  // onClose each time would keep restarting the timer.
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => closeRef.current(), toast.err ? 4000 : 2500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  return <div className={'toast' + (toast.err ? ' err' : '')} onClick={onClose}>{toast.text}</div>
}

// Note and allergy shown under a dish (or for the whole guest)
function NoteTags({ note, allergy }) {
  const n = splitNote(note), a = splitNote(allergy)
  if (!n.length && !a.length) return null
  return (
    <div className="ntags">
      {n.map(x => <span key={'n' + x} className="ntg">{x}</span>)}
      {a.map(x => <span key={'a' + x} className="atg">Allergy: {x}</span>)}
    </div>
  )
}

export default function MaestroCaptain({ eventData, captain, onSwitchCaptain }) {
  const ev = eventData
  const courses = coursesOf(ev)
  const firstCourse = courses[0]
  const coverCount = Math.max(1, Number(ev.chairs_per_table) || 10)
  const tableKey = `ms_table_${ev.id}_${captain.id}`
  const [table, setTable] = useState(() => {
    const saved = Number(localStorage.getItem(tableKey))
    return Number(captain.table_number) || saved || null
  })
  const [view, setView] = useState('take')
  const [coverPick, setCover] = useState(() => coverRange(captain, coverCount)?.from || 1)
  // Two filter rows: Cuisine (All, Italian, Oriental ...) first, then Course (All, Soup ... Dessert)
  const [cuisineTab, setCuisineTab] = useState(ALL)
  const [courseTab, setCourseTab] = useState(ALL)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())    // ms_items ids picked on the board
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [noteOpen, setNoteOpen] = useState(null)   // the note being edited in place: 'item:<id>', 'out:<ref>' or 'guest:<cover>'
  const [pickTable, setPickTable] = useState(false)
  const [showAll, setShowAll] = useState(false)     // All covers: the other captain's covers as well
  const [showDelivered, setShowDelivered] = useState(0)  // until (ms)
  // Order panel: pinned = always shown; unpinned = a one-line bar that opens on a tap and hides again
  // while the captain picks dishes. Remembered on the tablet.
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem('ms_order_pinned') !== '0' } catch { return true } })
  const [orderOpen, setOrderOpen] = useState(false)
  const now = useNow(1000)

  useEffect(() => { if (table) localStorage.setItem(tableKey, String(table)) }, [table, tableKey])
  useEffect(() => { if (captain.table_number && Number(captain.table_number) !== table) setTable(Number(captain.table_number)) }, [captain.table_number])

  // ---------------------------------------------------------- outbox: dishes tapped, being saved
  // Every + is kept on the tablet until the server has it, so a weak network never loses a dish:
  // shown at once as "Saving…", sent straight away, tried again every few seconds if it failed.
  const outKey = `ms_outbox_${ev.id}_${table}`
  const [outbox, setOutbox] = useState([])
  useEffect(() => { try { setOutbox(JSON.parse(localStorage.getItem(outKey) || '[]')) } catch { setOutbox([]) } }, [outKey])
  useEffect(() => { try { localStorage.setItem(outKey, JSON.stringify(outbox)) } catch { /* full */ } }, [outbox, outKey])
  const outRef = useRef(outbox); outRef.current = outbox

  const menuQ = useLive(async () => {
    const [m, vips, evr] = await Promise.all([
      loadMenu(ev.id),
      supabase.from('ms_vip_guests').select('*').eq('event_id', ev.id).eq('is_active', true).order('sort_order').order('name'),
      supabase.from('events').select('id,late_minutes,served_hide_minutes').eq('id', ev.id).maybeSingle(),
    ])
    return { ...m, vips: vips.error ? [] : (vips.data || []), ev: evr.data || null }
  }, { eventId: ev.id, tables: ['ms_vip_guests'], intervalMs: 15000 })
  const menu = menuQ.data
  const vips = useMemo(() => menu?.vips || [], [menu])
  const evLive = { ...ev, ...(menu?.ev || {}) }

  const liveQ = useLive(async () => {
    if (!table) return { items: [], kots: [], covers: [], captains: [] }
    const [items, kots, covers, caps] = await Promise.all([
      supabase.from('ms_items').select('*').eq('event_id', ev.id).eq('table_number', table).order('held_at'),
      supabase.from('kots').select('id,kot_no,kitchen_id,kitchen_name,cover_no,barker,stage,fired_at,ready_at,dispatched_at,served_at,status,kind,is_remake,print_status')
        .eq('event_id', ev.id).eq('table_number', table).eq('kind', 'order'),
      supabase.from('ms_covers').select('*').eq('event_id', ev.id).eq('table_number', table),
      supabase.from('captains').select('*').eq('event_id', ev.id).eq('table_number', table).eq('is_active', true).order('created_at'),
    ])
    for (const r of [items, kots, covers]) if (r.error) throw r.error
    // Table Captain 1, 2 ... in cover order (C1-C5 first), then in the order they were added
    const capList = [...(caps.data || [])].sort(capOrder)
    return { items: items.data || [], kots: kots.data || [], covers: covers.data || [], captains: capList }
  }, { eventId: ev.id, tables: ['ms_items', 'kots', 'ms_covers'], intervalMs: 3000, deps: [table],
    // only this table's changes wake the tablet
    filter: table ? `table_number=eq.${table}` : null, match: row => row.event_id === ev.id })
  const live = liveQ.data || { items: [], kots: [], covers: [], captains: [] }

  const kotById = useMemo(() => Object.fromEntries(live.kots.map(k => [k.id, k])), [live.kots])
  const kitchenById = useMemo(() => Object.fromEntries((menu?.kitchens || []).map(k => [k.id, k])), [menu])
  const dishById = useMemo(() => Object.fromEntries((menu?.dishes || []).map(d => [d.id, d])), [menu])
  const vipById = useMemo(() => Object.fromEntries(vips.map(v => [v.id, v])), [vips])
  const seated = useMemo(() => new Set(live.covers.filter(c => c.seated_at).map(c => c.cover_no)), [live.covers])
  const coverRow = c => live.covers.find(x => x.cover_no === c) || null
  const seatedRef = useRef(seated); seatedRef.current = seated
  const liveIds = useMemo(() => new Set(live.items.map(i => i.id)), [live.items])

  // This captain's covers, read live so a split changed at the desk reaches the tablet.
  const ranges = tableRanges(live.captains, table, coverCount)
  const myRange = (liveQ.data ? ranges.get(captain.id) : coverRange(captain, coverCount)) || null
  const allCovers = Array.from({ length: coverCount }, (_, i) => i + 1)
  const isMine = c => !myRange || (c >= myRange.from && c <= myRange.to)
  const myCovers = allCovers.filter(isMine)
  const visibleCovers = showAll ? allCovers : myCovers
  const ownerOf = c => live.captains.filter(x => { const r = ranges.get(x.id); return x.id !== captain.id && r && c >= r.from && c <= r.to }).map(x => x.name).join(', ')
  const cover = myRange && !showAll && !isMine(coverPick) ? myRange.from : coverPick
  const toggleOthers = () => { setCover(isMine(cover) ? cover : myRange.from); setSel(new Set()); setShowAll(v => !v) }

  const itemsOf = c => live.items.filter(i => i.cover_no === c && i.state !== 'cancelled')
  const statusOf = i => dishStatus(i, kotById[i.kot_id], now, lateMinutes(kitchenById[i.kitchen_id], evLive))
  // Outbox lines still to show (a saved one goes once its dish has arrived from the server)
  const pendingOf = c => outbox.filter(o => o.cover === c && !o.cancel && !(o.ids || []).some(id => liveIds.has(id)))
  const vipOf = c => vipById[coverRow(c)?.vip_guest_id] || null
  const reservedFor = c => vips.find(v => Number(v.table_number) === Number(table) && Number(v.cover_no) === c) || null

  // the cover's label on the cover bar
  function coverState(c) {
    if (c === cover && view === 'take') return 'taking now'
    const its = itemsOf(c)
    if (its.length || pendingOf(c).length) {
      if (its.length && !pendingOf(c).length && its.every(i => statusOf(i).cls === 'sv')) return 'delivered'
      return 'ordered'
    }
    return seated.has(c) ? 'seated' : 'empty'
  }

  const capNo = live.captains.findIndex(c => c.id === captain.id)
  const capLabel = `${captain.name}${capNo >= 0 ? ` (Table Captain ${capNo + 1})` : ''}`
  const seatedMine = myCovers.filter(c => seated.has(c)).length

  // ----------------------------------------------------------- saving (no Save button)
  const flushing = useRef(false)
  const inflight = useRef(null)   // the outbox line being sent right now
  async function flush() {
    if (flushing.current || !table) return
    flushing.current = true
    try {
      for (;;) {
        const o = outRef.current.find(x => !x.ids)
        if (!o) break
        inflight.current = o.ref
        try {
          const r = await rpc('ms_hold', {
            p_event_id: ev.id, p_table_number: table, p_cover_no: o.cover, p_captain_id: captain.id, p_client_ref: o.ref,
            p_items: [{ menu_item_id: o.menu_item_id, qty: 1, note: o.note || null, allergy: o.allergy || null, vip_guest_id: o.vip_guest_id || null }],
          })
          const ids = r?.ids || []
          // removed again while it was being saved: take it off at once
          if (outRef.current.find(x => x.ref === o.ref)?.cancel && ids.length) {
            await supabase.from('ms_items').update({ state: 'cancelled', cancelled_at: new Date().toISOString() }).in('id', ids).eq('state', 'held')
          }
          const done = { ids: ids.length ? ids : ['none'], err: null, sentAt: Date.now() }
          setOutbox(list => list.map(x => (x.ref === o.ref ? { ...x, ...done } : x)))
          outRef.current = outRef.current.map(x => (x.ref === o.ref ? { ...x, ...done } : x))
          // first dish of a cover: the cover is seated (and the automatic first course fires)
          if (!seatedRef.current.has(o.cover)) {
            seatedRef.current = new Set([...seatedRef.current, o.cover])
            const s = await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: [o.cover], p_captain_id: captain.id, p_seated: true, p_per_item: true }).catch(() => null)
            if (s?.first_course?.kots?.length) setToast({ text: `C${o.cover} seated · ${firstCourse} fired` })
          }
          liveQ.reload()
        } catch (e) {
          setOutbox(list => list.map(x => (x.ref === o.ref ? { ...x, err: errText(e) } : x)))
          outRef.current = outRef.current.map(x => (x.ref === o.ref ? { ...x, err: errText(e) } : x))
          break   // tried again in a few seconds
        }
      }
    } finally { flushing.current = false; inflight.current = null }
  }
  // send anything waiting now, and every 4 seconds while something waits
  useEffect(() => { if (outbox.some(o => !o.ids)) flush() }, [outbox, table]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => { if (outRef.current.some(o => !o.ids)) flush() }, 4000)
    return () => clearInterval(t)
  }, [table]) // eslint-disable-line react-hooks/exhaustive-deps
  // a saved line goes from the outbox once the server's copy has arrived (or after a minute)
  useEffect(() => {
    if (!outbox.some(o => o.ids)) return
    const keep = outbox.filter(o => !o.ids || (!o.ids.some(id => liveIds.has(id)) && o.ids[0] !== 'none' && now - (o.sentAt || 0) < 60000))
    if (keep.length !== outbox.length) setOutbox(keep)
  }, [liveIds, outbox, now])

  // A note opened on a dish still being saved follows the dish once the server has it
  useEffect(() => {
    if (!noteOpen?.startsWith('out:')) return
    const o = outbox.find(x => 'out:' + x.ref === noteOpen)
    if (o?.ids && o.ids[0] !== 'none' && liveIds.has(o.ids[0])) setNoteOpen('item:' + o.ids[0])
  }, [noteOpen, outbox, liveIds])

  // + on a dish: one more of it for this cover, saved at once
  // + and − share one place on the dish: a quick double tap must not add and take off again
  const lastTap = useRef({})
  const tapOk = id => { const t = Date.now(); if (t - (lastTap.current[id] || 0) < 450) return false; lastTap.current[id] = t; return true }
  function addDish(d) {
    if (!tapOk(d.id)) return
    const vip = vipOf(cover)
    const pref = vip && (vip.dishes || []).find(x => x.menu_item_id === d.id)
    setOutbox(list => [...list, { ref: newRef(), cover, menu_item_id: d.id, note: pref?.note || '', allergy: '', vip_guest_id: vip && pref ? vip.id : null, at: Date.now() }])
  }
  // − on a dish: the last one of it not fired yet comes off
  async function minusDish(d) {
    if (!tapOk(d.id)) return
    const out = [...pendingOf(cover)].reverse().find(o => o.menu_item_id === d.id && !o.cancel)
    if (out) {
      // being sent this very moment: taken off as soon as the server has it
      if (!out.ids && inflight.current === out.ref) { setOutbox(list => list.map(x => (x.ref === out.ref ? { ...x, cancel: true } : x))); outRef.current = outRef.current.map(x => (x.ref === out.ref ? { ...x, cancel: true } : x)); return }
      if (!out.ids) { setOutbox(list => list.filter(x => x.ref !== out.ref)); outRef.current = outRef.current.filter(x => x.ref !== out.ref); return }
      setOutbox(list => list.filter(x => x.ref !== out.ref))
      await supabase.from('ms_items').update({ state: 'cancelled', cancelled_at: new Date().toISOString() }).in('id', out.ids).eq('state', 'held')
      liveQ.reload(); return
    }
    const held = [...itemsOf(cover)].reverse().find(i => i.state === 'held' && i.menu_item_id === d.id)
    if (held) await removeHeld(held, true)
  }
  const unfiredCount = id => itemsOf(cover).filter(i => i.state === 'held' && i.menu_item_id === id).length
    + pendingOf(cover).filter(o => o.menu_item_id === id && !o.cancel).length

  async function seat(c, on = true) {
    setBusy(true)
    try {
      const r = await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: [c], p_captain_id: captain.id, p_seated: on, p_per_item: true })
      const fc = r?.first_course?.kots?.length
      setToast({ text: on ? `C${c} seated${fc ? ` · ${firstCourse} fired` : ''}` : `C${c} marked not seated` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function seatAll() {
    const todo = visibleCovers.filter(c => !seated.has(c))
    if (!todo.length) return
    setBusy(true)
    try {
      const r = await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: todo, p_captain_id: captain.id, p_seated: true, p_per_item: true })
      setToast({ text: `${todo.length} covers seated${r?.first_course?.kots?.length ? ` · ${firstCourse} fired` : ''}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  // Fire: each dish goes to its kitchen as a KOT of its own
  // Each Fire stands alone: the captain can tap Fire on the next dish while the first is
  // still on its way, and a weak network gets a few more tries (the same reference, so a
  // repeat never makes a second KOT)
  const [firing, setFiring] = useState(() => new Set())
  const firingRef = useRef(firing); firingRef.current = firing
  async function fireIds(allIds, label) {
    const ids = allIds.filter(id => !firingRef.current.has(id))
    if (!ids.length) return
    firingRef.current = new Set([...firingRef.current, ...ids])
    setFiring(f => new Set([...f, ...ids]))
    try {
      const r = await rpcRetry('ms_fire', { p_event_id: ev.id, p_table_number: table, p_item_ids: ids, p_captain_id: captain.id, p_client_ref: newRef(), p_per_item: true })
      const k = r?.kots || []
      setToast({ text: `${label || 'Fired'} · ${k.map(x => `${x.kot_no} (${x.kitchen})`).join(', ')}` })
      setSel(new Set())
      await liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }); liveQ.reload() }
    setFiring(f => { const n = new Set(f); ids.forEach(id => n.delete(id)); return n })
  }

  async function cancelItems(ids, what) {
    setBusy(true)
    try {
      await rpc('ms_cancel', { p_item_ids: ids, p_by: captain.name })
      setToast({ text: `${what} cancelled` })
      setSheet(null); liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  // A held dish never reached the kitchen: one tap removes it (+ on the dish adds it again).
  // Only while it is still held - if it was fired meanwhile (another tablet), nothing changes.
  async function removeHeld(i, quiet) {
    try {
      const { data, error } = await supabase.from('ms_items').update({ state: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', i.id).eq('state', 'held').select('id')
      if (error) throw error
      if (!data?.length) { setToast({ text: `${i.name} was just sent to the kitchen - not removed` }); liveQ.reload(); return }
      if (!quiet) setToast({ text: `${i.name} removed from C${i.cover_no}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  // A dish sent by mistake can be cancelled within a minute of firing (a CANCEL slip prints);
  // after that the Control Desk cancels it
  const canCancelFired = i => {
    const k = kotById[i.kot_id]
    if (i.state !== 'fired' || i.served_at || !k || k.status !== 'open') return false
    return ['new', 'received'].includes(k.stage || 'new') || now - new Date(i.fired_at || k.fired_at).getTime() < 60000
  }

  async function serveKots(kotIds) {
    setBusy(true)
    try {
      await rpc('ms_serve', { p_kot_ids: kotIds, p_undo: false })
      setToast({ text: 'Marked delivered' }); setSheet(null); liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function remake(ids) {
    setBusy(true)
    try {
      const r = await rpc('ms_remake', { p_item_ids: ids, p_captain_id: captain.id, p_client_ref: newRef() })
      setToast({ text: `Remake sent · ${(r?.kots || []).map(k => k.kot_no).join(', ')}` }); setSheet(null); liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function help() {
    try {
      const { data: t } = await supabase.from('tables').select('id').eq('event_id', ev.id).eq('table_number', table).maybeSingle()
      // Same row shape as the existing Help button, so the supervisor's alert banner and the
      // Control Desk both pick it up.
      const { error } = await supabase.from('sos_requests').insert({ event_id: ev.id, table_id: t?.id || null, table_number: table, captain_id: captain.id, request_type: 'help', status: 'open' })
      if (error) throw error
      setToast({ text: 'The control desk has been alerted' })
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }

  // ----------------------------------------------------------- notes, guest, VIP
  async function saveNote(target, note, allergy) {
    try {
      if (target.kind === 'out') {
        setOutbox(list => list.map(x => (x.ref === target.ref ? { ...x, note, allergy } : x)))
        // already saved on the server: change it there too
        const o = outRef.current.find(x => x.ref === target.ref)
        if (o?.ids && o.ids[0] !== 'none') for (const id of o.ids) await rpc('ms_item_note', { p_item_id: id, p_note: note, p_allergy: allergy })
      } else if (target.kind === 'item') {
        await rpc('ms_item_note', { p_item_id: target.id, p_note: note, p_allergy: allergy })
      } else if (target.kind === 'guest') {
        await rpc('ms_cover_guest', { p_event_id: ev.id, p_table_number: table, p_cover_no: target.cover, p_guest_note: note, p_guest_allergy: allergy })
      }
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }); liveQ.reload() }
  }
  const toggleNote = key => setNoteOpen(k => (k === key ? null : key))

  async function newGuest(c) {
    setBusy(true)
    try {
      setOutbox(list => list.filter(o => o.cover !== c || o.ids))
      const r = await rpc('ms_cover_reset', { p_event_id: ev.id, p_table_number: table, p_cover_no: c })
      setToast({ text: `C${c} ready for a new guest${r?.cancelled ? ` · ${r.cancelled} dish${r.cancelled === 1 ? '' : 'es'} not fired removed` : ''}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function applyVip(v, c, auto = false) {
    setBusy(true)
    try {
      const r = await rpc('ms_vip_apply', { p_event_id: ev.id, p_table_number: table, p_cover_no: c, p_vip_id: v.id, p_captain_id: captain.id })
      setSheet(null); setCover(c)
      setToast({ text: `★ ${v.name} on C${c}${auto ? ' (reserved seat)' : ''} · ${r?.held ? `${r.held} preferred dish${r.held === 1 ? '' : 'es'} added` : 'preferences loaded'}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }
  async function clearVip(c) {
    setBusy(true)
    try {
      const r = await rpc('ms_vip_clear', { p_event_id: ev.id, p_table_number: table, p_cover_no: c })
      setToast({ text: `VIP removed from C${c}${r?.cancelled ? ` · ${r.cancelled} dish${r.cancelled === 1 ? '' : 'es'} not fired removed` : ''}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }
  // A VIP with a fixed seat: loaded by itself the first time the captain opens that cover
  const autoVip = useRef(new Set())
  useEffect(() => {
    if (view !== 'take' || !table || !liveQ.data || !menu) return
    const v = reservedFor(cover)
    const row = coverRow(cover)
    const key = `${table}:${cover}:${v?.id}`
    if (!v || row?.vip_done || row?.vip_guest_id || autoVip.current.has(key)) return
    autoVip.current.add(key)
    applyVip(v, cover, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cover, table, view, liveQ.data, menu])

  // ----------------------------------------------------------- table picker
  if (!table || pickTable) {
    const n = Math.max(1, Number(ev.number_of_tables) || 20)
    return (
      <div className="ms cap-app">
        <AppBar title={`${ev.name}`} sub={`${captain.name} · choose your table`} right={<button className="pill" onClick={onSwitchCaptain}>Switch captain</button>} />
        <div style={{ padding: 18, overflowY: 'auto' }}>
          <div className="cap" style={{ marginBottom: 10 }}>Which table are you serving?</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))' }}>
            {Array.from({ length: n }, (_, i) => i + 1).map(t => (
              <button key={t} className={'save'} style={{ borderColor: t === table ? 'var(--amber)' : 'var(--line)', background: t === table ? 'var(--amberl)' : '#fff' }}
                onClick={() => { setTable(t); setPickTable(false); setSel(new Set()); setShowAll(false) }}>T{t}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------- Take order: the menu
  const cats = (menu?.cats || []).filter(c => c.is_visible !== false)
  const autoFirst = ev.first_course_auto !== false
  const visibleCat = new Set(cats.map(c => c.id))
  const vip = vipOf(cover)
  const reserved = !vip ? reservedFor(cover) : null
  // VIP-only dishes (special preparations) are offered only on a VIP guest's cover
  const dishesShown = (menu?.dishes || []).filter(d => visibleCat.has(d.category_id) && !(autoFirst && d.course === firstCourse) && (!d.vip_only || vip))
  const courseOf = d => courses.includes(d.course) ? d.course : 'Other'
  const catName = id => menu?.catsById?.[id]?.name || ''
  const cuisineAll = cats.filter(c => dishesShown.some(d => d.category_id === c.id))
  const cuisineRank = id => { const i = cuisineAll.findIndex(c => c.id === id); return i < 0 ? 99 : i }
  // Cuisine first, then the courses that cuisine has: the two rows never end on an empty list
  const activeCuisine = cuisineAll.some(c => c.id === cuisineTab) ? cuisineTab : ALL
  const courseTabs = [...courses, 'Other'].filter(c => dishesShown.some(d => courseOf(d) === c && (activeCuisine === ALL || d.category_id === activeCuisine)))
  const activeCourse = courseTabs.includes(courseTab) ? courseTab : ALL
  const query = q.trim().toLowerCase()
  const shown = query
    ? dishesShown.filter(d => `${d.name} ${d.description || ''} ${catName(d.category_id)} ${d.course || ''}`.toLowerCase().includes(query))
    : dishesShown.filter(d => (activeCourse === ALL || courseOf(d) === activeCourse) && (activeCuisine === ALL || d.category_id === activeCuisine))
  // One heading per cuisine and course: "Italian · Soup", "Italian · Main Course 1" ... then the next cuisine
  const groupsShown = []
  if (!query) {
    const czs = activeCuisine === ALL ? cuisineAll : cuisineAll.filter(c => c.id === activeCuisine)
    for (const cz of czs) {
      for (const c of [...courses, 'Other']) {
        const list = shown.filter(d => d.category_id === cz.id && courseOf(d) === c)
        if (list.length) groupsShown.push({ key: cz.id + c, title: activeCuisine === ALL ? `${cz.name} · ${c}` : c, sub: `${list.length} ${list.length === 1 ? 'dish' : 'dishes'}`, list })
      }
    }
  }
  const czTag = id => <span className={'cz z' + (cuisineRank(id) % 6)}>{catName(id)}</span>
  const vipDishes = vip ? (vip.dishes || []).map(x => dishById[x.menu_item_id]).filter(Boolean) : []

  // One compact row per dish: photo, name, cuisine and one button: + adds it to the cover,
  // then the same button is − and takes it off again (no quantity)
  const dishCard = (d, k = '') => {
    const n = unfiredCount(d.id)
    const sent = itemsOf(cover).some(i => i.menu_item_id === d.id && i.state === 'fired')
    const off = d.is_available === false
    return (
      <div key={k + d.id} className={'dish drow' + (off ? ' off' : '') + (n ? ' picked' : '')}>
        <DishThumb dish={d} />
        <div className="dm">
          <div className="dn"><Veg veg={d.is_veg} />{d.name}</div>
          <div className="dd">{czTag(d.category_id)}{sent && !n && <b className="snt">✓ Sent</b>}{query || k ? <b className="dq">{d.course}</b> : null}{d.vip_only && <b className="vtag">VIP only</b>}{d.description || ''}</div>
        </div>
        <div className="da">
          {off ? <span className="so">Sold out</span> : n
            ? <button className="addm" onClick={() => minusDish(d)} aria-label={`Remove ${d.name}`}>−</button>
            : <button className="addp" onClick={() => addDish(d)} aria-label={`Add ${d.name}`}>+</button>}
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------- Take order: the cover's order
  const hideMs = servedHideMinutes(evLive) * 60000
  const showingDelivered = showDelivered > now
  const coverItems = itemsOf(cover)
  const pend = pendingOf(cover)
  const delivered = coverItems.filter(i => statusOf(i).cls === 'sv')
  const hiddenDelivered = delivered.filter(i => { const t = deliveredAt(i, kotById[i.kot_id]); return t && now - t > hideMs })
  const visibleItems = showingDelivered ? coverItems : coverItems.filter(i => !hiddenDelivered.includes(i))
  const lines = [
    ...visibleItems.map(i => ({ kind: 'item', i, course: i.course, dish: dishById[i.menu_item_id] })),
    ...pend.map(o => ({ kind: 'out', o, course: dishById[o.menu_item_id]?.course, dish: dishById[o.menu_item_id] })).filter(l => l.dish),
  ]
  const groupCourses = courses.filter(c => lines.some(l => l.course === c))
  const otherCourse = [...new Set(lines.map(l => l.course).filter(c => !courses.includes(c)))]
  const nHeld = coverItems.filter(i => i.state === 'held').length + pend.filter(o => !o.cancel).length
  const nKitchen = coverItems.filter(i => i.state === 'fired').length - delivered.length
  const nLate = coverItems.filter(i => i.state === 'fired' && statusOf(i).late).length
  const unsaved = outbox.filter(o => !o.ids && o.err).length
  const summary = [nHeld && <span key="h" className="s-h">{nHeld} not fired</span>,
    nKitchen > 0 && <span key="k" className="s-k">{nKitchen} in kitchen{nLate ? ` (${nLate} late)` : ''}</span>,
    delivered.length > 0 && <span key="s" className="s-s">{delivered.length} delivered</span>].filter(Boolean)
  const panelOpen = pinned || orderOpen
  const togglePin = () => { const v = !pinned; setPinned(v); setOrderOpen(v ? false : true); try { localStorage.setItem('ms_order_pinned', v ? '1' : '0') } catch { /* private mode */ } }
  const cr = coverRow(cover)

  const orderLine = l => {
    if (l.kind === 'out') {
      const o = l.o
      const nk = 'out:' + o.ref
      return (
        <div className="oln" key={'o' + o.ref}>
        <div className="oit dr">
          <Veg veg={l.dish.is_veg} />
          <div className="nmw"><span className="nm">{l.dish.name}</span>{czTag(l.dish.category_id)}<NoteTags note={o.note} allergy={o.allergy} /></div>
          <span className={'chip ' + (o.err ? 'lt' : 'hd')} title={o.err || ''}>{o.err ? 'Not saved · retrying' : 'Saving…'}</span>
          <button className={'nbtn' + (noteOpen === 'out:' + o.ref ? ' act' : '')} onClick={() => toggleNote('out:' + o.ref)}>{o.note || o.allergy ? 'Note' : '+ Note'}</button>
          <button className="x" onClick={() => minusDish(l.dish)} title="Take this dish off">✕</button>
        </div>
        {noteOpen === nk && <NoteEditor key={nk} note={o.note} allergy={o.allergy} onSave={(n, a) => saveNote({ kind: 'out', ref: o.ref }, n, a)} onClose={() => setNoteOpen(null)} />}
        </div>
      )
    }
    const i = l.i
    const st = statusOf(i)
    const nk = 'item:' + i.id
    return (
      <div className="oln" key={i.id}>
      <div className="oit">
        <Veg veg={i.veg} />
        <div className="nmw"><span className="nm">{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}</span>{l.dish ? czTag(l.dish.category_id) : null}{i.vip_guest_id && <span className="vtag">★</span>}<NoteTags note={i.note} allergy={i.allergy} /></div>
        {i.state === 'held' ? (
          <>
            <button className={'nbtn' + (noteOpen === 'item:' + i.id ? ' act' : '')} onClick={() => toggleNote('item:' + i.id)}>{i.note || i.allergy ? 'Note' : '+ Note'}</button>
            <button className="firei" disabled={firing.has(i.id)} onClick={() => fireIds([i.id], `${i.name} fired for C${i.cover_no}`)}>{firing.has(i.id) ? 'Firing…' : 'Fire'}</button>
            <button className="x" disabled={busy} onClick={() => removeHeld(i)} title="Remove this dish">✕</button>
          </>
        ) : (
          <>
            <span className={'chip ' + st.cls}>{st.label}</span>
            {canCancelFired(i) && <CancelFired disabled={busy} onCancel={() => cancelItems([i.id], i.name)} />}
          </>
        )}
      </div>
      {noteOpen === nk && i.state === 'held' && <NoteEditor key={nk} note={i.note} allergy={i.allergy} onSave={(n, a) => saveNote({ kind: 'item', id: i.id }, n, a)} onClose={() => setNoteOpen(null)} />}
      </div>
    )
  }

  const takeOrder = (
    <div className={'body' + (panelOpen ? '' : ' collapsed')}>
      {/* Unpinned: picking a dish folds the order away. On click (not pointer down), so the tap
          lands on the dish under the finger before the menu widens */}
      <div className="menu" onClickCapture={() => { if (!pinned && orderOpen) setOrderOpen(false) }}>
        {!menu ? <div className="empty">Loading the menu…</div> : (
          <>
            <div className="msearch">
              <div className="sbox">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${dishesShown.length} dishes…`} aria-label="Search dishes" />
                {q && <button className="clr" onClick={() => setQ('')} title="Clear">✕</button>}
              </div>
            </div>
            {query ? (
              <div className="found">{shown.length} {shown.length === 1 ? 'dish' : 'dishes'} matching “{q.trim()}”</div>
            ) : (
              <>
                {cuisineAll.length > 1 && (
                  <div className="frow" data-row="cuisine"><span className="fl">Cuisine</span>
                    <div className="cuis">
                      {[{ id: ALL, name: 'All' }, ...cuisineAll].map(c => (
                        <button key={c.id} className={'cc' + (c.id === activeCuisine ? ' a' : '')} onClick={() => { setCuisineTab(c.id); setCourseTab(ALL) }}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="frow" data-row="course"><span className="fl">Course</span>
                  <div className="tabs">
                    {[ALL, ...courseTabs].map(c => (
                      <button key={c} className={'tab' + (c === activeCourse ? ' a' : '')} onClick={() => setCourseTab(c)}>{c === ALL ? 'All' : c}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="dlist">
              {!query && vipDishes.length > 0 && [
                <div key="vh" className="ghead vh">★ Preferred by {vip.name}<span>· {vipDishes.length} {vipDishes.length === 1 ? 'dish' : 'dishes'}</span></div>,
                ...vipDishes.map(d => dishCard(d, 'v')),
              ]}
              {query
                ? shown.map(d => dishCard(d))
                : groupsShown.flatMap(g => [<div key={'h' + g.key} className="ghead">{g.title}<span>· {g.sub}</span></div>, ...g.list.map(d => dishCard(d))])}
              {!shown.length && <div className="empty">{query ? 'No dish matches that search.' : 'No dishes here.'}</div>}
            </div>
          </>
        )}
      </div>
      <div className={'cart' + (panelOpen ? '' : ' mini')}>
        {panelOpen ? (
          <>
            <div className="ch">
              <div className="cht">
                <b>{tc(table, cover)} · order</b>
                {seated.has(cover)
                  ? <span className="tagF">Seated</span>
                  : <button className="minib" disabled={busy} onClick={() => seat(cover)}>Mark seated{autoFirst ? ` · fires ${firstCourse}` : ''}</button>}
                <span style={{ flex: 1 }} />
                {!pinned && <button className="minib" onClick={() => setOrderOpen(false)}>Hide</button>}
                <button className={'pin' + (pinned ? ' pd' : '')} onClick={togglePin}
                  title={pinned ? 'Always shown. Tap to let it hide while you pick dishes' : 'Keep the order always shown'}>{pinned ? '📌 Pinned' : '📌 Pin'}</button>
              </div>
              {vip && (
                <div className="vipb" data-testid="vip-banner">
                  <div className="vt"><b>★ {vip.label ? `${vip.label} · ` : ''}{vip.name}</b><Sure label="Remove VIP" sure="Remove?" disabled={busy} onYes={() => clearVip(cover)} /></div>
                  {vip.allergies && <div className="va">Allergy: {vip.allergies}</div>}
                  {vip.likes && <div className="vl">Likes: {vip.likes}</div>}
                  {vip.dislikes && <div className="vl">Dislikes: {vip.dislikes}</div>}
                  {vip.notes && <div className="vl">Note: {vip.notes}</div>}
                </div>
              )}
              {reserved && <div className="vipr">★ Reserved for {reserved.name}<button className="minib" disabled={busy} onClick={() => applyVip(reserved, cover)}>Load preferences</button></div>}
              <div className="gnr">
                <button className={'gbtn' + (noteOpen === 'guest:' + cover ? ' act' : '')} onClick={() => toggleNote('guest:' + cover)}>
                  {cr?.guest_note || cr?.guest_allergy ? 'Guest note' : '+ Guest note (all dishes)'}</button>
                <NoteTags note={cr?.guest_note} allergy={cr?.guest_allergy} />
                <span style={{ flex: 1 }} />
                {(coverItems.length > 0 || cr?.guest_note || cr?.guest_allergy || vip) && <Sure label="New guest" sure="New guest?" disabled={busy} onYes={() => newGuest(cover)} />}
              </div>
              {noteOpen === 'guest:' + cover && (
                <NoteEditor key={'guest:' + cover} note={cr?.guest_note} allergy={cr?.guest_allergy}
                  onSave={(n, a) => saveNote({ kind: 'guest', cover }, n, a)} onClose={() => setNoteOpen(null)} />
              )}
              <div className="sum">{summary.length ? summary : <span>Nothing ordered for C{cover} yet · tap + on a dish</span>}
                {hiddenDelivered.length > 0 && (showingDelivered
                  ? <button className="shw" onClick={() => setShowDelivered(0)}>Hide delivered</button>
                  : <button className="shw" onClick={() => setShowDelivered(Date.now() + SHOW_DELIVERED_MS)}>Show delivered ({hiddenDelivered.length})</button>)}
                {unsaved > 0 && <span className="s-u">{unsaved} not saved · retrying</span>}
              </div>
              {!isMine(cover) && <div className="helpout">Helping out: C{cover} is {ownerOf(cover) || 'another captain'}'s cover</div>}
            </div>
            <div className="scroll olist">
              {[...groupCourses, ...otherCourse].map(c => (
                <div className="orow" key={c || 'none'}>
                  <div className="oc">{c || 'Other'}</div>
                  <div className="oi">{lines.filter(l => l.course === c).map(orderLine)}</div>
                </div>
              ))}
              {!lines.length && (
                <div className="empty">{hiddenDelivered.length ? 'Everything ordered has been delivered.' : 'Tap + on a dish: it is saved at once. Each dish has its own Fire button.'}</div>
              )}
            </div>
          </>
        ) : (
          <button className="obar" onClick={() => setOrderOpen(true)}>
            <b>{tc(table, cover)} · order</b>
            <span className="sum">{summary.length ? summary : <span>Nothing ordered yet</span>}</span>
            <span className="show">Show order ▴</span>
          </button>
        )}
      </div>
    </div>
  )

  // ----------------------------------------------------------- Course board
  const boardCovers = visibleCovers
  const cellItems = (c, course) => live.items.filter(i => i.cover_no === c && i.course === course && i.state !== 'cancelled')
  const selItems = live.items.filter(i => sel.has(i.id) && i.state === 'held')
  const selCovers = [...new Set(selItems.map(i => i.cover_no))].sort((a, b) => a - b)
  const selKitchens = [...new Set(selItems.map(i => kitchenById[i.kitchen_id]?.name).filter(Boolean))]
  const selCourses = [...new Set(selItems.map(i => i.course))].sort((a, b) => courseRank(courses, a) - courseRank(courses, b))

  function toggleIds(ids) {
    setSel(s => {
      const n = new Set(s)
      const all = ids.every(id => n.has(id))
      ids.forEach(id => (all ? n.delete(id) : n.add(id)))
      return n
    })
  }
  function onCell(c, course) {
    const its = cellItems(c, course)
    const held = its.filter(i => i.state === 'held').map(i => i.id)
    if (held.length) { toggleIds(held); return }
    if (its.length) setSheet({ kind: 'cell', cover: c, course, items: its })
  }
  function onCourseHead(course) {
    const held = live.items.filter(i => i.course === course && i.state === 'held' && boardCovers.includes(i.cover_no)).map(i => i.id)
    if (held.length) toggleIds(held)
  }
  // Next course to fire for a cover: the earliest course with held dishes
  function nextCourse(c) {
    const held = itemsOf(c).filter(i => i.state === 'held').map(i => i.course).filter(Boolean)
    return held.sort((a, b) => courseRank(courses, a) - courseRank(courses, b))[0] || null
  }
  function onCoverHead(c) {
    const ncc = nextCourse(c)
    if (!ncc) return
    toggleIds(live.items.filter(i => i.cover_no === c && i.course === ncc && i.state === 'held').map(i => i.id))
  }

  // pace panel
  const pace = []
  for (const c of boardCovers) {
    const its = itemsOf(c)
    if (!its.length && !seated.has(c)) continue
    const late = its.filter(i => statusOf(i).late)
    for (const i of late) pace.push({ c, t: `${shortName(i.name, 18)} late in ${kitchenById[i.kitchen_id]?.name || 'kitchen'}`, w: 3 })
    const lastFire = its.filter(i => i.fired_at).map(i => new Date(i.fired_at).getTime()).sort((a, b) => b - a)[0]
    const seatedAt = live.covers.find(x => x.cover_no === c)?.seated_at
    const since = lastFire || (seatedAt && new Date(seatedAt).getTime())
    const held = its.some(i => i.state === 'held')
    const servedTimes = its.filter(i => i.served_at).sort((a, b) => new Date(b.served_at) - new Date(a.served_at))
    const lastFired = its.filter(i => i.fired_at && !i.served_at).sort((a, b) => new Date(b.fired_at) - new Date(a.fired_at))[0]
    if (held && since && now - since > (Number(ev.pacing_minutes) || 25) * 60000) pace.push({ c, t: `nothing fired for ${Math.floor((now - since) / 60000)} min`, w: 2 })
    else if (servedTimes[0]) pace.push({ c, t: `${servedTimes[0].course?.toLowerCase() || 'course'} delivered ${ago(servedTimes[0].served_at, now)}`, w: 1 })
    else if (lastFired && !late.length) pace.push({ c, t: `${lastFired.course?.toLowerCase() || 'course'} fired ${ago(lastFired.fired_at, now)}`, w: 0 })
  }
  pace.sort((a, b) => b.w - a.w)

  // Status key with counts for the covers shown
  const shownItems = live.items.filter(i => i.state !== 'cancelled' && boardCovers.includes(i.cover_no) && courses.includes(i.course))
  const tally = cls => shownItems.filter(i => statusOf(i).cls === cls).length
  const KEY = [['hd', 'Not fired'], ['fi', 'In kitchen'], ['sv', 'Delivered'], ['lt', `Late (over ${lateMinutes(null, evLive)} min)`]]

  const board = (
    <div className="body bd">
      <div className="main">
        <div className="bdtop">
          <Scope myRange={myRange} showAll={showAll} onToggle={toggleOthers} />
          <div className="key">
            {KEY.map(([cls, label]) => <span key={cls} className={'kk ' + cls}><b>{tally(cls)}</b>{label}</span>)}
          </div>
        </div>
        <div className="boardwrap">
          <table className="board">
            <thead><tr><th />{courses.map(c => <th key={c} style={{ cursor: 'pointer' }} onClick={() => onCourseHead(c)}>{c}</th>)}</tr></thead>
            <tbody>
              {boardCovers.map(c => (
                <tr key={c}>
                  <td className={'cvc' + (isMine(c) ? '' : ' oth')} style={{ cursor: 'pointer' }} onClick={() => onCoverHead(c)}>C{c}{vipOf(c) ? ' ★' : ''}<small>{selCovers.includes(c) ? 'selected' : !isMine(c) ? ownerOf(c) || 'other' : seated.has(c) ? 'seated' : itemsOf(c).length ? 'ordered' : 'empty'}</small></td>
                  {courses.map(course => {
                    const its = cellItems(c, course)
                    if (!its.length) return <td key={course} className="c na"><b>—</b></td>
                    const sts = its.map(statusOf)
                    const worst = [...sts].sort((a, b) => a.rank - b.rank)[0]
                    const late = sts.find(s => s.late)
                    const st = late || worst
                    const isSel = its.some(i => sel.has(i.id))
                    const kitchens = new Set(its.map(i => i.kitchen_id)).size
                    const name = its.length === 1 ? its[0].name : `${its.length} dishes · ${kitchens} kitchen${kitchens === 1 ? '' : 's'}`
                    return (
                      <td key={course} className={'c ' + (isSel ? 'sel' : st.cls)} onClick={() => onCell(c, course)} title={its.map(i => i.name).join(', ')}>
                        <b>{name}</b><span>{isSel ? 'Fire' : st.label}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fbar">
          {selItems.length ? (
            <div><b>{selItems.length} {selItems.length === 1 ? 'dish' : 'dishes'} selected · {selCovers.map(c => 'C' + c).join(', ')}</b><br />
              <small>{selCourses.join(' + ')} · {selKitchens.join(', ')} · one KOT per dish</small></div>
          ) : (
            <div><b>Tap held dishes to fire</b><br /><small>Tap a course heading for every cover shown, or a cover for its next course</small></div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.35)' }} disabled={!sel.size} onClick={() => setSel(new Set())}>Clear</button>
          <button className="btn btn-amber" style={{ padding: '10px 18px', fontSize: 14 }} disabled={busy || !selItems.length}
            onClick={() => fireIds(selItems.map(i => i.id), `${selCourses.join(' + ')} fired`)}>Fire {selItems.length || ''} {selItems.length === 1 ? 'dish' : 'dishes'}</button>
        </div>
      </div>
      <div className="side">
        <h5>Pace</h5>
        <div className="pace">
          {pace.length ? pace.slice(0, 8).map((p, i) => <div key={i}><b>C{p.c}</b> {p.t}</div>) : <span className="muted">Seat covers and fire the first dishes to see the pace here.</span>}
        </div>
        <div className="pace" style={{ background: '#FFF8E6' }}><b>Flexible sequence:</b> fire one dish or several, for one cover or several. Each dish prints as its own KOT.</div>
        <button className="btn btn-ghost" disabled={busy || visibleCovers.every(c => seated.has(c))} onClick={seatAll}>{myRange && !showAll ? `Seat my covers (${rangeText(myRange)})` : 'Seat all covers'}{autoFirst ? ` · fires ${firstCourse}` : ''}</button>
      </div>
    </div>
  )

  return (
    <div className="ms cap-app">
      <AppBar
        title={view === 'take' ? `Table T${table} · ${captain.name}${myRange ? ` · ${rangeText(myRange)}` : ''}` : `Table T${table} · Course board`}
        sub={view === 'take'
          ? `${capNo >= 0 ? `Table Captain ${capNo + 1} · ` : ''}${myRange ? `your covers ${rangeText(myRange)} · ${seatedMine} seated` : `${coverCount} covers · ${seated.size} seated`}`
          : `${live.captains.map((c, i) => `${c.name} (TC${i + 1}${ranges.get(c.id) ? ' · ' + rangeText(ranges.get(c.id)) : ''})`).join(' · ') || captain.name} · ${seated.size} covers seated · tap dishes to fire`}
        right={<>
          <div className="tabsw">
            <button className={view === 'take' ? 'a' : ''} onClick={() => setView('take')}>Take order</button>
            <button className={view === 'board' ? 'a' : ''} onClick={() => setView('board')}>Course board</button>
          </div>
          <span className="pill"><span className={'on' + (liveQ.online ? '' : ' off')} />{liveQ.online ? 'Live' : 'Offline'}</span>
          <button className="pill vipbtn" onClick={() => setSheet({ kind: 'vip' })}>★ VIP Guests</button>
          <button className="pill" onClick={help}>Help</button>
          <button className="pill" onClick={() => setSheet({ kind: 'menu' })}>☰</button>
        </>} />
      {view === 'take' && (
        <div className="covers">
          {!myRange && <span className="l">Cover</span>}
          {visibleCovers.map((c, i) => {
            const s = coverState(c)
            // a label before each run of covers: "My covers", or the captain who looks after them
            const grp = x => (isMine(x) ? '' : ownerOf(x) || 'Other covers')
            const head = myRange && (i === 0 || grp(c) !== grp(visibleCovers[i - 1]))
            const star = vipOf(c) ? '★ ' : reservedFor(c) ? '☆ ' : ''
            return [
              head && <span key={'o' + c} className={'l' + (grp(c) ? ' oth' : '')}>{grp(c) || 'My covers'}</span>,
              <button key={c} className={'cv' + (isMine(c) ? '' : ' oth') + (c === cover ? ' sel' : s === 'ordered' || s === 'delivered' ? ' done' : s === 'seated' ? ' seat' : '') + (vipOf(c) ? ' vip' : '')}
                onClick={() => setCover(c)}><b>{star}C{c}</b><small>{c === cover ? 'taking now' : s}</small></button>,
            ]
          })}
          <span style={{ flex: 1 }} />
          <Scope myRange={myRange} showAll={showAll} onToggle={toggleOthers} />
        </div>
      )}
      {view === 'take' ? takeOrder : board}

      {sheet?.kind === 'cell' && (
        <CellSheet sheet={sheet} table={table} statusOf={statusOf} kotById={kotById} kitchenById={kitchenById} busy={busy} canCancel={canCancelFired}
          onClose={() => setSheet(null)} onServe={serveKots} onRemake={remake} onCancel={cancelItems} />
      )}
      {sheet?.kind === 'vip' && (
        <VipSheet vips={vips} table={table} cover={cover} covers={visibleCovers} busy={busy}
          seatOf={v => live.covers.find(c => c.vip_guest_id === v.id)} onClose={() => setSheet(null)} onApply={applyVip} />
      )}
      {sheet?.kind === 'menu' && (
        <Sheet onClose={() => setSheet(null)} title={capLabel} text={`${ev.name} · Table T${table}`}>
          <button className="btn btn-ghost" onClick={() => { setSheet(null); setPickTable(true) }}>Change table</button>
          <button className="btn btn-ghost" onClick={() => { setSheet(null); onSwitchCaptain && onSwitchCaptain() }}>Switch captain</button>
          <button className="btn btn-ghost" onClick={() => { setSheet(null); liveQ.reload(); menuQ.reload() }}>Refresh</button>
        </Sheet>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function AppBar({ title, sub, right }) {
  return (
    <div className="appbar">
      <div className="lft">
        <div className="brandmk"><div className="lt"><img src={logo} alt="Janu's Smart Serve" /></div><div className="wm"><small>Smart Serve</small><b>Maestro</b></div></div>
        <div className="brandsep" />
        <div style={{ minWidth: 0 }}><div className="t">{title}</div><div className="s">{sub}</div></div>
      </div>
      <div className="r">{right}</div>
    </div>
  )
}

export function Sheet({ title, text, children, onClose }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <div className="row">{children}</div>
      </div>
    </div>
  )
}

/* Note and allergy for one dish, or for everything a guest orders: tap the usual ones, type or
   speak anything else under Other. */
// Voice typing for a note: Chrome / Safari's speech recognition (needs a secure page and,
// on most tablets, internet; otherwise a short message points to the keyboard's own mic)
function useSpeech(onText) {
  const SR = typeof window !== 'undefined' && window.isSecureContext ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
  const [on, setOn] = useState(false)
  const [err, setErr] = useState('')
  const rec = useRef(null)
  const cb = useRef(onText); cb.current = onText
  useEffect(() => () => { try { rec.current?.abort() } catch { /* already stopped */ } }, [])
  function toggle() {
    if (on) { try { rec.current?.stop() } catch { /* stopped */ } return }
    try {
      const r = new SR()
      r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false
      r.onresult = e => {
        const t = Array.from(e.results).map(x => x[0]?.transcript || '').join(' ').trim()
        if (t) cb.current(t)
      }
      r.onend = () => setOn(false)
      r.onerror = e => {
        setOn(false)
        setErr(e?.error === 'not-allowed' || e?.error === 'service-not-allowed' ? 'Allow the microphone for this page, or use the keyboard\'s mic.'
          : e?.error === 'network' ? 'Voice typing needs internet - use the keyboard\'s mic, or type.'
          : e?.error === 'no-speech' ? 'Did not hear anything - tap 🎤 and talk.' : '')
      }
      rec.current = r
      setErr('')
      r.start(); setOn(true)
    } catch { setOn(false); setErr('Voice typing is not available here - use the keyboard\'s mic, or type.') }
  }
  return { ok: !!SR, on, err, toggle }
}

// Notes in place, right under the dish (or the guest): six one-tap notes, then Other or Allergy
// to type or speak. Every tap is saved at once - nothing to confirm, no screen to leave.
function NoteEditor({ note, allergy, onSave, onClose }) {
  const parts = splitNote(note)
  const [picked, setPicked] = useState(() => new Set(parts.filter(x => QUICK_NOTES.includes(x))))
  const [other, setOther] = useState(() => parts.filter(x => !QUICK_NOTES.includes(x)).join(', '))
  const [alg, setAlg] = useState(allergy || '')
  const [field, setField] = useState(() => null)   // 'other' | 'allergy' | null
  const cur = useRef({}); cur.current = { picked, other, alg, field }
  const saved = useRef(JSON.stringify([joinNote(parts), joinNote(splitNote(allergy))]))
  const chain = useRef(Promise.resolve())
  const saveRef = useRef(onSave); saveRef.current = onSave
  // saves go one after another, so the last tap always wins
  const save = (p = cur.current.picked, o = cur.current.other, a = cur.current.alg) => {
    const n = joinNote([...QUICK_NOTES.filter(x => p.has(x)), ...splitNote(o)])
    const al = joinNote(splitNote(a))
    const key = JSON.stringify([n, al])
    if (key === saved.current) return
    saved.current = key
    chain.current = chain.current.then(() => saveRef.current(n, al)).catch(() => {})
  }
  // typed but not saved when the note closes (cover changed, dish fired): saved anyway
  useEffect(() => () => save(), [])
  const flip = x => { const n = new Set(picked); n.has(x) ? n.delete(x) : n.add(x); setPicked(n); save(n) }
  const speech = useSpeech(t => {
    const { field: f, other: o, alg: a } = cur.current
    if (f === 'allergy') { const v = a ? `${a}, ${t}` : t; setAlg(v); save(undefined, undefined, v) }
    else { const v = o ? `${o}, ${t}` : t; setOther(v); setField('other'); save(undefined, v) }
  })
  const val = field === 'allergy' ? alg : other
  const setVal = v => (field === 'allergy' ? setAlg(v) : setOther(v))
  return (
    <div className="ned">
      <div className="qn">
        {QUICK_NOTES.map(x => <button key={x} className={picked.has(x) ? 'a' : ''} onClick={() => flip(x)}>{x}</button>)}
        <button className={'qo' + (field === 'other' ? ' act' : '') + (other.trim() ? ' a' : '')} onClick={() => { save(); setField(f => (f === 'other' ? null : 'other')) }}>✎ Other</button>
        <button className={'qal' + (field === 'allergy' ? ' act' : '') + (alg.trim() ? ' a' : '')} onClick={() => { save(); setField(f => (f === 'allergy' ? null : 'allergy')) }}>⚠ Allergy</button>
        <button className="qd" onClick={() => { save(); onClose() }}>Done</button>
      </div>
      {field && (
        <div className="nin">
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={() => save()}
            onKeyDown={e => { if (e.key === 'Enter') { save(); setField(null) } }}
            placeholder={field === 'allergy' ? 'Allergy: type or speak, e.g. peanuts' : 'Type or speak, e.g. no tomato in the pizza'} />
          {speech.ok && <button className={'mic' + (speech.on ? ' act' : '')} onMouseDown={e => e.preventDefault()} onClick={speech.toggle} title="Speak">{speech.on ? '● Stop' : '🎤'}</button>}
          <button className="ok" onMouseDown={e => e.preventDefault()} onClick={() => { save(); setField(null) }}>OK</button>
        </div>
      )}
      {speech.err && <div className="micerr">{speech.err}</div>}
    </div>
  )
}

/* VIP guests of the event: choose one, then the cover they sit on. */
function VipSheet({ vips, table, cover, covers, busy, seatOf, onClose, onApply }) {
  const [pick, setPick] = useState(null)
  const [c, setC] = useState(cover)
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet vipsheet" onClick={e => e.stopPropagation()}>
        {!pick ? (
          <>
            <h3>★ VIP Guests</h3>
            <p>Choose the guest, then their cover. Their allergies and preferences go on every KOT of that cover, and their preferred dishes are added to the order.</p>
            {!vips.length && <div className="empty">No VIP guests are set up for this event (Event set-up › VIP guests).</div>}
            <div className="viplist">
              {vips.map(v => {
                const at = seatOf(v)
                return (
                  <button key={v.id} className="vipi" onClick={() => { setPick(v); setC(v.table_number && Number(v.table_number) === Number(table) && v.cover_no ? Number(v.cover_no) : cover) }}>
                    <b>★ {v.name}</b>{v.label && <span className="vlab">{v.label}</span>}
                    <small>{at ? `Seated at T${at.table_number} · C${at.cover_no}` : v.table_number && v.cover_no ? `Reserved T${v.table_number} · C${v.cover_no}` : 'Any table'}
                      {v.allergies ? ` · Allergy: ${v.allergies}` : ''}{(v.dishes || []).length ? ` · ${(v.dishes || []).length} preferred dishes` : ''}</small>
                  </button>
                )
              })}
            </div>
            <div className="row" style={{ marginTop: 10 }}><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <h3>★ {pick.name}</h3>
            <p>{[pick.label, pick.allergies && `Allergy: ${pick.allergies}`, pick.dislikes && `Dislikes: ${pick.dislikes}`, pick.notes].filter(Boolean).join(' · ')}</p>
            {seatOf(pick) && !(seatOf(pick).table_number === table && seatOf(pick).cover_no === c) && (
              <p className="vmove">Now at T{seatOf(pick).table_number} · C{seatOf(pick).cover_no}: choosing a cover here moves the guest (their dishes not fired there are removed).</p>
            )}
            <div className="nsec">Cover at table T{table}</div>
            <div className="vcov">{covers.map(x => <button key={x} className={x === c ? 'a' : ''} onClick={() => setC(x)}>C{x}</button>)}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-amber" disabled={busy} onClick={() => onApply(pick, c)}>Seat at C{c} · load preferences</button>
              <button className="btn btn-ghost" onClick={() => setPick(null)}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CellSheet({ sheet, table, statusOf, kotById, kitchenById, busy, canCancel, onClose, onServe, onRemake, onCancel }) {
  const its = sheet.items
  const toServe = [...new Set(its.filter(i => i.state === 'fired' && !i.served_at && statusOf(i).cls !== 'sv').map(i => i.kot_id).filter(Boolean))]
  // Remake and Cancel reach the kitchen at once, so each takes a second tap.
  const [ask, setAsk] = useState(null)   // { id, kind: 'remake' | 'cancel' }
  const sure = (i, kind) => ask?.id === i.id && ask.kind === kind
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h3>{tc(table, sheet.cover)} · {sheet.course}</h3>
        <div style={{ margin: '8px 0 12px' }}>
          {its.map(i => {
            const s = statusOf(i)
            const k = kotById[i.kot_id]
            return (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px dashed var(--line)', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}</b>
                <NoteTags note={i.note} allergy={i.allergy} />
                <span className={'tagK'}>{s.label}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{kitchenById[i.kitchen_id]?.name}{k ? ` · ${k.kot_no}` : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {i.state === 'fired' && (sure(i, 'remake')
                    ? <button className="btn btn-amber" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => onRemake([i.id])}>Send remake</button>
                    : <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => setAsk({ id: i.id, kind: 'remake' })}>Remake</button>)}
                  {canCancel(i) && (sure(i, 'cancel')
                    ? <button className="btn btn-red" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => onCancel([i.id], i.name)}>Cancel dish</button>
                    : <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} disabled={busy} onClick={() => setAsk({ id: i.id, kind: 'cancel' })}>Cancel</button>)}
                </span>
              </div>
            )
          })}
        </div>
        {its.some(i => i.state === 'fired' && statusOf(i).cls !== 'sv' && !canCancel(i)) && !ask && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>A dish sent more than a minute ago can be cancelled by the Control Desk.</p>
        )}
        {ask && its.some(i => i.id === ask.id && (ask.kind !== 'cancel' || canCancel(i))) && <p style={{ fontSize: 12.5, color: ask.kind === 'cancel' ? 'var(--red)' : 'var(--ink)', margin: '0 0 10px' }}>
          {ask.kind === 'cancel'
            ? 'Tap Cancel dish to confirm. The kitchen screen updates at once, and a CANCEL slip prints if the KOT was already printed.'
            : 'Tap Send remake to confirm. A new KOT marked REMAKE - PRIORITY goes to the kitchen.'}</p>}
        <div className="row">
          {toServe.length > 0 && <button className="btn btn-green" disabled={busy} onClick={() => onServe(toServe)}>Mark delivered</button>}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
