/* Smart Serve Maestro - shared data helpers for the Captain App, Kitchen
   Display, Control Desk, Event Setup and Reports.

   The database is the source of truth: every write goes through one of the
   ms_* functions (db/2026-10-08_maestro.sql), which do the work in a single
   transaction. The screens read tables directly and stay live through
   Supabase Realtime, with polling as the fallback (the laptop server has no
   Realtime, and a weak venue network drops sockets). */
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export const STAGES = ['new', 'received', 'in_prep', 'ready', 'dispatched']
export const STAGE_LABEL = { new: 'New', received: 'Received', in_prep: 'In Preparation', ready: 'Ready', dispatched: 'Dispatched' }
// The barker's next action from each stage, as on the Kitchen Display.
// A KOT is received the moment it reaches the kitchen screen (no "New" step for the
// barker), so a new KOT and a received one both move on to preparation.
export const NEXT_ACTION = {
  new: { to: 'in_prep', label: 'Start preparing', cls: 'b2' },
  received: { to: 'in_prep', label: 'Start preparing', cls: 'b2' },
  in_prep: { to: 'ready', label: 'Ready', cls: 'b3' },
  // Handing the plate to a steward completes the KOT (no separate delivered / served step)
  ready: { to: 'dispatched', label: 'Handed over', cls: 'b2' },
}
export const DEFAULT_COURSES = ['First Course', 'Soup', 'Starters', 'Mains', 'Dessert']
// The few notes a captain adds with one tap, to a dish or to everything a guest orders;
// anything else is typed or spoken (Other). Allergies are kept apart so they print clearly.
export const QUICK_NOTES = ['Jain', 'No onion-garlic', 'Less spicy', 'Extra spicy', 'Less oil', 'No ajinomoto']
// Food preferences for a VIP guest (Event set-up), a longer list: set once, before the event
export const PREF_CHIPS = ['Jain', 'No onion', 'No garlic', 'No tomato', 'No mushroom', 'No coriander', 'Less spicy', 'Extra spicy',
  'Less oil', 'Less salt', 'No ajinomoto', 'Gluten free', 'Dairy free', 'Vegan']
// "Less spicy, No cheese" <-> ['Less spicy', 'No cheese']
export const splitNote = s => String(s || '').split(/[,|]/).map(x => x.trim()).filter(Boolean)
export const joinNote = parts => [...new Set(parts.map(x => String(x).trim()).filter(Boolean))].join(', ')
// Delivered dishes leave the captain's order this long after delivery (event setting)
export const servedHideMinutes = ev => { const n = Number(ev?.served_hide_minutes); return n > 0 ? n : 3 }

/* Covers a table captain looks after. Two captains can share a table and
   split its covers (Neha C1-C4, Arjun C5-C8): set in Event set-up >
   Captains. No range set: every cover of the table. Either captain can still
   open the other's covers on the tablet when needed. */
export function coverRange(cap, coverCount) {
  const n = Math.max(1, Number(coverCount) || 10)
  const f = Number(cap?.cover_from) || null
  const t = Number(cap?.cover_to) || null
  if (!f && !t) return null
  const from = Math.min(Math.max(1, f || 1), n)
  const to = Math.min(Math.max(from, t || n), n)
  return from === 1 && to === n ? null : { from, to }
}
export const servesCover = (cap, c, coverCount) => { const r = coverRange(cap, coverCount); return !r || (c >= r.from && c <= r.to) }
export const rangeText = r => r ? (r.from === r.to ? `C${r.from}` : `C${r.from}–C${r.to}`) : 'all covers'

/* Chairs and covers: a table has its chairs (10, or the table's own number), and the last of
   them are named 1A, 2A … instead of a C number: 10 chairs are C1 … C8, 1A, 2A. 1A belongs to
   Table Captain 1, 2A to Table Captain 2 (one captain: all of them). Kept as covers 101, 102 … */
export const EXTRA_BASE = 100
export const isExtraCover = c => Number(c) > EXTRA_BASE
// "C3" for a C-numbered cover, "1A" for the first A chair
export const coverLabel = c => (isExtraCover(c) ? `${Number(c) - EXTRA_BASE}A` : `C${c}`)

// Chairs at one table, all in: its own number when set (Event set-up › Chairs per table), else the event's
export function chairsOf(ev, table) {
  const own = Number(ev?.table_covers?.[String(table)])
  return Math.max(1, own > 0 ? Math.round(own) : Math.round(Number(ev?.chairs_per_table)) || 10)
}
// How many chairs of a table are named 1A, 2A …: 2 unless set
export function spareCount(ev) {
  const n = Number(ev?.spare_covers)
  return ev?.spare_covers == null || !Number.isFinite(n) ? 2 : Math.min(6, Math.max(0, Math.round(n)))
}
// The A chairs at one table (a table keeps at least C1)
export const sparesAt = (ev, table) => Math.max(0, Math.min(spareCount(ev), chairsOf(ev, table) - 1))
// C-numbered covers at one table: its chairs less the A chairs (10 chairs: C1–C8)
export const coversOf = (ev, table) => chairsOf(ev, table) - sparesAt(ev, table)
// "C1–C8, 1A, 2A" for a number of chairs
export function chairNames(chairs, spare = 2) {
  const n = Math.max(1, Number(chairs) || 1), s = Math.max(0, Math.min(spare, n - 1)), c = n - s
  return [c === 1 ? 'C1' : `C1–C${c}`, ...Array.from({ length: s }, (_, i) => `${i + 1}A`)].join(', ')
}
// Every cover of a table in order: C1 … Cn, then 1A, 2A …, and any other cover already used
// (an order taken before the table had fewer chairs keeps its cover)
export function tableCovers(ev, table, used = []) {
  const n = coversOf(ev, table)
  const spare = Array.from({ length: sparesAt(ev, table) }, (_, i) => EXTRA_BASE + i + 1)
  const more = used.map(Number).filter(c => c > 0 && (isExtraCover(c) || c > n))
  return [...Array.from({ length: n }, (_, i) => i + 1), ...[...new Set([...spare, ...more])].sort((a, b) => a - b)]
}
// The table captain of a spare cover: 1A Table Captain 1, 2A Table Captain 2, 3A Table Captain 1 …
export function spareOwner(capsInOrder, c) {
  const at = capsInOrder || []
  return at.length ? at[(Number(c) - EXTRA_BASE - 1) % at.length] : null
}

// C1–C3, C6–C8, 1A for a list of cover numbers
export function coversText(nums) {
  const all = [...new Set(nums)].sort((a, b) => a - b)
  const xs = all.filter(c => !isExtraCover(c))
  const out = []
  for (let i = 0; i < xs.length; i++) {
    let j = i
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
    out.push(i === j ? `C${xs[i]}` : `C${xs[i]}–C${xs[j]}`)
    i = j
  }
  for (const c of all.filter(isExtraCover)) out.push(coverLabel(c))
  return out.join(', ')
}
// Table Captain 1, 2 ...: by the covers set, then in the order they were added
export const capOrder = (a, b) => (Number(a.cover_from) || 99) - (Number(b.cover_from) || 99)
  || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.name || '').localeCompare(String(b.name || ''))

/* The covers each captain of a table looks after: id -> {from, to, auto?} or null (all).
   Ranges set in Event set-up win. A table with two or more captains and no range set is
   split evenly in captain order: of C1-C8, Table Captain 1 gets C1-C4, TC2 C5-C8. */
export function tableRanges(caps, table, coverCount) {
  const n = Math.max(1, Number(coverCount) || 10)
  const at = (caps || []).filter(c => c.is_active !== false && Number(c.table_number) === Number(table)).sort(capOrder)
  const out = new Map()
  // one captain, a range set by hand, or more captains than covers: no automatic split
  if (at.length < 2 || at.length > n || at.some(c => coverRange(c, n))) { at.forEach(c => out.set(c.id, coverRange(c, n))); return out }
  at.forEach((c, i) => {
    const from = Math.floor(i * n / at.length) + 1, to = Math.floor((i + 1) * n / at.length)
    out.set(c.id, from <= to ? { from, to, auto: true } : null)
  })
  return out
}

// The captains of a table who look after one cover: those whose range has it; else those with
// no range (all covers); else every captain of the table
export function captainsForCover(caps, table, c, coverCount) {
  const at = (caps || []).filter(x => x.is_active !== false && Number(x.table_number) === Number(table)).sort(capOrder)
  if (isExtraCover(c)) { const o = spareOwner(at, c); return o ? [o] : [] }
  const ranges = tableRanges(caps, table, coverCount)
  const own = at.filter(x => { const r = ranges.get(x.id); return r && c >= r.from && c <= r.to })
  if (own.length) return own
  const free = at.filter(x => !ranges.get(x.id))
  return free.length ? free : at
}

export function newRef() {
  try { if (crypto?.randomUUID) return crypto.randomUUID() } catch { /* older webview */ }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function coursesOf(ev) {
  return Array.isArray(ev?.courses) && ev.courses.length ? ev.courses : DEFAULT_COURSES
}

// Course labels for the kitchen cards, the way kitchens say them: the word "Course" goes
// (Main Course 1 -> Main 1, Main Course -> Main), only when the short form stays unique among the
// courses given. Nothing else is cut; the printed KOT and the card's tooltip keep the full name.
export function shortCourses(list) {
  const short = c => {
    const s = String(c || '').trim()
    const t = s.replace(/\s+course\b/i, '').replace(/\s+/g, ' ').trim()
    return t && s.length > 9 ? t : s
  }
  const all = [...new Set((list || []).filter(Boolean).map(c => String(c).trim()))]
  const n = {}
  all.forEach(c => { const s = short(c); n[s] = (n[s] || 0) + 1 })
  return c => { const s = short(c); return n[s] > 1 ? String(c || '').trim() : s }
}

export function courseRank(courses, c) {
  const i = courses.indexOf(c)
  return i < 0 ? 999 : i
}

export function lateMinutes(kitchen, ev) {
  const k = Number(kitchen?.late_minutes)
  if (k > 0) return k
  const e = Number(ev?.late_minutes)
  return e > 0 ? e : 3
}

// Same order of rules as ms_route() in the database, so the captain sees the
// kitchen a dish will go to before it is fired.
export function routeDish(dish, catsById, kitchens) {
  const active = (kitchens || []).filter(k => k.is_active !== false)
  const byId = id => active.find(k => k.id === id)
  const sorted = [...active].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  let k = (dish?.kitchen_id && byId(dish.kitchen_id)) ||
    (dish?.course && sorted.find(x => Array.isArray(x.courses) && x.courses.includes(dish.course))) ||
    (catsById?.[dish?.category_id]?.kitchen_id && byId(catsById[dish.category_id].kitchen_id)) ||
    [...sorted].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] || null
  const barker = !k || (Number(k.barkers) || 2) < 2 ? 'A' : (String(dish?.barker || 'A').toUpperCase() === 'B' ? 'B' : 'A')
  return { kitchen: k, barker }
}

export function mmss(ms) {
  if (ms == null || !isFinite(ms)) return '–'
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function clockText(d = new Date()) {
  // always 12-hour ("12:32 AM"), whatever the device's own clock setting
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function ago(iso, now = Date.now()) {
  if (!iso) return ''
  const m = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ${m % 60} min ago`
}

// Friendly text for the errors the ms_* functions raise ("CODE: message").
export function errText(e, fallback = 'Something went wrong. Please try again.') {
  const raw = String(e?.message || e?.details || e || '')
  const m = /^[A-Z_]+:\s*(.+)$/.exec(raw)
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + '.'
  if (/fetch|network|Failed to/i.test(raw)) return 'No connection. Check the Wi-Fi and try again.'
  return raw ? raw : fallback
}

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

// A call that only failed to get through (weak network), not one the server refused
export const isNetErr = e => /fetch|network|Failed to|Load failed|timed? ?out|ECONN|503|502|504/i.test(String(e?.message || e?.details || e || ''))
// The server has no such function yet (its SQL update has not been run)
export const isMissingFn = e => e?.code === 'PGRST202' || e?.code === '42883' || /could not find the function|function .* does not exist/i.test(String(e?.message || ''))

// rpc() for calls that are safe to repeat: a weak network gets a few more tries
export async function rpcRetry(name, args, { tries = 4, waitMs = 1200 } = {}) {
  for (let i = 1; ; i++) {
    try { return await rpc(name, args) } catch (e) {
      if (i >= tries || !isNetErr(e)) throw e
      await new Promise(r => setTimeout(r, waitMs * i))
    }
  }
}

/* Status of one dish (ms_items row) as the captain sees it. kot: its KOT row (or undefined).
   Two kitchen states only: in the kitchen (from firing) and delivered (the barker handed it to a
   steward). Not delivered within the kitchen alert time: late. */
export function dishStatus(item, kot, now, lateMin) {
  if (item.state === 'cancelled') return { cls: 'cx', label: 'Cancelled', rank: 9 }
  if (item.state === 'held') return { cls: 'hd', label: 'To pick up', rank: 0 }
  if (item.served_at || kot?.served_at || kot?.stage === 'dispatched' || kot?.status === 'delivered') return { cls: 'sv', label: 'Delivered', rank: 5 }
  const fired = new Date(kot?.fired_at || item.fired_at || now).getTime()
  if (now - fired > lateMin * 60000) return { cls: 'lt', label: 'Late ' + mmss(now - fired), rank: 2, late: true }
  return { cls: 'fi', label: 'In kitchen ' + mmss(now - fired), rank: 1 }
}
// When a dish was delivered (handed to a steward), or null
export function deliveredAt(item, kot) {
  const t = item?.served_at || kot?.served_at || kot?.dispatched_at || null
  return t ? new Date(t).getTime() : null
}

/* Live data: run load() now, again whenever one of the watched tables changes
   (Realtime), and on a timer as a safety net. A failed load keeps the last good data.
     filter   Realtime filter for the watched tables (default: this event), e.g.
              'kitchen_id=eq.<id>' for one kitchen or 'table_number=eq.7' for one table,
              so a tablet only wakes up for its own changes
     match    (row) => boolean, drops changes that are not ours (another event's table 7)
   Changes are batched: at most one reload every minGapMs (0.8 s), however busy the event is.
   While Realtime is connected the timer only reloads every idleMs (default 4 x
   intervalMs, at least 12 s), which keeps a weak connection free; when Realtime is
   down (the laptop server has none, or the connection dropped) it reloads every
   intervalMs, and once Realtime is back it reloads straight away. */
export function useLive(load, { eventId, tables = [], intervalMs = 4000, deps = [], filter = null, match = null, idleMs = null, minGapMs = 800 } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const matchRef = useRef(match)
  matchRef.current = match
  const busy = useRef(false)
  const again = useRef(false)
  const alive = useRef(true)
  const lastLoad = useRef(0)

  const reload = useCallback(async () => {
    if (busy.current) { again.current = true; return }
    busy.current = true
    try {
      do {
        again.current = false
        lastLoad.current = Date.now()
        const d = await loadRef.current()
        if (!alive.current) return
        setData(d); setError(null); setOnline(true)
      } while (again.current)
    } catch (e) {
      if (alive.current) { setError(e); setOnline(false) }
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    alive.current = true
    reload()
    let rtOk = false
    const slow = idleMs ?? Math.max(intervalMs * 4, 12000)
    const t = setInterval(() => {
      if (rtOk && Date.now() - lastLoad.current < slow) return
      reload()
    }, intervalMs)
    let ch = null
    let timer = null
    if (eventId && tables.length) {
      try {
        const kick = (p) => {
          const row = p?.new && Object.keys(p.new).length ? p.new : p?.old
          if (matchRef.current && row && Object.keys(row).length > 1 && !matchRef.current(row)) return
          if (timer) return // a reload is already on its way
          timer = setTimeout(() => { timer = null; reload() }, Math.max(150, minGapMs - (Date.now() - lastLoad.current)))
        }
        const flt = filter || `event_id=eq.${eventId}`
        ch = supabase.channel(`ms-${tables.join('-')}-${eventId}-${Math.random().toString(36).slice(2, 7)}`)
        for (const t2 of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t2, filter: flt }, kick)
        ch.subscribe((status) => {
          const was = rtOk
          rtOk = status === 'SUBSCRIBED'
          if (rtOk && !was) reload() // changes made while it was down
        })
      } catch { ch = null }
    }
    const onVis = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      clearInterval(t)
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, intervalMs, filter, ...deps])

  return { data, error, online, reload }
}

// One tick per second, for timers.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// Dishes belong to an event through their category (menu_items has no
// event_id of its own in the live database).
export async function eventDishes(eventId, columns = '*', catIds = null) {
  let ids = catIds
  if (!ids) {
    const c = await supabase.from('menu_categories').select('id').eq('event_id', eventId)
    if (c.error) return { data: null, error: c.error }
    ids = (c.data || []).map(x => x.id)
  }
  if (!ids.length) return { data: [], error: null }
  return supabase.from('menu_items').select(columns).in('category_id', ids).order('sort_order')
}

// Menu, kitchens and barkers of one event, with every dish routed.
export async function loadMenu(eventId) {
  const [cats, kitchens] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('kitchens').select('*').eq('event_id', eventId).order('sort_order'),
  ])
  for (const r of [cats, kitchens]) if (r.error) throw r.error
  const dishes = await eventDishes(eventId, '*', (cats.data || []).map(c => c.id))
  if (dishes.error) throw dishes.error
  const catsById = Object.fromEntries((cats.data || []).map(c => [c.id, c]))
  const list = (dishes.data || []).map(d => {
    const r = routeDish(d, catsById, kitchens.data)
    return { ...d, kitchenName: r.kitchen?.name || '', kitchenId: r.kitchen?.id || null, barkerSide: r.barker }
  })
  return { cats: cats.data || [], catsById, dishes: list, kitchens: kitchens.data || [] }
}

export function shortName(name, max = 22) {
  const s = String(name || '')
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// "T7 · C3", or "T7 · 1A" for an extra chair
export function tc(table, cover) {
  return `T${table} · ${coverLabel(cover)}`
}

// A KOT matches a search for "21", "IT-A 021", "T7", "T7 C3", "C3" or a dish name
export function kotMatches(k, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const no = String(k.kot_no || '').toLowerCase()
  const digits = q.replace(/\D/g, '')
  const kn = Number((no.match(/(\d+)\s*$/) || [])[1])
  // a bare number (or "#2", "kot 2", "no. 2") is the serial number, matched exactly
  if (digits && /^(#|kot|no\.?)?\s*\d+$/.test(q)) return kn === Number(digits)
  if (no.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true
  const tc = q.match(/^t\s*(\d+)(?:\s*[·.\- ]?\s*c\s*(\d+))?$/)
  if (tc) return Number(k.table_number) === Number(tc[1]) && (!tc[2] || Number(k.cover_no) === Number(tc[2]))
  const c = q.match(/^c\s*(\d+)$/)
  if (c) return Number(k.cover_no) === Number(c[1])
  // an extra chair: "1a", "t7 1a"
  const xa = q.match(/^(?:t\s*(\d+)\s*[·.\- ]?\s*)?(\d+)\s*a$/)
  if (xa) return Number(k.cover_no) === EXTRA_BASE + Number(xa[2]) && (!xa[1] || Number(k.table_number) === Number(xa[1]))
  // "a 2" / "b2": barker letter plus serial number
  const bs = q.match(/^([a-z])\s*-?\s*(\d+)$/)
  if (bs) return new RegExp('-' + bs[1] + '\\s*0*' + Number(bs[2]) + '$').test(no)
  return (k.items || []).some(it => String(it.name || '').toLowerCase().includes(q))
}
