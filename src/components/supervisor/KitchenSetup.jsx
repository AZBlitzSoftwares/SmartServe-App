import { useState, useEffect, useRef, useMemo } from 'react'
import MaestroSetup, { MaestroPreService } from '../../maestro/MaestroSetup'
import { supabase } from '../../lib/supabase'
import { tableRanges } from '../../maestro/msData'
import { useKitInfo, mb } from '../../lib/kitInfo'

/* Kitchens set-up for a Captain + Multi-Kitchen event.

   Everything the floor needs before the first order, on one screen and in
   the order it is done: chairs, kitchens and their printers, which kitchen
   cooks each menu category, which table each captain stands at, and which
   kitchen each waiter carries for. The checklist at the top is worked out
   from the same data on every change, so "is this event ready?" never needs
   a second screen or a refresh.

   Every change goes straight to Supabase and shows at once; a failed write
   is put back on screen with the reason beside it. No browser dialogs: a
   confirm() on a kiosk tablet blocks the whole page and is easy to dismiss
   by accident.

   Captains and waiters are created under Control › Captains / Waiters. This
   screen only links them. */

const QUICK_CUISINES = ['Indian', 'Arabic', 'Chinese', 'Italian', 'Mexican', 'Turkish', 'Continental', 'Desserts', 'Bar']
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const STATUS_POLL_MS = 10000   // printer health is written by the Print Hub; re-read it this often
const TEST_POLL_MS   = 1500
const TEST_STUCK_MS  = 15000   // a running Print Hub claims a job within a few seconds
const TEST_GIVEUP_MS = 120000
const ACTIVE_TEST = new Set(['sending', 'printing', 'stuck'])

const GREEN = '#16A34A', RED = '#DC2626', MARI = '#E8890C'
const AMBER_BG = '#FEF3C7', AMBER_LINE = '#FCD34D', AMBER_INK = '#92400E'

const card  = { background:'#fff', borderRadius:12, padding:'14px 16px', marginBottom:12, boxShadow:'var(--shadow)' }
const label = { fontSize:11, fontWeight:800, color:'var(--ink2)', textTransform:'uppercase', letterSpacing:'0.4px' }
const hint  = { fontSize:12, color:'var(--ink2)', lineHeight:1.5 }
const input = { height:38, width:'100%', border:'1.5px solid var(--line)', borderRadius:9, padding:'0 10px',
  fontSize:14, fontWeight:700, fontFamily:'Manrope', color:'var(--ink)', background:'#fff',
  outline:'none', boxSizing:'border-box' }
const btn = { height:38, padding:'0 16px', borderRadius:9, border:'none', background:'var(--ink)', color:'#fff',
  fontSize:13, fontWeight:800, fontFamily:'Manrope', cursor:'pointer', whiteSpace:'nowrap' }
const ghost = { ...btn, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)' }
const small = { height:30, padding:'0 11px', fontSize:12, borderRadius:8 }

/* ---------------------------------------------------------------- helpers */

// Supabase errors are written for developers; the floor needs to know whether to retry.
function errText(error, verb = 'saved') {
  const m = error?.message || String(error || '')
  if (/fetch|network|offline|timeout/i.test(m)) return 'No connection — not ' + verb + '. Check the Wi-Fi and try again.'
  return 'Not ' + verb + ': ' + (m || 'unknown error')
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'))

function listNames(rows, key = 'name', max = 3) {
  const names = rows.map(r => r[key])
  return names.length <= max ? names.join(', ') : names.slice(0, max).join(', ') + ' and ' + (names.length - max) + ' more'
}

// "1, 2, 3, 5, 7, 8" -> "1–3, 5, 7–8": a 50-table event stays one line
function ranges(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < s.length; i++) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? s[i] + '–' + s[j] : String(s[i]))
    i = j
  }
  return out.join(', ')
}

// Kitchen order drives the default fallback, dropdowns and the KOT board
function sortKitchens(list) {
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || String(a.name || '').localeCompare(String(b.name || '')))
}

/* The kitchen that really receives unrouted dishes. Mirrors the query in
   mk_place_order exactly (active, is_default first, then sort order), so the
   screen never names a different kitchen from the one that will print. */
function effectiveDefault(kitchens) {
  const act = kitchens.filter(k => k.is_active)
  return [...act].sort((a, b) => (b.is_default === true) - (a.is_default === true)
    || (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null
}

// Same natural sort as the captain and waiter lists: 2 before 10
function naturalBy(field) {
  const num = r => { const m = String(r[field] || '').match(/\d+/); return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER }
  return (a, b) => num(a) - num(b) || String(a[field] || '').localeCompare(String(b[field] || ''))
}

/* KOT prefix from the name: first two letters, as asked. When those are
   taken (Chinese after Chaat), the first three, then the first letter with
   each later one, so the suggestion is always free and still readable. */
function suggestPrefix(name, taken) {
  const L = String(name || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (L.length < 2) return L
  const cands = [L.slice(0, 2)]
  if (L.length >= 3) cands.push(L.slice(0, 3))
  for (let i = 2; i < L.length; i++) cands.push(L[0] + L[i])
  for (let i = 3; i < L.length; i++) cands.push(L.slice(0, 2) + L[i])
  return cands.find(p => !taken.has(p)) || L.slice(0, 2)
}

// Whole-word match, so a "Bar" kitchen never swallows "Barbecue"; plural-tolerant
function wordsIn(hay, needle) {
  const norm = s => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' '
  const sing = s => s.replace(/([a-z]{3,})s /g, '$1 ')
  const h = norm(hay), n = norm(needle)
  if (n.trim().length < 2) return false
  return h.includes(n) || sing(h).includes(sing(n))
}

function randomPins(n, used) {
  const taken = new Set(used)
  const out = []
  let guard = 0
  while (out.length < n && guard++ < 50000) {
    const p = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    // Skip 1111 / 1234-style PINs: a waiter guessing a colleague's should not be one try away
    if (taken.has(p) || /^(\d)\1{3}$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p)) continue
    taken.add(p); out.push(p)
  }
  return out
}

// "Ravi (07)" is how the waiter list stores a named waiter; show the two parts apart
const waiterName = w => {
  const n = (w.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  return n === (w.waiter_number || '') ? '' : n
}

function agoText(iso, now) {
  if (!iso) return null
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 90) return s + ' s ago'
  if (s < 5400) return Math.round(s / 60) + ' min ago'
  return Math.round(s / 3600) + ' h ago'
}

/* Saved ticks: a small ✓ beside a row for a moment after its write lands */
function useTicks() {
  const [ticks, setTicks] = useState({})
  function tick(id) {
    setTicks(p => ({ ...p, [id]: true }))
    setTimeout(() => setTicks(p => { const n = { ...p }; delete n[id]; return n }), 1800)
  }
  return [ticks, tick]
}

/* --------------------------------------------------------- small pieces */

function Banner({ tone = 'err', children, onClose, style }) {
  const t = {
    err:  { bg:'#FEF2F2', line:'#FECACA', ink:'#B91C1C' },
    ok:   { bg:'#DCFCE7', line:'#86EFAC', ink:'#15803D' },
    warn: { bg:AMBER_BG,  line:AMBER_LINE, ink:AMBER_INK },
    info: { bg:'#EFF6FF', line:'#BFDBFE', ink:'#1d4ed8' },
  }[tone]
  return (
    <div style={{ background:t.bg, border:'1px solid ' + t.line, color:t.ink, borderRadius:10,
      padding:'8px 12px', fontSize:12.5, fontWeight:700, lineHeight:1.5, marginBottom:10,
      display:'flex', alignItems:'flex-start', gap:10, ...style }}>
      <div style={{ flex:1, minWidth:0 }}>{children}</div>
      {onClose && (
        <button onClick={onClose} title="Dismiss" style={{ background:'none', border:'none', color:t.ink,
          fontSize:16, lineHeight:1, cursor:'pointer', padding:0, fontWeight:800 }}>&times;</button>
      )}
    </div>
  )
}

function SectionHead({ step, title, sub, right }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:12, flexWrap:'wrap' }}>
      <div style={{ flex:'1 1 280px', minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <span style={{ width:24, height:24, borderRadius:'50%', background:'var(--ink)', color:'#fff',
            fontSize:12, fontWeight:900, display:'inline-flex', alignItems:'center', justifyContent:'center',
            flexShrink:0 }}>{step}</span>
          <span style={{ fontSize:16, fontWeight:800 }}>{title}</span>
        </div>
        {sub && <div style={{ ...hint, marginTop:4, paddingLeft:33 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

function Switch({ on, onChange, disabled, title }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!on)} disabled={disabled} title={title}
      aria-pressed={on}
      style={{ width:46, height:26, borderRadius:999, border:'none', position:'relative', flexShrink:0,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
        background: on ? GREEN : '#D1D5DB', transition:'background 0.2s' }}>
      <span style={{ position:'absolute', top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:'50%',
        background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }} />
    </button>
  )
}

// Sits at the end of a row's status line, so it costs no width when it is not there
const Saved = ({ show }) => show
  ? <span style={{ color:GREEN, fontWeight:800, marginLeft:6, whiteSpace:'nowrap' }}>✓ Saved</span>
  : null

/* ================================================================ screen */

export default function KitchenSetup({ eventData, onEventChange }) {
  const eventId = eventData?.id
  // Loading is "the data on screen is not for this event yet", so switching events shows it too
  const [loadedFor, setLoadedFor] = useState(null)
  const [loadErr, setLoadErr]   = useState('')
  const [kitchens, setKitchens] = useState([])
  const [cats, setCats]         = useState([])
  const [itemCounts, setItemCounts] = useState({})
  const [captains, setCaptains] = useState([])
  const [waiters, setWaiters]   = useState([])
  const [now, setNow]           = useState(() => Date.now())
  const loadSeq = useRef(0)
  const [maestroNonce, setMaestroNonce] = useState(0)

  useEffect(() => { load() }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Printer health comes from the Print Hub on the desk laptop, not from
     anything done here, so it is re-read on a timer. Only the two status
     fields are merged in: a whole-row refresh could undo an edit that is
     still on its way to the server. */
  useEffect(() => {
    if (!eventId) return
    const t = setInterval(async () => {
      setNow(Date.now())
      const { data, error } = await supabase.from('kitchens')
        .select('id, printer_status, printer_checked_at').eq('event_id', eventId)
      if (error || !data) return
      const m = new Map(data.map(r => [r.id, r]))
      setKitchens(prev => prev.map(k => m.has(k.id)
        ? { ...k, printer_status: m.get(k.id).printer_status, printer_checked_at: m.get(k.id).printer_checked_at }
        : k))
    }, STATUS_POLL_MS)
    return () => clearInterval(t)
  }, [eventId])

  async function load() {
    if (!eventId) return
    const forEvent = eventId
    // A slow answer for the previous event must not land on this one
    const seq = ++loadSeq.current
    setLoadErr('')
    const [k, c, cp, w] = await Promise.all([
      supabase.from('kitchens').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('menu_categories').select('id, event_id, name, sort_order, is_visible, kitchen_id')
        .eq('event_id', eventId).order('sort_order'),
      supabase.from('captains').select('*')
        .eq('event_id', eventId).eq('is_active', true),
      supabase.from('waiters').select('id, waiter_number, name, is_active, kitchen_id, pin')
        .eq('event_id', eventId).eq('is_active', true),
    ])
    if (seq !== loadSeq.current) return
    const bad = [k, c, cp, w].find(r => r.error)
    if (bad) {
      setLoadErr(bad.error.message || 'Could not load')
      setLoadedFor(forEvent)
      return
    }
    const catRows = c.data || []
    let counts = {}
    if (catRows.length) {
      // Only category_id is fetched: the count is all this screen needs
      const { data: items } = await supabase.from('menu_items').select('category_id')
        .in('category_id', catRows.map(x => x.id))
      if (seq !== loadSeq.current) return
      ;(items || []).forEach(i => { counts[i.category_id] = (counts[i.category_id] || 0) + 1 })
    }
    setKitchens(k.data || [])
    setCats(catRows)
    setItemCounts(counts)
    setCaptains([...(cp.data || [])].sort(naturalBy('name')))
    setWaiters([...(w.data || [])].sort(naturalBy('waiter_number')))
    setNow(Date.now())
    setLoadedFor(forEvent)
  }

  const sortedKitchens = useMemo(() => sortKitchens(kitchens), [kitchens])
  const defaultKitchen = useMemo(() => effectiveDefault(kitchens), [kitchens])
  const tableCount = eventData?.number_of_tables || null

  const checks = useMemo(() => {
    const active = kitchens.filter(k => k.is_active)
    const activeIds = new Set(active.map(k => k.id))
    const out = []

    out.push({ key:'kitchens', target:'ks-kitchens', title:'Kitchens', ok: active.length > 0,
      detail: active.length ? plural(active.length, 'kitchen') + ' ready to take KOTs'
        : kitchens.length ? 'Every kitchen is switched off — orders cannot be placed'
        : 'No kitchens yet — add one in step 2' })

    const noIp = sortKitchens(active).filter(k => !IPV4.test(String(k.printer_ip || '').trim()))
    out.push({ key:'printers', target:'ks-kitchens', title:'Printers', ok: active.length > 0 && noIp.length === 0,
      detail: !active.length ? 'Add a kitchen first'
        : noIp.length ? 'No printer IP: ' + listNames(noIp)
        : 'Every kitchen has a printer IP' })

    const visible = cats.filter(x => x.is_visible !== false)
    const unrouted = visible.filter(x => !activeIds.has(x.kitchen_id))
    out.push({ key:'routing', target:'ks-routing', title:'Menu routing', ok: visible.length > 0 && unrouted.length === 0,
      detail: !visible.length ? 'No menu categories yet — add the menu under Menu'
        : !unrouted.length ? 'All ' + plural(visible.length, 'category', 'categories') + ' go to a kitchen'
        : defaultKitchen
          ? plural(unrouted.length, 'category', 'categories') + ' go to the default kitchen ' + defaultKitchen.name
          : plural(unrouted.length, 'category', 'categories') + ' have no kitchen' })

    const noTable = captains.filter(x => !x.table_number)
    out.push({ key:'captains', target:'ks-captains', title:'Captains', ok: captains.length > 0 && noTable.length === 0,
      detail: !captains.length ? 'No captains yet — add them in Captains below'
        : !noTable.length ? 'All ' + plural(captains.length, 'captain') + ' linked to a table'
        : noTable.length <= 2 ? listNames(noTable) + (noTable.length === 1 ? ' has' : ' have') + ' no table'
        : plural(noTable.length, 'captain') + ' have no table' })

    const noKitchen = waiters.filter(x => !activeIds.has(x.kitchen_id))
    const noPin = waiters.filter(x => !/^\d{4}$/.test(String(x.pin || '')))
    const bits = []
    if (noKitchen.length) bits.push(noKitchen.length + ' without a kitchen')
    if (noPin.length) bits.push(noPin.length + ' without a PIN')
    out.push({ key:'waiters', target:'ks-waiters', title:'Waiters', ok: waiters.length > 0 && !bits.length,
      detail: !waiters.length ? 'No waiters yet — add them in Waiters below'
        : bits.length ? bits.join(' · ')
        : 'All ' + plural(waiters.length, 'waiter') + ' have a kitchen and a PIN' })
    return out
  }, [kitchens, cats, captains, waiters, defaultKitchen])

  if (!eventId) return null

  if (loadedFor !== eventId) return (
    <div style={{ padding:40, textAlign:'center', color:'var(--ink2)', fontSize:14 }}>Loading kitchen set-up…</div>
  )

  if (loadErr) return (
    <div style={card}>
      <Banner tone="err" style={{ marginBottom:12 }}>
        Could not load the kitchen set-up: {loadErr}
        <div style={{ fontWeight:600, marginTop:4 }}>
          If this mentions kitchens, kitchen_id, table_number or pin, the multi-kitchen database
          update (db/2026-10-07_multikitchen.sql) has not been run on this database yet.
        </div>
      </Banner>
      <button onClick={load} style={btn}>Try again</button>
    </div>
  )

  return (
    // Keyed on the event so open forms and running test prints never carry over to another event
    <div key={eventId}>
      <style>{CSS}</style>
      {/* ss-maestro: Maestro events have their own pre-service check (barkers
          instead of waiters, courses, printers confirmed by the Print Hub) */}
      {eventData?.maestro
        ? <MaestroPreService eventData={eventData} nonce={maestroNonce} />
        : <Readiness checks={checks} onReload={load} />}
      <ChairsCard eventData={eventData} onEventChange={onEventChange} />
      <KitchensSection eventId={eventId} maestro={!!eventData?.maestro} kitchens={sortedKitchens} setKitchens={setKitchens}
        cats={cats} setCats={setCats} waiters={waiters} setWaiters={setWaiters}
        defaultKitchen={defaultKitchen} now={now} />
      <RoutingSection cats={cats} setCats={setCats} kitchens={sortedKitchens}
        itemCounts={itemCounts} defaultKitchen={defaultKitchen} />
      {eventData?.maestro && (
        <MaestroSetup eventData={eventData} onEventChange={onEventChange} onChanged={() => setMaestroNonce(n => n + 1)}
          refreshKey={sortedKitchens.map(k => [k.id, k.name, k.prefix, k.is_active, k.is_default].join(':')).join('|')
            + '#' + cats.map(c => c.id + ':' + (c.kitchen_id || '')).join('|')} />
      )}
      <CaptainsSection eventId={eventId} step={4} captains={captains} setCaptains={setCaptains} tableCount={tableCount}
        coverCount={Math.max(1, Number(eventData?.chairs_per_table) || 10)} maestro={!!eventData?.maestro} />
      {!eventData?.maestro && <WaitersSection eventId={eventId} waiters={waiters} setWaiters={setWaiters} kitchens={sortedKitchens} />}
    </div>
  )
}

const CSS = `
  .ks-ready  { display:grid; grid-template-columns:repeat(auto-fit, minmax(178px, 1fr)); gap:8px; }
  .ks-kgrid  { display:grid; gap:8px 16px; align-items:center;
    grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,1.5fr) 220px;
    grid-template-areas:"name printer status test actions"; }
  .ks-c-name { grid-area:name } .ks-c-printer { grid-area:printer } .ks-c-status { grid-area:status }
  .ks-c-test { grid-area:test } .ks-c-actions { grid-area:actions; justify-content:flex-end }
  .ks-kform  { display:grid; gap:10px 12px;
    grid-template-columns:minmax(0,1.5fr) minmax(0,0.6fr) minmax(0,1.3fr) minmax(0,0.5fr) minmax(0,1.3fr);
    grid-template-areas:"name prefix ip port backup"; }
  .ks-f-name { grid-area:name } .ks-f-prefix { grid-area:prefix } .ks-f-ip { grid-area:ip }
  .ks-f-port { grid-area:port } .ks-f-backup { grid-area:backup }
  .ks-cats   { display:grid; grid-template-columns:repeat(auto-fill, minmax(400px, 1fr)); gap:8px; }
  .ks-caps   { display:grid; grid-template-columns:repeat(auto-fill, minmax(350px, 1fr)); gap:8px; }
  .ks-wtrs   { display:grid; grid-template-columns:repeat(auto-fill, minmax(400px, 1fr)); gap:8px; }
  .ks-row:focus-within { border-color: var(--ink2) !important; }
  @media (max-width: 1279px) {
    .ks-kgrid { grid-template-columns:minmax(0,1.2fr) minmax(0,1.1fr) minmax(0,1fr);
      grid-template-areas:"name printer status" "test test actions"; }
  }
  @media (max-width: 1100px) {
    .ks-kform { grid-template-columns:repeat(4, minmax(0,1fr));
      grid-template-areas:"name name prefix port" "ip ip backup backup"; }
  }
  @media (max-width: 760px) {
    .ks-kgrid { grid-template-columns:1fr; grid-template-areas:"name" "printer" "status" "test" "actions"; }
    .ks-c-actions { justify-content:flex-start }
    .ks-kform { grid-template-columns:1fr 1fr;
      grid-template-areas:"name name" "prefix port" "ip ip" "backup backup"; }
    .ks-cats, .ks-wtrs { grid-template-columns:1fr; }
  }
`

/* ------------------------------------------------------------ readiness */

function Readiness({ checks, onReload }) {
  const failing = checks.filter(c => !c.ok).length
  const ready = failing === 0
  const jump = id => document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' })
  return (
    <div id="ks-ready" style={{ ...card, borderTop:'4px solid ' + (ready ? GREEN : MARI) }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, flexWrap:'wrap' }}>
        <div style={{ flex:'1 1 240px', minWidth:0 }}>
          <div style={label}>Before service</div>
          <div style={{ fontSize:18, fontWeight:900, marginTop:2, color: ready ? GREEN : 'var(--ink)' }}>
            {ready ? '✓ Ready for service' : plural(failing, 'thing') + ' to finish before service'}
          </div>
        </div>
        <button onClick={onReload} style={{ ...ghost, ...small }} title="Read everything again from the server">Reload</button>
      </div>
      <div className="ks-ready">
        {checks.map(c => (
          <button key={c.key} onClick={() => jump(c.target)}
            title="Go to this step"
            style={{ textAlign:'left', fontFamily:'Manrope', cursor:'pointer', borderRadius:10,
              padding:'9px 11px', display:'flex', gap:9, alignItems:'flex-start',
              background: c.ok ? '#F0FDF4' : '#FEF2F2',
              border:'1.5px solid ' + (c.ok ? '#BBF7D0' : '#FECACA') }}>
            <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, marginTop:1,
              background: c.ok ? GREEN : RED, color:'#fff', fontSize:13, fontWeight:900,
              display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{c.ok ? '✓' : '✗'}</span>
            <span style={{ minWidth:0 }}>
              <span style={{ display:'block', fontSize:13, fontWeight:800, color:'var(--ink)' }}>{c.title}</span>
              <span style={{ display:'block', fontSize:12, fontWeight:600, lineHeight:1.4, marginTop:1,
                color: c.ok ? '#15803D' : '#B91C1C' }}>{c.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- chairs per table */

function ChairsCard({ eventData, onEventChange }) {
  const current = eventData?.chairs_per_table ?? 10
  const [draft, setDraft] = useState(String(current))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // When the saved value changes (here or on another screen) the box follows it
  const [shown, setShown] = useState(current)
  if (shown !== current) { setShown(current); setDraft(String(current)) }

  const v = parseInt(draft, 10)
  const valid = /^\d+$/.test(draft) && v >= 1 && v <= 20
  const dirty = valid && v !== current

  async function save() {
    if (!valid) { setMsg({ tone:'err', text:'Enter a number from 1 to 20.' }); return }
    if (!dirty) return
    setSaving(true); setMsg(null)
    // Shown straight away: captains' chair pickers follow the event row
    onEventChange?.({ ...eventData, chairs_per_table: v })
    const { data, error } = await supabase.from('events').update({ chairs_per_table: v })
      .eq('id', eventData.id).select().single()
    setSaving(false)
    if (error) {
      onEventChange?.({ ...eventData, chairs_per_table: current })
      setDraft(String(current))
      setMsg({ tone:'err', text: errText(error) })
      return
    }
    if (data) onEventChange?.(data)
    setMsg({ tone:'ok', text:'Saved — ' + v + ' chairs at every table' })
    setTimeout(() => setMsg(null), 2500)
  }

  const step = d => setDraft(String(Math.min(20, Math.max(1, (parseInt(draft, 10) || current) + d))))
  const sq = { width:38, height:40, borderRadius:10, border:'1.5px solid var(--line)', background:'#fff',
    fontSize:18, fontWeight:800, cursor:'pointer', color:'var(--ink)' }

  return (
    <div style={card} id="ks-chairs">
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:'1 1 280px', minWidth:0 }}>
          <SectionHead step={1} title={eventData?.maestro ? 'Covers per table' : 'Chairs per table'}
            sub={(eventData?.maestro
                ? 'Captains take the order cover by cover, C1 to C' + (valid ? v : current) + '. '
                : 'Captains pick chairs 1 to ' + (valid ? v : current) + ' when they take an order. ')
              + (eventData?.number_of_tables ? 'Tables at this event: ' + eventData.number_of_tables + ' (change under Tables, at the bottom of this page).' : '')} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0, marginBottom:12 }}>
          <button onClick={() => step(-1)} disabled={saving} style={sq} title="One fewer">−</button>
          <input value={draft} inputMode="numeric" disabled={saving}
            onChange={e => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={e => { if (e.key === 'Enter') save() }}
            style={{ ...input, width:64, height:40, textAlign:'center', fontSize:17, fontWeight:900,
              borderColor: valid ? 'var(--line)' : RED }} />
          <button onClick={() => step(1)} disabled={saving} style={sq} title="One more">+</button>
          <button onClick={save} disabled={saving || !dirty}
            style={{ ...btn, height:40, background: dirty ? 'var(--ink)' : '#E5E7EB', color: dirty ? '#fff' : '#9CA3AF',
              cursor: dirty ? 'pointer' : 'default' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {msg && <Banner tone={msg.tone} style={{ marginBottom:0 }} onClose={() => setMsg(null)}>{msg.text}</Banner>}
    </div>
  )
}

/* ------------------------------------------------------------- kitchens */

const PRINTER = {
  online:    { label:'Online',    color:GREEN,     bg:'#DCFCE7' },
  offline:   { label:'Offline',   color:RED,       bg:'#FEF2F2' },
  paper_out: { label:'Paper out', color:RED,       bg:'#FEF2F2' },
  paper_low: { label:'Paper low', color:AMBER_INK, bg:AMBER_BG },
  unknown:   { label:'Unknown',   color:'#6B7280', bg:'#F3F4F6' },
}

const emptyForm = () => ({ mode:'add', id:null, name:'', prefix:'', prefixTouched:false,
  printer_ip:'', printer_port:'9100', backup_printer_ip:'', is_default:false, is_active:true })

function validateKitchen(f, kitchens) {
  const e = {}
  const others = kitchens.filter(k => k.id !== f.id)
  const name = f.name.trim()
  if (!name) e.name = 'Enter a name, e.g. Italian'
  else if (others.some(k => String(k.name || '').trim().toLowerCase() === name.toLowerCase()))
    e.name = 'There is already a kitchen called ' + name
  const p = f.prefix.trim().toUpperCase()
  if (!/^[A-Z]{2,3}$/.test(p)) e.prefix = '2 or 3 letters, e.g. IT'
  else {
    const clash = others.find(k => String(k.prefix || '').toUpperCase() === p)
    if (clash) e.prefix = clash.name + ' already uses ' + p
  }
  const ip = f.printer_ip.trim()
  if (ip && !IPV4.test(ip)) e.printer_ip = 'Not an IP address — e.g. 192.168.1.104'
  const port = Number(f.printer_port)
  if (!/^\d+$/.test(String(f.printer_port).trim()) || port < 1 || port > 65535) e.printer_port = '1–65535, usually 9100'
  const b = f.backup_printer_ip.trim()
  if (b && !IPV4.test(b)) e.backup_printer_ip = 'Not an IP address'
  else if (b && b === ip) e.backup_printer_ip = 'Same as the main printer'
  return e
}

function KitchensSection({ eventId, maestro, kitchens, setKitchens, setCats, waiters, setWaiters, cats, defaultKitchen, now }) {
  const [form, setForm]       = useState(null)
  const [tried, setTried]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [formErr, setFormErr] = useState('')
  const [confirm, setConfirm] = useState(null)   // { id, checking, kots }
  const [msg, setMsg]         = useState(null)
  const [tests, setTests]     = useState({})     // kitchen id -> { phase, kotId, started, error }
  const testsRef = useRef(tests)
  useEffect(() => { testsRef.current = tests }, [tests])

  const takenPrefixes = id => new Set(kitchens.filter(k => k.id !== id).map(k => String(k.prefix || '').toUpperCase()))

  function openAdd(name = '') {
    const f = emptyForm()
    f.name = name
    f.prefix = suggestPrefix(name, takenPrefixes(null))
    // The first kitchen is the default: someone has to receive unrouted dishes
    f.is_default = !kitchens.some(k => k.is_active)
    setForm(f); setTried(false); setFormErr(''); setConfirm(null)
  }

  function openEdit(k) {
    setForm({ mode:'edit', id:k.id, name:k.name || '', prefix:k.prefix || '', prefixTouched:true,
      printer_ip:k.printer_ip || '', printer_port:String(k.printer_port ?? 9100),
      backup_printer_ip:k.backup_printer_ip || '', is_active:k.is_active !== false,
      // The kitchen that really gets unrouted dishes, even if no row is flagged yet;
      // saving it writes the flag down
      is_default: defaultKitchen?.id === k.id, wasDefault: defaultKitchen?.id === k.id })
    setTried(false); setFormErr(''); setConfirm(null)
  }

  function setField(field, value) {
    setForm(f => {
      const next = { ...f, [field]: value }
      if (field === 'name' && !f.prefixTouched) next.prefix = suggestPrefix(value, takenPrefixes(f.id))
      if (field === 'prefix') { next.prefix = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3); next.prefixTouched = true }
      if (field === 'printer_port') next.printer_port = value.replace(/\D/g, '').slice(0, 5)
      return next
    })
  }

  /* Exactly one default. The new one is set first and the others cleared
     after, so there is never a moment with no default at all. */
  async function makeDefault(id) {
    // Only the flags are put back on failure: a row added a moment ago must stay on screen
    const flags = new Map(kitchens.map(k => [k.id, !!k.is_default]))
    setKitchens(prev => prev.map(k => ({ ...k, is_default: k.id === id })))
    const a = await supabase.from('kitchens').update({ is_default:true }).eq('id', id)
    const b = a.error ? a : await supabase.from('kitchens').update({ is_default:false }).eq('event_id', eventId).neq('id', id)
    if (a.error || b.error) {
      setKitchens(prev => prev.map(k => flags.has(k.id) ? { ...k, is_default: flags.get(k.id) } : k))
      setMsg({ tone:'err', text: errText(a.error || b.error) })
      return false
    }
    return true
  }

  // Where the default goes when the current default is switched off or deleted
  const nextDefaultFor = id => kitchens.find(k => k.id !== id && k.is_active) || null

  async function saveForm() {
    setTried(true)
    const errs = validateKitchen(form, kitchens)
    if (Object.keys(errs).length) return
    setSaving(true); setFormErr('')
    const payload = {
      name: form.name.trim(), prefix: form.prefix.trim().toUpperCase(),
      printer_ip: form.printer_ip.trim() || null, printer_port: Number(form.printer_port) || 9100,
      backup_printer_ip: form.backup_printer_ip.trim() || null,
      is_active: form.is_active,
      // Switching off the default hands the role on (below) rather than leaving an inactive default
      is_default: form.is_default && form.is_active,
    }
    let row, error
    if (form.mode === 'add') {
      const maxOrder = kitchens.reduce((m, k) => Math.max(m, k.sort_order ?? 0), 0)
      ;({ data: row, error } = await supabase.from('kitchens')
        .insert({ ...payload, event_id: eventId, sort_order: maxOrder + 1 }).select().single())
    } else {
      // A printer typed in by hand is a different printer: forget the hardware address
      // learned for the old one, or the Print Hub would "follow" it back
      const old = kitchens.find(k => k.id === form.id)
      if (old && 'printer_mac' in old && (old.printer_ip || null) !== payload.printer_ip) payload.printer_mac = null
      if (old && 'backup_printer_mac' in old && (old.backup_printer_ip || null) !== payload.backup_printer_ip) payload.backup_printer_mac = null
      ;({ data: row, error } = await supabase.from('kitchens').update(payload).eq('id', form.id).select().single())
    }
    if (error || !row) { setSaving(false); setFormErr(errText(error)); return }

    setKitchens(prev => form.mode === 'add' ? [...prev, row] : prev.map(k => k.id === row.id ? row : k))
    let note = (form.mode === 'add' ? 'Added ' : 'Saved ') + row.name
    if (row.is_default) await makeDefault(row.id)
    else if (form.wasDefault && !row.is_active) {
      const nd = nextDefaultFor(row.id)
      if (nd && await makeDefault(nd.id)) note += ' · default kitchen is now ' + nd.name
    }
    setSaving(false); setForm(null)
    setMsg({ tone:'ok', text: note })
    setTimeout(() => setMsg(m => (m && m.text === note ? null : m)), 3000)
  }

  async function setActive(k, on) {
    setKitchens(prev => prev.map(x => x.id === k.id ? { ...x, is_active:on } : x))
    setConfirm(null)
    const { error } = await supabase.from('kitchens').update({ is_active:on }).eq('id', k.id)
    if (error) {
      setKitchens(prev => prev.map(x => x.id === k.id ? { ...x, is_active:!on } : x))
      setMsg({ tone:'err', text: errText(error) })
      return
    }
    let note = k.name + (on ? ' is on' : ' is off — its categories go to the default kitchen')
    if (!on && defaultKitchen?.id === k.id) {
      const nd = nextDefaultFor(k.id)
      if (nd && await makeDefault(nd.id)) note = k.name + ' is off · default kitchen is now ' + nd.name
    }
    setMsg({ tone:'ok', text: note })
  }

  async function move(k, dir) {
    const i = kitchens.findIndex(x => x.id === k.id), j = i + dir
    if (i < 0 || j < 0 || j >= kitchens.length) return
    const next = kitchens.slice();
    [next[i], next[j]] = [next[j], next[i]]
    // Renumber 1..n rather than swapping two values: rows made together all start at 0
    const changes = next.map((x, idx) => ({ id:x.id, from:x.sort_order, to:idx + 1 })).filter(c => c.from !== c.to)
    const apply = key => prev => prev.map(x => { const c = changes.find(c => c.id === x.id); return c ? { ...x, sort_order:c[key] } : x })
    setKitchens(apply('to'))
    const res = await Promise.all(changes.map(c => supabase.from('kitchens').update({ sort_order:c.to }).eq('id', c.id)))
    const bad = res.find(r => r.error)
    if (bad) { setKitchens(apply('from')); setMsg({ tone:'err', text: errText(bad.error) }) }
  }

  // Test slips do not count: a kitchen that only ever printed tests can still go
  async function askDelete(k) {
    setForm(null)
    setConfirm({ id:k.id, checking:true })
    const { count, error } = await supabase.from('kots').select('id', { count:'exact', head:true })
      .eq('kitchen_id', k.id).neq('kind', 'test')
    if (error) { setConfirm(null); setMsg({ tone:'err', text: errText(error, 'checked') }); return }
    setConfirm({ id:k.id, checking:false, kots: count || 0 })
  }

  async function doDelete(k) {
    const before = { kitchens, cats, waiters }
    setConfirm(null)
    // The database unlinks categories and waiters itself (on delete set null); mirror it on screen
    setKitchens(prev => prev.filter(x => x.id !== k.id))
    setCats(prev => prev.map(c => c.kitchen_id === k.id ? { ...c, kitchen_id:null } : c))
    setWaiters(prev => prev.map(w => w.kitchen_id === k.id ? { ...w, kitchen_id:null } : w))
    let note = 'Deleted ' + k.name
    if (defaultKitchen?.id === k.id) {
      const nd = nextDefaultFor(k.id)
      if (nd && await makeDefault(nd.id)) note += ' · default kitchen is now ' + nd.name
    }
    // Its test slips go too, or a queued one would reach the Print Hub with no printer
    await supabase.from('kots').delete().eq('kitchen_id', k.id).eq('kind', 'test')
    const { error } = await supabase.from('kitchens').delete().eq('id', k.id)
    if (error) {
      setKitchens(before.kitchens); setCats(before.cats); setWaiters(before.waiters)
      setMsg({ tone:'err', text: errText(error, 'deleted') })
      return
    }
    setMsg({ tone:'ok', text: note })
  }

  /* ---- test print: a real job through the Print Hub, not a ping ---- */
  const anyTestRunning = Object.values(tests).some(t => ACTIVE_TEST.has(t.phase) && t.kotId)
  useEffect(() => {
    if (!anyTestRunning) return
    const t = setInterval(pollTests, TEST_POLL_MS)
    return () => clearInterval(t)
  }, [anyTestRunning])

  async function testPrint(k) {
    const started = Date.now()
    setTests(p => ({ ...p, [k.id]: { phase:'sending', kotId:null, started } }))
    const { data, error } = await supabase.from('kots').insert({
      event_id: eventId, kitchen_id: k.id, kind:'test', kitchen_name: k.name,
      kot_no:'TEST', items:[], status:'open',
    }).select('id').single()
    setTests(p => {
      if (p[k.id]?.started !== started) return p   // a newer test replaced this one
      return { ...p, [k.id]: error || !data
        ? { phase:'failed', started, error: errText(error, 'sent') }
        : { ...p[k.id], kotId: data.id } }
    })
  }

  async function pollTests() {
    const live = Object.entries(testsRef.current).filter(([, t]) => ACTIVE_TEST.has(t.phase) && t.kotId)
    if (!live.length) return
    const { data, error } = await supabase.from('kots').select('id, print_status, last_error')
      .in('id', live.map(([, t]) => t.kotId))
    if (error) return   // a blip in the connection should not end the test; try again next round
    const byId = new Map((data || []).map(r => [r.id, r]))
    const at = Date.now()
    setTests(prev => {
      const next = { ...prev }
      for (const [kid, t] of live) {
        if (next[kid]?.kotId !== t.kotId) continue
        const row = byId.get(t.kotId)
        const age = at - t.started
        let phase = t.phase, err = t.error
        if (row?.print_status === 'printed') phase = 'printed'
        else if (row?.print_status === 'failed') { phase = 'failed'; err = row.last_error || 'the printer did not answer' }
        else if (row?.print_status === 'skipped') { phase = 'failed'; err = 'the job was skipped' }
        else if (row?.print_status === 'printing') phase = 'printing'
        else if (age > TEST_STUCK_MS) phase = 'stuck'
        if (ACTIVE_TEST.has(phase) && age > TEST_GIVEUP_MS) phase = phase === 'printing' ? 'nofinish' : 'gaveup'
        next[kid] = { ...next[kid], phase, error: err }
      }
      return next
    })
  }

  const ownCounts = id => ({
    cats: cats.filter(c => c.kitchen_id === id).length,
    waiters: waiters.filter(w => w.kitchen_id === id).length,
  })
  const usedNames = new Set(kitchens.map(k => String(k.name || '').trim().toLowerCase()))
  const chips = QUICK_CUISINES.filter(n => !usedNames.has(n.toLowerCase()))

  return (
    <div style={card} id="ks-kitchens">
      <SectionHead step={2} title="Kitchens & printers"
        sub={maestro
          ? "One kitchen per cuisine, plus a First Course and a Desserts kitchen if you like. Every firing prints one KOT per cover, per kitchen and per barker, on that kitchen's printer, through the Print Hub on the desk laptop."
          : "One kitchen per cuisine. Each order is split into one KOT per kitchen and printed on that kitchen's printer by the Print Hub on the desk laptop."}
        right={!form && <button onClick={() => openAdd('')} style={btn}>+ Add kitchen</button>} />

      {msg && <Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      {!form && chips.length > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:12 }}>
          <span style={{ ...label, marginRight:4 }}>Quick add</span>
          {chips.map(n => (
            <button key={n} onClick={() => openAdd(n)}
              style={{ height:32, padding:'0 13px', borderRadius:999, border:'1.5px solid #FED7AA',
                background:'#FFF7ED', color:'#9A3412', fontSize:12.5, fontWeight:800, cursor:'pointer',
                fontFamily:'Manrope' }}>+ {n}</button>
          ))}
        </div>
      )}

      {form?.mode === 'add' && (
        <KitchenForm form={form} setField={setField} setForm={setForm} kitchens={kitchens} tried={tried}
          saving={saving} error={formErr} onSave={saveForm} onCancel={() => setForm(null)}
          defaultKitchen={defaultKitchen} />
      )}

      {kitchens.length === 0 && !form && (
        <div style={{ textAlign:'center', padding:'22px 0 8px', color:'var(--ink2)', fontSize:13, lineHeight:1.6 }}>
          No kitchens yet. Tap a cuisine above or <strong>+ Add kitchen</strong>.<br />
          <span style={{ fontSize:12, color:'#999' }}>Orders cannot be placed until at least one kitchen exists.</span>
        </div>
      )}

      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {kitchens.map((k, idx) => form?.mode === 'edit' && form.id === k.id ? (
          <KitchenForm key={k.id} form={form} setField={setField} setForm={setForm} kitchens={kitchens}
            tried={tried} saving={saving} error={formErr} onSave={saveForm} onCancel={() => setForm(null)}
            defaultKitchen={defaultKitchen} />
        ) : (
          <KitchenRow key={k.id} k={k} maestro={maestro} first={idx === 0} last={idx === kitchens.length - 1}
            isDefault={defaultKitchen?.id === k.id} now={now} test={tests[k.id]}
            sharedWith={k.printer_ip ? kitchens.filter(o => o.id !== k.id && keyOf(o.printer_ip, o.printer_port) === keyOf(k.printer_ip, k.printer_port)) : []}
            confirm={confirm?.id === k.id ? confirm : null} counts={ownCounts(k.id)}
            onMove={d => move(k, d)} onEdit={() => openEdit(k)} onTest={() => testPrint(k)}
            onMakeDefault={async () => { if (await makeDefault(k.id)) setMsg({ tone:'ok', text: k.name + ' is now the default kitchen' }) }}
            onAskDelete={() => askDelete(k)} onCancelDelete={() => setConfirm(null)}
            onDelete={() => doDelete(k)} onActive={on => setActive(k, on)} />
        ))}
      </div>

      {kitchens.length > 0 && !form && <FindPrinters eventId={eventId} kitchens={kitchens} setKitchens={setKitchens} />}
    </div>
  )
}

/* ---------------------------------------------------------- find printers */

/* The Print Hub looks for printers on its own network and lists them here,
   with their hardware (MAC) address. A printer is chosen for a kitchen from
   the list instead of typing an IP, and "Print a slip" shows which physical
   printer is which. Each kitchen printer's MAC is remembered, so a printer
   that comes back from a restart with a new address is followed by the hub
   on its own - those moves are shown here too. */
const ago = (t, now) => {
  const m = Math.round((now - new Date(t)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'
}
const splitIp = ip => { const m = String(ip || '').match(/^(.+):(\d+)$/); return m ? { host:m[1], port:Number(m[2]) } : { host:String(ip || ''), port:9100 } }
const keyOf = (ip, port) => { const e = splitIp(ip); const p = /:\d+$/.test(String(ip || '')) ? e.port : Number(port) || 9100; return e.host ? (p === 9100 ? e.host : e.host + ':' + p) : null }

/* The Print Hub for a normal day, built with every deploy (tools/offline-kit.mjs):
   one double-click on the laptop connected to the printers' router. */
function PrintHubDownload() {
  const kit = useKitInfo()
  const files = kit && Array.isArray(kit.printhub) ? kit.printhub : []
  if (!files.length) return null
  return (
    <div data-testid="printhub-download" style={{ display:'flex', alignItems:'center', gap:'6px 12px', flexWrap:'wrap', marginTop:10,
      fontSize:12.5, color:'var(--ink2)', lineHeight:1.5 }}>
      <span><b style={{ color:'var(--ink)' }}>Print Hub:</b> runs on one laptop connected to the printers’ router (needs Node.js).</span>
      {[['windows', 'Windows'], ['mac', 'Mac']].map(([os, label]) => {
        const f = files.find(x => x.os === os)
        return f && (
          <a key={os} href={`/downloads/${f.file}`} download data-testid={`hub-${os}`}
            style={{ fontWeight:800, color:'var(--ink)', whiteSpace:'nowrap' }}>⬇ Download for {label}
            <span style={{ fontWeight:600, opacity:0.7 }}> ({mb(f.bytes)})</span></a>
        )
      })}
    </div>
  )
}

function FindPrinters({ eventId, kitchens, setKitchens }) {
  const [rows, setRows] = useState(null)        // null = not loaded / not available
  const [missing, setMissing] = useState(false) // database update not applied yet
  const [search, setSearch] = useState(null)    // { at, base, phase:'asking'|'waiting'|'done'|'nohub', n }
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState({})          // ip -> 'slip' | 'assign'
  const [note, setNote] = useState(null)
  const [now, setNow] = useState(() => Date.now())   // refreshed with every load, for "seen 2 min ago"
  const [claimers, setClaimers] = useState([])  // Print Hubs that took this event's KOTs lately

  async function load() {
    const { data, error } = await supabase.from('found_printers').select('*').eq('event_id', eventId).order('seen_at', { ascending:false })
    setNow(Date.now())
    if (error) { if (/found_printers|schema cache|does not exist/i.test(error.message)) setMissing(true); return null }
    setRows(data || []); return data || []
  }
  useEffect(() => { load() }, [eventId])
  // Only one Print Hub may work on an event: every running hub takes the event's KOTs, and a hub
  // that cannot reach a printer (another building, another router) fails them.
  useEffect(() => {
    let alive = true
    async function loadClaimers() {
      const since = new Date(Date.now() - 10 * 60000).toISOString()
      const { data, error } = await supabase.from('kots').select('print_claimed_by')
        .eq('event_id', eventId).gte('print_claimed_at', since).not('print_claimed_by', 'is', null).limit(500)
      if (alive && !error) setClaimers([...new Set((data || []).map(r => r.print_claimed_by).filter(Boolean))])
    }
    loadClaimers()
    const t = setInterval(loadClaimers, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [eventId])
  useEffect(() => {
    const t = setInterval(load, search && search.phase === 'waiting' ? 2000 : 20000)
    return () => clearInterval(t)
  }, [eventId, search?.phase])
  // the search ends when fresh rows arrive, or after 25 s with nothing. "Fresh" is judged on the
  // database clock (newer than anything seen before the button was pressed), so a tablet whose
  // clock is a little off still sees the answer.
  useEffect(() => {
    if (!search || search.phase !== 'waiting') return
    const fresh = (rows || []).filter(r => +new Date(r.seen_at) > search.base)
    if (fresh.length) { setSearch(s => ({ ...s, phase:'done', n: fresh.length })); setOpen(true); return }
    const t = setTimeout(() => setSearch(s => s && s.phase === 'waiting' ? { ...s, phase:'nohub' } : s), Math.max(0, 25000 - (Date.now() - search.at)))
    return () => clearTimeout(t)
  }, [rows, search])

  async function find() {
    setNote(null)
    const at = Date.now()
    setSearch({ at, base: Infinity, phase:'asking' })
    const before = await load()
    const base = (before || rows || []).reduce((m, r) => Math.max(m, +new Date(r.seen_at) || 0), 0)
    const { error } = await supabase.from('events').update({ printer_scan_at: new Date(at).toISOString() }).eq('id', eventId)
    if (error) { setSearch(null); if (/printer_scan_at/.test(error.message)) setMissing(true); else setNote({ tone:'err', text: errText(error, 'sent') }); return }
    setSearch({ at, base, phase:'waiting' })
  }

  async function slip(f) {
    setBusy(b => ({ ...b, [f.ip]:'slip' }))
    const { error } = await supabase.from('kots').insert({ event_id:eventId, kitchen_id:null, kind:'test', kot_no:'IDENTIFY',
      kitchen_name:'Printer ' + f.ip, printer_ip:f.ip, items:[], status:'open' })
    setBusy(b => ({ ...b, [f.ip]:null }))
    setNote(error ? { tone:'err', text: errText(error, 'sent') } : { tone:'ok', text:'A slip saying THIS PRINTER ' + f.ip + ' is printing on that printer.' })
  }

  async function assign(f, value) {
    if (!value) return
    const [slot, id] = value.split(':')
    const k = kitchens.find(x => x.id === id)
    if (!k) return
    const { host, port } = splitIp(f.ip)
    const patch = slot === 'main'
      ? { printer_ip: host, printer_port: port, printer_mac: f.mac || null }
      : { backup_printer_ip: f.ip, backup_printer_mac: f.mac || null }
    setBusy(b => ({ ...b, [f.ip]:'assign' }))
    const { data, error } = await supabase.from('kitchens').update(patch).eq('id', k.id).select().single()
    setBusy(b => ({ ...b, [f.ip]:null }))
    if (error) { setNote({ tone:'err', text: k.name + ' — ' + errText(error) }); return }
    setKitchens(prev => prev.map(x => x.id === k.id ? data : x))
    setNote({ tone:'ok', text: (slot === 'main' ? k.name + ' prints on ' : k.name + ' falls back to ') + f.ip + '. Use Test print on the kitchen to check.' })
  }

  if (missing) return (
    <div style={{ marginTop:12, fontSize:12, color:'var(--ink2)' }}>Printer search is not available yet on this database (update 2026-10-09_printer_discovery.sql).</div>
  )

  const users = f => kitchens.flatMap(k => [
    keyOf(k.printer_ip, k.printer_port) === f.ip ? k.name : null,
    keyOf(k.backup_printer_ip) === f.ip ? k.name + ' (backup)' : null]).filter(Boolean)
  const moved = kitchens.filter(k => k.printer_moved_at && now - new Date(k.printer_moved_at) < 12 * 3600e3)
  const list = rows || []
  const latest = list.length ? Math.max(...list.map(r => +new Date(r.seen_at))) : 0
  const hubs = [...new Set([...claimers, ...list.filter(r => r.hub && latest - new Date(r.seen_at) < 3 * 60000).map(r => r.hub)])]
  const phaseText = !search ? null
    : search.phase === 'asking' ? 'Asking the Print Hub…'
    : search.phase === 'waiting' ? 'The Print Hub is looking at its network…'
    : search.phase === 'done' ? search.n + ' printer' + (search.n === 1 ? '' : 's') + ' answered'
    : 'No printers reported. Check that the Print Hub is running on a laptop connected to the printers’ router (download it below), then try again.'

  return (
    <div style={{ marginTop:14, borderTop:'1px solid var(--line)', paddingTop:12 }}>
      {moved.map(k => (
        <Banner key={k.id} tone="ok">{k.name}’s printer came back on a new address ({k.printer_moved_from} → {keyOf(k.printer_ip, k.printer_port)}) {ago(k.printer_moved_at, now)}. The Print Hub recognised it by its hardware address and moved the kitchen; nothing to do.</Banner>
      ))}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <button onClick={find} disabled={search?.phase === 'asking' || search?.phase === 'waiting'}
          style={{ ...btn, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)' }}>
          {search?.phase === 'waiting' || search?.phase === 'asking' ? '🔎 Searching…' : '🔎 Find printers'}</button>
        {list.length > 0 && (
          <button onClick={() => setOpen(o => !o)} style={{ background:'none', border:'none', color:'var(--ink)', fontWeight:800, fontSize:12.5, cursor:'pointer', textDecoration:'underline' }}>
            {open ? 'Hide' : 'Show'} {list.length} printer{list.length === 1 ? '' : 's'} found</button>
        )}
        <span style={{ fontSize:12, fontWeight:700, color: search?.phase === 'nohub' ? AMBER_INK : 'var(--ink2)' }}>
          {phaseText || 'The Print Hub finds printers on its network and follows a printer that restarts on a new address.'}</span>
      </div>
      {hubs.length > 1 && (
        <div style={{ marginTop:8 }} data-testid="two-hubs"><Banner tone="warn">
          {hubs.length} Print Hubs are working on this event: {hubs.join(', ')}. Only one may run: keep the one on the laptop
          connected to the printers’ router and close the other{hubs.length > 2 ? 's' : ''}, or KOTs can fail.</Banner></div>
      )}
      {note && <div style={{ marginTop:8 }}><Banner tone={note.tone} onClose={() => setNote(null)}>{note.text}</Banner></div>}
      <PrintHubDownload />
      {open && list.length > 0 && (
        <div style={{ display:'grid', gap:6, marginTop:10 }}>
          {list.map(f => {
            const used = users(f)
            const stale = latest - new Date(f.seen_at) > 3 * 60000
            return (
              <div key={f.id} className="ks-row" style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', border:'1.5px solid var(--line)',
                borderRadius:10, padding:'8px 12px', background: stale ? 'var(--bg)' : '#fff', opacity: stale ? 0.7 : 1 }}>
                <div style={{ minWidth:170 }}>
                  <div style={{ fontWeight:900, fontVariantNumeric:'tabular-nums' }}>🖨 {f.ip}</div>
                  <div style={{ fontSize:11, color:'var(--ink2)', fontFamily:'ui-monospace, Menlo, monospace' }}>{f.mac || 'hardware address not readable'}</div>
                </div>
                <span style={{ fontSize:11, fontWeight:800, borderRadius:999, padding:'2px 8px',
                  background: f.status === 'paper_out' ? '#FEF2F2' : f.status === 'paper_low' ? AMBER_BG : '#F0FDF4',
                  color: f.status === 'paper_out' ? RED : f.status === 'paper_low' ? AMBER_INK : GREEN }}>
                  {f.status === 'paper_out' ? 'Paper out' : f.status === 'paper_low' ? 'Paper low' : 'Answering'}</span>
                <span style={{ fontSize:11.5, color:'var(--ink2)' }}>seen {ago(f.seen_at, now)}{f.hub ? ' by ' + f.hub : ''}</span>
                <span style={{ fontSize:12, fontWeight:700, color: used.length ? 'var(--ink)' : AMBER_INK, flex:1, minWidth:140 }}>
                  {used.length ? 'Used by ' + used.join(', ') : 'Not used by any kitchen'}</span>
                <button onClick={() => slip(f)} disabled={!!busy[f.ip]} style={{ ...btn, height:32, padding:'0 10px', fontSize:12, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)' }}>
                  {busy[f.ip] === 'slip' ? 'Sending…' : 'Print a slip'}</button>
                <select value="" onChange={e => assign(f, e.target.value)} disabled={!!busy[f.ip]}
                  style={{ ...input, width:190, height:32, fontSize:12.5 }}>
                  <option value="">Use for a kitchen…</option>
                  <optgroup label="Main printer for">
                    {kitchens.filter(k => k.is_active !== false).map(k => <option key={'m' + k.id} value={'main:' + k.id}>{k.name}</option>)}
                  </optgroup>
                  <optgroup label="Backup printer for">
                    {kitchens.filter(k => k.is_active !== false).map(k => <option key={'b' + k.id} value={'backup:' + k.id}>{k.name}</option>)}
                  </optgroup>
                </select>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function KitchenForm({ form, setField, setForm, kitchens, tried, saving, error, onSave, onCancel, defaultKitchen }) {
  const errs = validateKitchen(form, kitchens)
  // Mistakes show as soon as something is typed; "required" waits for Save
  const show = (key, val) => errs[key] && (tried || String(val ?? '').trim() !== '') ? errs[key] : null
  // Same printer = same IP AND same port (Virtual Printers share 127.0.0.1 on different ports)
  const formPort = Number(form.printer_port) || 9100
  const shared = form.printer_ip.trim() && kitchens.filter(k => k.id !== form.id && k.printer_ip === form.printer_ip.trim()
    && (Number(k.printer_port) || 9100) === formPort)
  const lockedDefault = form.mode === 'edit' && form.wasDefault
  const firstKitchen = form.mode === 'add' && !kitchens.some(k => k.is_active)
  const nextDefault = kitchens.find(k => k.id !== form.id && k.is_active)
  // Numbering carries on after a prefix change, so an edit shows the real next number
  const seq = form.mode === 'edit' ? (kitchens.find(k => k.id === form.id)?.kot_seq || 0) : 0
  const kotHint = seq ? 'Next KOT: ' + form.prefix + '-' + String(seq + 1).padStart(3, '0')
    : 'KOTs: ' + form.prefix + '-001, ' + form.prefix + '-002'

  const field = (key, title, node, err, note, extra) => (
    <label className={extra} style={{ display:'block', minWidth:0 }}>
      <span style={{ ...label, display:'block', marginBottom:4 }}>{title}</span>
      {node}
      {err ? <span style={{ display:'block', fontSize:11.5, fontWeight:700, color:RED, marginTop:3 }}>{err}</span>
        : note ? <span style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--ink2)', marginTop:3 }}>{note}</span>
        : null}
    </label>
  )
  const inp = bad => ({ ...input, borderColor: bad ? RED : 'var(--line)' })
  const enter = e => { if (e.key === 'Enter') onSave() ; if (e.key === 'Escape') onCancel() }

  return (
    <div style={{ border:'2px solid ' + MARI, borderRadius:12, padding:'14px 14px 12px', background:'#FFFBF5',
      marginBottom:12 }}>
      <div style={{ fontSize:14, fontWeight:900, marginBottom:10 }}>
        {form.mode === 'add' ? 'New kitchen' : 'Edit ' + (kitchens.find(k => k.id === form.id)?.name || 'kitchen')}
      </div>
      <div className="ks-kform">
        {field('name', 'Name',
          <input autoFocus={form.mode === 'add' && !form.name} value={form.name} onChange={e => setField('name', e.target.value)}
            onKeyDown={enter} placeholder="e.g. Italian" style={inp(show('name', form.name))} />,
          show('name', form.name), null, 'ks-f-name')}
        {field('prefix', 'KOT prefix',
          <input value={form.prefix} onChange={e => setField('prefix', e.target.value)} onKeyDown={enter}
            placeholder="IT" maxLength={3}
            style={{ ...inp(show('prefix', form.prefix)), letterSpacing:'2px', textTransform:'uppercase', fontWeight:900 }} />,
          show('prefix', form.prefix), /^[A-Z]{2,3}$/.test(form.prefix) ? kotHint : null, 'ks-f-prefix')}
        {field('printer_ip', 'Printer IP',
          <input value={form.printer_ip} onChange={e => setField('printer_ip', e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={enter} placeholder="192.168.1.104" inputMode="decimal" style={inp(show('printer_ip', form.printer_ip))} />,
          show('printer_ip', form.printer_ip),
          shared && shared.length ? 'Same printer as ' + listNames(shared) : !form.printer_ip.trim() ? 'Can be added later' : null, 'ks-f-ip')}
        {field('printer_port', 'Port',
          <input value={form.printer_port} onChange={e => setField('printer_port', e.target.value)} onKeyDown={enter}
            inputMode="numeric" style={inp(show('printer_port', 'x'))} />,
          show('printer_port', 'x'), null, 'ks-f-port')}
        {field('backup_printer_ip', 'Backup printer IP (optional)',
          <input value={form.backup_printer_ip} onChange={e => setField('backup_printer_ip', e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={enter} placeholder="None" inputMode="decimal" style={inp(show('backup_printer_ip', form.backup_printer_ip))} />,
          show('backup_printer_ip', form.backup_printer_ip), 'Used when the main printer is down', 'ks-f-backup')}
      </div>

      <div style={{ display:'flex', gap:'10px 28px', flexWrap:'wrap', marginTop:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:'1 1 320px' }}>
          <Switch on={form.is_default} disabled={lockedDefault || firstKitchen}
            onChange={v => setForm(f => ({ ...f, is_default:v, is_active: v ? true : f.is_active }))}
            title={lockedDefault ? 'Make another kitchen the default to change this' : ''} />
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:800 }}>Default kitchen</div>
            <div style={{ ...hint, fontSize:11.5 }}>
              {firstKitchen ? 'The first kitchen is the default. It gets every dish whose category has no kitchen.'
                : lockedDefault ? 'This is the default. To change it, use "Make default" on another kitchen.'
                : form.is_default ? 'Gets every dish whose category has no kitchen. ' + (defaultKitchen ? defaultKitchen.name + ' stops being the default.' : '')
                : 'Gets every dish whose category has no kitchen' + (defaultKitchen ? ' (now: ' + defaultKitchen.name + ')' : '') + '.'}
            </div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flex:'1 1 280px' }}>
          <Switch on={form.is_active} disabled={form.is_default && !lockedDefault}
            onChange={v => setForm(f => ({ ...f, is_active:v }))} />
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:800 }}>{form.is_active ? 'On — takes KOTs' : 'Off — takes no KOTs'}</div>
            <div style={{ ...hint, fontSize:11.5, color: !form.is_active && lockedDefault ? AMBER_INK : 'var(--ink2)' }}>
              {!form.is_active && lockedDefault
                ? (nextDefault ? 'On save, ' + nextDefault.name + ' becomes the default kitchen.' : 'No other kitchen is on — orders cannot be placed.')
                : 'Off sends its categories to the default kitchen.'}
            </div>
          </div>
        </div>
      </div>

      {error && <Banner tone="err" style={{ marginTop:12, marginBottom:0 }}>{error}</Banner>}

      <div style={{ display:'flex', gap:8, marginTop:14, alignItems:'center', flexWrap:'wrap' }}>
        <button onClick={onSave} disabled={saving} style={{ ...btn, background:MARI, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Saving…' : form.mode === 'add' ? 'Save kitchen' : 'Save changes'}
        </button>
        <button onClick={onCancel} disabled={saving} style={ghost}>Cancel</button>
        {tried && Object.keys(errs).length > 0 && (
          <span style={{ fontSize:12, fontWeight:700, color:RED }}>Fix the field{Object.keys(errs).length === 1 ? '' : 's'} in red first.</span>
        )}
      </div>
    </div>
  )
}

function KitchenRow({ k, maestro, first, last, isDefault, now, test, sharedWith, confirm, counts,
  onMove, onEdit, onTest, onMakeDefault, onAskDelete, onCancelDelete, onDelete, onActive }) {
  const hasIp = IPV4.test(String(k.printer_ip || '').trim())
  const st = k.printer_status ? (PRINTER[k.printer_status] || PRINTER.unknown) : null
  const ago = agoText(k.printer_checked_at, now)
  const staleMs = k.printer_checked_at ? now - new Date(k.printer_checked_at).getTime() : null
  // The bar is the printer's health at a glance; DEFAULT has its own badge
  const bar = !k.is_active ? '#9CA3AF'
    : !hasIp || k.printer_status === 'offline' || k.printer_status === 'paper_out' ? RED
    : k.printer_status === 'paper_low' ? MARI : GREEN
  const arrow = dis => ({ width:30, height:26, borderRadius:7, border:'1.5px solid var(--line)', background:'#fff',
    fontSize:11, fontWeight:900, color: dis ? '#D1D5DB' : 'var(--ink)', cursor: dis ? 'default' : 'pointer', padding:0 })
  const link = { background:'none', border:'none', padding:'0 4px', fontSize:12.5, fontWeight:800,
    cursor:'pointer', fontFamily:'Manrope', color:'var(--ink2)', height:30 }

  return (
    <div className="ks-row" style={{ display:'flex', gap:10, border:'1.5px solid var(--line)', borderLeft:'4px solid ' + bar,
      borderRadius:10, padding:'10px 12px', background: k.is_active ? '#fff' : '#FAFAFA' }}>
      {/* Order matters: it is the order of the KOT board and of every kitchen list */}
      <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
        <button onClick={() => onMove(-1)} disabled={first} title="Move up" style={arrow(first)}>▲</button>
        <button onClick={() => onMove(1)} disabled={last} title="Move down" style={arrow(last)}>▼</button>
      </div>

      <div style={{ flex:1, minWidth:0 }}>
        {/* One line on a laptop, two on a tablet, stacked on a phone (see .ks-kgrid) */}
        <div className="ks-kgrid">
          <div className="ks-c-name" style={{ minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
              <span style={{ fontSize:16, fontWeight:900, color: k.is_active ? 'var(--ink)' : '#9CA3AF' }}>{k.name}</span>
              <span title="KOT prefix and the next KOT number" style={{ fontSize:11, fontWeight:900, letterSpacing:'1px', borderRadius:6,
                padding:'2px 7px', background:'#F3EEF8', color:'var(--ink2)' }}>{maestro
                  ? `${k.prefix}-A ${String((k.kot_seq || 0) + 1).padStart(3, '0')}`
                  : `${k.prefix}-${String((k.kot_seq || 0) + 1).padStart(3, '0')}`}</span>
              {isDefault && <span style={{ fontSize:10, fontWeight:900, letterSpacing:'0.4px', borderRadius:999,
                padding:'2px 8px', background:'#FFF7ED', color:'#C2410C', border:'1px solid #FED7AA' }}>DEFAULT</span>}
              {!k.is_active && <span style={{ fontSize:10, fontWeight:900, letterSpacing:'0.4px', borderRadius:999,
                padding:'2px 8px', background:'#F3F4F6', color:'#6B7280', border:'1px solid #E5E7EB' }}>OFF</span>}
            </div>
            <div style={{ fontSize:11.5, color:'var(--ink2)', fontWeight:600, marginTop:2 }}>
              {plural(counts.cats, 'category', 'categories')}{maestro ? '' : ' · ' + plural(counts.waiters, 'waiter')}
            </div>
          </div>

          <div className="ks-c-printer" style={{ minWidth:0, fontSize:13 }}>
            {hasIp ? (
              <>
                <span style={{ fontWeight:800, fontVariantNumeric:'tabular-nums' }}>🖨 {k.printer_ip}</span>
                <span style={{ color:'var(--ink2)', fontWeight:600 }}>:{k.printer_port ?? 9100}</span>
                <div style={{ fontSize:11.5, color:'var(--ink2)', marginTop:1 }}>
                  {k.backup_printer_ip ? 'Backup ' + k.backup_printer_ip : 'No backup printer'}
                  {sharedWith.length > 0 && ' · shared with ' + listNames(sharedWith)}
                </div>
              </>
            ) : (
              <button onClick={onEdit} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C',
                borderRadius:8, padding:'5px 10px', fontSize:12, fontWeight:800, cursor:'pointer', fontFamily:'Manrope' }}>
                No printer IP — add one
              </button>
            )}
          </div>

          <div className="ks-c-status" style={{ minWidth:0 }}>
            {st ? (
              <span style={{ background:st.bg, color:st.color, borderRadius:999, padding:'3px 10px',
                fontSize:11.5, fontWeight:900, whiteSpace:'nowrap' }}>● {st.label}</span>
            ) : (
              <span style={{ background:'#F3F4F6', color:'#6B7280', borderRadius:999, padding:'3px 10px',
                fontSize:11.5, fontWeight:800, whiteSpace:'nowrap' }}>Not checked yet</span>
            )}
            <div style={{ fontSize:11.5, fontWeight:600, marginTop:3,
              color: staleMs != null && staleMs > 180000 ? AMBER_INK : 'var(--ink2)' }}>
              {ago ? 'checked ' + ago : hasIp ? 'waiting for the Print Hub' : '\u00a0'}
            </div>
          </div>

          <div className="ks-c-test" style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
            <button onClick={onTest} disabled={!hasIp || !k.is_active || (test && ACTIVE_TEST.has(test.phase))}
              title={!hasIp ? 'Add a printer IP first' : !k.is_active ? 'Reactivate the kitchen first'
                : test && ACTIVE_TEST.has(test.phase) ? 'Waiting for the Print Hub' : 'Print a test slip on this printer'}
              style={{ ...ghost, ...small, flexShrink:0, borderColor: hasIp && k.is_active ? 'var(--ink)' : 'var(--line)',
                color: hasIp && k.is_active ? 'var(--ink)' : '#9CA3AF',
                cursor: hasIp && k.is_active ? 'pointer' : 'not-allowed' }}>🖨 Test print</button>
            <TestResult test={test} />
          </div>

          <div className="ks-c-actions" style={{ display:'flex', alignItems:'center', gap:2, flexWrap:'wrap' }}>
            {k.is_active && !isDefault && <button onClick={onMakeDefault} style={link}>Make default</button>}
            {!k.is_active && <button onClick={() => onActive(true)} style={{ ...link, color:GREEN }}>Reactivate</button>}
            <button onClick={onEdit} style={{ ...link, color:'var(--ink)' }}>Edit</button>
            <button onClick={onAskDelete} style={{ ...link, color:RED }}>Delete</button>
          </div>
        </div>

        {confirm && (
          <div style={{ marginTop:10, borderRadius:9, padding:'9px 12px', display:'flex', alignItems:'center',
            gap:10, flexWrap:'wrap', background: confirm.kots ? AMBER_BG : '#FEF2F2',
            border:'1px solid ' + (confirm.kots ? AMBER_LINE : '#FECACA') }}>
            {confirm.checking ? (
              <span style={{ fontSize:12.5, fontWeight:700, color:'var(--ink2)' }}>Checking for KOTs…</span>
            ) : confirm.kots > 0 ? (
              <>
                <span style={{ flex:'1 1 260px', fontSize:12.5, fontWeight:700, color:AMBER_INK, lineHeight:1.45 }}>
                  {k.name} already has {plural(confirm.kots, 'KOT')}, so it stays for the reports.
                  {k.is_active ? ' Deactivate it instead — its categories then go to the default kitchen.' : ' It is already deactivated.'}
                </span>
                {k.is_active && <button onClick={() => onActive(false)} style={{ ...btn, ...small, background:AMBER_INK }}>Deactivate</button>}
                <button onClick={onCancelDelete} style={{ ...ghost, ...small }}>{k.is_active ? 'Cancel' : 'OK'}</button>
              </>
            ) : (
              <>
                <span style={{ flex:'1 1 260px', fontSize:12.5, fontWeight:700, color:'#B91C1C', lineHeight:1.45 }}>
                  Delete {k.name}?
                  {(counts.cats || counts.waiters)
                    ? ' ' + [counts.cats && plural(counts.cats, 'category', 'categories'), counts.waiters && plural(counts.waiters, 'waiter')]
                        .filter(Boolean).join(' and ') + ' will be unlinked.'
                    : ' Nothing is linked to it.'}
                  {isDefault && ' Another kitchen becomes the default.'}
                </span>
                <button onClick={onDelete} style={{ ...btn, ...small, background:RED }}>Delete</button>
                <button onClick={onCancelDelete} style={{ ...ghost, ...small }}>Cancel</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TestResult({ test }) {
  if (!test) return null
  const T = {
    sending:  ['Sending…', 'var(--ink2)'],
    printing: ['Printing…', 'var(--ink2)'],
    stuck:    ['Not picked up — is the Print Hub running on the desk laptop?', AMBER_INK],
    printed:  ['Printed ✓', GREEN],
    failed:   ['Failed: ' + (test.error || 'unknown error'), RED],
    gaveup:   ['Not picked up after 2 minutes — start the Print Hub on the desk laptop, then test again.', RED],
    nofinish: ['The Print Hub took the job but never reported back — test again.', RED],
  }[test.phase] || ['', 'var(--ink2)']
  return (
    <span style={{ fontSize:12.5, fontWeight:800, color:T[1], lineHeight:1.35, minWidth:0, flex:'0 1 auto' }}>
      {T[0]}
    </span>
  )
}

/* --------------------------------------------------------- menu routing */

function RoutingSection({ cats, setCats, kitchens, itemCounts, defaultKitchen }) {
  const [ticks, tick] = useTicks()
  const [msg, setMsg] = useState(null)
  const activeIds = new Set(kitchens.filter(k => k.is_active).map(k => k.id))
  const sorted = [...cats].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)))
  const unrouted = sorted.filter(c => !activeIds.has(c.kitchen_id))
  const visibleUnrouted = unrouted.filter(c => c.is_visible !== false)

  async function route(cat, kitchenId) {
    const before = cat.kitchen_id ?? null
    const to = kitchenId || null
    if (before === to) return
    setCats(prev => prev.map(c => c.id === cat.id ? { ...c, kitchen_id:to } : c))
    const { error } = await supabase.from('menu_categories').update({ kitchen_id:to }).eq('id', cat.id)
    if (error) {
      setCats(prev => prev.map(c => c.id === cat.id ? { ...c, kitchen_id:before } : c))
      setMsg({ tone:'err', text: cat.name + ' — ' + errText(error) })
      return
    }
    tick(cat.id)
  }

  /* Only ever fills gaps: a category someone has already pointed at a
     working kitchen is left alone, even if its name says otherwise. */
  async function autoMatch() {
    const act = kitchens.filter(k => k.is_active)
    if (!act.length) { setMsg({ tone:'warn', text:'Add a kitchen first.' }); return }
    if (!unrouted.length) { setMsg({ tone:'ok', text:'Every category already goes to a kitchen.' }); return }
    const plan = []
    for (const c of unrouted) {
      const hits = act.filter(k => wordsIn(c.name, k.name) || wordsIn(k.name, c.name))
      // "Indian Breads" with kitchens Indian and Breads: the longer name is the more specific
      const best = hits.sort((a, b) => b.name.length - a.name.length)[0]
      if (best) plan.push({ cat:c, kitchen:best })
    }
    if (!plan.length) {
      setMsg({ tone:'warn', text:'No category name matches a kitchen name. Pick the kitchen for the amber ones by hand.' })
      return
    }
    setCats(prev => prev.map(c => { const p = plan.find(x => x.cat.id === c.id); return p ? { ...c, kitchen_id:p.kitchen.id } : c }))
    const res = await Promise.all(plan.map(p => supabase.from('menu_categories').update({ kitchen_id:p.kitchen.id }).eq('id', p.cat.id)))
    const failed = plan.filter((p, i) => res[i].error)
    if (failed.length) {
      setCats(prev => prev.map(c => { const p = failed.find(x => x.cat.id === c.id); return p ? { ...c, kitchen_id:p.cat.kitchen_id ?? null } : c }))
    }
    const done = plan.filter(p => !failed.includes(p))
    done.forEach(p => tick(p.cat.id))
    const left = unrouted.length - done.length
    setMsg({ tone: failed.length ? 'err' : 'ok',
      text: 'Matched ' + done.length + ' of ' + unrouted.length + ' unrouted: '
        + done.map(p => p.cat.name + ' → ' + p.kitchen.name).join(', ') + '.'
        + (left ? ' ' + plural(left, 'category', 'categories') + ' still to pick by hand.' : '')
        + (failed.length ? ' ' + failed.length + ' could not be saved — ' + errText(res.find(r => r.error).error) : '') })
  }

  return (
    <div style={card} id="ks-routing">
      <SectionHead step={3} title="Menu routing"
        sub={'Which kitchen cooks each menu category. The categories on the left are the ones in the Menu tab (they appear here by themselves when'
          + ' you add one there); pick the kitchen whose printer and barkers get those dishes. Saved as soon as you choose.'
          + ' A category left blank goes to the default kitchen' + (defaultKitchen ? ' (' + defaultKitchen.name + ').' : '.')}
        right={cats.length > 0 && (
          <button onClick={autoMatch} style={{ ...btn, background: unrouted.length ? MARI : '#E5E7EB',
            color: unrouted.length ? '#fff' : '#9CA3AF' }}
            title="Route every unrouted category whose name contains a kitchen name">
            ⚡ Auto-match{unrouted.length ? ' (' + unrouted.length + ')' : ''}
          </button>
        )} />

      {msg && <Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      {cats.length === 0 ? (
        <div style={{ textAlign:'center', padding:'18px 0 6px', color:'var(--ink2)', fontSize:13, lineHeight:1.6 }}>
          This event has no menu categories yet. Add the menu under <strong>Menu</strong>, then come back here.
        </div>
      ) : (
        <>
          {visibleUnrouted.length > 0 && (
            <div style={{ fontSize:12.5, fontWeight:700, color:AMBER_INK, marginBottom:8 }}>
              {plural(visibleUnrouted.length, 'category', 'categories')} not routed (amber) — {defaultKitchen ? 'their dishes print in ' + defaultKitchen.name : 'add a kitchen first'}.
            </div>
          )}
          <div className="ks-cats">
            {sorted.map(c => {
              const hidden = c.is_visible === false
              const off = c.kitchen_id && !activeIds.has(c.kitchen_id)
              const amber = !activeIds.has(c.kitchen_id) && !hidden
              const current = kitchens.find(k => k.id === c.kitchen_id)
              const n = itemCounts[c.id] || 0
              return (
                <div key={c.id} className="ks-row" style={{ display:'flex', alignItems:'center', gap:10, borderRadius:10,
                  padding:'7px 8px 7px 12px', border:'1.5px solid ' + (amber ? AMBER_LINE : 'var(--line)'),
                  background: amber ? AMBER_BG : '#fff' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }}>
                      <span style={{ fontSize:14, fontWeight:800, overflow:'hidden', textOverflow:'ellipsis',
                        whiteSpace:'nowrap', color: hidden ? '#9CA3AF' : 'var(--ink)' }}>{c.name}</span>
                      {hidden && <span style={{ fontSize:9.5, fontWeight:900, color:'#6B7280', background:'#F3F4F6',
                        borderRadius:999, padding:'1px 6px', flexShrink:0 }}>HIDDEN</span>}
                    </div>
                    <div style={{ fontSize:11.5, fontWeight:600, color: amber ? AMBER_INK : 'var(--ink2)', marginTop:1 }}>
                      {plural(n, 'dish', 'dishes')}
                      {!activeIds.has(c.kitchen_id) && (defaultKitchen
                        ? ' · → default kitchen (' + defaultKitchen.name + ')' + (off ? ' because ' + (current?.name || 'its kitchen') + ' is off' : '')
                        : ' · no kitchen yet')}
                      <Saved show={!!ticks[c.id]} />
                    </div>
                  </div>
                  <select value={c.kitchen_id || ''} onChange={e => route(c, e.target.value)}
                    style={{ ...input, width:170, flexShrink:0, height:36, fontSize:13, cursor:'pointer',
                      borderColor: amber ? AMBER_LINE : 'var(--line)', paddingRight:6 }}>
                    <option value="">{defaultKitchen ? 'Default (' + defaultKitchen.name + ')' : 'No kitchen'}</option>
                    {kitchens.filter(k => k.is_active || k.id === c.kitchen_id).map(k => (
                      <option key={k.id} value={k.id}>{k.name}{k.is_active ? '' : ' (off)'}</option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------ captains → tables */

// Captains in table order (Table 1, 2, 3 ...), by name within a table; no table yet last
const byTable = list => [...list].sort((a, b) =>
  (a.table_number || 1e9) - (b.table_number || 1e9) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric:true }))

// Covers a captain looks after at a shared table; null = every cover of the table
function capRange(c, coverCount) {
  const f = Number(c.cover_from) || null, t = Number(c.cover_to) || null
  if (!f && !t) return null
  const from = Math.min(Math.max(1, f || 1), coverCount), to = Math.min(Math.max(from, t || coverCount), coverCount)
  return from === 1 && to === coverCount ? null : { from, to }
}
const capRangeText = r => r ? (r.from === r.to ? 'C' + r.from : 'C' + r.from + '–C' + r.to) : 'all covers'
const COVER_SQL_HINT = 'Run 2026-10-10_maestro_covers.sql in Supabase (maestro-sql folder) first, then try again.'

function CaptainsSection({ eventId, step = 4, captains, setCaptains, tableCount, coverCount = 10, maestro = false }) {
  const [ticks, tick] = useTicks()
  const [msg, setMsg] = useState(null)
  const [add, setAdd] = useState({ name:'', pin:'', table:'' })
  const [adding, setAdding] = useState(false)

  const perTable = {}
  captains.forEach(c => { if (c.table_number) perTable[c.table_number] = (perTable[c.table_number] || 0) + 1 })
  const covered = Object.keys(perTable).map(Number)
  const uncovered = tableCount ? Array.from({ length: tableCount }, (_, i) => i + 1).filter(n => !perTable[n]) : []
  // Tables shared by two or more captains, and whether their covers are split
  const shared = Object.keys(perTable).map(Number).filter(t => perTable[t] > 1).sort((a, b) => a - b)
  // A table's captains in the order they were added (Table Captain 1, 2 on the tablet), split ones by their covers
  const capsAt = t => captains.filter(c => c.table_number === t)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.name).localeCompare(String(b.name)))
  const capsByCover = t => [...capsAt(t)].sort((a, b) => (capRange(a, coverCount)?.from || 99) - (capRange(b, coverCount)?.from || 99))
  const unsplit = shared.filter(t => capsAt(t).every(c => !capRange(c, coverCount)))
  const [splitting, setSplitting] = useState(false)
  // Cover split needs 2026-10-10_maestro_covers.sql: until it has run, no cover boxes
  const hasCovers = !captains.length || captains.some(c => 'cover_from' in c)
  // Maestro: a shared table with no split set is split evenly in captain order (as the tablets do)
  const autoOf = c => {
    if (!maestro || !c.table_number || capRange(c, coverCount)) return null
    const r = tableRanges(captains, c.table_number, coverCount).get(c.id)
    return r?.auto ? r : null
  }
  const rangeLabel = c => { const r = capRange(c, coverCount); if (r) return capRangeText(r); const a = autoOf(c); return a ? capRangeText(a) + ' (automatic)' : 'all covers' }
  // Captains whose covers overlap another captain's at the same table
  const overlapOf = c => {
    const r = capRange(c, coverCount)
    if (!r || !c.table_number) return ''
    return captains.filter(x => x.id !== c.id && x.table_number === c.table_number)
      .filter(x => { const o = capRange(x, coverCount); return o && o.from <= r.to && r.from <= o.to }).map(x => x.name).join(', ')
  }

  // Shared tables with no split yet: covers divided evenly, in captain order (Rahul C1–C5, Imran C6–C10)
  async function splitEvenly() {
    setSplitting(true)
    for (const t of unsplit) {
      const list = capsAt(t)
      for (let i = 0; i < list.length; i++) {
        const from = Math.floor(i * coverCount / list.length) + 1, to = Math.floor((i + 1) * coverCount / list.length)
        if (from > to) continue
        if (!(await save(list[i], { cover_from: from, cover_to: to }))) { setSplitting(false); return }
      }
    }
    setSplitting(false)
    setMsg({ tone:'ok', text: 'Covers split for table' + (unsplit.length === 1 ? ' ' : 's ') + ranges(unsplit) + '. Change any range in the captain’s row.' })
  }

  // One write for any field of one captain, with the old value put back if it fails
  async function save(c, fields) {
    const before = Object.fromEntries(Object.keys(fields).map(k => [k, c[k] ?? null]))
    if (Object.keys(fields).every(k => (fields[k] ?? null) === before[k])) return true
    setCaptains(prev => prev.map(x => x.id === c.id ? { ...x, ...fields } : x))
    const { error } = await supabase.from('captains').update(fields).eq('id', c.id)
    if (error) {
      setCaptains(prev => prev.map(x => x.id === c.id ? { ...x, ...before } : x))
      setMsg({ tone:'err', text: c.name + ' — ' + (error.code === '23505' ? 'another captain already has that name'
        : /cover_(from|to)/.test(String(error.message || '')) ? COVER_SQL_HINT : errText(error)) })
      return false
    }
    tick(c.id)
    return true
  }

  async function remove(c) {
    // No confirm dialog: removal is a soft delete and the captain can be added back
    const { error } = await supabase.from('captains').update({ is_active:false }).eq('id', c.id)
    if (error) { setMsg({ tone:'err', text: c.name + ' — ' + errText(error) }); return }
    setCaptains(prev => prev.filter(x => x.id !== c.id))
    setMsg({ tone:'ok', text: c.name + ' removed. Orders they already took keep their name.' })
  }

  async function create() {
    const name = add.name.trim(), pin = add.pin.trim()
    const table = add.table.trim() ? parseInt(add.table, 10) : null
    if (!name) { setMsg({ tone:'err', text:'Enter the captain’s name' }); return }
    if (!/^\d{4}$/.test(pin)) { setMsg({ tone:'err', text:'The PIN must be exactly 4 digits' }); return }
    setAdding(true)
    let { data, error } = await supabase.from('captains')
      .insert({ event_id:eventId, name, pin, table_number:table, is_active:true })
      .select('*').single()
    if (error?.code === '23505') {
      // The name belongs to a captain removed earlier: bring them back with the new PIN and table
      const { data: old } = await supabase.from('captains').select('id').eq('event_id', eventId).eq('is_active', false).ilike('name', name).maybeSingle()
      if (old) ({ data, error } = await supabase.from('captains').update({ pin, table_number:table, is_active:true }).eq('id', old.id)
        .select('*').single())
      // An old cover range belongs to the old table
      if (!error && data && (data.cover_from != null || data.cover_to != null)) {
        const r = await supabase.from('captains').update({ cover_from:null, cover_to:null }).eq('id', data.id).select('*').single()
        if (!r.error) data = r.data
      }
    }
    setAdding(false)
    if (error) {
      setMsg({ tone:'err', text: error.code === '23505' ? 'A captain called "' + name + '" already exists at this event.' : errText(error) })
      return
    }
    setCaptains(prev => [...prev, data].sort(naturalBy('name')))
    setAdd({ name:'', pin:'', table: table ? String(table) : '' })
    tick(data.id)
    setMsg(null)
  }
  const suggestPin = () => setAdd(a => ({ ...a, pin: randomPins(1, captains.map(c => c.pin).filter(Boolean))[0] || '' }))

  return (
    <div style={card} id="ks-captains">
      <SectionHead step={step} title="Captains"
        sub={'Everything about captains is here: name, sign-in PIN, the table they serve'
          + (tableCount ? ' (1–' + tableCount + ')' : '') + ' and, when two captains share a table, the covers each one looks after (1–'
          + coverCount + '). On the tablet a captain signs in with name and PIN; the event, table and covers are found automatically.'
          + ' A captain sees their own covers first and taps All covers when needed.'} />

      {msg && <Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      {captains.length > 0 && (
        <div style={{ fontSize:12.5, lineHeight:1.6, background:'var(--bg)', borderRadius:9, padding:'8px 12px',
          marginBottom:10, color:'var(--ink2)', fontWeight:600 }}>
          <span style={{ fontWeight:800, color:'var(--ink)' }}>Tables with captains:</span>{' '}
          {covered.length ? ranges(covered) : 'none yet'}
          {tableCount ? (
            <>
              {'  ·  '}
              <span style={{ fontWeight:800, color: uncovered.length ? AMBER_INK : GREEN }}>Tables without a captain:</span>{' '}
              <span style={{ color: uncovered.length ? AMBER_INK : GREEN }}>{uncovered.length ? ranges(uncovered) : 'none'}</span>
            </>
          ) : null}
          {hasCovers && shared.length > 0 && (
            <div style={{ marginTop:4 }}>
              <span style={{ fontWeight:800, color:'var(--ink)' }}>Shared tables:</span>{' '}
              {shared.map((t, i) => (
                <span key={t}>{i ? '  ·  ' : ''}T{t} {capsByCover(t).map(c => c.name + ' ' + rangeLabel(c)).join(', ')}</span>
              ))}
              {unsplit.length > 0 && (
                <button onClick={splitEvenly} disabled={splitting}
                  style={{ ...btn, height:28, padding:'0 10px', fontSize:12, marginLeft:8, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)' }}>
                  {splitting ? 'Splitting…' : 'Split covers evenly: table' + (unsplit.length === 1 ? ' ' : 's ') + unsplit.join(', ')}</button>
              )}
            </div>
          )}
        </div>
      )}

      {captains.length > 0 && (
        <div className="ks-caps" style={{ marginBottom:12 }}>
          {byTable(captains).map(c => (
            <CaptainRow key={c.id + ':' + (c.table_number ?? '') + ':' + (c.pin ?? '')}
              c={c} tableCount={tableCount} coverCount={hasCovers ? coverCount : 0} autoLabel={rangeLabel(c)}
              onSave={save} onRemove={remove} saved={!!ticks[c.id]}
              crowd={c.table_number ? perTable[c.table_number] : 0} overlap={overlapOf(c)} />
          ))}
        </div>
      )}

      {/* Add a captain: name, PIN and table in one line */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', paddingTop: captains.length ? 10 : 0,
        borderTop: captains.length ? '1px solid var(--line)' : 'none' }}>
        <span style={{ ...label, flexShrink:0 }}>Add captain</span>
        <input value={add.name} placeholder="Name" onChange={e => setAdd(a => ({ ...a, name:e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...input, flex:'1 1 160px', width:'auto' }} />
        <input value={add.pin} placeholder="PIN" inputMode="numeric" maxLength={4}
          onChange={e => setAdd(a => ({ ...a, pin:e.target.value.replace(/\D/g, '').slice(0, 4) }))}
          onKeyDown={e => { if (e.key === 'Enter') create() }}
          style={{ ...input, width:84, textAlign:'center', fontWeight:900, letterSpacing:'2px' }} />
        <button type="button" onClick={suggestPin} title="Suggest a PIN nobody else has"
          style={{ ...btn, background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)', padding:'0 10px' }}>New PIN</button>
        <input value={add.table} placeholder="Table" inputMode="numeric"
          onChange={e => setAdd(a => ({ ...a, table:e.target.value.replace(/\D/g, '').slice(0, 3) }))}
          onKeyDown={e => { if (e.key === 'Enter') create() }}
          style={{ ...input, width:76, textAlign:'center', fontWeight:900 }} />
        <button onClick={create} disabled={adding || !add.name.trim() || add.pin.length !== 4}
          style={{ ...btn, opacity: (!add.name.trim() || add.pin.length !== 4) ? 0.45 : 1 }}>{adding ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  )
}

function CaptainRow({ c, tableCount, coverCount = 10, onSave, onRemove, saved, crowd, overlap, autoLabel }) {
  const [draft, setDraft] = useState(c.table_number ? String(c.table_number) : '')
  const [pin, setPin] = useState(c.pin || '')
  const [cf, setCf] = useState(c.cover_from ? String(c.cover_from) : '')
  const [ct, setCt] = useState(c.cover_to ? String(c.cover_to) : '')
  const [err, setErr] = useState('')
  // A range saved elsewhere (Split covers evenly) shows in the boxes
  const saved2 = (c.cover_from ?? '') + '-' + (c.cover_to ?? '')
  const [seenRange, setSeenRange] = useState(saved2)
  if (seenRange !== saved2) { setSeenRange(saved2); setCf(c.cover_from ? String(c.cover_from) : ''); setCt(c.cover_to ? String(c.cover_to) : '') }
  const covers = coverCount > 0
  const range = covers ? capRange(c, coverCount) : null
  // Saved when focus leaves both cover boxes, so typing first then last is one change
  const coverBlur = e => { if (e.relatedTarget?.dataset?.cov === c.id) return; commitCovers() }

  // Both empty: every cover. One filled: from that cover to the last, or from the first to it.
  async function commitCovers() {
    const f = cf.trim() ? parseInt(cf, 10) : null, t = ct.trim() ? parseInt(ct, 10) : null
    const reset = () => { setCf(c.cover_from ? String(c.cover_from) : ''); setCt(c.cover_to ? String(c.cover_to) : '') }
    if (f == null && t == null) { setErr(''); await onSave(c, { cover_from: null, cover_to: null }); return }
    const from = f ?? 1, to = t ?? coverCount
    if (from < 1 || to > coverCount || from > to) { setErr('Covers 1–' + coverCount + ', first before last'); reset(); return }
    setErr('')
    const all = from === 1 && to === coverCount
    if (!(await onSave(c, all ? { cover_from: null, cover_to: null } : { cover_from: from, cover_to: to }))) reset()
  }

  async function commitTable() {
    const s = draft.trim()
    const v = s === '' ? null : parseInt(s, 10)
    if (s !== '' && (!v || v < 1)) { setErr('Enter a table number'); setDraft(c.table_number ? String(c.table_number) : ''); return }
    setErr('')
    // A cover range belongs to the table: moving the captain clears it
    const clear = v !== c.table_number && (c.cover_from != null || c.cover_to != null) ? { cover_from: null, cover_to: null } : {}
    await onSave(c, { table_number: v, ...clear })
  }
  async function commitPin() {
    const v = pin.trim()
    if (v === (c.pin || '')) return
    if (!/^\d{4}$/.test(v)) { setErr('PIN must be 4 digits'); setPin(c.pin || ''); return }
    setErr('')
    await onSave(c, { pin: v })
  }

  const warn = err ? err
    : !/^\d{4}$/.test(String(c.pin || '')) ? 'Needs a 4-digit PIN'
    : !c.table_number ? 'No table yet'
    : tableCount && c.table_number > tableCount ? 'Above the ' + tableCount + ' tables at this event'
    : crowd > 2 ? crowd + ' captains on table ' + c.table_number
    : overlap ? 'Covers overlap with ' + overlap
    : null
  const tone = err || (c.table_number && warn) ? RED : warn ? AMBER_INK : null

  const box = { ...input, height:34, textAlign:'center', fontWeight:900, flexShrink:0,
    borderColor: tone === RED ? '#FCA5A5' : tone ? AMBER_LINE : 'var(--line)' }
  return (
    <div className="ks-row" style={{ borderRadius:10, padding:'7px 8px 8px 12px',
      border:'1.5px solid ' + (tone === RED ? '#FECACA' : tone ? AMBER_LINE : 'var(--line)'),
      background: tone === RED ? '#FEF2F2' : tone ? AMBER_BG : '#fff' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div title={c.name} style={{ fontSize:14, fontWeight:800, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
          <div style={{ fontSize:11.5, fontWeight:700, color: tone || 'var(--ink2)', minHeight:16 }}>
            {warn || 'Table ' + c.table_number + ' · ' + (covers ? capRangeText(range) === 'all covers' && autoLabel ? autoLabel : capRangeText(range) : autoLabel || 'all covers')}
            <Saved show={saved} />
          </div>
        </div>
        <RemoveX what={c.name} onRemove={() => onRemove(c)} />
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6, flexWrap:'wrap' }}>
        <span style={{ ...label, fontSize:10 }}>PIN</span>
        <input value={pin} inputMode="numeric" maxLength={4} placeholder="PIN" title="Sign-in PIN"
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr('') }}
          onBlur={commitPin} onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          style={{ ...box, width:64, fontSize:14, letterSpacing:'2px', borderColor:'var(--line)' }} />
        <span style={{ ...label, fontSize:10, marginLeft:4 }}>Table</span>
        <input value={draft} inputMode="numeric" placeholder="—"
          onChange={e => { setDraft(e.target.value.replace(/\D/g, '').slice(0, 3)); setErr('') }}
          onBlur={commitTable} onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          style={{ ...box, width:52, fontSize:15 }} />
        {covers && <>
          <span style={{ ...label, fontSize:10, marginLeft:4 }} title={'Covers this captain looks after (1–' + coverCount + '). Empty = all covers of the table.'}>Covers</span>
          <input value={cf} inputMode="numeric" placeholder="1" title="First cover" data-cov={c.id}
            onChange={e => { setCf(e.target.value.replace(/\D/g, '').slice(0, 2)); setErr('') }}
            onBlur={coverBlur} onKeyDown={e => { if (e.key === 'Enter') commitCovers() }}
            style={{ ...box, width:40, padding:'0 4px', fontSize:14 }} />
          <span style={{ color:'var(--ink2)', fontWeight:800 }}>–</span>
          <input value={ct} inputMode="numeric" placeholder={String(coverCount)} title="Last cover" data-cov={c.id}
            onChange={e => { setCt(e.target.value.replace(/\D/g, '').slice(0, 2)); setErr('') }}
            onBlur={coverBlur} onKeyDown={e => { if (e.key === 'Enter') commitCovers() }}
            style={{ ...box, width:40, padding:'0 4px', fontSize:14 }} />
        </>}
      </div>
    </div>
  )
}

/* × that needs a second tap: removing a captain or waiter signs them out of their tablet,
   so a stray tap during service must not do it. */
function RemoveX({ what, onRemove }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  if (armed) return (
    <button onClick={() => { setArmed(false); onRemove() }} title={'Tap again to remove ' + what}
      style={{ background:RED, border:'none', color:'#fff', fontSize:11.5, fontWeight:900, borderRadius:8,
        height:30, padding:'0 8px', cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' }}>Remove?</button>
  )
  return (
    <button onClick={() => setArmed(true)} title={'Remove ' + what}
      style={{ background:'none', border:'none', color:RED, fontSize:18, fontWeight:800, cursor:'pointer', padding:'0 2px', flexShrink:0 }}>×</button>
  )
}

/* ------------------------------------------------------ waiters → kitchens */

function WaitersSection({ eventId, waiters, setWaiters, kitchens }) {
  const [add, setAdd] = useState({ number:'', name:'', kitchen:'' })
  const [adding, setAdding] = useState(false)
  const [ticks, tick] = useTicks()
  const [msg, setMsg] = useState(null)
  const [issued, setIssued] = useState(null)   // [{ w, pin }] after "Give PINs"
  const [issuing, setIssuing] = useState(false)
  const [copied, setCopied] = useState('')
  const urlRef = useRef(null)
  const url = (typeof window !== 'undefined' ? window.location.origin : '') + '/waiter'
  const active = kitchens.filter(k => k.is_active)
  const activeIds = new Set(active.map(k => k.id))
  const missingPin = waiters.filter(w => !/^\d{4}$/.test(String(w.pin || '')))
  const noKitchen = waiters.filter(w => !activeIds.has(w.kitchen_id))

  async function patch(w, fields, revertFields) {
    setWaiters(prev => prev.map(x => x.id === w.id ? { ...x, ...fields } : x))
    const { error } = await supabase.from('waiters').update(fields).eq('id', w.id)
    if (error) {
      setWaiters(prev => prev.map(x => x.id === w.id ? { ...x, ...revertFields } : x))
      setMsg({ tone:'err', text: (w.waiter_number || w.name) + ' — ' + errText(error) })
      return false
    }
    tick(w.id)
    return true
  }

  // Add a waiter here, with kitchen and PIN, instead of a separate Waiters tab
  async function create() {
    const num = add.number.trim(), nm = add.name.trim()
    if (!num && !nm) { setMsg({ tone:'err', text:'Enter a waiter number or name' }); return }
    setAdding(true)
    const pin = randomPins(1, waiters.map(w => w.pin).filter(Boolean))[0]
    const row = { event_id:eventId, waiter_number: num || nm, name: nm && num ? nm + ' (' + num + ')' : (nm || num),
      kitchen_id: add.kitchen || null, pin, is_active:true }
    let { data, error } = await supabase.from('waiters').insert(row)
      .select('id, waiter_number, name, is_active, kitchen_id, pin').single()
    if (error?.code === '23505') {
      // Number used by a waiter removed earlier: bring that row back instead
      const { data: old } = await supabase.from('waiters').select('id').eq('event_id', eventId).eq('is_active', false)
        .eq('waiter_number', row.waiter_number).limit(1).maybeSingle()
      if (old) ({ data, error } = await supabase.from('waiters').update({ name:row.name, kitchen_id:row.kitchen_id, pin, is_active:true })
        .eq('id', old.id).select('id, waiter_number, name, is_active, kitchen_id, pin').single())
      else error = { message:'Waiter ' + row.waiter_number + ' already exists at this event.' }
    }
    setAdding(false)
    if (error) { setMsg({ tone:'err', text: errText(error) }); return }
    setWaiters(prev => [...prev, data].sort(naturalBy('waiter_number')))
    setIssued([{ w:data, pin }])
    setAdd(a => ({ number:'', name:'', kitchen:a.kitchen }))
    tick(data.id)
  }
  async function removeWaiter(w) {
    const { error } = await supabase.from('waiters').update({ is_active:false }).eq('id', w.id)
    if (error) { setMsg({ tone:'err', text: errText(error) }); return }
    setWaiters(prev => prev.filter(x => x.id !== w.id))
  }

  async function givePins() {
    if (!missingPin.length) return
    setIssuing(true); setIssued(null)
    const pins = randomPins(missingPin.length, waiters.map(w => w.pin).filter(Boolean))
    const plan = missingPin.map((w, i) => ({ w, pin: pins[i] }))
    setWaiters(prev => prev.map(x => { const p = plan.find(p => p.w.id === x.id); return p ? { ...x, pin:p.pin } : x }))
    const res = await Promise.all(plan.map(p => supabase.from('waiters').update({ pin:p.pin }).eq('id', p.w.id)))
    setIssuing(false)
    const failed = plan.filter((p, i) => res[i].error)
    if (failed.length) {
      setWaiters(prev => prev.map(x => failed.some(f => f.w.id === x.id) ? { ...x, pin:null } : x))
      setMsg({ tone:'err', text: failed.length + ' PIN' + (failed.length === 1 ? '' : 's') + ' not saved — ' + errText(res.find(r => r.error).error) })
    }
    const ok = plan.filter(p => !failed.includes(p))
    ok.forEach(p => tick(p.w.id))
    if (ok.length) setIssued(ok)
  }

  async function copy() {
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); ok = true }
    } catch { /* refused - try the older way below */ }
    if (!ok) {
      // Plain-http tablets and locked-down browsers have no clipboard API; execCommand still works there
      try {
        const ta = document.createElement('textarea')
        ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        ok = !!(document.execCommand && document.execCommand('copy'))
        document.body.removeChild(ta)
      } catch { ok = false }
    }
    // Last resort: leave the address selected so a long-press or Ctrl+C copies it
    if (!ok && urlRef.current) window.getSelection?.().selectAllChildren(urlRef.current)
    setCopied(ok ? 'ok' : 'fail')
    setTimeout(() => setCopied(''), ok ? 2500 : 5000)
  }

  return (
    <div style={card} id="ks-waiters">
      <SectionHead step={5} title="Waiters → kitchens"
        sub={"Each waiter carries food for one kitchen and sees only that kitchen's KOTs on their phone. "
          // mk_waiter_login accepts the name, the full stored name or the number with or without leading zeros
          + 'They sign in with their name or waiter number'
          + (waiters[0]?.waiter_number ? ' (e.g. ' + waiters[0].waiter_number + ')' : '') + ' and their 4-digit PIN.'}
        right={waiters.length > 0 && (
          <button onClick={givePins} disabled={!missingPin.length || issuing}
            style={{ ...btn, background: missingPin.length ? MARI : '#E5E7EB', color: missingPin.length ? '#fff' : '#9CA3AF',
              cursor: missingPin.length ? 'pointer' : 'default' }}>
            {issuing ? 'Saving PINs…' : missingPin.length
              ? 'Give PINs to ' + plural(missingPin.length, 'waiter') + ' without one'
              : 'Every waiter has a PIN'}
          </button>
        )} />

      {/* The address to open on every waiter's phone. Big, because it is read off this screen across a room. */}
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', background:'var(--ink)', color:'#fff',
        borderRadius:12, padding:'12px 16px', marginBottom:12 }}>
        <div style={{ flex:'1 1 300px', minWidth:0 }}>
          <div style={{ ...label, color:'rgba(255,255,255,0.65)' }}>Waiter app — open on each waiter's phone</div>
          <div ref={urlRef} style={{ fontSize:24, fontWeight:900, letterSpacing:'0.2px', marginTop:2, wordBreak:'break-all',
            userSelect:'text', WebkitUserSelect:'text' }}>{url}</div>
        </div>
        <button onClick={copy} style={{ ...btn, background: copied === 'ok' ? GREEN : MARI, height:40, minWidth:96 }}>
          {copied === 'ok' ? 'Copied ✓' : copied === 'fail' ? 'Selected — copy it' : 'Copy'}
        </button>
      </div>

      {msg && <Banner tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      {issued && (
        <Banner tone="ok" onClose={() => setIssued(null)}>
          New PINs — read them out or note them down:
          <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 16px', marginTop:6 }}>
            {issued.map(p => (
              <span key={p.w.id} style={{ fontSize:14, fontWeight:900, color:'#14532D' }}>
                {p.w.waiter_number || p.w.name}{waiterName(p.w) ? ' ' + waiterName(p.w) : ''}
                <span style={{ fontWeight:600, color:'#15803D' }}> → </span>
                <span style={{ letterSpacing:'2px' }}>{p.pin}</span>
              </span>
            ))}
          </div>
        </Banner>
      )}

      {waiters.length === 0 ? (
        <Banner tone="info" style={{ marginBottom:10 }}>
          No waiters at this event yet. Add them below: each one gets a kitchen and a PIN straight away.
        </Banner>
      ) : (
        <>
          {/* Per-kitchen head count: a kitchen with nobody on it has KOTs nobody carries */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
            {active.map(k => {
              const n = waiters.filter(w => w.kitchen_id === k.id).length
              return (
                <span key={k.id} style={{ fontSize:12, fontWeight:800, borderRadius:999, padding:'4px 11px',
                  background: n ? '#F3EEF8' : '#FEF2F2', color: n ? 'var(--ink)' : '#B91C1C',
                  border:'1px solid ' + (n ? 'var(--line)' : '#FECACA') }}>
                  {k.name} · {n ? plural(n, 'waiter') : 'no waiter'}
                </span>
              )
            })}
            {noKitchen.length > 0 && (
              <span style={{ fontSize:12, fontWeight:800, borderRadius:999, padding:'4px 11px',
                background:AMBER_BG, color:AMBER_INK, border:'1px solid ' + AMBER_LINE }}>
                No kitchen · {noKitchen.length}
              </span>
            )}
          </div>
          <div className="ks-wtrs">
            {waiters.map(w => (
              // Keyed on the PIN too: one set by Give PINs replaces the draft and any old complaint
              <WaiterRow key={w.id + ':' + (w.pin ?? '')} w={w} kitchens={kitchens} activeIds={activeIds} saved={!!ticks[w.id]}
                onKitchen={id => patch(w, { kitchen_id: id || null }, { kitchen_id: w.kitchen_id ?? null })}
                onPin={pin => patch(w, { pin }, { pin: w.pin ?? null })} onRemove={() => removeWaiter(w)} />
            ))}
          </div>
        </>
      )}

      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', paddingTop:10, marginTop:10,
        borderTop:'1px solid var(--line)' }}>
        <span style={{ ...label, flexShrink:0 }}>Add waiter</span>
        <input value={add.number} placeholder="No. e.g. 07" onChange={e => setAdd(a => ({ ...a, number:e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...input, width:100 }} />
        <input value={add.name} placeholder="Name (optional)" onChange={e => setAdd(a => ({ ...a, name:e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') create() }} style={{ ...input, flex:'1 1 150px', width:'auto' }} />
        <select value={add.kitchen} onChange={e => setAdd(a => ({ ...a, kitchen:e.target.value }))}
          style={{ ...input, width:150, cursor:'pointer' }}>
          <option value="">Kitchen…</option>
          {active.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
        <button onClick={create} disabled={adding || (!add.number.trim() && !add.name.trim())}
          style={{ ...btn, opacity: (!add.number.trim() && !add.name.trim()) ? 0.45 : 1 }}>{adding ? 'Adding…' : 'Add'}</button>
        <span style={{ fontSize:11.5, color:'var(--ink2)' }}>A PIN is given automatically.</span>
      </div>
    </div>
  )
}

function WaiterRow({ w, kitchens, activeIds, saved, onKitchen, onPin, onRemove }) {
  const [pin, setPin] = useState(w.pin || '')
  const [err, setErr] = useState('')

  async function commitPin() {
    const v = pin.trim()
    if (v === (w.pin || '')) { setErr(''); return }
    if (v !== '' && !/^\d{4}$/.test(v)) { setErr('PIN must be 4 digits'); setPin(w.pin || ''); return }
    setErr('')
    // Clearing a PIN is allowed (it locks the waiter out) and shows up in the checklist
    await onPin(v || null)
  }

  const kitchenOk = activeIds.has(w.kitchen_id)
  const pinOk = /^\d{4}$/.test(String(w.pin || ''))
  const current = kitchens.find(k => k.id === w.kitchen_id)
  const problem = err || (!kitchenOk ? (current ? current.name + ' is off — pick another kitchen' : 'Pick a kitchen') : !pinOk ? 'Needs a PIN' : null)
  const nm = waiterName(w)

  return (
    <div className="ks-row" style={{ borderRadius:10, padding:'7px 8px 7px 10px',
      border:'1.5px solid ' + (problem ? AMBER_LINE : 'var(--line)'), background: problem ? AMBER_BG : '#fff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span style={{ minWidth:34, height:30, borderRadius:8, background:'var(--ink)', color:'#fff', fontSize:13,
          fontWeight:900, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'0 6px',
          flexShrink:0 }}>{w.waiter_number || '—'}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:800, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
            color: nm ? 'var(--ink)' : '#9CA3AF' }}>{nm || 'No name'}</div>
          <div style={{ fontSize:11, fontWeight:700, color: problem ? (err ? RED : AMBER_INK) : GREEN, minHeight:15,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{problem || 'Ready'}<Saved show={saved} /></div>
        </div>
        <select value={w.kitchen_id || ''} onChange={e => onKitchen(e.target.value)}
          style={{ ...input, width:124, height:36, fontSize:13, flexShrink:0, cursor:'pointer', paddingRight:4,
            borderColor: kitchenOk ? 'var(--line)' : AMBER_LINE, color: w.kitchen_id ? 'var(--ink)' : '#9CA3AF' }}>
          <option value="">Kitchen…</option>
          {kitchens.filter(k => k.is_active || k.id === w.kitchen_id).map(k => (
            <option key={k.id} value={k.id}>{k.name}{k.is_active ? '' : ' (off)'}</option>
          ))}
        </select>
        <input value={pin} inputMode="numeric" maxLength={4} placeholder="PIN" title="4-digit PIN"
          onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr('') }}
          onBlur={commitPin} onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          style={{ ...input, width:70, height:36, textAlign:'center', fontSize:14, fontWeight:900, letterSpacing:'2px',
            flexShrink:0, borderColor: err ? RED : pinOk ? 'var(--line)' : AMBER_LINE }} />
        {onRemove && <RemoveX what={nm || 'this waiter'} onRemove={onRemove} />}
      </div>
    </div>
  )
}
