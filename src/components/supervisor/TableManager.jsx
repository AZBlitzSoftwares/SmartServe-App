import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { WaiterList, HelpItemsEditor } from './EventManager'

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

export default function TableManager({ eventData, onEventChange }) {
  // Waiters first: the list that changes during an event
  const [view, setView] = useState('waiters')
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
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Event Control</h2>
        <button onClick={load} style={{ background:'var(--ink)', color:'#fff', border:'none',
          borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Refresh</button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        {[['waiters','Waiters'],['tables','Tables'],['help','Help'],['settings','Settings']].map(([v,label]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ flex:1, padding:'9px 4px', borderRadius:10, fontSize:13, fontWeight:700,
              cursor:'pointer', border:'1.5px solid',
              background: view===v ? 'var(--ink)' : '#fff',
              color: view===v ? '#fff' : 'var(--ink)',
              borderColor: view===v ? 'var(--ink)' : 'var(--line)' }}>{label}</button>
        ))}
      </div>

      {view === 'waiters' && eventData?.id && <WaiterList eventId={eventData.id} />}

      {/* Help list. Was on the admin Events screen, which the supervisor
          cannot open - so the person standing in the room could not change
          what guests were allowed to ask for. */}
      {view === 'help' && eventData?.id && (
        <HelpPane eventData={eventData} onEventChange={onEventChange} />
      )}

      {view === 'settings' && eventData?.id && (
        <EventSettings eventData={eventData} onEventChange={onEventChange} />
      )}

      {view === 'tables' && (
      <>

      {/* Sits above the counts because it changes what those counts mean */}
      <div style={{ background:'#fff', borderRadius:12, padding:'12px 14px', marginBottom:12,
        boxShadow:'var(--shadow)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 200px', minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'var(--ink2)',
              textTransform:'uppercase', letterSpacing:'0.4px' }}>Tables at this event</div>
            <div style={{ fontSize:12, color:'var(--ink2)', marginTop:3, lineHeight:1.5 }}>
              Raise it when the caterer lays more. Tablets can claim the new numbers within a minute.
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
      </>
      )}
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
function HelpPane({ eventData, onEventChange }) {
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
              textTransform:'uppercase', letterSpacing:'0.4px' }}>Help button on guest tablets</div>
            <div style={{ fontSize:13, fontWeight:700, marginTop:3 }}>
              {callOn ? 'On — guests can send the requests below'
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
          The button is off, so none of these are reaching guests right now.
        </div>
      )}

      <HelpItemsEditor eventId={eventData.id} />
    </div>
  )
}
