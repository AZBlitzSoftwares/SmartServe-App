/* Smart Serve Maestro - Captain App (table captain tablet).

   Two screens, one tap apart:
     Take order    pick the cover, take the guest's FULL order (all courses)
                   with notes. Save holds it: nothing reaches a kitchen.
     Course board  every cover x every course at a glance. Tap the held dishes
                   to send and tap Fire: one KOT per cover per kitchen barker.
   Seating a cover fires the First Course automatically (event setting).
   Served, Remake and Cancel are on the course board. Help alerts the desk. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/janus_logo.jpg'
import './maestro.css'
import {
  coursesOf, courseRank, lateMinutes, dishStatus, useLive, useNow, loadMenu, rpc, errText, newRef,
  NOTE_CHIPS, ago, shortName, tc,
} from './msData'

const FOODS = ['#7DAA6A', '#7A3B2A', '#D5532F', '#A66A2C', '#C9A15B', '#B5582A', '#8E6BBF', '#3F8F8A', '#C98B2E']
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

function DishPhoto({ dish }) {
  const [broken, setBroken] = useState(false)
  if (dish.photo_url && !broken) {
    return <div className="ph"><img src={dish.photo_url} alt="" loading="lazy" onError={() => setBroken(true)} /></div>
  }
  const f = FOODS[hash(dish.name) % FOODS.length]
  return (
    <div className="ph" style={{ background: 'linear-gradient(135deg,#F0E4CC,#fff)' }}>
      <div className="plate" />
      <div className="food" style={{ width: 54, height: 54, margin: '-27px 0 0 -27px', background: `radial-gradient(circle at 35% 35%,${f}cc,${f})` }} />
      <div className="food" style={{ width: 17, height: 17, margin: '-23px 0 0 6px', background: '#fff8' }} />
    </div>
  )
}

function Veg({ veg }) { return <span className={'veg' + (veg === false ? ' nv' : '')} /> }

function Toast({ toast, onClose }) {
  // Timed on the toast alone: the screen re-renders on every poll, and a new
  // onClose each time would keep restarting the timer.
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => closeRef.current(), toast.err ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  return <div className={'toast' + (toast.err ? ' err' : '')}>{toast.text}<button onClick={onClose}>OK</button></div>
}

export default function MaestroCaptain({ eventData, captain, onSwitchCaptain, onChat, chatUnread = 0 }) {
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
  const [cover, setCover] = useState(1)
  const [catId, setCatId] = useState(null)
  const [courseF, setCourseF] = useState(null)
  // The menu is browsed course first (Soup, Starters, ...) with cuisines as filters, or
  // cuisine first with courses as filters. Long menus are searched instead.
  const [browse, setBrowseRaw] = useState(() => { try { return localStorage.getItem('ms_browse') || 'course' } catch { return 'course' } })
  const setBrowse = b => { setBrowseRaw(b); try { localStorage.setItem('ms_browse', b) } catch { /* private mode */ } }
  const [courseTab, setCourseTab] = useState(null)
  const [cuisineF, setCuisineF] = useState(null)
  const [q, setQ] = useState('')
  const [drafts, setDrafts] = useState({})          // cover -> { menu_item_id: {qty, note} }
  const [sel, setSel] = useState(() => new Set())    // ms_items ids picked on the board
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [pickTable, setPickTable] = useState(false)
  const [noteOpen, setNoteOpen] = useState(null)   // draft row whose note chips are showing
  const now = useNow(1000)

  useEffect(() => { if (table) localStorage.setItem(tableKey, String(table)) }, [table, tableKey])
  useEffect(() => { if (captain.table_number && Number(captain.table_number) !== table) setTable(Number(captain.table_number)) }, [captain.table_number])

  // Drafts survive a reload of the tablet (per event + table).
  const draftKey = `ms_drafts_${ev.id}_${table}`
  useEffect(() => { try { setDrafts(JSON.parse(localStorage.getItem(draftKey) || '{}')) } catch { setDrafts({}) } }, [draftKey])
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify(drafts)) } catch { /* full */ } }, [drafts, draftKey])

  const menuQ = useLive(() => loadMenu(ev.id), { eventId: ev.id, tables: [], intervalMs: 15000 })
  const menu = menuQ.data

  const liveQ = useLive(async () => {
    if (!table) return { items: [], kots: [], covers: [], captains: [] }
    const [items, kots, covers, caps] = await Promise.all([
      supabase.from('ms_items').select('*').eq('event_id', ev.id).eq('table_number', table).order('held_at'),
      supabase.from('kots').select('id,kot_no,kitchen_id,kitchen_name,cover_no,barker,stage,fired_at,ready_at,dispatched_at,served_at,status,kind,is_remake,print_status')
        .eq('event_id', ev.id).eq('table_number', table).eq('kind', 'order'),
      supabase.from('ms_covers').select('*').eq('event_id', ev.id).eq('table_number', table),
      supabase.from('captains').select('id,name,table_number').eq('event_id', ev.id).eq('table_number', table).eq('is_active', true).order('created_at'),
    ])
    for (const r of [items, kots, covers]) if (r.error) throw r.error
    return { items: items.data || [], kots: kots.data || [], covers: covers.data || [], captains: caps.data || [] }
  }, { eventId: ev.id, tables: ['ms_items', 'kots', 'ms_covers'], intervalMs: 3000, deps: [table] })
  const live = liveQ.data || { items: [], kots: [], covers: [], captains: [] }

  const kotById = useMemo(() => Object.fromEntries(live.kots.map(k => [k.id, k])), [live.kots])
  const kitchenById = useMemo(() => Object.fromEntries((menu?.kitchens || []).map(k => [k.id, k])), [menu])
  const dishById = useMemo(() => Object.fromEntries((menu?.dishes || []).map(d => [d.id, d])), [menu])
  const seated = useMemo(() => new Set(live.covers.filter(c => c.seated_at).map(c => c.cover_no)), [live.covers])

  const itemsOf = c => live.items.filter(i => i.cover_no === c && i.state !== 'cancelled')
  const statusOf = i => dishStatus(i, kotById[i.kot_id], now, lateMinutes(kitchenById[i.kitchen_id], ev))

  // the cover's label on the cover bar
  function coverState(c) {
    if (c === cover && view === 'take') return 'taking now'
    const its = itemsOf(c)
    if (its.length) {
      if (its.every(i => statusOf(i).cls === 'sv')) return 'served'
      return 'ordered'
    }
    return seated.has(c) ? 'seated' : 'empty'
  }

  const capNo = live.captains.findIndex(c => c.id === captain.id)
  const capLabel = `${captain.name}${capNo >= 0 ? ` (Table Captain ${capNo + 1})` : ''}`

  // ----------------------------------------------------------- actions
  const draft = drafts[cover] || {}
  const setDraft = (c, fn) => setDrafts(d => {
    const cur = { ...(d[c] || {}) }
    fn(cur)
    for (const k of Object.keys(cur)) if (!cur[k] || cur[k].qty <= 0) delete cur[k]
    const next = { ...d, [c]: cur }
    if (!Object.keys(cur).length) delete next[c]
    return next
  })
  const addDish = (id, n = 1) => setDraft(cover, cur => { cur[id] = { qty: (cur[id]?.qty || 0) + n, note: cur[id]?.note || '' } })
  const toggleNote = (id, chip) => setDraft(cover, cur => {
    const parts = new Set(String(cur[id]?.note || '').split(',').map(s => s.trim()).filter(Boolean))
    parts.has(chip) ? parts.delete(chip) : parts.add(chip)
    cur[id] = { ...cur[id], note: NOTE_CHIPS.filter(c => parts.has(c)).concat([...parts].filter(p => !NOTE_CHIPS.includes(p))).join(', ') }
  })

  async function seat(c, on = true) {
    setBusy(true)
    try {
      const r = await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: [c], p_captain_id: captain.id, p_seated: on })
      const fc = r?.first_course?.kots?.length
      setToast({ text: on ? `C${c} seated${fc ? ` · ${firstCourse} fired` : ''}` : `C${c} marked not seated` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function seatAll() {
    const todo = Array.from({ length: coverCount }, (_, i) => i + 1).filter(c => !seated.has(c))
    if (!todo.length) return
    setBusy(true)
    try {
      const r = await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: todo, p_captain_id: captain.id, p_seated: true })
      setToast({ text: `${todo.length} covers seated${r?.first_course?.kots?.length ? ` · ${firstCourse} fired` : ''}` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function saveDraft(c) {
    const d = drafts[c] || {}
    const items = Object.entries(d).map(([id, v]) => ({ menu_item_id: id, qty: v.qty, note: v.note || null }))
    if (!items.length) return []
    const r = await rpc('ms_hold', { p_event_id: ev.id, p_table_number: table, p_cover_no: c, p_captain_id: captain.id, p_items: items, p_client_ref: newRef() })
    setDrafts(x => { const n = { ...x }; delete n[c]; return n })
    return r?.ids || []
  }

  async function onSave() {
    setBusy(true)
    try {
      const n = Object.keys(draft).length
      await saveDraft(cover)
      if (!seated.has(cover)) await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: [cover], p_captain_id: captain.id, p_seated: true })
      setToast({ text: `Order saved for C${cover} · ${n} ${n === 1 ? 'dish' : 'dishes'} held` })
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }) }
    setBusy(false)
  }

  async function fireIds(ids, label) {
    if (!ids.length) return
    setBusy(true)
    try {
      const r = await rpc('ms_fire', { p_event_id: ev.id, p_table_number: table, p_item_ids: ids, p_captain_id: captain.id, p_client_ref: newRef() })
      const k = r?.kots || []
      setToast({ text: `${label || 'Fired'} · ${k.length} KOT${k.length === 1 ? '' : 's'}: ${k.map(x => x.kot_no).join(', ')}` })
      setSel(new Set())
      liveQ.reload()
    } catch (e) { setToast({ text: errText(e), err: true }); liveQ.reload() }
    setBusy(false)
  }

  // Next course to fire for a cover: the earliest course with held dishes
  // (counting dishes still in the draft).
  function nextCourse(c, extraDraft) {
    const held = itemsOf(c).filter(i => i.state === 'held').map(i => i.course)
    const dr = Object.keys(extraDraft || {}).map(id => dishById[id]?.course)
    const all = [...held, ...dr].filter(Boolean)
    return all.sort((a, b) => courseRank(courses, a) - courseRank(courses, b))[0] || null
  }

  async function onSaveAndFire() {
    const nc = nextCourse(cover, draft)
    if (!nc) return
    setBusy(true)
    try {
      await saveDraft(cover)
      if (!seated.has(cover)) await rpc('ms_seat', { p_event_id: ev.id, p_table_number: table, p_covers: [cover], p_captain_id: captain.id, p_seated: true })
      const { data } = await supabase.from('ms_items').select('id').eq('event_id', ev.id).eq('table_number', table)
        .eq('cover_no', cover).eq('state', 'held').eq('course', nc)
      setBusy(false)
      await fireIds((data || []).map(x => x.id), `${nc} fired for C${cover}`)
    } catch (e) { setToast({ text: errText(e), err: true }); setBusy(false) }
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

  async function serveKots(kotIds) {
    setBusy(true)
    try {
      await rpc('ms_serve', { p_kot_ids: kotIds, p_undo: false })
      setToast({ text: 'Marked served' }); setSheet(null); liveQ.reload()
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
      // Same row shape as the existing Help button, so the supervisor's
      // alert banner and the Control Desk both pick it up.
      const { error } = await supabase.from('sos_requests').insert({ event_id: ev.id, table_id: t?.id || null, table_number: table, captain_id: captain.id, request_type: 'help', status: 'open' })
      if (error) throw error
      setToast({ text: 'The control desk has been alerted' })
    } catch (e) { setToast({ text: errText(e), err: true }) }
  }

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
                onClick={() => { setTable(t); setPickTable(false); setSel(new Set()) }}>T{t}</button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------- Take order
  const cats = (menu?.cats || []).filter(c => c.is_visible !== false)
  const autoFirst = ev.first_course_auto !== false
  const visibleCat = new Set(cats.map(c => c.id))
  const dishesShown = (menu?.dishes || []).filter(d => visibleCat.has(d.category_id) && !(autoFirst && d.course === firstCourse))
  const catsWithDishes = cats.filter(c => dishesShown.some(d => d.category_id === c.id))
  const activeCat = catsWithDishes.find(c => c.id === catId) || catsWithDishes[0]
  const catDishes = dishesShown.filter(d => d.category_id === activeCat?.id)
  const catCourses = courses.filter(c => catDishes.some(d => d.course === c))
  // course first
  const courseOf = d => courses.includes(d.course) ? d.course : 'Other'
  const courseTabs = [...courses, 'Other'].filter(c => dishesShown.some(d => courseOf(d) === c))
  const activeCourse = courseTabs.includes(courseTab) ? courseTab : courseTabs[0]
  const courseDishes = dishesShown.filter(d => courseOf(d) === activeCourse)
  const courseCats = cats.filter(c => courseDishes.some(d => d.category_id === c.id))
  const catName = id => menu?.catsById?.[id]?.name || ''
  const query = q.trim().toLowerCase()
  const shown = query
    ? dishesShown.filter(d => `${d.name} ${d.description || ''} ${catName(d.category_id)} ${d.course || ''}`.toLowerCase().includes(query))
    : browse === 'course'
      ? courseDishes.filter(d => !cuisineF || d.category_id === cuisineF)
      : catDishes.filter(d => !courseF || d.course === courseF)
  const countIn = (list, f) => list.filter(f).length

  const coverItems = itemsOf(cover)
  const draftRows = Object.entries(draft).map(([id, v]) => ({ id, ...v, dish: dishById[id] })).filter(r => r.dish)
  const groupCourses = courses.filter(c => coverItems.some(i => i.course === c) || draftRows.some(r => r.dish.course === c))
  const otherCourse = [...new Set([...coverItems.map(i => i.course), ...draftRows.map(r => r.dish.course)].filter(c => !courses.includes(c)))]
  const nc = nextCourse(cover, draft)
  const ncDishes = [...coverItems.filter(i => i.state === 'held' && i.course === nc).map(i => ({ kitchen: kitchenById[i.kitchen_id]?.name, barker: i.barker })),
    ...draftRows.filter(r => r.dish.course === nc).map(r => ({ kitchen: r.dish.kitchenName, barker: r.dish.barkerSide }))]
  const ncKots = new Set(ncDishes.map(d => d.kitchen + d.barker)).size
  const ncKitchens = [...new Set(ncDishes.map(d => d.kitchen))].filter(Boolean)
  const heldCount = coverItems.filter(i => i.state === 'held').length + draftRows.length

  const grouped = !query && browse === 'course' && !cuisineF && courseCats.length > 1
  const dishCard = d => {
    const q = draft[d.id]?.qty || 0
    const off = d.is_available === false
    return (
      <div key={d.id} className={'dish' + (off ? ' off' : '')}>
        <DishPhoto dish={d} />
        <div className="di">
          <div className="dn"><Veg veg={d.is_veg} />{d.name}</div>
          <div className="dd">{d.description || (browse === 'course' && !query ? catName(d.category_id) : d.course) || ''}</div>
          {query && <div className="dq">{d.course} · {catName(d.category_id)}</div>}
          <div className="add">
            <span className="k">{off ? 'Sold out' : `${d.kitchenName} kitchen`}</span>
            {off ? null : q ? (
              <div className="st"><button className="m" onClick={() => addDish(d.id, -1)}>−</button><span>{q}</span><button className="m" onClick={() => addDish(d.id, 1)}>+</button></div>
            ) : <button className="btn btn-amber" style={{ padding: '5px 12px' }} onClick={() => addDish(d.id, 1)}>ADD +</button>}
          </div>
        </div>
      </div>
    )
  }

  const takeOrder = (
    <div className="body">
      <div className="menu">
        {!menu ? <div className="empty">Loading the menu…</div> : (
          <>
            <div className="msearch">
              <div className="sbox">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${dishesShown.length} dishes…`} aria-label="Search dishes" />
                {q && <button className="clr" onClick={() => setQ('')} title="Clear">✕</button>}
              </div>
              <div className="seg" role="group" aria-label="Browse the menu by">
                <button className={browse === 'course' ? 'a' : ''} onClick={() => setBrowse('course')}>By course</button>
                <button className={browse === 'cuisine' ? 'a' : ''} onClick={() => setBrowse('cuisine')}>By cuisine</button>
              </div>
            </div>
            {query ? (
              <div className="courses"><span className="cc a">{shown.length} {shown.length === 1 ? 'dish' : 'dishes'} matching “{q.trim()}”</span></div>
            ) : browse === 'course' ? (
              <>
                <div className="tabs">
                  {courseTabs.map(c => (
                    <button key={c} className={'tab' + (c === activeCourse ? ' a' : '')} onClick={() => { setCourseTab(c); setCuisineF(null) }}>
                      {c} <span className="n">{countIn(dishesShown, d => courseOf(d) === c)}</span></button>
                  ))}
                </div>
                {courseCats.length > 1 && (
                  <div className="courses">
                    <button className={'cc' + (!cuisineF ? ' a' : '')} onClick={() => setCuisineF(null)}>All {courseDishes.length}</button>
                    {courseCats.map(c => (
                      <button key={c.id} className={'cc' + (cuisineF === c.id ? ' a' : '')} onClick={() => setCuisineF(cuisineF === c.id ? null : c.id)}>
                        {c.name} {countIn(courseDishes, d => d.category_id === c.id)}</button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="tabs">
                  {catsWithDishes.map(c => (
                    <button key={c.id} className={'tab' + (c.id === activeCat?.id ? ' a' : '')} onClick={() => { setCatId(c.id); setCourseF(null) }}>
                      {c.name} <span className="n">{countIn(dishesShown, d => d.category_id === c.id)}</span></button>
                  ))}
                </div>
                {catCourses.length > 1 && (
                  <div className="courses">
                    {catCourses.map(c => (
                      <button key={c} className={'cc' + (courseF === c ? ' a' : '')} onClick={() => setCourseF(courseF === c ? null : c)}>
                        {c} {countIn(catDishes, d => d.course === c)}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            {grouped && <div className="mixhint">Guests can mix cuisines in every course: one from each is fine, and every dish goes to its own kitchen on its own KOT.</div>}
            <div className="grid">
              {grouped
                ? courseCats.flatMap(c => {
                    const list = shown.filter(d => d.category_id === c.id)
                    return list.length ? [<div key={'h' + c.id} className="ghead">{c.name}<span>{list.length} · {list[0].kitchenName} kitchen</span></div>, ...list.map(dishCard)] : []
                  })
                : shown.map(dishCard)}
              {!shown.length && <div className="empty">{query ? 'No dish matches that search.' : 'No dishes here.'}</div>}
            </div>
          </>
        )}
      </div>
      <div className="cart">
        <div className="ch">
          <b>Full order · {tc(table, cover)}</b>
          <small>Taken once, saved for the cover and fired course by course</small>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {seated.has(cover)
              ? <span className="tagF">Seated</span>
              : <button className="btn btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} disabled={busy} onClick={() => seat(cover)}>Mark C{cover} seated{autoFirst ? ` · fires ${firstCourse}` : ''}</button>}
          </div>
        </div>
        <div className="scroll">
          {[...groupCourses, ...otherCourse].map(c => {
            const its = coverItems.filter(i => i.course === c)
            const drs = draftRows.filter(r => r.dish.course === c)
            const anyHeld = its.some(i => i.state === 'held') || drs.length
            const tag = c === nc ? <span className="tagF">Fire first</span>
              : anyHeld ? <span className="tagH">Hold</span>
              : its.length && its.every(i => statusOf(i).cls === 'sv') ? <span className="tagF">Served</span>
              : <span className="tagK">Fired</span>
            return (
              <div className="crs" key={c || 'none'}>
                <div className="h"><span>{c || 'Other'}</span>{tag}</div>
                {its.map(i => {
                  const s = statusOf(i)
                  return (
                    <div className="it" key={i.id}>
                      <Veg veg={i.veg} />{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}{i.note && <span className="note">{i.note}</span>}
                      <span className="k">{kitchenById[i.kitchen_id]?.name || ''}{i.state !== 'held' ? ` · ${s.label}` : ''}</span>
                      {i.state === 'held' && <button className="x" disabled={busy} onClick={() => setSheet({ kind: 'cancelHeld', item: i })}>✕</button>}
                    </div>
                  )
                })}
                {drs.map(r => (
                  <div className="it dr" key={'d' + r.id}>
                    <Veg veg={r.dish.is_veg} /><span className="tagN">New</span>
                    <span className="nm">{r.dish.name}</span>
                    <span className="k">{r.dish.kitchenName}</span>
                    <div className="st"><button className="m" onClick={() => setDraft(cover, cur => { cur[r.id] = { ...cur[r.id], qty: cur[r.id].qty - 1 } })}>−</button><span>{r.qty}</span><button className="m" onClick={() => addDish(r.id, 1)}>+</button></div>
                    <div className="nline">
                      {r.note && <span className="note">{r.note}</span>}
                      <button className="nbtn" onClick={() => setNoteOpen(o => o === r.id ? null : r.id)}>{noteOpen === r.id ? 'Done' : r.note ? 'Edit note' : '+ Note'}</button>
                    </div>
                    {noteOpen === r.id && <div className="notes">{NOTE_CHIPS.map(ch => <button key={ch} className={String(r.note || '').split(',').map(s => s.trim()).includes(ch) ? 'a' : ''} onClick={() => toggleNote(r.id, ch)}>{ch}</button>)}</div>}
                  </div>
                ))}
              </div>
            )
          })}
          {!groupCourses.length && !otherCourse.length && (
            <div className="empty">Nothing ordered for C{cover} yet.<br />Add every course the guest wants, then Save.</div>
          )}
        </div>
        <div className="acts">
          <button className="save" disabled={busy || !draftRows.length} onClick={onSave}>
            Save order for C{cover}<small>{draftRows.length ? `All ${heldCount} ${heldCount === 1 ? 'dish' : 'dishes'} held for C${cover}` : 'Add dishes to save'}</small>
          </button>
          <button className="btn btn-amber firebtn" disabled={busy || !nc} onClick={onSaveAndFire}>
            {draftRows.length ? `Save & fire ${nc || ''} now` : `Fire ${nc || 'next course'} now`}
            <small>{nc ? `${ncDishes.length} ${ncDishes.length === 1 ? 'dish' : 'dishes'} · ${ncKots} KOT${ncKots === 1 ? '' : 's'} · ${ncKitchens.join(', ')}` : 'Nothing held for this cover'}</small>
          </button>
        </div>
      </div>
    </div>
  )

  // ----------------------------------------------------------- Course board
  const boardCovers = Array.from({ length: coverCount }, (_, i) => i + 1)
  const cellItems = (c, course) => live.items.filter(i => i.cover_no === c && i.course === course && i.state !== 'cancelled')
  const selItems = live.items.filter(i => sel.has(i.id) && i.state === 'held')
  const selCovers = [...new Set(selItems.map(i => i.cover_no))].sort((a, b) => a - b)
  const selKots = new Set(selItems.map(i => `${i.cover_no}|${i.kitchen_id}|${i.barker}`)).size
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
    const held = live.items.filter(i => i.course === course && i.state === 'held').map(i => i.id)
    if (held.length) toggleIds(held)
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
    const ready = its.filter(i => !i.served_at && statusOf(i).cls === 'rd')
    const lastFired = its.filter(i => i.fired_at && !i.served_at).sort((a, b) => new Date(b.fired_at) - new Date(a.fired_at))[0]
    if (ready.length) pace.push({ c, t: `${ready[0].course?.toLowerCase() || 'dish'} ready at the pass`, w: 2.5 })
    if (held && since && now - since > (Number(ev.pacing_minutes) || 25) * 60000) pace.push({ c, t: `nothing fired for ${Math.floor((now - since) / 60000)} min`, w: 2 })
    else if (servedTimes[0]) pace.push({ c, t: `${servedTimes[0].course?.toLowerCase() || 'course'} served ${ago(servedTimes[0].served_at, now)}`, w: 1 })
    else if (lastFired && !ready.length && !late.length) pace.push({ c, t: `${lastFired.course?.toLowerCase() || 'course'} fired ${ago(lastFired.fired_at, now)}`, w: 0 })
  }
  pace.sort((a, b) => b.w - a.w)
  const lateMin = lateMinutes(null, ev)

  const board = (
    <div className="body bd">
      <div className="main">
        <div className="boardwrap">
          <table className="board">
            <thead><tr><th />{courses.map(c => <th key={c} style={{ cursor: 'pointer' }} onClick={() => onCourseHead(c)}>{c}</th>)}</tr></thead>
            <tbody>
              {boardCovers.map(c => (
                <tr key={c}>
                  <td className="cvc" style={{ cursor: 'pointer' }} onClick={() => onCoverHead(c)}>C{c}<small>{selCovers.includes(c) ? 'selected' : seated.has(c) ? 'seated' : itemsOf(c).length ? 'ordered' : 'empty'}</small></td>
                  {courses.map(course => {
                    const its = cellItems(c, course)
                    if (!its.length) return <td key={course} className="c na"><b>—</b></td>
                    const sts = its.map(statusOf)
                    const worst = [...sts].sort((a, b) => a.rank - b.rank)[0]
                    const late = sts.find(s => s.late)
                    const st = late || worst
                    const isSel = its.some(i => sel.has(i.id))
                    const kitchens = new Set(its.map(i => i.kitchen_id)).size
                    const name = its.length === 1 ? its[0].name : `${its.length} ${course.toLowerCase()} · ${kitchens} kitchen${kitchens === 1 ? '' : 's'}`
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
              <small>{selCourses.join(' + ')} · {selKitchens.join(', ')} · creates {selKots} KOT{selKots === 1 ? '' : 's'}, one cover each</small></div>
          ) : (
            <div><b>Tap held dishes to fire</b><br /><small>Tap a course heading for the whole table, or a cover for its next course</small></div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.35)' }} disabled={!sel.size} onClick={() => setSel(new Set())}>Clear</button>
          <button className="btn btn-amber" style={{ padding: '10px 18px', fontSize: 14 }} disabled={busy || !selItems.length}
            onClick={() => fireIds(selItems.map(i => i.id), `${selCourses.join(' + ')} fired`)}>Fire {selItems.length || ''} {selItems.length === 1 ? 'dish' : 'dishes'}</button>
        </div>
      </div>
      <div className="side">
        <h5>Status</h5>
        <div className="lgd">
          <div><i className="hd" />Held · saved, not fired</div>
          <div><i className="fi" />Fired · in the kitchen</div>
          <div><i className="rd" />Ready at the pass</div>
          <div><i className="ow" />Dispatched · on the way</div>
          <div><i className="sv" />Served</div>
          <div><i className="lt" />Late · over {lateMin} min</div>
        </div>
        <h5 style={{ marginTop: 6 }}>Pace</h5>
        <div className="pace">
          {pace.length ? pace.slice(0, 8).map((p, i) => <div key={i}><b>C{p.c}</b> {p.t}</div>) : <span className="muted">Seat covers and fire the first course to see the pace here.</span>}
        </div>
        <div className="pace" style={{ background: '#FFF8E6' }}><b>Flexible sequence:</b> fire one dish, a whole course, or two courses together, for one cover or several.</div>
        <button className="btn btn-ghost" disabled={busy || seated.size >= coverCount} onClick={seatAll}>Seat all covers{autoFirst ? ` · fires ${firstCourse}` : ''}</button>
      </div>
    </div>
  )

  return (
    <div className="ms cap-app">
      <AppBar
        title={view === 'take' ? `Table T${table} · ${capLabel}` : `Table T${table} · Course board`}
        sub={view === 'take'
          ? `${coverCount} covers · ${seated.size} seated · Captain App`
          : `${live.captains.map((c, i) => `${c.name} (TC${i + 1})`).join(' · ') || captain.name} · ${seated.size} covers seated · tap dishes to fire`}
        right={<>
          <div className="tabsw">
            <button className={view === 'take' ? 'a' : ''} onClick={() => setView('take')}>Take order</button>
            <button className={view === 'board' ? 'a' : ''} onClick={() => setView('board')}>Course board</button>
          </div>
          <span className="pill"><span className={'on' + (liveQ.online ? '' : ' off')} />{liveQ.online ? 'Live' : 'Offline'}</span>
          <button className="pill" onClick={help}>Help</button>
          {onChat && <button className={'pill' + (chatUnread ? ' alert' : '')} onClick={onChat}>Desk{chatUnread ? ` · ${chatUnread}` : ''}</button>}
          <button className="pill" onClick={() => setSheet({ kind: 'menu' })}>☰</button>
        </>} />
      {view === 'take' && (
        <div className="covers">
          <span className="l">Cover</span>
          {Array.from({ length: coverCount }, (_, i) => i + 1).map(c => {
            const s = coverState(c)
            return (
              <button key={c} className={'cv' + (c === cover ? ' sel' : s === 'ordered' || s === 'served' ? ' done' : s === 'seated' ? ' seat' : '')}
                onClick={() => setCover(c)}><b>C{c}</b><small>{c === cover ? 'taking now' : s}{drafts[c] && c !== cover ? ' *' : ''}</small></button>
            )
          })}
        </div>
      )}
      {view === 'take' ? takeOrder : board}

      {sheet?.kind === 'cancelHeld' && (
        <Sheet onClose={() => setSheet(null)} title={`Remove ${sheet.item.name}?`} text={`It is held for ${tc(table, sheet.item.cover_no)} and has not reached the kitchen.`}>
          <button className="btn btn-red" disabled={busy} onClick={() => cancelItems([sheet.item.id], sheet.item.name)}>Remove dish</button>
          <button className="btn btn-ghost" onClick={() => setSheet(null)}>Keep</button>
        </Sheet>
      )}
      {sheet?.kind === 'cell' && (
        <CellSheet sheet={sheet} table={table} statusOf={statusOf} kotById={kotById} kitchenById={kitchenById} busy={busy}
          onClose={() => setSheet(null)} onServe={serveKots} onRemake={remake} onCancel={cancelItems} />
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

function CellSheet({ sheet, table, statusOf, kotById, kitchenById, busy, onClose, onServe, onRemake, onCancel }) {
  const its = sheet.items
  const toServe = [...new Set(its.filter(i => i.state === 'fired' && !i.served_at).map(i => i.kot_id).filter(Boolean))]
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
                {i.note && <span className="note">{i.note}</span>}
                <span className={'tagK'}>{s.label}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>{kitchenById[i.kitchen_id]?.name}{k ? ` · ${k.kot_no}` : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  {i.state === 'fired' && (sure(i, 'remake')
                    ? <button className="btn btn-amber" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => onRemake([i.id])}>Send remake</button>
                    : <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => setAsk({ id: i.id, kind: 'remake' })}>Remake</button>)}
                  {i.state === 'fired' && !i.served_at && (sure(i, 'cancel')
                    ? <button className="btn btn-red" style={{ padding: '4px 9px', fontSize: 12 }} disabled={busy} onClick={() => onCancel([i.id], i.name)}>Cancel dish</button>
                    : <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 12, color: 'var(--red)' }} disabled={busy} onClick={() => setAsk({ id: i.id, kind: 'cancel' })}>Cancel</button>)}
                </span>
              </div>
            )
          })}
        </div>
        {ask && <p style={{ fontSize: 12.5, color: ask.kind === 'cancel' ? 'var(--red)' : 'var(--ink)', margin: '0 0 10px' }}>
          {ask.kind === 'cancel'
            ? 'Tap Cancel dish to confirm. The kitchen screen updates at once, and a CANCEL slip prints if the KOT was already printed.'
            : 'Tap Send remake to confirm. A new KOT marked REMAKE - PRIORITY goes to the kitchen.'}</p>}
        <div className="row">
          {toServe.length > 0 && <button className="btn btn-green" disabled={busy} onClick={() => onServe(toServe)}>Mark served</button>}
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
