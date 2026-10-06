import { useState, useEffect, useRef, useMemo, useCallback, memo, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { playChatChime, unlockChime } from '../../lib/chime'

/* Kitchen Board - the desk screen for Captain + Multi-Kitchen events.

   One operator, one laptop. Captains order per chair, the database splits
   each order into one KOT per kitchen, the Print Hub on this laptop prints
   each KOT on its kitchen's printer, and the kitchen's waiters mark KOTs
   delivered on their phones. This board shows all of that at once and
   fixes the usual problems in one tap: a failed print (reprint, or send it
   to another kitchen's printer), a printer that is down, a Print Hub that
   is not running, and KOTs running late.

   Only mounted when eventData.multi_kitchen is true, so nothing here can
   change how a guest or ordinary captain event behaves.

   Colour carries meaning and nothing else:
     red    late (15 min+) or failed
     amber  getting late (10 min+), paper low, waiting longer than it should
     green  printed, delivered, printer online, Print Hub running
     grey   neutral / unknown                                              */

const BUILD_VERSION = 'MK v1 · 2026-10-07'

const POLL_MS        = 4000      // venue Wi-Fi drops websockets; polling is the floor
const FULL_SYNC_MS   = 120000    // full re-read now and then, in case a poll window was missed
const OVERLAP_MS     = 15000     // incremental polls re-read this much behind the newest change
const HUB_SILENT_MS  = 60000     // no sign of the Print Hub for this long + KOTs waiting = not running
const HUB_IDLE_OK_MS = 90000     // the hub re-sends printer status every 60 s when idle
const QUEUE_LATE_MS  = 20000     // a queued KOT older than this should have been picked up
const QUEUE_STUCK_MS = 60000     // ...and older than this is stuck even if the hub is alive
const LATE_AMBER_MIN = 10
const LATE_RED_MIN   = 15
const CLOSED_CAP     = 300       // Delivered / All show the latest this many
const ACTION_HOLD_MS = 25000     // how long a reprint stays in the failed panel to show its outcome

const DARK = '#1A0A0A', MARI = '#E8890C'
const TONE = {
  red:   { bg:'#FEE2E2', fg:'#B91C1C', bd:'#FECACA', dot:'#DC2626' },
  amber: { bg:'#FEF3C7', fg:'#B45309', bd:'#FCD34D', dot:'#D97706' },
  green: { bg:'#DCFCE7', fg:'#15803D', bd:'#BBF7D0', dot:'#16A34A' },
  grey:  { bg:'#F3F4F6', fg:'#6B7280', bd:'#E5E7EB', dot:'#9CA3AF' },
  blue:  { bg:'#EFF6FF', fg:'#2563EB', bd:'#BFDBFE', dot:'#2563EB' },
  dark:  { bg:DARK,      fg:'#FFFFFF', bd:DARK,      dot:DARK },
}
const PRINTER = {
  online:    { tone:'green', label:'Online' },
  paper_low: { tone:'amber', label:'Paper low' },
  paper_out: { tone:'red',   label:'Paper out' },
  offline:   { tone:'red',   label:'Offline' },
  unknown:   { tone:'grey',  label:'Status unknown' },
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

// Server timestamps arrive as ISO from the API and sometimes in Postgres'
// own "2026-10-13 20:14:05.123456+00" form from the live feed. Both parse.
function ms(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  let s = String(v).trim().replace(' ', 'T')
  s = s.replace(/([+-]\d\d)$/, '$1:00').replace(/(\.\d{3})\d+/, '$1')
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

// "Today" is a service day that turns over at 4 AM, so a function running
// past midnight keeps its KOTs on the board, while yesterday's rehearsal
// and test prints stay off it.
function serviceDayStart(nowMs) {
  const d = new Date(nowMs)
  d.setHours(4, 0, 0, 0)
  if (d.getTime() > nowMs) d.setDate(d.getDate() - 1)
  return d.getTime()
}

function asItems(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}
function asChairs(v) {
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite)
  if (typeof v === 'string') return v.replace(/[{}\s]/g, '').split(',').filter(Boolean).map(Number).filter(Number.isFinite)
  return []
}
// [1,2,3,5,7,8] -> "1-3, 5, 7-8"
function chairsText(v) {
  const a = [...new Set(asChairs(v))].sort((x, y) => x - y)
  if (!a.length) return ''
  const out = []
  for (let i = 0; i < a.length; i++) {
    let j = i
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++
    out.push(j - i >= 2 ? a[i] + '–' + a[j] : j > i ? a[i] + ', ' + a[j] : String(a[i]))
    i = j
  }
  return out.join(', ')
}
function clockTime(v) {
  const t = ms(v)
  return t ? new Date(t).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : ''
}
function agoText(d) {
  if (!Number.isFinite(d)) return 'never'
  const s = Math.max(0, Math.round(d / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return s + ' s ago'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' min ago'
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago'
}
function shortAgo(d) {
  const s = Math.max(0, Math.round(d / 1000))
  return s < 5 ? 'now' : s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago'
}
function minsText(m) { return m < 1 ? '<1 min' : m + ' min' }
function lateTone(mins) { return mins >= LATE_RED_MIN ? 'red' : mins >= LATE_AMBER_MIN ? 'amber' : null }

// A failed print that still needs fixing. An order KOT that has since been
// delivered or cancelled does not - reprinting a cancelled order would send
// the kitchen a slip for food nobody wants. Cancel and test slips always
// carry status 'cancelled' / 'open' by design, so only orders are filtered.
function needsFix(k) {
  return k.print_status === 'failed' && !(k.kind === 'order' && k.status !== 'open')
}

// Drop desk-action states older than a minute.
function gcPend(p) {
  const t = Date.now(), out = {}
  for (const id in p) if (t - p[id].at < 60000) out[id] = p[id]
  return out
}

let lastRing = 0
function ring() {
  const t = Date.now()
  if (t - lastRing < 3000) return   // one incident, one chime
  lastRing = t
  playChatChime()
}

/* ------------------------------------------------------------------ */
/* Data engine - plain JS, created once per event                      */
/* ------------------------------------------------------------------ */

/* Loads kitchens and today's KOTs, then keeps them current two ways:
   Supabase Realtime for instant updates, and a 4 s poll underneath that
   only asks for rows changed since the newest one already held (so 2,000
   KOTs do not travel every 4 s). Rows are merged newest-wins on
   updated_at, so a slow response can never put an older state back.

   It also keeps two things the screen needs to be honest:
   - when the Print Hub was last seen, judged by the moment a new sign of
     it arrived here, not only by server timestamps
   - how far this laptop's clock is from the server's, so timers and
     "last seen" do not lie on a laptop whose clock is off                 */
const SAME_KEYS = ['status', 'print_status', 'print_attempts', 'printer_ip', 'last_error', 'delivered_at', 'printed_at', 'print_claimed_at']

function makeEngine(eventId, S) {
  let alive = false, timer = null, channel = null, busy = false, onWake = null
  let inbox = [], flushT = null
  let cursor = 0, lastFull = 0, lastOk = 0, primed = false, beatMax = 0
  let samples = [], skew = 0
  let dayStart = serviceDayStart(Date.now())

  const continuous = () => Date.now() - lastOk < 12000

  function noteBeat(b, valid) {
    if (b > beatMax) {
      beatMax = b
      // A new claim / print / printer check showing up while we have been
      // connected all along means the hub did it moments ago.
      if (primed && valid) S.setHubSeen(Date.now())
    }
  }

  // A row's updated_at was written before we received it, so
  // (updated_at - local receive time) is a lower bound on the clock gap.
  // Fresh samples (live feed, our own writes) are tight in both directions.
  function noteSkew(v, fresh) {
    const t = Date.now()
    samples.push({ t, v, fresh })
    while (samples.length && t - samples[0].t > 300000) samples.shift()
    if (samples.length > 200) samples.splice(0, samples.length - 200)
    // Third-highest rather than the maximum, so one or two odd rows can
    // never shift every timer on the board.
    const all = samples.map(x => x.v).sort((a, b) => b - a)
    const tight = samples.filter(x => x.fresh).map(x => x.v).sort((a, b) => b - a)
    let est = 0
    if (all.length >= 3 && all[2] > 2000) est = Math.min(all[2], 600000)                  // laptop clock behind
    else if (tight.length >= 3 && tight[0] < -3000) est = Math.max(tight[0], -600000)    // laptop clock ahead
    if (Math.abs(est - skew) >= 1000) { skew = est; S.setSkew(est) }
  }

  function flush() {
    if (flushT) { clearTimeout(flushT); flushT = null }
    const rows = inbox; inbox = []
    if (!rows.length) return
    const start = dayStart
    S.setKots(prev => {
      let next = null
      for (const r of rows) {
        if (!r || !r.id) continue
        if (r.event_id && r.event_id !== eventId) continue
        if (ms(r.created_at) && ms(r.created_at) < start) continue
        const cur = (next || prev).get(r.id)
        let val = r
        if (cur) {
          const ru = ms(r.updated_at), cu = ms(cur.updated_at)
          if (ru < cu) continue
          // The overlap window re-reads the last few seconds every poll; an
          // unchanged row must not cost a re-render of the whole board.
          if (ru === cu && SAME_KEYS.every(key => r[key] === undefined || r[key] === cur[key])) continue
          // Keep anything a live-feed payload left out (unchanged large values)
          val = { ...cur }
          for (const key in r) if (r[key] !== undefined) val[key] = r[key]
          if (!Array.isArray(val.items) && typeof val.items !== 'string') val.items = cur.items
        }
        if (!next) next = new Map(prev)
        next.set(r.id, val)
      }
      return next || prev
    })
  }

  function ingest(rows, source, valid) {
    if (!rows || !rows.length) return
    const now = Date.now()
    let best = -Infinity, beat = 0
    for (const r of rows) {
      const u = ms(r.updated_at)
      // Only polls move the "changed since" mark, so a gap in polling is
      // always re-read by the next poll even if live updates kept arriving.
      if (source === 'poll' && u > cursor) cursor = u
      if (u && u - now > best) best = u - now
      beat = Math.max(beat, ms(r.print_claimed_at), ms(r.printed_at))
    }
    noteBeat(beat, valid)
    if (best > -Infinity) noteSkew(best, source !== 'poll')
    inbox.push(...rows)
    if (!flushT) flushT = setTimeout(flush, 120)   // batches a burst of live updates into one render
  }

  function ingestKitchens(list, replace, valid) {
    let beat = 0
    for (const k of list) beat = Math.max(beat, ms(k.printer_checked_at))
    noteBeat(beat, valid)
    const sortK = arr => arr.slice().sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || '').localeCompare(String(b.name || '')))
    S.setKitchens(prev => {
      if (replace) {
        const next = sortK(list)
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next
      }
      const m = new Map(prev.map(k => [k.id, k]))
      for (const k of list) m.set(k.id, { ...(m.get(k.id) || {}), ...k })
      return sortK([...m.values()])
    })
  }

  async function fetchFull() {
    // Supabase hands back at most 1,000 rows per request, so read in pages
    // until an empty one - an event can pass 2,000 KOTs.
    const out = []
    const since = new Date(dayStart).toISOString()
    for (let from = 0; from < 50000;) {
      const { data, error } = await supabase.from('kots').select('*')
        .eq('event_id', eventId).gte('created_at', since)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      if (!data || !data.length) break
      out.push(...data)
      from += data.length
    }
    return out
  }

  async function fetchChanged() {
    const out = []
    const after = new Date(Math.max(0, cursor - OVERLAP_MS)).toISOString()
    const since = new Date(dayStart).toISOString()
    for (let from = 0; from < 20000;) {
      const { data, error } = await supabase.from('kots').select('*')
        .eq('event_id', eventId).gte('created_at', since).gt('updated_at', after)
        .order('updated_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      out.push(...(data || []))
      if (!data || data.length < 1000) break
      from += data.length
    }
    return out
  }

  async function poll(forceFull) {
    if (!alive || busy) return
    busy = true
    try {
      const full = forceFull || !primed || Date.now() - lastFull > FULL_SYNC_MS
      if (full) {
        const ds = serviceDayStart(Date.now())
        if (ds !== dayStart) {
          dayStart = ds
          S.setKots(prev => {
            const m = new Map()
            for (const [id, k] of prev) if (ms(k.created_at) >= ds) m.set(id, k)
            return m
          })
        }
      }
      const kres = await supabase.from('kitchens').select('*').eq('event_id', eventId)
        .order('sort_order', { ascending: true })
      if (kres.error) throw kres.error
      const rows = full ? await fetchFull() : await fetchChanged()
      if (!alive) return
      const valid = continuous()
      ingestKitchens(kres.data || [], true, valid)
      ingest(rows, 'poll', valid)
      if (full) lastFull = Date.now()
      if (!primed) { flush(); primed = true; S.setLoaded(true) }
      lastOk = Date.now()
      S.setLastOk(lastOk)
      S.setLoadErr(null)
    } catch (e) {
      if (alive) S.setLoadErr(String((e && (e.message || e.error_description)) || e || 'network error'))
    } finally {
      busy = false
    }
  }

  function start() {
    if (alive) return
    alive = true
    poll(true)
    timer = setInterval(() => poll(false), POLL_MS)
    // Coming back from sleep or a dropped connection: catch up at once.
    onWake = () => { if (document.visibilityState !== 'hidden') poll(false) }
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    try {
      channel = supabase.channel('kitchen-board-' + eventId + '-' + Math.random().toString(36).slice(2, 8))
        .on('postgres_changes', { event:'*', schema:'public', table:'kots', filter:'event_id=eq.' + eventId }, p => {
          if (!alive) return
          if (p.eventType === 'DELETE') {
            const id = p.old && p.old.id
            if (id) S.setKots(prev => { if (!prev.has(id)) return prev; const m = new Map(prev); m.delete(id); return m })
            return
          }
          if (p.new) ingest([p.new], 'rt', continuous())
        })
        .on('postgres_changes', { event:'*', schema:'public', table:'kitchens', filter:'event_id=eq.' + eventId }, p => {
          if (!alive) return
          if (p.eventType === 'DELETE') {
            const id = p.old && p.old.id
            if (id) S.setKitchens(prev => prev.filter(k => k.id !== id))
            return
          }
          if (p.new) ingestKitchens([p.new], false, continuous())
        })
        .subscribe(status => { if (alive) S.setRt(status) })
    } catch { /* polling alone still keeps the board current */ }
  }

  function stop() {
    alive = false
    clearInterval(timer); timer = null
    if (flushT) { clearTimeout(flushT); flushT = null }
    if (onWake) {
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      onWake = null
    }
    if (channel) { try { supabase.removeChannel(channel) } catch { /* ignore */ } channel = null }
  }

  return {
    start, stop,
    ingest: rows => ingest(rows, 'self', true),
    // If a poll is already in flight, the next one becomes the full re-read.
    refresh: () => { lastFull = 0; poll(true) },
  }
}

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

function derive(kots, kitchens) {
  const orders = [], failed = [], queue = []
  const per = new Map()
  const pk = id => { let p = per.get(id); if (!p) { p = { open:0, failed:0, oldest:0 }; per.set(id, p) } return p }
  let beat = 0, open = 0, delivered = 0, durSum = 0, durN = 0
  for (const k of kots.values()) {
    beat = Math.max(beat, ms(k.print_claimed_at), ms(k.printed_at))
    if (k.print_status === 'queued' || k.print_status === 'printing') queue.push(k)
    if (needsFix(k)) { failed.push(k); pk(k.kitchen_id).failed++ }
    if (k.kind !== 'order') continue
    orders.push(k)
    if (k.status === 'open') {
      open++
      const p = pk(k.kitchen_id), c = ms(k.created_at)
      p.open++
      if (c && (!p.oldest || c < p.oldest)) p.oldest = c
    } else if (k.status === 'delivered') {
      delivered++
      const dur = ms(k.delivered_at) - ms(k.created_at)
      if (dur > 0 && dur < 6 * 3600000) { durSum += dur; durN++ }
    }
  }
  for (const kt of kitchens) beat = Math.max(beat, ms(kt.printer_checked_at))
  failed.sort((a, b) => ms(a.created_at) - ms(b.created_at))
  return { orders, failed, queue, per, beat, open, delivered,
    avgMin: durN ? durSum / durN / 60000 : null }
}

// Where a KOT will print: its redirect if one is set, else its kitchen's printer.
function targetIp(k, kitchen) { return (k.printer_ip && String(k.printer_ip).trim()) || (kitchen && kitchen.printer_ip) || '' }

function printerName(ip, kitchens, own) {
  if (!ip) return ''
  if (own && own.backup_printer_ip === ip && own.printer_ip !== ip) return 'backup printer'
  const k = kitchens.find(x => x.printer_ip === ip)
  return k ? k.name + ' printer' : ip
}

function printChip(k, nowS, kitchens, own) {
  const closed = k.kind === 'order' && k.status !== 'open'
  const attempts = k.print_attempts || 0
  const via = k.printer_ip ? 'via ' + printerName(k.printer_ip, kitchens, own) : ''
  switch (k.print_status) {
    case 'printed':
      return { tone:'green', text:'Printed', via,
        title:'Printed ' + clockTime(k.printed_at) + (attempts > 1 ? ' · attempt ' + attempts : '') + (via ? ' · ' + via : '') }
    case 'failed':
      if (closed) return { tone:'grey', text:'Not printed', via, title:k.last_error || '' }
      return { tone:'red', text:'Failed' + (attempts ? ' ×' + attempts : ''), via,
        title:(k.last_error || 'Print failed') + (attempts ? ' · ' + attempts + (attempts === 1 ? ' attempt' : ' attempts') : '') }
    case 'printing': {
      const age = nowS - ms(k.print_claimed_at)
      return { tone: age > QUEUE_STUCK_MS ? 'amber' : 'blue', text:'Printing…', via,
        title:'Print Hub picked this up ' + agoText(age) }
    }
    case 'queued': {
      if (closed) return { tone:'grey', text:'Queued', via, title:'' }
      const age = nowS - ms(k.updated_at)
      return age > QUEUE_LATE_MS + 10000
        ? { tone:'amber', text:'Waiting ' + (age < 60000 ? Math.round(age / 1000) + ' s' : Math.floor(age / 60000) + ' min'), via,
            title:'Waiting for the Print Hub since ' + clockTime(k.updated_at) }
        : { tone:'grey', text:'Queued', via, title:'Waiting for the Print Hub' }
    }
    case 'skipped': return { tone:'grey', text:'Not printed', via, title:'Skipped - order cancelled before printing' }
    default: return { tone:'grey', text:k.print_status || '–', via, title:'' }
  }
}

/* What a desk action on this KOT looks like right now. Null = nothing to show. */
function actionState(k, p, now, nowS) {
  if (!p || now - p.at > ACTION_HOLD_MS) return null
  if (p.stage === 'sending') return { tone:'grey', text: p.kind === 'deliver' ? 'Saving…' : 'Sending…', busy:true }
  if (p.stage === 'error')   return { tone:'red', text:p.msg, busy:false }
  if (p.stage === 'noop')    return now - p.at < 6000 ? { tone:'grey', text:p.msg, busy:false } : null
  if (p.kind === 'deliver') {
    if (now - p.at >= 4000) return null
    if (k.status === 'delivered') return { tone:'green', text:'Delivered ✓', busy:true }
    return k.status === 'open' ? { tone:'grey', text:'Saving…', busy:true } : null   // saved, row not merged yet
  }
  // Saved, but the board has not merged the new row yet: still "sent".
  if (p.baseU != null && ms(k.updated_at) <= p.baseU) return { tone:'blue', text:p.label || 'Sent to printer…', busy:true }
  if (k.print_status === 'failed' && (k.print_attempts || 0) > p.attempts) return null   // failed again: show it plainly
  if (k.print_status === 'queued')   return { tone:'blue', text:p.label || 'Sent to printer…', busy:true }
  if (k.print_status === 'printing') return { tone:'blue', text: p.where ? 'Printing on ' + p.where + '…' : 'Printing…', busy:true }
  if (k.print_status === 'printed')  return nowS - ms(k.printed_at) < 6000 ? { tone:'green', text:'Printed ✓', busy:true } : null
  return null
}

/* ------------------------------------------------------------------ */
/* Little visual pieces                                                */
/* ------------------------------------------------------------------ */

function Chip({ tone = 'grey', children, title, strong, style }) {
  const t = TONE[tone] || TONE.grey
  return (
    <span title={title || undefined} style={{ display:'inline-flex', alignItems:'center', gap:4, maxWidth:'100%',
      background: strong ? t.dot : t.bg, color: strong ? '#fff' : t.fg, boxSizing:'border-box',
      borderRadius:999, padding:'2px 9px', fontSize:11, fontWeight:800, lineHeight:1.5,
      whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums', ...style }}>
      <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{children}</span>
    </span>
  )
}

function Dot({ tone = 'grey', size = 9, pulse }) {
  return <span className={pulse ? 'kb-pulse' : undefined}
    style={{ display:'inline-block', width:size, height:size, borderRadius:999, flexShrink:0,
      background:(TONE[tone] || TONE.grey).dot }} />
}

function NoteBadge({ text }) {
  return (
    <span title={text} style={{ display:'inline-block', verticalAlign:'1px', marginLeft:5,
      background:'#FEF9C3', color:'#854D0E', border:'1px solid #FDE047', borderRadius:5,
      padding:'0 5px', fontSize:10, fontWeight:900, letterSpacing:0.4, textTransform:'uppercase',
      maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:'15px' }}>{text}</span>
  )
}

function ItemsText({ items }) {
  const list = asItems(items)
  if (!list.length) return <span style={{ color:'var(--ink2)' }}>{'–'}</span>
  // Each dish stays on one line; lines break only between dishes.
  return list.map((it, i) => (
    <Fragment key={i}>
      <span style={{ whiteSpace:'nowrap' }}>
        <b style={{ fontWeight:800 }}>{(it.qty ?? 1) + '×'}</b>{' ' + (it.name || 'Item')}
        {it.note ? <NoteBadge text={String(it.note)} /> : null}
        {i < list.length - 1 ? <span style={{ color:'#9CA3AF' }}>,</span> : null}
      </span>
      {i < list.length - 1 ? ' ' : null}
    </Fragment>
  ))
}

function itemsTitle(items) {
  return asItems(items).map(it => (it.qty ?? 1) + '× ' + (it.name || 'Item') + (it.note ? ' [' + it.note + ']' : '')).join('\n')
}

const btnBase = { border:'none', borderRadius:8, padding:'6px 11px', fontSize:12, fontWeight:800,
  cursor:'pointer', whiteSpace:'nowrap', lineHeight:1.3, fontFamily:'Manrope, sans-serif' }
const btnGhost = { ...btnBase, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)' }
const btnDark  = { ...btnBase, background:DARK, color:'#fff' }
const btnGreen = { ...btnBase, background:'#16A34A', color:'#fff' }
const btnConfirm = { ...btnBase, background:DARK, color:MARI, boxShadow:'0 0 0 2px ' + MARI + ' inset' }
const btnRetry   = { borderColor:'#DC2626', color:'#B91C1C' }

/* ------------------------------------------------------------------ */
/* KOT row                                                             */
/* ------------------------------------------------------------------ */

const KotRow = memo(function KotRow({ k, nowS, kitchens, own, act, confirming, onReprint, onDeliver, onTable }) {
  const open = k.status === 'open'
  const created = ms(k.created_at)
  const ageMin = open && nowS ? Math.max(0, Math.floor((nowS - created) / 60000)) : null
  const late = ageMin != null ? lateTone(ageMin) : null
  const pc = printChip(k, nowS, kitchens, own)
  const failedOpen = open && k.print_status === 'failed'
  const bar = late === 'red' || failedOpen ? TONE.red.dot : late === 'amber' ? TONE.amber.dot : 'transparent'
  const rowBg = late === 'red' ? '#FFF5F5' : late === 'amber' ? '#FFFBEB' : '#fff'
  const canReprint = open && ['printed', 'failed', 'skipped'].includes(k.print_status)
  const chairs = chairsText(k.chairs)
  const rp = act && act.kind !== 'deliver' ? act : null
  const dl = act && act.kind === 'deliver' ? act : null
  const held = !open && dl && dl.tone === 'green'   // just delivered from the desk, still on the Open view

  let ageCell
  if (open) {
    ageCell = <Chip tone={late || 'grey'} strong={late === 'red'} title={'Sent ' + clockTime(k.created_at)}>{minsText(ageMin)}</Chip>
  } else if (k.status === 'delivered') {
    const dm = Math.max(0, Math.round((ms(k.delivered_at) - created) / 60000))
    ageCell = <span title="Sent to delivered" style={{ fontSize:12, fontWeight:700, color:'var(--ink2)' }}>{dm + ' min'}</span>
  } else ageCell = <span style={{ color:'#9CA3AF' }}>{'–'}</span>

  let dlv
  if (k.status === 'delivered') {
    dlv = (
      <div style={{ lineHeight:1.25, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:800, color:'#15803D', whiteSpace:'nowrap' }}>{'✓ Delivered ' + clockTime(k.delivered_at)}</div>
        <div style={{ fontSize:11, color:'var(--ink2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{'by ' + (k.delivered_by_name || '–')}</div>
      </div>
    )
  } else if (k.status === 'cancelled') {
    dlv = <Chip tone="grey" title={k.cancelled_at ? 'Cancelled ' + clockTime(k.cancelled_at) : ''}>{'Cancelled' + (k.cancelled_at ? ' ' + clockTime(k.cancelled_at) : '')}</Chip>
  } else {
    dlv = <span style={{ display:'inline-block', fontSize:11, fontWeight:800, color:'var(--ink)', border:'1.5px solid var(--line)',
      borderRadius:999, padding:'1px 9px', background:'#fff' }}>Open</span>
  }

  return (
    <div className="kb-grid kb-row" style={{ background:rowBg, borderLeft:'4px solid ' + bar }}>
      <div className="kb-c-kot" style={{ fontSize:13, fontWeight:900, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap' }}>{k.kot_no || '–'}</div>
      <div className="kb-c-kit" title={k.kitchen_name || ''} style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{k.kitchen_name || own?.name || '–'}</div>
      <div className="kb-c-tab" style={{ minWidth:0, lineHeight:1.2 }}>
        <span onClick={() => k.table_number != null && onTable(k.table_number)} title={'Show only table ' + k.table_number}
          style={{ fontSize:14, fontWeight:900, cursor:'pointer' }}>{'T' + (k.table_number ?? '?')}</span>
        {chairs && <div title={'Chairs ' + chairs} style={{ fontSize:11, color:'var(--ink2)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{'Chairs ' + chairs}</div>}
      </div>
      <div className="kb-c-items kb-clamp" title={itemsTitle(k.items)} style={{ fontSize:13, fontWeight:600, lineHeight:'19px' }}>
        <ItemsText items={k.items} />
      </div>
      <div className="kb-c-cap" title={k.captain_name ? 'Captain ' + k.captain_name : ''} style={{ fontSize:12, fontWeight:600, color:'var(--ink2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{k.captain_name || '–'}</div>
      <div className="kb-c-age">{ageCell}</div>
      <div className="kb-c-prn" style={{ minWidth:0, lineHeight:1.2 }}>
        <Chip tone={pc.tone} strong={pc.tone === 'red'} title={pc.title}>{pc.text}</Chip>
        {pc.via && <div title={pc.via} style={{ fontSize:10, color:'var(--ink2)', fontWeight:700, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pc.via}</div>}
      </div>
      <div className="kb-c-dlv" style={{ minWidth:0 }}>{dlv}</div>
      <div className="kb-c-act" style={{ display:'flex', gap:6, justifyContent:'flex-end', alignItems:'center' }}>
        {/* Fixed-width slots, so Mark delivered lines up down the whole list
            whether or not a row has a Reprint button. A failed write turns
            back into its button, outlined red, so it can be tapped again. */}
        {held && <><span style={{ width:112 }} /><Chip tone="green" style={{ width:112, justifyContent:'center', padding:'3px 6px' }}>{dl.text}</Chip></>}
        {open && (rp && rp.tone !== 'red'
          ? <Chip tone={rp.tone} title={rp.text} style={{ width:112, justifyContent:'center', padding:'3px 6px' }}>{rp.text}</Chip>
          : canReprint || rp
            ? <button className="kb-btn" onClick={() => onReprint(k)}
                title={rp ? rp.text : "Print this KOT again on its kitchen's printer"}
                style={{ ...btnGhost, width:112, ...(rp ? btnRetry : null) }}>{rp ? '↻ Not sent' : '🖨 Reprint'}</button>
            : <span style={{ width:112 }} />)}
        {open && (dl && dl.tone !== 'red'
          ? <Chip tone={dl.tone} style={{ width:112, justifyContent:'center', padding:'3px 6px' }}>{dl.text}</Chip>
          : <button className="kb-btn" onClick={() => onDeliver(k)}
              title={confirming ? 'Click again to confirm' : dl ? dl.text : 'Mark this KOT delivered from the desk'}
              style={{ ...(confirming ? btnConfirm : dl ? { ...btnGhost, ...btnRetry } : btnGreen), width:112 }}>
              {confirming ? 'Confirm?' : dl ? '↻ Not saved' : '✓ Mark delivered'}
            </button>)}
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/* Failed prints panel                                                 */
/* ------------------------------------------------------------------ */

function RedirectChoices({ targets, onPick, onClose }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:6, alignItems:'center', padding:'8px 0 2px' }}>
      <span style={{ fontSize:12, fontWeight:800, color:'#7F1D1D', marginRight:2 }}>Print on:</span>
      {targets.length === 0 && <span style={{ fontSize:12, color:'var(--ink2)' }}>No other printer is set up for this event.</span>}
      {targets.map(t => {
        const st = PRINTER[t.status] || PRINTER.unknown
        return (
          <button key={t.ip} className="kb-btn" onClick={() => onPick(t)}
            title={t.ip + ' · ' + st.label}
            style={{ ...btnGhost, display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px' }}>
            <Dot tone={st.tone} size={8} />
            <span>{t.label}</span>
            <span style={{ fontSize:11, fontWeight:600, color: st.tone === 'red' ? TONE.red.fg : 'var(--ink2)' }}>
              {st.tone === 'green' ? t.ip : st.label}
            </span>
          </button>
        )
      })}
      <button className="kb-btn" onClick={onClose} style={{ ...btnBase, background:'transparent', color:'var(--ink2)' }}>Cancel</button>
    </div>
  )
}

function FailedItem({ k, kitchen, kitchens, act, nowS, redirectOpen, targets, onReprint, onRedirect, onToggleRedirect, onDismiss }) {
  const kind = k.kind === 'cancel' ? 'CANCEL' : k.kind === 'test' ? 'TEST' : null
  const attempts = k.print_attempts || 0
  const busy = act && act.busy
  const via = k.printer_ip ? printerName(k.printer_ip, kitchens, kitchen) : ''
  const done = act && act.tone === 'green'
  return (
    <div style={{ padding:'8px 12px', borderTop:'1px solid #FECACA', background: done ? '#F0FDF4' : act && act.busy ? '#FFFFFF' : '#FFF5F5' }}>
      <div className="kb-fgrid">
        <div className="kb-f-kot" style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
          {kind && <Chip tone={kind === 'CANCEL' ? 'dark' : 'grey'} style={{ fontSize:10, padding:'1px 6px' }}>{kind}</Chip>}
          <span style={{ fontSize:14, fontWeight:900, whiteSpace:'nowrap' }}>{k.kot_no || (kind === 'TEST' ? 'Test slip' : '–')}</span>
        </div>
        <div className="kb-f-kit" style={{ fontSize:12, fontWeight:800, color:'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{k.kitchen_name || kitchen?.name || '–'}</div>
        <div className="kb-f-tab" style={{ fontSize:13, fontWeight:900 }}>{k.table_number != null ? 'T' + k.table_number : ''}</div>
        <div className="kb-f-err" style={{ minWidth:0 }}>
          {act ? (
            <div style={{ fontSize:13, fontWeight:800, color: (TONE[act.tone] || TONE.grey).fg }}>{act.text}</div>
          ) : (
            <>
              <div title={k.last_error || ''} style={{ fontSize:12, fontWeight:700, color:'#991B1B', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {k.last_error || 'Print failed'}
              </div>
              <div style={{ fontSize:11, color:'var(--ink2)', fontWeight:600 }}>
                {attempts + (attempts === 1 ? ' attempt' : ' attempts') + ' · failed ' + agoText(nowS - ms(k.updated_at))}
                {via ? ' · sent via ' + via : ''}
              </div>
            </>
          )}
        </div>
        <div className="kb-f-act" style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
          {!busy && (
            <>
              <button className="kb-btn" onClick={() => onReprint(k)} style={btnDark}
                title={"Print again on this kitchen's own printer"}>{'🖨 Reprint'}</button>
              <button className="kb-btn" onClick={() => onToggleRedirect(k.id)}
                style={{ ...btnGhost, borderColor: redirectOpen ? DARK : 'var(--line)' }}
                title="Print it on another kitchen's printer instead">{'Redirect ' + (redirectOpen ? '▴' : '▾')}</button>
              {k.kind === 'test' && (
                <button className="kb-btn" onClick={() => onDismiss(k)} style={{ ...btnBase, background:'transparent', color:'var(--ink2)' }}
                  title="Clear this test slip from the list without printing it">Dismiss</button>
              )}
            </>
          )}
        </div>
      </div>
      {redirectOpen && !busy && <RedirectChoices targets={targets} onPick={t => onRedirect(k, t)} onClose={() => onToggleRedirect(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Kitchen tile                                                        */
/* ------------------------------------------------------------------ */

function KitchenTile({ k, stats, nowList, nowLive, selected, stale, onClick }) {
  const hasPrinter = !!(k.printer_ip && String(k.printer_ip).trim())
  const st = hasPrinter ? (PRINTER[k.printer_status] || (k.printer_status ? PRINTER.unknown : { tone:'grey', label:'Not checked yet' })) : { tone:'amber', label:'No printer set' }
  const oldestMin = stats.oldest ? Math.max(0, Math.floor((nowList - stats.oldest) / 60000)) : null
  const late = oldestMin != null ? lateTone(oldestMin) : null
  const worst = st.tone === 'red' || stats.failed > 0 || late === 'red' ? 'red'
    : st.tone === 'amber' || late === 'amber' ? 'amber'
    : st.tone === 'green' ? 'green' : 'grey'
  const checked = ms(k.printer_checked_at)
  const sub = selected ? 'rgba(255,255,255,0.72)' : 'var(--ink2)'
  return (
    <div className="kb-tile" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      title={selected ? 'Showing only ' + k.name + ' - click again to show all kitchens' : 'Show only ' + k.name + ' KOTs'}
      style={{ background: selected ? DARK : '#fff', borderRadius:12, boxShadow:'var(--shadow)', cursor:'pointer',
        borderLeft:'5px solid ' + (TONE[worst] || TONE.grey).dot,
        outline: selected ? '2px solid ' + MARI : 'none', outlineOffset:-2,
        padding:'7px 10px 8px 10px', minWidth:0, display:'flex', flexDirection:'column', gap:3 }}>
      {/* 1: kitchen, failed count, open count */}
      <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
        <span style={{ fontSize:14, fontWeight:900, color: selected ? MARI : 'var(--ink)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>{k.name}</span>
        {stats.failed > 0 && <Chip tone="red" strong style={{ padding:'0 7px', fontSize:10, flexShrink:0 }}>{stats.failed + ' failed'}</Chip>}
        <span style={{ flex:1 }} />
        <span style={{ flexShrink:0, lineHeight:1, whiteSpace:'nowrap' }}>
          <span style={{ fontSize:20, fontWeight:900, color: selected ? '#fff' : 'var(--ink)', fontVariantNumeric:'tabular-nums' }}>{stats.open}</span>
          <span style={{ fontSize:10, fontWeight:800, color:sub, marginLeft:3 }}>open</span>
        </span>
      </div>
      {/* 2: printer state and address */}
      <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
        {/* While the Print Hub is not running nobody is checking the printer,
            so the last known state is shown faded rather than as current. */}
        <Dot tone={st.tone} pulse={st.tone === 'red' && !stale} />
        <span style={{ fontSize:12, fontWeight:800, whiteSpace:'nowrap', flexShrink:0, opacity: stale && hasPrinter ? 0.55 : 1,
          color: selected ? '#fff' : st.tone === 'grey' ? 'var(--ink2)' : TONE[st.tone].fg }}>{st.label}</span>
        <span style={{ fontSize:11, color:sub, fontWeight:600, fontVariantNumeric:'tabular-nums', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>
          {hasPrinter ? '· ' + k.printer_ip + (k.printer_port && k.printer_port !== 9100 ? ':' + k.printer_port : '') : '· add one in Kitchen setup'}
        </span>
      </div>
      {/* 3: when the printer was last checked, oldest open KOT */}
      <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
        <span style={{ fontSize:11, color:sub, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', minWidth:0 }}>
          {hasPrinter ? (checked > 0 ? 'checked ' + shortAgo(nowLive - checked) : 'not checked yet') : ''}
        </span>
        <span style={{ flex:1 }} />
        {oldestMin != null
          ? <Chip tone={late || 'grey'} strong={late === 'red'} title="Oldest open KOT in this kitchen" style={{ flexShrink:0 }}>{'oldest ' + minsText(oldestMin)}</Chip>
          : <span style={{ fontSize:11, fontWeight:700, color:sub, flexShrink:0 }}>nothing open</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

export default function KitchenBoard({ eventData }) {
  if (!eventData?.id) return null
  // Keyed by event, so switching events starts from a clean slate.
  return <Board key={eventData.id} eventId={eventData.id} />
}

function Board({ eventId }) {
  const [kots, setKots] = useState(() => new Map())
  const [kitchens, setKitchens] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [lastOk, setLastOk] = useState(0)
  const [rt, setRt] = useState('CONNECTING')
  const [skew, setSkew] = useState(0)
  const [hubSeen, setHubSeen] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [engine] = useState(() => makeEngine(eventId,
    { setKots, setKitchens, setLoaded, setLoadErr, setLastOk, setRt, setSkew, setHubSeen }))

  const [view, setView] = useState('open')
  const [kitchenFilter, setKitchenFilter] = useState(null)
  const [tableQ, setTableQ] = useState('')
  const [pend, setPend] = useState({})
  const [confirmId, setConfirmId] = useState(null)
  const [redirectFor, setRedirectFor] = useState(null)
  const confirmRef = useRef(null)
  const confirmTimer = useRef(null)

  useEffect(() => { engine.start(); return () => engine.stop() }, [engine])
  // Audio needs one real user gesture first; arm on the first click or key.
  useEffect(() => unlockChime(), [])
  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  /* The board fills the screen below the tabs and the KOT list scrolls inside
     it, so the counts, Print Hub state, kitchens and failed prints never
     scroll away. Measured every second rather than once, because the app's
     new-order banner pushes everything down 72px while it is showing. */
  const rootRef = useRef(null)
  const [boardH, setBoardH] = useState(null)
  useEffect(() => {
    function tick() {
      setNow(Date.now())
      const el = rootRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      // 12px leaves room under the board; the Captains pill floats over the
      // footer line's empty right-hand end, not over a row.
      const h = Math.floor(window.innerHeight - top - 12)
      const next = h >= 500 ? h : null   // too short to split - let the page scroll instead
      setBoardH(prev => (prev === next || (prev && next && Math.abs(prev - next) < 3)) ? prev : next)
    }
    tick()
    const t = setInterval(tick, 1000)
    window.addEventListener('resize', tick)
    return () => { clearInterval(t); window.removeEventListener('resize', tick) }
  }, [])

  const nowS = now + skew                                    // server-time "now"
  const listNowS = Math.floor(now / 15000) * 15000 + skew    // row timers tick every 15 s

  const kitchenById = useMemo(() => new Map(kitchens.map(k => [k.id, k])), [kitchens])
  const activeKitchens = useMemo(() => kitchens.filter(k => k.is_active !== false), [kitchens])
  const d = useMemo(() => derive(kots, kitchens), [kots, kitchens])

  /* ---------- Print Hub health ---------- */
  const online = lastOk > 0 && now - lastOk < 20000
  const hubAge = Math.min(d.beat ? Math.max(0, nowS - d.beat) : Infinity, hubSeen ? now - hubSeen : Infinity)
  let waitingAll = 0, waitingLate = 0, stuck = 0
  for (const k of d.queue) {
    if (k.kind === 'order' && k.status === 'cancelled') continue
    waitingAll++
    const since = k.print_status === 'printing' ? ms(k.print_claimed_at) : ms(k.updated_at)
    const age = nowS - since
    if (k.print_status === 'queued' ? age > QUEUE_LATE_MS : age > QUEUE_STUCK_MS) waitingLate++
    if (age > QUEUE_STUCK_MS) stuck++
  }
  /* Red needs both: KOTs waiting 20 s+ AND no sign of the hub for 60 s.
     With nothing to print, the hub's only sign of life is a printer status
     it re-sends every 60 s (checked every 15 s), so a healthy idle hub can
     read up to ~80 s - green holds to 90 s to keep the pill from flickering. */
  const hub = !loaded || !online ? 'unknown'
    : waitingLate && hubAge > HUB_SILENT_MS ? 'down'
    : hubAge <= HUB_IDLE_OK_MS ? (stuck ? 'slow' : 'ok')
    : 'idle'

  /* ---------- Chime: a new failure, or the Print Hub going down ---------- */
  const failKey = d.failed.map(k => k.id + ':' + (k.print_attempts || 0)).join('|')
  const prevFail = useRef(null)
  useEffect(() => {
    if (!loaded) return
    const keys = new Set(failKey ? failKey.split('|') : [])
    // The first load only sets the baseline: what is already failed is on
    // screen in red, and replaying it as a chime would say "new" when it is not.
    if (prevFail.current) for (const key of keys) if (!prevFail.current.has(key)) { ring(); break }
    prevFail.current = keys
  }, [failKey, loaded])
  const prevHub = useRef(hub)
  useEffect(() => {
    if (hub === 'down' && prevHub.current !== 'down') ring()
    prevHub.current = hub
  }, [hub])

  /* ---------- Desk actions ---------- */
  const mark = useCallback((ids, entry) => setPend(p => {
    const n = gcPend(p)
    for (const id of ids) {
      const e = entry(id, n[id])
      // A new action replaces whatever the last one left behind; later
      // stages of the same action are merged into it.
      n[id] = e.stage === 'sending' ? e : { ...(n[id] || {}), ...e }
    }
    return n
  }), [])

  /* Reprint and redirect are the same write: back to 'queued', with or
     without a printer override. Only KOTs that are not already queued or
     being printed are touched - requeueing one the hub has in hand would
     put two copies on the kitchen's spike. */
  const sendToPrinter = useCallback(async (list, target, fromPanel) => {
    if (!list.length) return
    const ids = list.map(k => k.id)
    const attempts = Object.fromEntries(list.map(k => [k.id, k.print_attempts || 0]))
    const baseU = Object.fromEntries(list.map(k => [k.id, ms(k.updated_at)]))
    const where = target ? target.label + ' printer' : ''
    const label = target ? 'Sent to ' + where + '…' : 'Sent to printer…'
    setRedirectFor(null)
    mark(ids, id => ({ kind: target ? 'redirect' : 'reprint', stage:'sending', at:Date.now(), attempts:attempts[id], baseU:baseU[id], label, where, fromPanel }))
    const patch = target
      ? { print_status:'queued', printer_ip:target.ip, last_error:null }
      : { print_status:'queued', printer_ip:null, last_error:null }
    try {
      const { data, error } = await supabase.from('kots').update(patch)
        .in('id', ids).in('print_status', ['failed', 'printed', 'skipped']).select()
      if (error) throw error
      const rows = data || []
      if (rows.length) engine.ingest(rows)
      const got = new Set(rows.map(r => r.id))
      mark(ids, id => got.has(id)
        ? { stage:'sent' }
        : { stage:'noop', at:Date.now(), msg:'Already printing' })
    } catch {
      mark(ids, () => ({ stage:'error', msg:'Not sent – check Wi-Fi, try again' }))
    }
  }, [engine, mark])

  const dismissTest = useCallback(async k => {
    mark([k.id], () => ({ kind:'dismiss', stage:'sending', at:Date.now(), attempts:k.print_attempts || 0, fromPanel:true }))
    try {
      const { data, error } = await supabase.from('kots').update({ print_status:'skipped' })
        .eq('id', k.id).eq('print_status', 'failed').select()
      if (error) throw error
      if (data && data.length) engine.ingest(data)
      setPend(p => { const n = { ...p }; delete n[k.id]; return n })
    } catch {
      mark([k.id], () => ({ stage:'error', msg:'Not saved – try again' }))
    }
  }, [engine, mark])

  const deliver = useCallback(async k => {
    mark([k.id], () => ({ kind:'deliver', stage:'sending', at:Date.now(), attempts:0 }))
    try {
      const { data, error } = await supabase.rpc('mk_mark_delivered', { p_kot_id:k.id, p_waiter_id:null })
      if (error) throw error
      const row = Array.isArray(data) ? data[0] : data
      if (row && row.id) engine.ingest([row])
      const ok = row && row.status === 'delivered'
      mark([k.id], () => ok
        ? { stage:'done', at:Date.now() }
        : { stage:'noop', at:Date.now(), msg: row && row.status === 'cancelled' ? 'Order was cancelled' : 'Already closed' })
    } catch {
      mark([k.id], () => ({ stage:'error', at:Date.now(), msg:'Not saved – try again' }))
    }
  }, [engine, mark])

  // Two clicks, four seconds apart at most. No dialogs on this screen.
  const onDeliverClick = useCallback(k => {
    clearTimeout(confirmTimer.current)
    if (confirmRef.current === k.id) {
      confirmRef.current = null; setConfirmId(null)
      deliver(k)
      return
    }
    confirmRef.current = k.id; setConfirmId(k.id)
    confirmTimer.current = setTimeout(() => {
      if (confirmRef.current === k.id) { confirmRef.current = null; setConfirmId(null) }
    }, 4000)
  }, [deliver])

  const onRowReprint = useCallback(k => sendToPrinter([k], null, false), [sendToPrinter])
  const onTable = useCallback(n => setTableQ(String(n)), [])

  /* ---------- Redirect targets ---------- */
  function targetsFor(kitchen, currentIp) {
    const seen = new Set([currentIp])
    const out = []
    if (kitchen && kitchen.backup_printer_ip && !seen.has(kitchen.backup_printer_ip)) {
      seen.add(kitchen.backup_printer_ip)
      out.push({ ip:kitchen.backup_printer_ip, label:kitchen.name + ' backup', status:'unknown', order:-1 })
    }
    for (const kt of activeKitchens) {
      const ip = kt.printer_ip && String(kt.printer_ip).trim()
      if (!ip || seen.has(ip)) continue
      seen.add(ip)
      out.push({ ip, label:kt.name, status:kt.printer_status || 'unknown', order:kt.sort_order ?? 0 })
    }
    const rank = s => s === 'online' ? 0 : s === 'paper_low' ? 1 : s === 'offline' || s === 'paper_out' ? 3 : 2
    return out.sort((a, b) => rank(a.status) - rank(b.status) || a.order - b.order)
  }

  /* ---------- Failed panel content ---------- */
  const panel = useMemo(() => {
    const items = [...d.failed]
    const have = new Set(items.map(k => k.id))
    // Keep a just-fixed slip in view for a few seconds, so the operator
    // sees it go "Sent to printer..." and then "Printed" before it leaves.
    for (const id in pend) {
      const p = pend[id]
      if (!p.fromPanel || have.has(id)) continue
      const k = kots.get(id)
      if (!k || !actionState(k, p, now, nowS)) continue   // nothing left to show for it
      items.push(k); have.add(id)
    }
    // A failed CANCEL slip first - that kitchen is cooking food nobody
    // wants - then orders oldest first, and test slips last.
    const rank = k => k.kind === 'cancel' ? 0 : k.kind === 'test' ? 2 : 1
    items.sort((a, b) => rank(a) - rank(b) || ms(a.created_at) - ms(b.created_at))
    const groups = new Map()
    for (const k of items) {
      const g = groups.get(k.kitchen_id) || []
      g.push(k); groups.set(k.kitchen_id, g)
    }
    return [...groups.entries()]
      .map(([kid, list]) => ({ kid, list, kitchen:kitchenById.get(kid), top:rank(list[0]) }))
      .sort((a, b) => a.top - b.top || (a.kitchen?.sort_order ?? 999) - (b.kitchen?.sort_order ?? 999))
  }, [d.failed, pend, kots, now, nowS, kitchenById])
  const panelCount = panel.reduce((n, g) => n + g.list.length, 0)

  /* ---------- KOT list ---------- */
  const tableNum = /^\d+$/.test(tableQ) ? parseInt(tableQ, 10) : null
  // Rows just delivered from the desk stay on the Open view for a moment
  // with a green tick, so the row does not simply vanish under the cursor.
  const holdKey = Object.keys(pend).filter(id => pend[id].kind === 'deliver' && pend[id].stage === 'done' && now - pend[id].at < 4000).join(',')
  const list = useMemo(() => {
    const hold = new Set(holdKey ? holdKey.split(',') : [])
    const counts = { open:0, failed:0, delivered:0, cancelled:0, all:0 }
    const rows = []
    for (const k of d.orders) {
      if (kitchenFilter && k.kitchen_id !== kitchenFilter) continue
      if (tableNum != null && Number(k.table_number) !== tableNum) continue
      counts.all++
      const failed = k.status === 'open' && k.print_status === 'failed'
      if (k.status === 'open') counts.open++
      else if (k.status === 'delivered') counts.delivered++
      else if (k.status === 'cancelled') counts.cancelled++
      if (failed) counts.failed++
      const inView = view === 'all' ? true
        : view === 'failed' ? failed
        : k.status === view || (view === 'open' && hold.has(k.id))
      if (inView) rows.push(k)
    }
    const closedAt = k => ms(k.delivered_at) || ms(k.cancelled_at) || ms(k.created_at)
    rows.sort((a, b) => {
      const ao = a.status === 'open' || hold.has(a.id), bo = b.status === 'open' || hold.has(b.id)
      if (ao !== bo) return ao ? -1 : 1
      return ao ? ms(a.created_at) - ms(b.created_at) : closedAt(b) - closedAt(a)
    })
    const capped = (view === 'delivered' || view === 'all') && rows.length > CLOSED_CAP
    return { rows: capped ? rows.slice(0, CLOSED_CAP) : rows, total:rows.length, capped, counts }
  }, [d.orders, kitchenFilter, tableNum, view, holdKey])

  /* ---------- Render ---------- */
  const fixed = boardH != null
  const selKitchen = kitchenFilter ? kitchenById.get(kitchenFilter) : null
  const avg = d.avgMin
  const avgTone = avg == null ? null : lateTone(Math.round(avg))
  const syncAge = lastOk ? now - lastOk : Infinity
  const VIEWS = [['open', 'Open'], ['failed', 'Failed'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']]

  return (
    <div ref={rootRef} style={{ height: fixed ? boardH : 'auto', display:'flex', flexDirection:'column', gap:10, minHeight:0 }}>
      <style>{`
        .kb-grid { display:grid; column-gap:10px; align-items:center;
          grid-template-columns: 70px 88px 104px minmax(160px,1fr) 86px 62px 108px 142px 232px; }
        .kb-row { padding:7px 12px 7px 8px; border-bottom:1px solid var(--line); min-height:42px; box-sizing:border-box; }
        .kb-head { padding:7px 12px 7px 12px; font-size:10.5px; font-weight:800; color:var(--ink2);
          text-transform:uppercase; letter-spacing:0.5px; background:#FBFAFD; border-bottom:1px solid var(--line);
          position:sticky; top:0; z-index:2; }
        .kb-clamp { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .kb-fgrid { display:grid; column-gap:12px; align-items:center;
          grid-template-columns: 118px 96px 48px minmax(0,1fr) auto; }
        .kb-tiles { display:grid; gap:8px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
        .kb-btn:hover { filter:brightness(0.94); }
        .kb-btn:active { transform:translateY(1px); }
        .kb-tile:hover { box-shadow:0 6px 22px rgba(42,27,46,0.16); }
        @keyframes kbPulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
        .kb-pulse { animation:kbPulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .kb-pulse { animation:none; } }
        @media (max-width: 1100px) {
          .kb-grid { grid-template-columns: 70px 100px minmax(0,1fr) minmax(0,1fr) auto; row-gap:6px;
            grid-template-areas: "kot tab items items age" "kit cap prn dlv act"; }
          .kb-head { display:none; }
          .kb-c-kot{grid-area:kot} .kb-c-kit{grid-area:kit} .kb-c-tab{grid-area:tab} .kb-c-items{grid-area:items}
          .kb-c-cap{grid-area:cap} .kb-c-age{grid-area:age; justify-self:end} .kb-c-prn{grid-area:prn}
          .kb-c-dlv{grid-area:dlv} .kb-c-act{grid-area:act}
          .kb-fgrid { grid-template-columns: 118px minmax(0,1fr) 48px; row-gap:6px;
            grid-template-areas: "kot kit tab" "err err err" "act act act"; }
          .kb-f-kot{grid-area:kot} .kb-f-kit{grid-area:kit} .kb-f-tab{grid-area:tab} .kb-f-err{grid-area:err} .kb-f-act{grid-area:act}
        }
      `}</style>

      {/* ── Header: title, counts, Print Hub state ── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', flexShrink:0 }}>
        <h2 style={{ fontSize:20, fontWeight:800, display:'flex', alignItems:'baseline', gap:8, marginRight:6 }}>
          Kitchen Board
          <span style={{ fontSize:11, fontWeight:600, color:'var(--ink2)', opacity:0.65 }}>{BUILD_VERSION}</span>
        </h2>
        {[
          { key:'open', n:d.open, label: d.open === 1 ? 'open KOT' : 'open KOTs', tone:null, onClick:() => setView('open') },
          { key:'failed', n:d.failed.length, label: d.failed.length === 1 ? 'failed print' : 'failed prints', tone: d.failed.length ? 'red' : null, onClick:() => setView('failed') },
          { key:'delivered', n:d.delivered, label:'delivered', tone:null, onClick:() => setView('delivered') },
        ].map(s => (
          <button key={s.key} className="kb-btn" onClick={s.onClick} title={'Show ' + s.label}
            style={{ display:'inline-flex', alignItems:'baseline', gap:5, border:'none', cursor:'pointer',
              background: s.tone ? TONE.red.dot : '#fff', color: s.tone ? '#fff' : 'var(--ink)',
              borderRadius:12, padding:'6px 12px', boxShadow:'var(--shadow)' }}>
            <span style={{ fontSize:19, fontWeight:900, fontVariantNumeric:'tabular-nums' }}>{loaded ? s.n : '–'}</span>
            <span style={{ fontSize:12, fontWeight:700, color: s.tone ? 'rgba(255,255,255,0.9)' : 'var(--ink2)' }}>{s.label}</span>
          </button>
        ))}
        <div title="Average time from a KOT being sent to the kitchen until it is marked delivered (today)"
          style={{ display:'inline-flex', alignItems:'baseline', gap:5, background: avgTone ? TONE[avgTone].bg : '#fff',
            borderRadius:12, padding:'6px 12px', boxShadow:'var(--shadow)' }}>
          <span style={{ fontSize:19, fontWeight:900, fontVariantNumeric:'tabular-nums', color: avgTone ? TONE[avgTone].fg : 'var(--ink)' }}>
            {avg == null ? '–' : avg.toFixed(1)}
          </span>
          <span style={{ fontSize:12, fontWeight:700, color:'var(--ink2)' }}>{'min avg send → delivered'}</span>
        </div>
        <span style={{ flex:1 }} />
        <HubPill hub={hub} hubAge={hubAge} />
        <button className="kb-btn" onClick={() => engine.refresh()}
          style={{ ...btnBase, background:'var(--ink)', color:'#fff', padding:'8px 14px', fontSize:13, borderRadius:10 }}>Refresh</button>
      </div>

      {/* ── Alarms: lost connection, Print Hub down or stuck ── */}
      {loaded && !online && (
        <Banner tone="red" title={'No connection to the server – this board was last updated ' + agoText(syncAge)}
          sub={'Check the laptop’s Wi-Fi. The board retries every 4 seconds and catches up by itself.' + (loadErr ? ' (' + loadErr + ')' : '')} />
      )}
      {hub === 'down' && (
        <Banner tone="red" icon={'🖨'}
          title={'Print Hub is not running on the desk laptop – ' + waitingAll + (waitingAll === 1 ? ' KOT' : ' KOTs') + ' waiting to print'}
          sub={'Start the Print Hub program on this laptop \u2013 if it is already open, check it is set to this event. Waiting KOTs print by themselves once it runs. ' + (Number.isFinite(hubAge) ? 'Last seen ' + agoText(hubAge) + '.' : 'Not seen today.')} />
      )}
      {hub === 'slow' && (
        <Banner tone="amber" icon={'🖨'}
          title={stuck + (stuck === 1 ? ' KOT has' : ' KOTs have') + ' been waiting over a minute to print'}
          sub="The Print Hub is running but not getting through them. Check its window on the desk laptop and the printer it is sending to." />
      )}

      {!loaded ? (
        <div style={{ background:'#fff', borderRadius:14, boxShadow:'var(--shadow)', padding:50, textAlign:'center',
          color: loadErr ? TONE.red.fg : 'var(--ink2)', fontWeight:700 }}>
          {loadErr ? 'Cannot reach the server – retrying every 4 seconds…' : 'Loading kitchen board…'}
          {loadErr && <div style={{ fontSize:12, fontWeight:600, marginTop:6, color:'var(--ink2)' }}>{loadErr}</div>}
        </div>
      ) : (
        <>
          {/* ── Kitchen tiles ── */}
          {activeKitchens.length === 0 ? (
            <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:12, padding:'10px 14px', fontSize:13, fontWeight:700, color:'#92400E', flexShrink:0 }}>
              No kitchens are set up for this event yet. Add them in Kitchen setup before captains start ordering.
            </div>
          ) : (
            <div className="kb-tiles" style={{ flexShrink:0 }}>
              {activeKitchens.map(k => (
                <KitchenTile key={k.id} k={k} stats={d.per.get(k.id) || { open:0, failed:0, oldest:0 }}
                  nowList={listNowS} nowLive={nowS} selected={kitchenFilter === k.id} stale={hub === 'down' || hub === 'idle'}
                  onClick={() => setKitchenFilter(f => f === k.id ? null : k.id)} />
              ))}
            </div>
          )}

          {/* ── Failed prints ── */}
          {panelCount > 0 && (
            <div style={{ background:'#fff', borderRadius:14, overflow:'hidden', flexShrink:0, display:'flex', flexDirection:'column',
              // Red only while something is actually failed; once every slip
              // is fixed and just confirming, the panel calms down.
              boxShadow: d.failed.length ? '0 4px 20px rgba(220,38,38,0.18)' : 'var(--shadow)',
              border:'2px solid ' + (d.failed.length ? TONE.red.dot : DARK),
              maxHeight: fixed ? Math.max(150, Math.round(boardH * 0.36)) : 'none' }}>
              <div style={{ background: d.failed.length ? TONE.red.dot : DARK, color:'#fff', padding:'7px 12px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                <span style={{ fontSize:14, fontWeight:900 }}>
                  {d.failed.length
                    ? '⚠ ' + d.failed.length + (d.failed.length === 1 ? ' print failed' : ' prints failed') + ' – the kitchen does not have ' + (d.failed.length === 1 ? 'this slip' : 'these slips')
                    : '✓ Fixed – checking they print'}
                </span>
                <span style={{ flex:1 }} />
                <span style={{ fontSize:11, fontWeight:700, opacity:0.9 }}>Reprint on its own printer, or redirect to another kitchen&apos;s</span>
              </div>
              <div style={{ overflowY:'auto', minHeight:0 }}>
                {panel.map(g => {
                  const realFails = g.list.filter(k => needsFix(k) && !actionState(k, pend[k.id], now, nowS))
                  const gKey = 'group:' + g.kid
                  const pst = g.kitchen ? (g.kitchen.printer_ip ? (PRINTER[g.kitchen.printer_status] || PRINTER.unknown) : { tone:'amber', label:'No printer set' }) : null
                  return (
                    <div key={g.kid || 'none'}>
                      {realFails.length >= 2 && (
                        <div style={{ background:'#FEE2E2', padding:'7px 12px', borderTop:'1px solid #FECACA' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                            <span style={{ fontSize:13, fontWeight:900, color:'#7F1D1D' }}>
                              {(g.kitchen?.name || realFails[0].kitchen_name || 'Kitchen') + ' · ' + realFails.length + ' failed'}
                            </span>
                            {pst && <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, color:'#7F1D1D' }}>
                              <Dot tone={pst.tone} size={8} />{'printer ' + (g.kitchen.printer_ip || '') + ' · ' + pst.label}
                            </span>}
                            <span style={{ flex:1 }} />
                            <button className="kb-btn" onClick={() => sendToPrinter(realFails, null, true)} style={btnDark}>{'🖨 Reprint all ' + realFails.length}</button>
                            <button className="kb-btn" onClick={() => setRedirectFor(r => r === gKey ? null : gKey)}
                              style={{ ...btnGhost, borderColor: redirectFor === gKey ? DARK : 'var(--line)' }}>{'Redirect all ' + (redirectFor === gKey ? '▴' : '▾')}</button>
                          </div>
                          {redirectFor === gKey && (
                            <RedirectChoices targets={targetsFor(g.kitchen, g.kitchen?.printer_ip || '')}
                              onPick={t => sendToPrinter(realFails, t, true)} onClose={() => setRedirectFor(null)} />
                          )}
                        </div>
                      )}
                      {g.list.map(k => {
                        const kitchen = kitchenById.get(k.kitchen_id)
                        return (
                          <FailedItem key={k.id} k={k} kitchen={kitchen} kitchens={kitchens}
                            act={actionState(k, pend[k.id], now, nowS)} nowS={nowS}
                            redirectOpen={redirectFor === k.id}
                            targets={redirectFor === k.id ? targetsFor(kitchen, targetIp(k, kitchen)) : []}
                            onReprint={x => sendToPrinter([x], null, true)}
                            onRedirect={(x, t) => sendToPrinter([x], t, true)}
                            onToggleRedirect={id => setRedirectFor(r => (id == null || r === id) ? null : id)}
                            onDismiss={dismissTest} />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Filters ── */}
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', flexShrink:0 }}>
            {VIEWS.map(([val, label]) => {
              const on = view === val
              const n = list.counts[val]
              const red = val === 'failed' && n > 0
              return (
                <button key={val} className="kb-btn" onClick={() => setView(val)}
                  style={{ ...btnBase, padding:'7px 13px', fontSize:13, borderRadius:10,
                    background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)',
                    border:'1.5px solid ' + (on ? 'var(--ink)' : 'var(--line)') }}>
                  {label}
                  <span style={{ marginLeft:6, fontSize:11, fontWeight:900, borderRadius:999, padding:'0 6px',
                    background: red ? TONE.red.dot : on ? 'rgba(255,255,255,0.18)' : 'var(--bg)',
                    color: red ? '#fff' : on ? '#fff' : 'var(--ink2)' }}>{n}</span>
                </button>
              )
            })}
            <div style={{ display:'flex', alignItems:'center', background:'#fff', border:'1.5px solid ' + (tableQ ? DARK : 'var(--line)'),
              borderRadius:10, padding:'0 4px 0 10px', height:35, marginLeft:4 }}>
              <span style={{ fontSize:12, fontWeight:800, color:'var(--ink2)', marginRight:4 }}>Table</span>
              <input value={tableQ} inputMode="numeric" placeholder="no."
                onChange={e => setTableQ(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onKeyDown={e => { if (e.key === 'Escape') setTableQ('') }}
                style={{ width:54, border:'none', outline:'none', fontSize:14, fontWeight:800, fontFamily:'Manrope, sans-serif',
                  background:'transparent', color:'var(--ink)' }} />
              {tableQ && <button onClick={() => setTableQ('')} title="Clear table search"
                style={{ border:'none', background:'var(--bg)', borderRadius:7, width:24, height:24, fontSize:13, fontWeight:900, color:'var(--ink2)', cursor:'pointer' }}>{'✕'}</button>}
            </div>
            {selKitchen && (
              <span style={{ display:'inline-flex', alignItems:'center', gap:6, background:DARK, color:MARI, borderRadius:10,
                padding:'0 6px 0 11px', height:35, fontSize:13, fontWeight:800 }}>
                {selKitchen.name + ' only'}
                <button onClick={() => setKitchenFilter(null)} title="Show all kitchens"
                  style={{ border:'none', background:'rgba(255,255,255,0.14)', color:'#fff', borderRadius:7, width:24, height:24, fontSize:13, fontWeight:900, cursor:'pointer' }}>{'✕'}</button>
              </span>
            )}
          </div>

          {/* ── KOT list ── */}
          <div style={{ background:'#fff', borderRadius:14, boxShadow:'var(--shadow)', overflow:'hidden',
            flex: fixed ? '1 1 0' : 'none', minHeight: fixed ? 140 : 0, display:'flex', flexDirection:'column' }}>
            <div style={{ overflowY: fixed ? 'auto' : 'visible', overflowX:'hidden', flex:1, minHeight:0, WebkitOverflowScrolling:'touch' }}>
              <div className="kb-grid kb-head">
                <div>KOT</div><div>Kitchen</div><div>Table</div><div>Items</div><div>Captain</div>
                <div>Age</div><div>Print</div><div>Delivery</div><div style={{ textAlign:'right' }}>Actions</div>
              </div>
              {list.rows.length === 0 ? (
                <div style={{ padding:'34px 20px', textAlign:'center', color:'var(--ink2)', fontWeight:700, fontSize:14 }}>
                  {emptyText(view, tableNum, selKitchen)}
                </div>
              ) : list.rows.map(k => {
                const p = pend[k.id]
                const live = k.status === 'open' || k.print_status === 'queued' || k.print_status === 'printing'
                return (
                  <KotRow key={k.id} k={k} nowS={live ? listNowS : 0} kitchens={kitchens} own={kitchenById.get(k.kitchen_id)}
                    act={p ? actionStateRow(k, p, now, nowS) : null} confirming={confirmId === k.id}
                    onReprint={onRowReprint} onDeliver={onDeliverClick} onTable={onTable} />
                )
              })}
            </div>
          </div>

          {/* ── Footer: what is shown, and how fresh it is ── */}
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12, color:'var(--ink2)', fontWeight:600,
            flexShrink:0, paddingRight:170, minHeight:22 }}>
            <span>
              {list.capped
                ? 'Showing the latest ' + CLOSED_CAP + ' of ' + list.total.toLocaleString() + ' – type a table number to find older KOTs'
                : 'Showing ' + list.total + (list.total === 1 ? ' KOT' : ' KOTs')}
            </span>
            <span>{'·'}</span>
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, color: online ? 'var(--ink2)' : TONE.red.fg, fontWeight: online ? 600 : 800 }}>
              <Dot tone={online ? (rt === 'SUBSCRIBED' ? 'green' : 'amber') : 'red'} size={7} />
              {online
                ? (rt === 'SUBSCRIBED' ? 'Live' : 'Live link down, checking every 4 s') + ' · synced ' + agoText(syncAge)
                : 'Not connected · last synced ' + agoText(syncAge)}
            </span>
            {Math.abs(skew) > 30000 && (
              <span title="Timers on this board are corrected for it">
                {'· Laptop clock is ' + Math.round(Math.abs(skew) / 60000) + ' min ' + (skew > 0 ? 'slow' : 'fast')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// Row actions only show reprint/deliver states raised from the row itself or
// the panel; a dismiss is panel-only.
function actionStateRow(k, p, now, nowS) {
  if (p.kind === 'dismiss') return null
  const s = actionState(k, p, now, nowS)
  return s ? { ...s, kind:p.kind } : null
}

function emptyText(view, tableNum, kitchen) {
  const where = (kitchen ? ' for ' + kitchen.name : '') + (tableNum != null ? ' on table ' + tableNum : '')
  if (view === 'open') return 'No open KOTs' + where + ' – all caught up.'
  if (view === 'failed') return 'No failed prints' + where + '.'
  if (view === 'delivered') return 'Nothing delivered yet' + where + '.'
  if (view === 'cancelled') return 'No cancelled KOTs' + where + '.'
  return 'No KOTs yet' + where + '.'
}

function HubPill({ hub, hubAge }) {
  const cfg = {
    ok:      { tone:'green', text:'Print Hub active · last seen ' + agoText(hubAge) },
    slow:    { tone:'amber', text:'Print Hub running, KOTs waiting' },
    down:    { tone:'red',   text:'Print Hub not running' },
    idle:    { tone:'grey',  text: Number.isFinite(hubAge) ? 'Print Hub last seen ' + agoText(hubAge) + ' · nothing waiting' : 'Print Hub not seen yet · nothing waiting' },
    unknown: { tone:'grey',  text:'Print Hub status unknown' },
  }[hub]
  const t = TONE[cfg.tone]
  return (
    <span title={hub === 'idle' ? 'Nothing is waiting to print, so the hub has had nothing to do. Make sure it is running before orders start.' : undefined}
      style={{ display:'inline-flex', alignItems:'center', gap:7, background:t.bg, border:'1px solid ' + t.bd, color:t.fg,
        borderRadius:999, padding:'6px 12px', fontSize:12, fontWeight:800, whiteSpace:'nowrap' }}>
      <Dot tone={cfg.tone} pulse={hub === 'down'} />
      {cfg.text}
    </span>
  )
}

function Banner({ tone, icon, title, sub }) {
  const red = tone === 'red'
  return (
    <div role="alert" style={{ flexShrink:0, borderRadius:12, padding:'10px 14px', display:'flex', alignItems:'center', gap:12,
      background: red ? TONE.red.dot : TONE.amber.bg, color: red ? '#fff' : '#92400E',
      border: red ? 'none' : '1px solid ' + TONE.amber.bd,
      boxShadow: red ? '0 4px 20px rgba(220,38,38,0.35)' : 'none' }}>
      {icon && <span style={{ fontSize:24, lineHeight:1 }}>{icon}</span>}
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:15, fontWeight:900 }}>{title}</div>
        {sub && <div style={{ fontSize:12, fontWeight:600, opacity: red ? 0.92 : 1, marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  )
}
