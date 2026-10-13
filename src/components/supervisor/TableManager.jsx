import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { WaiterList, HelpItemsEditor } from './EventManager'
import CaptainList from './CaptainList'
import KitchenSetup from './KitchenSetup'
import OfflineKitCard from './OfflineKitCard'
import Fold from './Fold'
import { jumpTo, setFold } from '../../lib/fold'

/* Table management for the current event.

   Online is judged on the heartbeat rather than the claim itself.
   Guest tablets touch last_seen_at every 2 minutes, but the window
   is a full hour: guests order and then leave the tablet alone for
   long stretches, and flagging those as offline would make the
   warning meaningless.

   A claim older than an hour with no beat expires on its own and
   any tablet can take the number. Release is available at any
   moment, so nothing actually has to wait an hour. */

// A guest ordering and then not touching the tablet for half an hour is
// completely normal, so a short window paints the screen red for tablets
// that are working fine - and a warning that is usually wrong gets ignored.
const ONLINE_MS = 60 * 60 * 1000
const STALE_MS  = 60 * 60 * 1000

function statusOf(row) {
  if (!row.claimed_by_device) return 'free'
  const seen = row.last_seen_at || row.claimed_at
  if (!seen) return 'free'
  return (Date.now() - new Date(seen).getTime()) < ONLINE_MS ? 'online' : 'offline'
}

const STATUS = {
  online:  { label:'ONLINE',       color:'#16A34A', bg:'#DCFCE7', border:'#86EFAC' },
  offline: { label:'OFFLINE',      color:'#DC2626', bg:'#FEF2F2', border:'#FECACA' },
  free:    { label:'NOT ASSIGNED', color:'#6B7280', bg:'#F3F4F6', border:'#E5E7EB' },
}

/* ----------------------------------------------------------------------
   Control: ONE set-up screen per event type.

   Everything a supervisor sets up for an event is on this one page, in the
   order it is done, with a ready-check on top. Sections that do not apply
   to the event type are not shown at all, so nobody configures something
   that has no effect (an order limit on a Maestro event, waiters on a
   Maestro event, tablets on a captain event).
   ---------------------------------------------------------------------- */
const MODES = {
  self:    { name:'Guest Self-Service', note:'A tablet on every table; guests order for themselves and waiters deliver.' },
  captain: { name:'Captain Service', note:'Captains carry the tablet and take orders; waiters deliver.' },
  multi:   { name:'Captain + Multi-Kitchen', note:'Captains order by chair; each cuisine KOT prints in its own kitchen; waiters carry from their kitchen.' },
  maestro: { name:'Smart Serve Maestro', note:'Plated, course-by-course service: hold and fire per cover, barkers on kitchen screens, Control Desk.' },
}
export function modeOf(ev) {
  return ev?.maestro ? 'maestro' : ev?.multi_kitchen ? 'multi' : ev?.service_mode === 'captain' ? 'captain' : 'self'
}

export default function TableManager({ eventData, onEventChange }) {
  const mode = modeOf(eventData)
  const [nonce, setNonce] = useState(0)
  if (!eventData?.id) return null

  // The jump bar: every section of this event type, in order
  const nav = {
    self:    [['ss-ready','Ready check'], ['st-tables','Tables & tablets'], ['ss-waiters','Waiters'], ['ss-help','Help requests'], ['ss-limit','Order limit'], ['ss-offline','Offline kit']],
    captain: [['ss-ready','Ready check'], ['ss-captains','Captains'], ['ss-waiters','Waiters'], ['st-tables','Tables'], ['ss-help','Help requests'], ['ss-limit','Order limit'], ['ss-offline','Offline kit']],
    multi:   [['ks-ready','Ready check'], ['ks-chairs','Chairs'], ['ks-kitchens','Kitchens & printers'], ['ks-routing','Menu routing'], ['ks-captains','Captains'], ['ks-waiters','Waiters'], ['st-tables','Tables'], ['ss-help','Help requests'], ['ss-limit','Order limit'], ['ss-offline','Offline kit']],
    maestro: [['ms-ready','Ready check'], ['ks-chairs','1 Tables & chairs'], ['ks-kitchens','2 Kitchens & printers'], ['ms-barkers','3 Barkers'], ['ks-captains','4 Captains'],
      ['ms-courses','5 Courses'], ['ks-routing','6 Menu routing'], ['ms-rules','7 Kitchen rules'], ['ms-dishes','8 Dishes'], ['ms-vip','9 VIP guests'], ['ms-screens','10 Big screens'], ['ss-offline','11 Offline kit']],
  }[mode]
  // A collapsed section opens first (Maestro), then the page scrolls to it
  const jump = id => jumpTo(id)
  const sectionHead = (id, title, sub) => (
    <div id={id} style={{ margin:'18px 0 8px', scrollMarginTop:70 }}>
      <h3 style={{ fontSize:16, fontWeight:900 }}>{title}</h3>
      {sub && <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:2, lineHeight:1.5 }}>{sub}</div>}
    </div>
  )

  return (
    <div key={eventData.id + ':' + mode}>
      <style>{`#ss-setup [id]{scroll-margin-top:110px}`}</style>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:10, flexWrap:'wrap' }}>
        <div style={{ minWidth:0 }}>
          <h2 style={{ fontSize:20, fontWeight:800 }}>Event set-up</h2>
          <div style={{ fontSize:12.5, color:'var(--ink2)', marginTop:3 }}>
            <span style={{ background:'var(--ink)', color:'#fff', borderRadius:999, padding:'2px 10px', fontWeight:800, fontSize:11.5, marginRight:8 }}>
              {MODES[mode].name}</span>
            {MODES[mode].note} Everything for this event type is on this page; change the type under Events.
          </div>
        </div>
        <button onClick={() => setNonce(n => n + 1)} style={{ background:'var(--ink)', color:'#fff', border:'none',
          borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Refresh</button>
      </div>

      {/* Jump bar - stays at the top while scrolling */}
      <div style={{ position:'sticky', top:0, zIndex:20, background:'var(--bg)', padding:'6px 0 8px', marginBottom:6,
        display:'flex', gap:6, ...(mode === 'maestro' ? { flexWrap:'wrap' } : { overflowX:'auto' }) }}>
        {nav.map(([id, label]) => (
          <button key={id} onClick={() => jump(id)}
            style={{ flexShrink:0, padding:'6px 12px', borderRadius:999, fontSize:12.5, fontWeight:700, cursor:'pointer',
              border:'1.5px solid var(--line)', background:'#fff', color:'var(--ink)', whiteSpace:'nowrap' }}>{label}</button>
        ))}
        {mode === 'maestro' && <>
          <span style={{ flex:'1 0 8px' }} />
          {[['Collapse all', false], ['Open all', true]].map(([label, open]) => (
            <button key={label} onClick={() => setFold('*', open)} data-testid={open ? 'open-all' : 'collapse-all'}
              style={{ flexShrink:0, padding:'6px 12px', borderRadius:999, fontSize:12.5, fontWeight:800, cursor:'pointer',
                border:'1.5px solid var(--ink)', background: open ? 'var(--ink)' : '#fff', color: open ? '#fff' : 'var(--ink)', whiteSpace:'nowrap' }}>{label}</button>
          ))}
        </>}
      </div>

      <div id="ss-setup" key={nonce} style={{ paddingBottom:'45vh' /* lets the last sections scroll to the top from the jump bar */ }}>
        {(mode === 'self' || mode === 'captain') && <BasicReadiness eventData={eventData} mode={mode} />}

        {(mode === 'multi' || mode === 'maestro') && <KitchenSetup eventData={eventData} onEventChange={onEventChange} />}

        {mode === 'captain' && <>
          {sectionHead('ss-captains', 'Captains', 'Name and 4-digit PIN for each captain. On the tablet they sign in with these; the event is found automatically.')}
          <CaptainList eventId={eventData.id} />
        </>}

        {mode === 'self' && <TablesSection eventData={eventData} onEventChange={onEventChange} showTablets />}

        {(mode === 'self' || mode === 'captain') && <>
          {sectionHead('ss-waiters', 'Waiters', 'The people who carry food and answer help requests. The desk assigns them to orders.')}
          <WaiterList eventId={eventData.id} />
        </>}

        {/* Maestro: the number of tables is in Tables & chairs (step 1) */}
        {mode !== 'self' && mode !== 'maestro' && <TablesSection eventData={eventData} onEventChange={onEventChange} showTablets={false} />}

        {mode !== 'maestro' && <>
          {sectionHead('ss-help', 'Help requests', mode === 'self'
            ? 'What guests can ask for from the tablet, and the switch for the Help button.'
            : 'What captains can request from the desk on behalf of a table.')}
          <HelpPane eventData={eventData} onEventChange={onEventChange} mode={mode} />
          {sectionHead('ss-limit', 'Order limit')}
          <EventSettings eventData={eventData} onEventChange={onEventChange} />
        </>}

        {mode === 'maestro' ? <Fold id="ss-offline" step={11} title="Offline kit"><OfflineKitCard /></Fold> : <OfflineKitCard />}
      </div>
    </div>
  )
}

/* Ready check for guest and captain events: the same idea as the kitchen
   check on multi-kitchen and Maestro events - green when everything a
   service needs is in place, each line jumps to the section to fix it. */
function BasicReadiness({ eventData, mode }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const ev = eventData.id
      const [cats, waiters, caps, tables, sups] = await Promise.all([
        supabase.from('menu_categories').select('id').eq('event_id', ev),
        supabase.from('waiters').select('id').eq('event_id', ev).eq('is_active', true),
        supabase.from('captains').select('id, pin').eq('event_id', ev).eq('is_active', true),
        supabase.from('tables').select('id, claimed_by_device, last_seen_at, claimed_at').eq('event_id', ev),
        supabase.from('supervisors').select('id').eq('event_id', ev).eq('is_active', true),
      ])
      const ids = (cats.data || []).map(c => c.id)
      const items = ids.length ? await supabase.from('menu_items').select('id, is_available').in('category_id', ids) : { data: [] }
      if (alive) setD({ cats: ids.length, items: items.data || [], waiters: waiters.data || [], caps: caps.data || [],
        tables: tables.data || [], sups: sups.data || [] })
    })()
    return () => { alive = false }
  }, [eventData.id])
  if (!d) return <div style={{ padding:20, color:'var(--ink2)', fontSize:13 }}>Checking the set-up…</div>
  const n = eventData.number_of_tables || 0
  const live = d.tables.filter(t => statusOf(t) === 'online').length
  const checks = [
    { id:'ss-menu', title:'Menu', ok: d.items.length > 0, detail: d.items.length
        ? d.items.length + ' dishes in ' + d.cats + ' categories'
        : 'No dishes yet — add the menu under the Menu tab' },
    { id:'st-tables', title:'Tables', ok: n > 0, detail: n ? n + ' tables at this event' : 'Set the number of tables' },
    ...(mode === 'self' ? [{ id:'st-tables', title:'Tablets', ok: n > 0 && live >= n,
        detail: live + ' of ' + n + ' tables have a working tablet' }] : []),
    ...(mode === 'captain' ? [{ id:'ss-captains', title:'Captains', ok: d.caps.length > 0 && d.caps.every(c => /^\d{4}$/.test(String(c.pin || ''))),
        detail: !d.caps.length ? 'No captains yet — nobody can take orders' : d.caps.length + ' captains with a sign-in PIN' }] : []),
    { id:'ss-waiters', title:'Waiters', ok: d.waiters.length > 0, detail: d.waiters.length ? d.waiters.length + ' waiters' : 'No waiters yet' },
    { id:'ss-help', title:'Supervisor', ok: d.sups.length > 0, detail: d.sups.length ? d.sups.length + ' supervisor sign-in' + (d.sups.length === 1 ? '' : 's') : 'No supervisor for this event (Events tab)' },
  ]
  const failing = checks.filter(c => !c.ok).length
  const jump = id => document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' })
  return (
    <div id="ss-ready" style={{ background:'#fff', borderRadius:12, padding:'14px 16px', marginBottom:12, boxShadow:'var(--shadow)',
      borderTop:'4px solid ' + (failing ? '#E8890C' : '#16A34A') }}>
      <div style={{ fontSize:11, fontWeight:800, color:'var(--ink2)', textTransform:'uppercase', letterSpacing:'0.4px' }}>Before service</div>
      <div style={{ fontSize:18, fontWeight:900, margin:'2px 0 10px', color: failing ? 'var(--ink)' : '#16A34A' }}>
        {failing ? failing + (failing === 1 ? ' thing' : ' things') + ' to finish before service' : '✓ Ready for service'}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:8 }}>
        {checks.map((c, i) => (
          <button key={i} onClick={() => jump(c.id)} style={{ textAlign:'left', fontFamily:'Manrope', cursor:'pointer', borderRadius:10,
            padding:'9px 11px', display:'flex', gap:9, alignItems:'flex-start',
            background: c.ok ? '#F0FDF4' : '#FEF2F2', border:'1.5px solid ' + (c.ok ? '#BBF7D0' : '#FECACA') }}>
            <span style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, background: c.ok ? '#16A34A' : '#DC2626', color:'#fff',
              fontSize:13, fontWeight:900, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{c.ok ? '✓' : '✗'}</span>
            <span><span style={{ display:'block', fontSize:13, fontWeight:800 }}>{c.title}</span>
              <span style={{ display:'block', fontSize:12, fontWeight:600, color: c.ok ? '#15803D' : '#B91C1C' }}>{c.detail}</span></span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TablesSection({ eventData, onEventChange, showTablets }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [tick, setTick] = useState(0)
  // Table count, editable here so the floor is not stuck with whatever the
  // admin guessed days earlier
  const [countDraft, setCountDraft] = useState('')
  const [savingCount, setSavingCount] = useState(false)
  const [countNote, setCountNote] = useState('')

  useEffect(() => { load() }, [eventData?.id])
  useEffect(() => {
    setCountDraft(String(eventData?.number_of_tables || ''))
  }, [eventData?.id, eventData?.number_of_tables])

  // Re-render every 30s so a tablet going quiet turns red without a refresh
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!eventData?.id) return
    const poll = setInterval(load, 30000)
    return () => clearInterval(poll)
  }, [eventData?.id])

  async function load() {
    if (!eventData?.id) { setLoading(false); return }
    const { data } = await supabase.from('tables')
      .select('id, table_number, claimed_by_device, claimed_at, last_seen_at')
      .eq('event_id', eventData.id).order('table_number')
    setRows(data || [])
    setLoading(false)
  }

  async function release(row) {
    if (!window.confirm('Release table ' + row.table_number + '?\n\nNo orders or reports are affected. The number simply becomes free for another tablet to claim.')) return
    setBusy(row.id)
    await supabase.from('tables')
      .update({ claimed_by_device: null, claimed_at: null, last_seen_at: null })
      .eq('id', row.id)
    setBusy(null); load()
  }

  /* Raising the count is free - the numbers simply become valid. Lowering it
     is not: a tablet already working on table 12 stops being able to order
     the moment the count drops to 10, and the guests on it get no
     explanation. So a live tablet blocks the change outright, and existing
     orders ask first.

     Nothing is deleted. The table rows and their orders stay put and stay in
     the reports; raising the count brings them straight back. */
  async function saveCount() {
    const v = parseInt(countDraft, 10)
    const current = eventData?.number_of_tables || 0
    if (!v || v < 1 || v > 200) { alert('Enter a table count between 1 and 200.'); return }
    if (v === current) return

    if (v < current) {
      const above = rows.filter(r => r.table_number > v)
      const live  = above.filter(r => r.claimed_by_device)
      if (live.length) {
        alert('Table ' + live.map(r => r.table_number).join(', ') +
          ' still ' + (live.length === 1 ? 'has a tablet' : 'have tablets') + ' on it.\n\n' +
          'Release ' + (live.length === 1 ? 'it' : 'them') + ' first, or the tablet stops working mid-service.')
        return
      }
      const ids = above.map(r => r.id)
      if (ids.length) {
        const { count } = await supabase.from('orders')
          .select('id', { count:'exact', head:true }).in('table_id', ids)
        if (count > 0 && !window.confirm(
          'Tables above ' + v + ' have ' + count + ' order' + (count === 1 ? '' : 's') + ' against them.\n\n' +
          'Nothing is deleted and the reports keep every order. Those numbers just stop\n' +
          'being valid for tablets. Continue?')) return
      }
    }

    setSavingCount(true)
    const { error } = await supabase.from('events')
      .update({ number_of_tables: v }).eq('id', eventData.id)
    setSavingCount(false)
    if (error) { alert('Could not save. Check the connection and try again.'); return }
    setCountNote(v > current
      ? (v - current) + ' table' + (v - current === 1 ? '' : 's') + ' added — now ' + v
      : 'Now ' + v + ' tables')
    setTimeout(() => setCountNote(''), 3000)
    const { data } = await supabase.from('events').select('*').eq('id', eventData.id).single()
    if (data && onEventChange) onEventChange(data)
    load()
  }

  const total   = eventData?.number_of_tables || rows.length

  // Built from the event's table count, not from what exists in the table.
  // A table no tablet has ever claimed has no row at all, so it was simply
  // invisible - and that is the one a supervisor needs to spot before service.
  const byNumber = {}
  rows.forEach(r => { byNumber[r.table_number] = r })
  const allTables = Array.from({ length: total }, (_, i) => {
    const n = i + 1
    return byNumber[n] || { id:'empty-' + n, table_number:n, claimed_by_device:null }
  })
  const online  = rows.filter(r => statusOf(r) === 'online').length
  const offline = rows.filter(r => statusOf(r) === 'offline').length
  const missing = Math.max(0, total - online - offline)

  if (loading) return (
    <div style={{ padding:40, textAlign:'center', color:'var(--ink2)', fontSize:14 }}>Loading tables...</div>
  )

  return (
    <div>
      <div id="st-tables" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'4px 0 10px' }}>
        <h3 style={{ fontSize:16, fontWeight:900 }}>{showTablets ? 'Tables and tablets' : 'Tables'}</h3>
        {showTablets && <button onClick={load} style={{ background:'#fff', color:'var(--ink)', border:'1.5px solid var(--line)',
          borderRadius:9, padding:'6px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>Refresh</button>}
      </div>
      <>

      {/* Sits above the counts because it changes what those counts mean */}
      <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', marginBottom:12,
        boxShadow:'var(--shadow)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 200px', minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'var(--ink2)',
              textTransform:'uppercase', letterSpacing:'0.4px' }}>Tables at this event</div>
            <div style={{ fontSize:12, color:'var(--ink2)', marginTop:3, lineHeight:1.5 }}>
              {showTablets
                ? 'Raise it when the caterer lays more. Tablets can claim the new numbers within a minute.'
                : 'Raise it when the caterer lays more. Captains can use the new numbers straight away.'}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
            <button onClick={() => setCountDraft(String(Math.max(1, (parseInt(countDraft,10)||0) - 1)))}
              disabled={savingCount} title="One fewer"
              style={{ width:38, height:40, borderRadius:10, border:'1.5px solid var(--line)',
                background:'#fff', fontSize:18, fontWeight:800, cursor:'pointer' }}>−</button>
            <input type="number" min="1" max="200" value={countDraft}
              onChange={e => setCountDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveCount() }}
              disabled={savingCount}
              style={{ width:72, height:40, borderRadius:10, border:'1.5px solid var(--line)',
                textAlign:'center', fontSize:16, fontWeight:800, fontFamily:'Manrope',
                outline:'none', boxSizing:'border-box' }} />
            <button onClick={() => setCountDraft(String(Math.min(200, (parseInt(countDraft,10)||0) + 1)))}
              disabled={savingCount} title="One more"
              style={{ width:38, height:40, borderRadius:10, border:'1.5px solid var(--line)',
                background:'#fff', fontSize:18, fontWeight:800, cursor:'pointer' }}>+</button>
            <button onClick={saveCount}
              disabled={savingCount || parseInt(countDraft,10) === (eventData?.number_of_tables || 0)}
              style={{ height:40, padding:'0 18px', borderRadius:10, border:'none',
                background: parseInt(countDraft,10) === (eventData?.number_of_tables || 0)
                  ? '#E5E7EB' : 'var(--ink)',
                color: parseInt(countDraft,10) === (eventData?.number_of_tables || 0)
                  ? '#9CA3AF' : '#fff',
                fontSize:13, fontWeight:800,
                cursor: savingCount ? 'wait' : 'pointer' }}>
              {savingCount ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {countNote && (
          <div style={{ background:'#DCFCE7', border:'1px solid #86EFAC', color:'#15803D',
            borderRadius:9, padding:'7px 11px', fontSize:12, fontWeight:700, marginTop:10 }}>
            ✓ {countNote}
          </div>
        )}
      </div>

      {!showTablets ? (
        <div style={{ fontSize:12.5, color:'var(--ink2)', lineHeight:1.55, margin:'0 2px 14px' }}>
          No tablet sits on a table at this event: captains carry the tablets, so there is nothing else to set up here.
        </div>
      ) : (<>
      {/* At-a-glance cover check before guests sit down */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, marginBottom:16 }}>
        {[['Online', online, '#16A34A'], ['Offline', offline, '#DC2626'], ['Not assigned', missing, '#6B7280']].map(([label, n, c]) => (
          <div key={label} style={{ background:'#fff', borderRadius:10, padding:'5px 8px',
            textAlign:'center', boxShadow:'var(--shadow)' }}>
            <div style={{ fontSize:17, fontWeight:900, color:c }}>{n}</div>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', textTransform:'uppercase',
              letterSpacing:'0.4px', marginTop:2 }}>{label}</div>
          </div>
        ))}
      </div>

      {offline > 0 && (
        <div style={{ background:'#FEF2F2', border:'1.5px solid #FECACA', borderRadius:12,
          padding:'11px 14px', marginBottom:14, fontSize:13, color:'#B91C1C', fontWeight:600, lineHeight:1.5 }}>
          {offline} tablet{offline === 1 ? '' : 's'} not responding for over an hour. Check the device is on and connected, or release the table so another tablet can take it.
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--ink2)', fontSize:14, lineHeight:1.6 }}>
          No tablet has connected to this event yet.<br />
          Tables appear here as soon as the first tablet selects one.
        </div>
      )}

      {/* Cards in three columns, matching the Waiters view. Full-width rows
          meant four tables filled the screen. */}
      <style>{`
        /* Columns, not grid - fills downwards so table 14 is found by reading
           a column rather than zigzagging. Matches the waiter list. */
        .ss-tgrid { column-count:3; column-gap:6px; }
        .ss-tgrid > div {
          break-inside:avoid; -webkit-column-break-inside:avoid; page-break-inside:avoid;
          margin-bottom:6px;
        }
        @media (max-width: 900px) { .ss-tgrid { column-count:2; } }
        @media (max-width: 560px) { .ss-tgrid { column-count:1; } }
      `}</style>
      <div className="ss-tgrid">
      {allTables.map(r => {
        const st = statusOf(r)
        const cfg = STATUS[st]
        const seen = r.last_seen_at || r.claimed_at
        return (
          <div key={r.id} style={{ background:'#fff', borderRadius:10, padding:'6px 9px',
            boxShadow:'var(--shadow)', borderLeft:'3px solid ' + cfg.color }}>
            {/* Two lines. Number and status on top, time and Release beneath. */}
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:3 }}>
              <span style={{ fontSize:15, fontWeight:900, minWidth:20 }}>{r.table_number}</span>
              <span style={{ background:cfg.bg, border:'1px solid ' + cfg.border, color:cfg.color,
                borderRadius:999, padding:'1px 7px', fontSize:9, fontWeight:800,
                letterSpacing:'0.3px', whiteSpace:'nowrap' }}>{cfg.label}</span>
            </div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:6, minHeight:20 }}>
              <span style={{ fontSize:10, color:'var(--ink2)' }}>
                {seen && st !== 'free'
                  ? new Date(seen).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
                  : '\u2014'}
              </span>
              {r.claimed_by_device && (
                <button onClick={() => release(r)} disabled={busy === r.id}
                  style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C',
                    borderRadius:6, padding:'2px 9px', fontSize:10, fontWeight:800,
                    cursor: busy === r.id ? 'wait' : 'pointer' }}>
                  {busy === r.id ? '...' : 'Release'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      </div>
      </>)}
      </>
    </div>
  )
}

/* The two controls a supervisor reaches for during service.

   The order limit is the rush lever: dropped to 1 when orders stack up
   faster than the floor can clear them, lifted when the room is quiet and
   the staff are idle. It caps orders in progress at once, not orders for
   the evening - a table can always order again once the last one lands.

   Both write straight to the event row. Guest tablets poll the event every
   minute, so a change reaches the floor without anyone reloading. */
function EventSettings({ eventData, onEventChange }) {
  const [saving, setSaving] = useState(null)
  const [note, setNote] = useState('')

  const limit    = eventData.max_orders_per_table ?? 1
  const callOn   = eventData.call_waiter_enabled !== false

  async function save(field, value, label) {
    setSaving(field)
    const { error } = await supabase.from('events').update({ [field]: value }).eq('id', eventData.id)
    setSaving(null)
    if (error) { alert('Could not save. Check the connection and try again.'); return }
    setNote(label)
    setTimeout(() => setNote(''), 2500)
    const { data } = await supabase.from('events').select('*').eq('id', eventData.id).single()
    if (data && onEventChange) onEventChange(data)
  }

  const card = { background:'#fff', borderRadius:12, padding:'14px 16px',
    marginBottom:12, boxShadow:'var(--shadow)' }
  const label = { fontSize:11, fontWeight:800, color:'var(--ink2)',
    textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:4 }
  const hint = { fontSize:12, color:'var(--ink2)', lineHeight:1.5, marginTop:8 }

  return (
    <div>
      {note && (
        <div style={{ background:'#DCFCE7', border:'1px solid #86EFAC', color:'#15803D',
          borderRadius:10, padding:'9px 13px', fontSize:13, fontWeight:700, marginBottom:12 }}>
          ✓ {note}
        </div>
      )}

      <div style={card}>
        <div style={label}>Active orders per table</div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:8 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} disabled={saving==='max_orders_per_table'}
              onClick={() => save('max_orders_per_table', n, 'Order limit set to ' + n + ' per table')}
              style={{ width:46, height:42, borderRadius:10, border:'1.5px solid',
                borderColor: limit===n ? 'var(--ink)' : 'var(--line)',
                background: limit===n ? 'var(--ink)' : '#fff',
                color: limit===n ? '#fff' : 'var(--ink)',
                fontWeight:800, fontSize:15, cursor:'pointer' }}>{n}</button>
          ))}
          {/* Free number box for anything above 5. The old event form had one
              and the rebuild dropped it, so 8 or 10 could not be set at all.
              Saves on blur and on Enter rather than per keystroke. */}
          <input type="number" min="1" max="99" placeholder="Other"
            key={'lim' + limit}
            defaultValue={limit > 5 ? limit : ''}
            disabled={saving==='max_orders_per_table'}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            onBlur={e => {
              const v = parseInt(e.target.value)
              if (!v || v < 1 || v === limit) return
              save('max_orders_per_table', v, 'Order limit set to ' + v + ' per table')
            }}
            style={{ width:74, height:42, borderRadius:10, border:'1.5px solid',
              borderColor: limit > 5 ? 'var(--ink)' : 'var(--line)',
              background:'#fff', color:'var(--ink)', fontWeight:800, fontSize:15,
              textAlign:'center', fontFamily:'Manrope', outline:'none',
              boxSizing:'border-box' }} />
          <button disabled={saving==='max_orders_per_table'}
            onClick={() => save('max_orders_per_table', 0, 'Order limit removed')}
            style={{ height:42, padding:'0 14px', borderRadius:10, border:'1.5px solid',
              borderColor: limit===0 ? 'var(--ink)' : 'var(--line)',
              background: limit===0 ? 'var(--ink)' : '#fff',
              color: limit===0 ? '#fff' : 'var(--ink)',
              fontWeight:800, fontSize:13, cursor:'pointer' }}>No limit</button>
        </div>
        <div style={hint}>
          How many orders one table can have <strong>in progress at the same time</strong>.
          Not a cap for the evening — once an order is delivered the table can order again.
          Drop to 1 when the kitchen is behind; raise it when the floor is quiet.
        </div>
      </div>

      <div style={{ ...card, background:'var(--bg)', boxShadow:'none' }}>
        <div style={{ fontSize:12, color:'var(--ink2)', lineHeight:1.6 }}>
          Event name, date, venue and catering branding are set by the admin team
          before the event and cannot be changed here.
        </div>
      </div>
    </div>
  )
}

/* The switch and the list it governs, on one screen.

   Separating them put "can guests ask for anything" a tab away from "what
   can they ask for", so neither screen told the whole story and turning the
   button off meant hopping between tabs to check what had been hidden. */
function HelpPane({ eventData, onEventChange, mode }) {
  const who = mode === 'self' ? 'guests' : 'captains'
  const [saving, setSaving] = useState(false)
  const callOn = eventData.call_waiter_enabled !== false

  async function toggle() {
    setSaving(true)
    const { error } = await supabase.from('events')
      .update({ call_waiter_enabled: !callOn }).eq('id', eventData.id)
    setSaving(false)
    if (error) { alert('Could not save. Check the connection and try again.'); return }
    const { data } = await supabase.from('events').select('*').eq('id', eventData.id).single()
    if (data && onEventChange) onEventChange(data)
  }

  return (
    <div>
      <div style={{ background:'#fff', borderRadius:12, padding:'14px 16px', marginBottom:12,
        boxShadow:'var(--shadow)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'var(--ink2)',
              textTransform:'uppercase', letterSpacing:'0.4px' }}>Help button on {mode === 'self' ? 'guest' : 'captain'} tablets</div>
            <div style={{ fontSize:13, fontWeight:700, marginTop:3 }}>
              {callOn ? 'On — ' + who + ' can send the requests below'
                      : 'Off — no request button on any tablet'}
            </div>
          </div>
          <button onClick={toggle} disabled={saving}
            style={{ width:52, height:28, borderRadius:999, border:'none',
              cursor: saving ? 'wait' : 'pointer', position:'relative', flexShrink:0,
              background: callOn ? '#16A34A' : '#D1D5DB', transition:'background 0.2s' }}>
            <span style={{ position:'absolute', top:3, left: callOn ? 26 : 3, width:22, height:22,
              borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)',
              transition:'left 0.2s', display:'block' }}></span>
          </button>
        </div>
        <div style={{ fontSize:12, color:'var(--ink2)', lineHeight:1.5, marginTop:8 }}>
          Turn off during a speech or a performance so requests do not pile up while
          nobody can act on them. Takes effect on every tablet within a minute.
        </div>
      </div>

      {!callOn && (
        <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:10,
          padding:'9px 13px', fontSize:12, color:'#92400E', fontWeight:600, marginBottom:12 }}>
          The button is off, so none of these can be sent right now.
        </div>
      )}

      <HelpItemsEditor eventId={eventData.id} />
    </div>
  )
}
