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
   allergies, dislikes and notes go on every KOT of that cover (the KOT prints the VIP's name
   at the top), and the menu becomes the guest's own menu (Event set-up › VIP guests › Their
   menu): their dishes, course by course, and every course their menu leaves out (Amuse
   Bouche, drinks …) as for any guest. Nothing is added to the order by itself: the captain
   adds the dishes and picks them up. Full menu shows everything again. A VIP with a fixed
   table and cover is loaded by itself when the captain opens that cover.
   Two captains can share a table and split its covers (Event set-up > Captains). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import {
  coursesOf, courseRank, lateMinutes, dishStatus, deliveredAt, useLive, useNow, loadMenu, rpc, rpcRetry, errText, newRef,
  QUICK_NOTES, splitNote, joinNote, servedHideMinutes, ago, shortName, tc, coverRange, rangeText, tableRanges, capOrder,
  isExtraCover, coverLabel, coversOf, tableCovers, spareOwner,
} from './msData'

const ALL = '__all'
const SHOW_DELIVERED_MS = 10000   // Show delivered: 10 seconds to read them, then they hide again
// "NMA - Mrs Nita Ambani": the VIP guest as the KOT prints it (label, then name)
const vipName = v => [v?.label, v?.name].map(x => String(x || '').trim()).filter(Boolean).join(' - ')

// Void a dish already fired: a second tap, because it prints a VOID slip in the kitchen.
function CancelFired({ disabled, onCancel }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return armed
    ? <button className="x arm" disabled={disabled} onClick={() => { setArmed(false); onCancel() }}>Void?</button>
    : <button className="x void" disabled={disabled} onClick={() => setArmed(true)} title="Void this dish: the kitchen stops it">✕ Void</button>
}

// A second tap for actions that undo the guest's order (New guest)
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

// A list that scrolls with a scroll bar that is always visible (tablets hide their own until
// you scroll) and a "More below" button while anything is out of sight underneath
function ScrollBox({ className, children }) {
  const ref = useRef(null)
  const [bar, setBar] = useState(null)   // { h, top, more } in % of the box
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const next = scrollHeight <= clientHeight + 2 ? null : {
      h: Math.round(Math.max(12, (clientHeight / scrollHeight) * 100)),
      top: 0, more: scrollHeight - clientHeight - scrollTop > 6,
    }
    if (next) next.top = Math.round((scrollTop / (scrollHeight - clientHeight)) * (100 - next.h))
    setBar(b => (JSON.stringify(b) === JSON.stringify(next) ? b : next))
  }, [])
  useEffect(() => { measure() })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure); ro.observe(el)
    return () => ro.disconnect()
  }, [measure])
  return (
    <div className="sbx">
      <div ref={ref} className={className} onScroll={measure}>{children}</div>
      {bar && <div className="sbar" aria-hidden="true"><i style={{ top: bar.top + '%', height: bar.h + '%' }} /></div>}
      {bar?.more && <button className="smore" onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: 'smooth' })}>More below ▾</button>}
    </div>
  )
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
  const tableKey = `ms_table_${ev.id}_${captain.id}`
  const [table, setTable] = useState(() => {
    const saved = Number(localStorage.getItem(tableKey))
    return Number(captain.table_number) || saved || null
  })
  const [view, setView] = useState('take')
  const [coverPick, setCover] = useState(() => coverRange(captain, coversOf(ev, captain.table_number))?.from || 1)
  // Two filter rows: Cuisine (All, Italian, Oriental ...) first, then Course (All, Soup ... Dessert)
  const [cuisineTab, setCuisineTab] = useState(ALL)
  const [courseTab, setCourseTab] = useState(ALL)
  const [q, setQ] = useState('')
  const [fullFor, setFullFor] = useState('')         // 'table:cover' of a VIP cover showing the full menu
  const [sel, setSel] = useState(() => new Set())    // ms_items ids picked on the board
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [noteOpen, setNoteOpen] = useState(null)   // the note being edited in place: 'item:<id>', 'out:<ref>' or 'guest:<cover>'
  // Typing in the order (a note) or the dish search, on an upright tablet: the order panel grows a
  // little for a note (the screen stays the same: top bar, covers and menu in place), the order
  // steps aside for the dish search. Worked out from the field that really has the focus, so a
  // note field closed by OK, Enter or Done never leaves the screen in typing mode.
  const [typing, setTyping] = useState('')
  const typingOff = useRef(null)
  const typingNow = () => {
    const t = document.activeElement
    if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) return ''
    return t.closest('.cart') ? 'order' : t.closest('.msearch') ? 'search' : ''
  }
  // only a field changes it at once: a button taking the focus (the tap on a dish +, a note chip)
  // must not move the screen under the finger before the tap ends; the blur timer handles it
  const onFocusIn = e => {
    if (!e.target || !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
    clearTimeout(typingOff.current); setTyping(typingNow())
  }
  const onFocusOut = () => { clearTimeout(typingOff.current); typingOff.current = setTimeout(() => setTyping(typingNow()), 150) }
  const recheckTyping = () => { clearTimeout(typingOff.current); typingOff.current = setTimeout(() => setTyping(typingNow()), 60) }
  /* The keyboard on a touch screen. Chrome makes room for it by itself (the page gets shorter).
     Inside the tablet app it is laid over the page and the page is not told, so the field at the
     bottom was hidden under it. There, like other apps do, the whole screen moves up until the
     field (with 🎤 and OK) sits just above the keyboard, and comes back down when typing ends. */
  const [pan, setPanState] = useState(0)
  const panRef = useRef(0)
  useEffect(() => {
    const setPan = v => { panRef.current = v; setPanState(v) }
    if (!window.matchMedia || !window.matchMedia('(pointer:coarse)').matches) return
    const vv = window.visualViewport
    let timers = [], h0 = window.innerHeight
    const isField = t => t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && !/^(checkbox|radio|button|submit)$/.test(t.type)
    const clear = () => { timers.forEach(clearTimeout); timers = [] }
    const place = t => {
      if (document.activeElement !== t) return
      const h = window.innerHeight
      // the browser told the page about the keyboard (page shorter, or visible area shorter): nothing to do
      if (h < h0 - 100 || (vv && vv.height < h - 100)) { setPan(0); return }
      const kb = Math.round(h * (h > window.innerWidth ? 0.34 : 0.55))   // the Samsung keyboard, upright / sideways
      const row = t.closest('.nin') || t
      const bottom = row.getBoundingClientRect().bottom + panRef.current
      setPan(Math.max(0, Math.round(bottom - (h - kb - 6))))
    }
    const onIn = e => {
      if (!isField(e.target)) return
      clear()
      if (!panRef.current) h0 = Math.max(h0, window.innerHeight)
      const t = e.target
      timers = [setTimeout(() => place(t), 380), setTimeout(() => place(t), 900)]
    }
    const onOut = () => {
      clear()
      timers = [setTimeout(() => { if (!isField(document.activeElement)) setPan(0) }, 160)]
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => { clear(); document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [])
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
      // the event's settings read live: alert times, and covers per table changed at the desk
      supabase.from('events').select('*').eq('id', ev.id).maybeSingle(),
    ])
    return { ...m, vips: vips.error ? [] : (vips.data || []), ev: evr.data || null }
  }, { eventId: ev.id, tables: ['ms_vip_guests'], intervalMs: 15000 })
  const menu = menuQ.data
  const vips = useMemo(() => menu?.vips || [], [menu])
  const evLive = { ...ev, ...(menu?.ev || {}) }
  // this table's covers (a table can have its own number, set at the desk)
  const coverCount = coversOf(evLive, table)

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
  // C1 … Cn, then the A chairs 1A, 2A … (10 chairs: C1–C8, 1A, 2A): 1A is Table Captain 1's, 2A Table Captain 2's
  const allCovers = tableCovers(evLive, table, [...live.covers.map(x => x.cover_no), ...live.items.map(i => i.cover_no), ...outbox.map(o => o.cover)])
  const spareOf = c => spareOwner(live.captains, c)
  const isMine = c => !myRange || (isExtraCover(c) ? !spareOf(c) || spareOf(c).id === captain.id : c >= myRange.from && c <= myRange.to)
  const myCovers = allCovers.filter(isMine)
  const visibleCovers = showAll ? allCovers : myCovers
  const ownerOf = c => (isExtraCover(c)
    ? (spareOf(c) && spareOf(c).id !== captain.id ? spareOf(c).name : '')
    : live.captains.filter(x => { const r = ranges.get(x.id); return x.id !== captain.id && r && c >= r.from && c <= r.to }).map(x => x.name).join(', '))
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
            if (s?.first_course?.kots?.length) setToast({ text: `${coverLabel(o.cover)} seated · ${firstCourse} picked up` })
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
    setOutbox(list => [...list, { ref: newRef(), cover, menu_item_id: d.id, note: pref?.note || '', allergy: pref?.allergy || '', vip_guest_id: vip && pref ? vip.id : null, at: Date.now() }])
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
      setToast({ text: on ? `${coverLabel(c)} seated${fc ? ` · ${firstCourse} picked up` : ''}` : `${coverLabel(c)} marked not seated` })
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
      setToast({ text: `${todo.length} covers seated${r?.first_course?.kots?.length ? ` · ${firstCourse} picked up` : ''}` })
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
      setToast({ text: `${label || 'Picked up'} · ${k.map(x => `${x.kot_no} (${x.kitchen})`).join(', ')}` })
      setSel(new Set())
      await liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }); liveQ.reload() }
    setFiring(f => { const n = new Set(f); ids.forEach(id => n.delete(id)); return n })
  }

  async function cancelItems(ids, what) {
    setBusy(true)
    try {
      await rpc('ms_cancel', { p_item_ids: ids, p_by: captain.name })
      setToast({ text: `${what} voided` })
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
      if (!quiet) setToast({ text: `${i.name} removed from ${coverLabel(i.cover_no)}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }
  // A dish fired by mistake can be voided within a minute of firing (a VOID slip prints);
  // after that the Control Desk voids it
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
  const toggleNote = key => { setNoteOpen(k => (k === key ? null : key)); recheckTyping() }

  async function newGuest(c) {
    setBusy(true)
    try {
      setOutbox(list => list.filter(o => o.cover !== c || o.ids))
      const r = await rpc('ms_cover_reset', { p_event_id: ev.id, p_table_number: table, p_cover_no: c })
      setToast({ text: `${coverLabel(c)} ready for a new guest${r?.cancelled ? ` · ${r.cancelled} dish${r.cancelled === 1 ? '' : 'es'} not picked up removed` : ''}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function applyVip(v, c, auto = false) {
    setBusy(true)
    try {
      const r = await rpc('ms_vip_apply', { p_event_id: ev.id, p_table_number: table, p_cover_no: c, p_vip_id: v.id, p_captain_id: captain.id })
      setSheet(null); setCover(c); setFullFor('')
      const own = (v.dishes || []).length > 0
      setToast({ text: `★ ${vipName(v)} on ${coverLabel(c)}${auto ? ' (reserved seat)' : ''} · ${r?.held ? `${r.held} dish${r.held === 1 ? '' : 'es'} added · ` : ''}${own ? 'their menu is showing' : 'preferences loaded'}` })
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
  const courseOf = d => courses.includes(d.course) ? d.course : 'Other'
  // A VIP guest with their own menu: only their dishes in the courses their menu has; a course
  // their menu leaves out (Amuse Bouche, Gujarati Thali, drinks …) shows as for every guest.
  // Full menu shows everything (until the cover changes).
  const vipList = vip ? (vip.dishes || []).filter(x => dishById[x.menu_item_id]) : []
  const vipMode = vipList.length > 0 && fullFor !== `${table}:${cover}`
  const vipEntry = vipMode ? Object.fromEntries(vipList.map(x => [x.menu_item_id, x])) : {}
  const vipCourses = new Set(vipMode ? vipList.map(x => courseOf(dishById[x.menu_item_id])) : [])
  // VIP-only dishes (special preparations) are offered only on a VIP guest's cover
  const dishesShown = (menu?.dishes || []).filter(d => visibleCat.has(d.category_id) && !(autoFirst && d.course === firstCourse) && (!d.vip_only || vip)
    && (!vipMode || vipEntry[d.id] || (!d.vip_only && !vipCourses.has(courseOf(d)))))
  const nVipShown = vipMode ? dishesShown.filter(d => vipEntry[d.id]).length : 0
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
  // The menu course by course (Soup, Appetizer ...); in each course the dishes cuisine by cuisine,
  // each card naming its cuisine
  const groupsShown = []
  if (!query) {
    for (const c of [...courses, 'Other']) {
      const list = shown.filter(d => courseOf(d) === c).sort((a, b) => cuisineRank(a.category_id) - cuisineRank(b.category_id))
      if (!list.length) continue
      const czNames = [...new Set(list.map(d => catName(d.category_id)))].join(', ')
      groupsShown.push({ key: c, title: c, sub: `${list.length} ${list.length === 1 ? 'dish' : 'dishes'}${activeCuisine === ALL ? ` · ${czNames}` : ''}`, list })
    }
  }
  const czTag = id => <span className={'cz z' + (cuisineRank(id) % 6)}>{catName(id)}</span>

  // One tile per dish (3 to a row on the captain tablet, no photo): cuisine on top, the name
  // on up to three lines, one line of description and one button: + adds it to the cover,
  // then the same button is − and takes it off again (no quantity)
  const dishCard = (d, k = '') => {
    const n = unfiredCount(d.id)
    const sent = itemsOf(cover).some(i => i.menu_item_id === d.id && i.state === 'fired')
    const off = d.is_available === false
    // on a VIP's own menu the dish reads as in their menu booklet
    const desc = vipEntry[d.id]?.desc || d.description
    return (
      <div key={k + d.id} className={'dish dtile' + (off ? ' off' : '') + (n ? ' picked' : '')} data-dish={d.name}>
        <div className="dtop">
          {czTag(d.category_id)}
          {(query || k) && d.course ? <b className="dq">{d.course}</b> : null}
          {d.vip_only && !vipEntry[d.id] && <b className="vtag">VIP only</b>}
          {sent && !n && <b className="snt">✓ Sent</b>}
        </div>
        <div className="dn"><Veg veg={d.is_veg} /><span className="dnt">{d.name}</span></div>
        {desc && <div className="dd">{desc}</div>}
        <div className="dbot">
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
  // One plain list (no course headings): in course order, then in the order they were taken
  const lineAt = l => new Date(l.kind === 'out' ? l.o.at : l.i.held_at || 0).getTime() || 0
  const orderedLines = [...lines].sort((a, b) => courseRank(courses, a.course) - courseRank(courses, b.course) || lineAt(a) - lineAt(b))
  const nHeld = coverItems.filter(i => i.state === 'held').length + pend.filter(o => !o.cancel).length
  const nKitchen = coverItems.filter(i => i.state === 'fired').length - delivered.length
  const nLate = coverItems.filter(i => i.state === 'fired' && statusOf(i).late).length
  const unsaved = outbox.filter(o => !o.ids && o.err).length
  const summary = [nHeld && <span key="h" className="s-h">{nHeld} to pick up</span>,
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
          <div className="nmw"><span className="nm">{l.dish.name}</span>{czTag(l.dish.category_id)}{l.course && <span className="ocrs">{l.course}</span>}
            <span className={'chip ' + (o.err ? 'lt' : 'hd')} title={o.err || ''}>{o.err ? 'Not saved · retrying' : 'Saving…'}</span><NoteTags note={o.note} allergy={o.allergy} /></div>
          <button className={'nbtn' + (noteOpen === 'out:' + o.ref ? ' act' : '')} onClick={() => toggleNote('out:' + o.ref)}>{o.note || o.allergy ? 'Note' : '+ Note'}</button>
          <button className="x" onClick={() => minusDish(l.dish)} title="Take this dish off">✕</button>
        </div>
        {noteOpen === nk && <NoteEditor key={nk} note={o.note} allergy={o.allergy} onSave={(n, a) => saveNote({ kind: 'out', ref: o.ref }, n, a)} onClose={() => { setNoteOpen(null); recheckTyping() }} onField={recheckTyping} />}
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
        <div className="nmw"><span className="nm">{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}</span>{l.dish ? czTag(l.dish.category_id) : null}{l.course && <span className="ocrs">{l.course}</span>}{i.vip_guest_id && <span className="vtag">★</span>}
          {i.state !== 'held' && <span className={'chip ' + st.cls}>{st.label}</span>}<NoteTags note={i.note} allergy={i.allergy} /></div>
        {i.state === 'held' ? (
          <>
            <button className={'nbtn' + (noteOpen === 'item:' + i.id ? ' act' : '')} onClick={() => toggleNote('item:' + i.id)}>{i.note || i.allergy ? 'Note' : '+ Note'}</button>
            <button className="firei" disabled={firing.has(i.id)} onClick={() => fireIds([i.id], `${i.name} picked up for ${coverLabel(i.cover_no)}`)}>{firing.has(i.id) ? 'Sending…' : 'Pick up'}</button>
            <button className="x" disabled={busy} onClick={() => removeHeld(i)} title="Remove this dish">✕</button>
          </>
        ) : (
          canCancelFired(i) && <CancelFired disabled={busy} onCancel={() => cancelItems([i.id], i.name)} />
        )}
      </div>
      {noteOpen === nk && i.state === 'held' && <NoteEditor key={nk} note={i.note} allergy={i.allergy} onSave={(n, a) => saveNote({ kind: 'item', id: i.id }, n, a)} onClose={() => { setNoteOpen(null); recheckTyping() }} onField={recheckTyping} />}
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
            {vip && vipList.length > 0 && (
              <div className={'vipmenu' + (vipMode ? '' : ' full')} data-vipmenu={vipMode ? 'own' : 'full'}>
                <span className="vmt">★ VIP</span>
                <b className="vmn">{vipName(vip)}</b>
                <span className="vms">{vipMode ? `Their menu · ${nVipShown} ${nVipShown === 1 ? 'dish' : 'dishes'}` : 'Full menu'}</span>
                <button className="vmb" onClick={() => { setFullFor(vipMode ? `${table}:${cover}` : ''); setCuisineTab(ALL); setCourseTab(ALL) }}>{vipMode ? 'Full menu' : 'Their menu'}</button>
              </div>
            )}
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
            <div className="dlist tiles">
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
                  : <button className="minib" disabled={busy} onClick={() => seat(cover)}>Mark seated{autoFirst ? ` · picks up ${firstCourse}` : ''}</button>}
                <span style={{ flex: 1 }} />
                {(coverItems.length > 0 || cr?.guest_note || cr?.guest_allergy || vip) && <Sure label="New guest" sure="New guest?" disabled={busy} onYes={() => newGuest(cover)} />}
                {!pinned && <button className="minib" onClick={() => setOrderOpen(false)}>Hide</button>}
                <button className={'pin' + (pinned ? ' pd' : '')} onClick={togglePin} aria-label={pinned ? 'Pinned' : 'Pin'}
                  title={pinned ? 'Pinned: always shown. Tap to let it hide while you pick dishes' : 'Keep the order always shown'}>{pinned ? '📌' : '📌 Pin'}</button>
              </div>
              {reserved && <div className="vipr">★ Reserved for {vipName(reserved)}<button className="minib" disabled={busy} onClick={() => applyVip(reserved, cover)}>Load their menu</button></div>}
              {vip && <div className="vipr vipon" data-vip-on={vip.name}><span>★ VIP · {vipName(vip)}</span></div>}
              <div className="sum">
                <button className={'gbtn' + (noteOpen === 'guest:' + cover ? ' act' : '')} onClick={() => toggleNote('guest:' + cover)}>
                  {cr?.guest_note || cr?.guest_allergy ? 'Guest note' : '+ Guest note (all dishes)'}</button>
                <NoteTags note={cr?.guest_note} allergy={cr?.guest_allergy} />
                {summary.length ? summary : <span>Nothing ordered for {coverLabel(cover)} yet · tap + on a dish</span>}
                {hiddenDelivered.length > 0 && (showingDelivered
                  ? <button className="shw" onClick={() => setShowDelivered(0)}>Hide delivered</button>
                  : <button className="shw" onClick={() => setShowDelivered(Date.now() + SHOW_DELIVERED_MS)}>Show delivered ({hiddenDelivered.length})</button>)}
                {unsaved > 0 && <span className="s-u">{unsaved} not saved · retrying</span>}
              </div>
              {noteOpen === 'guest:' + cover && (
                <NoteEditor key={'guest:' + cover} note={cr?.guest_note} allergy={cr?.guest_allergy}
                  onSave={(n, a) => saveNote({ kind: 'guest', cover }, n, a)} onClose={() => { setNoteOpen(null); recheckTyping() }} onField={recheckTyping} />
              )}
              {!isMine(cover) && <div className="helpout">Helping out: {coverLabel(cover)} is {ownerOf(cover) || 'another captain'}'s cover</div>}
            </div>
            <ScrollBox className="scroll olist">
              {orderedLines.map(orderLine)}
              {!lines.length && (
                <div className="empty">{hiddenDelivered.length ? 'Everything ordered has been delivered.' : 'Tap + on a dish: it is saved at once. Each dish has its own Pick up button.'}</div>
              )}
            </ScrollBox>
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
    if (held && since && now - since > (Number(ev.pacing_minutes) || 25) * 60000) pace.push({ c, t: `nothing picked up for ${Math.floor((now - since) / 60000)} min`, w: 2 })
    else if (servedTimes[0]) pace.push({ c, t: `${servedTimes[0].course?.toLowerCase() || 'course'} delivered ${ago(servedTimes[0].served_at, now)}`, w: 1 })
    else if (lastFired && !late.length) pace.push({ c, t: `${lastFired.course?.toLowerCase() || 'course'} picked up ${ago(lastFired.fired_at, now)}`, w: 0 })
  }
  pace.sort((a, b) => b.w - a.w)

  // Status key with counts for the covers shown
  const shownItems = live.items.filter(i => i.state !== 'cancelled' && boardCovers.includes(i.cover_no) && courses.includes(i.course))
  const tally = cls => shownItems.filter(i => statusOf(i).cls === cls).length
  const KEY = [['hd', 'To pick up'], ['fi', 'In kitchen'], ['sv', 'Delivered'], ['lt', `Late (over ${lateMinutes(null, evLive)} min)`]]

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
                  <td className={'cvc' + (isMine(c) ? '' : ' oth')} style={{ cursor: 'pointer' }} onClick={() => onCoverHead(c)}>{coverLabel(c)}{vipOf(c) ? ' ★' : ''}<small>{selCovers.includes(c) ? 'selected' : !isMine(c) ? ownerOf(c) || 'other' : seated.has(c) ? 'seated' : itemsOf(c).length ? 'ordered' : 'empty'}</small></td>
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
                        <b>{name}</b><span>{isSel ? 'Pick up' : st.label}</span>
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
            <div><b>Tap held dishes to pick up</b><br /><small>Tap a course heading for every cover shown, or a cover for its next course</small></div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.35)' }} disabled={!sel.size} onClick={() => setSel(new Set())}>Clear</button>
          <button className="btn btn-amber" style={{ padding: '10px 18px', fontSize: 14 }} disabled={busy || !selItems.length}
            onClick={() => fireIds(selItems.map(i => i.id), `${selCourses.join(' + ')} picked up`)}>Pick up {selItems.length || ''} {selItems.length === 1 ? 'dish' : 'dishes'}</button>
        </div>
      </div>
      <div className="side">
        <h5>Pace</h5>
        <div className="pace">
          {pace.length ? pace.slice(0, 8).map((p, i) => <div key={i}><b>{coverLabel(p.c)}</b> {p.t}</div>) : <span className="muted">Seat covers and pick up the first dishes to see the pace here.</span>}
        </div>
        <div className="pace" style={{ background: '#FFF8E6' }}><b>Flexible sequence:</b> pick up one dish or several, for one cover or several. Each dish prints as its own KOT.</div>
        <button className="btn btn-ghost" disabled={busy || visibleCovers.every(c => seated.has(c))} onClick={seatAll}>{myRange && !showAll ? `Seat my covers (${rangeText(myRange)})` : 'Seat all covers'}{autoFirst ? ` · picks up ${firstCourse}` : ''}</button>
      </div>
    </div>
  )

  return (
    <div className={'ms cap-app' + (typing ? ' typing-' + typing : '')} onFocus={onFocusIn} onBlur={onFocusOut}
      style={pan ? { transform: `translateY(${-pan}px)`, transition: 'transform .15s ease-out' } : undefined}>
      <AppBar
        title={view === 'take' ? `Table T${table} · ${captain.name}${myRange ? ` · ${rangeText(myRange)}` : ''}` : `Table T${table} · Course board`}
        sub={view === 'take'
          ? `${capNo >= 0 ? `Table Captain ${capNo + 1} · ` : ''}${myRange ? `your covers ${rangeText(myRange)} · ${seatedMine} seated` : `${allCovers.length} covers · ${seated.size} seated`}`
          : `${live.captains.map((c, i) => `${c.name} (TC${i + 1}${ranges.get(c.id) ? ' · ' + rangeText(ranges.get(c.id)) : ''})`).join(' · ') || captain.name} · ${seated.size} covers seated · tap dishes to pick up`}
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
              <button key={c} className={'cv' + (isMine(c) ? '' : ' oth') + (isExtraCover(c) ? ' xc' : '') + (c === cover ? ' sel' : s === 'ordered' || s === 'delivered' ? ' done' : s === 'seated' ? ' seat' : '') + (vipOf(c) ? ' vip' : '')}
                onClick={() => setCover(c)}><b>{star}{coverLabel(c)}</b><small>{c === cover ? 'taking now' : s}</small></button>,
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

/* Note and allergy for one dish, or for everything a guest orders: tap the usual ones, type
   anything else under Other (voice typing: the 🎤 on the tablet's own keyboard). */

// Notes in place, right under the dish (or the guest): six one-tap notes, then Other or Allergy
// to type. Every tap is saved at once - nothing to confirm, no screen to leave.
function NoteEditor({ note, allergy, onSave, onClose, onField }) {
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
  const val = field === 'allergy' ? alg : other
  const setVal = v => (field === 'allergy' ? setAlg(v) : setOther(v))
  const inputRef = useRef(null)
  // closing the field: the keyboard goes down and the screen is back as it was
  const closeField = () => { save(); try { inputRef.current?.blur() } catch { /* gone */ } setField(null); onField?.() }
  const openField = f => { save(); setField(cur => (cur === f ? null : f)); onField?.() }
  return (
    <div className="ned">
      <div className="qn">
        {QUICK_NOTES.map(x => <button key={x} className={picked.has(x) ? 'a' : ''} onClick={() => flip(x)}>{x}</button>)}
        <button className={'qo' + (field === 'other' ? ' act' : '') + (other.trim() ? ' a' : '')} onClick={() => openField('other')}>✎ Other</button>
        <button className={'qal' + (field === 'allergy' ? ' act' : '') + (alg.trim() ? ' a' : '')} onClick={() => openField('allergy')}>⚠ Allergy</button>
        <button className="qd" onClick={() => { save(); try { inputRef.current?.blur() } catch { /* gone */ } onClose() }}>Done</button>
      </div>
      {field && (
        <div className="nin">
          <input ref={inputRef} autoFocus value={val} onChange={e => setVal(e.target.value)} onBlur={() => save()}
            onKeyDown={e => { if (e.key === 'Enter') closeField() }}
            placeholder={field === 'allergy' ? 'Allergy, e.g. peanuts' : 'Type, e.g. no tomato in the pizza'} />
          <button className="ok" onMouseDown={e => e.preventDefault()} onClick={closeField}>OK</button>
        </div>
      )}
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
            <p>Choose the guest, then their cover. The menu becomes the guest's own menu, and their allergies and preferences go on every KOT of that cover with their name. Nothing is added to the order: add the dishes and pick them up as usual.</p>
            {!vips.length && <div className="empty">No VIP guests are set up for this event (Event set-up › VIP guests).</div>}
            <div className="viplist">
              {vips.map(v => {
                const at = seatOf(v)
                return (
                  <button key={v.id} className="vipi" onClick={() => { setPick(v); setC(v.table_number && Number(v.table_number) === Number(table) && v.cover_no ? Number(v.cover_no) : cover) }}>
                    <b>★ {v.name}</b>{v.label && <span className="vlab">{v.label}</span>}
                    <small>{at ? `Seated at ${tc(at.table_number, at.cover_no)}` : v.table_number && v.cover_no ? `Reserved ${tc(v.table_number, v.cover_no)}` : 'Any table'}
                      {v.allergies ? ` · Allergy: ${v.allergies}` : ''}{(v.dishes || []).length ? ` · own menu, ${(v.dishes || []).length} dishes` : ''}</small>
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
              <p className="vmove">Now at {tc(seatOf(pick).table_number, seatOf(pick).cover_no)}: choosing a cover here moves the guest (their dishes not picked up there are removed).</p>
            )}
            <div className="nsec">Cover at table T{table}</div>
            <div className="vcov">{covers.map(x => <button key={x} className={x === c ? 'a' : ''} onClick={() => setC(x)}>{coverLabel(x)}</button>)}</div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-amber" disabled={busy} onClick={() => onApply(pick, c)}>Seat at {coverLabel(c)}{(pick.dishes || []).length ? ' · show their menu' : ' · load preferences'}</button>
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
  // Remake and Void reach the kitchen at once, so each takes a second tap.
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
                    ? <button className="btn btn-red" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => onCancel([i.id], i.name)}>Void dish</button>
                    : <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} disabled={busy} onClick={() => setAsk({ id: i.id, kind: 'cancel' })}>Void</button>)}
                </span>
              </div>
            )
          })}
        </div>
        {its.some(i => i.state === 'fired' && statusOf(i).cls !== 'sv' && !canCancel(i)) && !ask && (
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px' }}>A dish picked up more than a minute ago can be voided by the Control Desk.</p>
        )}
        {ask && its.some(i => i.id === ask.id && (ask.kind !== 'cancel' || canCancel(i))) && <p style={{ fontSize: 12.5, color: ask.kind === 'cancel' ? 'var(--red)' : 'var(--ink)', margin: '0 0 10px' }}>
          {ask.kind === 'cancel'
            ? 'Tap Void dish to confirm. The kitchen screen updates at once, and a VOID slip prints if the KOT was already printed.'
            : 'Tap Send remake to confirm. A new KOT marked REMAKE - PRIORITY goes to the kitchen.'}</p>}
        <div className="row">
          {toServe.length > 0 && <button className="btn btn-green" disabled={busy} onClick={() => onServe(toServe)}>Mark delivered</button>}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
