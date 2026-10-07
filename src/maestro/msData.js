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
export const NEXT_ACTION = {
  new: { to: 'received', label: 'Received', cls: 'b1' },
  received: { to: 'in_prep', label: 'Send to chef', cls: 'b2' },
  in_prep: { to: 'ready', label: 'Ready', cls: 'b3' },
  ready: { to: 'dispatched', label: 'Dispatched', cls: 'b2' },
}
export const DEFAULT_COURSES = ['First Course', 'Soup', 'Starters', 'Mains', 'Dessert']
export const NOTE_CHIPS = ['Jain', 'No onion-garlic', 'Less spicy', 'Allergy']

export function newRef() {
  try { if (crypto?.randomUUID) return crypto.randomUUID() } catch { /* older webview */ }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export function coursesOf(ev) {
  return Array.isArray(ev?.courses) && ev.courses.length ? ev.courses : DEFAULT_COURSES
}

export function courseRank(courses, c) {
  const i = courses.indexOf(c)
  return i < 0 ? 999 : i
}

export function lateMinutes(kitchen, ev) {
  const k = Number(kitchen?.late_minutes)
  if (k > 0) return k
  const e = Number(ev?.late_minutes)
  return e > 0 ? e : 5
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
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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

/* Status of one dish (ms_items row) as the captain sees it on the course
   board. kot: its KOT row (or undefined). */
export function dishStatus(item, kot, now, lateMin) {
  if (item.state === 'cancelled') return { cls: 'cx', label: 'Cancelled', rank: 9 }
  if (item.state === 'held') return { cls: 'hd', label: 'Held', rank: 0 }
  if (item.served_at || kot?.served_at) return { cls: 'sv', label: 'Served', rank: 5 }
  const stage = kot?.stage || 'new'
  if (stage === 'dispatched') return { cls: 'ow', label: 'On the way', rank: 4 }
  if (stage === 'ready') return { cls: 'rd', label: 'Ready', rank: 3 }
  const fired = new Date(kot?.fired_at || item.fired_at || now).getTime()
  if (now - fired > lateMin * 60000) return { cls: 'lt', label: 'Late ' + mmss(now - fired), rank: 2, late: true }
  return { cls: 'fi', label: 'In kitchen', rank: 1 }
}

/* Live data: run load() now, again whenever one of the watched tables
   changes for this event (Realtime), and every intervalMs regardless. A
   failed load keeps the last good data. */
export function useLive(load, { eventId, tables = [], intervalMs = 4000, deps = [] } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const busy = useRef(false)
  const again = useRef(false)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    if (busy.current) { again.current = true; return }
    busy.current = true
    try {
      do {
        again.current = false
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
    const t = setInterval(reload, intervalMs)
    let ch = null
    if (eventId && tables.length) {
      try {
        let timer = null
        const kick = () => { clearTimeout(timer); timer = setTimeout(reload, 250) }
        ch = supabase.channel(`ms-${tables.join('-')}-${eventId}-${Math.random().toString(36).slice(2, 7)}`)
        for (const t2 of tables) ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t2, filter: `event_id=eq.${eventId}` }, kick)
        ch.subscribe()
      } catch { ch = null }
    }
    const onVis = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive.current = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      if (ch) { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, intervalMs, ...deps])

  return { data, error, online, reload }
}

// One tick per second, for timers.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// Menu, kitchens and barkers of one event, with every dish routed.
export async function loadMenu(eventId) {
  const [cats, dishes, kitchens] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('menu_items').select('*').eq('event_id', eventId).order('sort_order'),
    supabase.from('kitchens').select('*').eq('event_id', eventId).order('sort_order'),
  ])
  for (const r of [cats, dishes, kitchens]) if (r.error) throw r.error
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

// "T7 · C3"
export function tc(table, cover) {
  return `T${table} · C${cover}`
}
