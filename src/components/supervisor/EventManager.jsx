import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

// Auto-compute event status from date
function eventStatus(dateStr) {
  if (!dateStr) return 'planned'
  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')
  if (dateStr > todayStr) return 'planned'
  if (dateStr === todayStr) return 'active'
  return 'completed'
}
const STATUS_LABEL = { planned:'Planned', active:'Active', completed:'Completed' }
const STATUS_BG    = { planned:'#EFF6FF', active:'#DCFCE7', completed:'#F3F4F6' }
const STATUS_COLOR = { planned:'#2563EB', active:'#16A34A', completed:'#6B7280' }

const INP = { width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, marginBottom:0, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', background:'#fff' }
const LBL = { fontSize:12, fontWeight:700, color:'#666', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }

/* Help items for one event.

   event_id NULL rows are the shared defaults every event falls back
   to. An event only gets its own rows once someone customises it,
   which keeps new events working with no setup and stops one
   wedding's list leaking into another. */

/* Which tablets have claimed which tables, for one event.

   The list matters more than the Release button: it answers a
   question Janu's team currently cannot answer at all - is every
   table actually covered? Fifteen tablets placed but thirteen
   claimed means two are off, dead, or on the wrong event, and
   right now that only surfaces when those tables never order. */
function TableClaims({ eventId, tableCount }) {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) load() }, [open, eventId])

  async function load() {
    const { data } = await supabase.from('tables')
      .select('id, table_number, claimed_by_device, claimed_at, last_seen_at')
      .eq('event_id', eventId).order('table_number')
    setRows(data || [])
  }

  function live(r) {
    if (!r.claimed_by_device) return false
    const seen = r.last_seen_at || r.claimed_at
    if (!seen) return false
    // Same one hour window as the Tables tab, so the two never disagree
    return (Date.now() - new Date(seen).getTime()) < 60 * 60 * 1000
  }

  async function release(id) {
    setBusy(true)
    await supabase.from('tables')
      .update({ claimed_by_device: null, claimed_at: null, last_seen_at: null })
      .eq('id', id)
    setBusy(false); load()
  }

  const claimed = rows.filter(live).length
  const total = tableCount || rows.length

  return (
    <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
      <button onClick={() => setOpen(!open)}
        style={{ width:'100%', background:'none', border:'none', padding:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', textTransform:'uppercase' }}>
          📱 Tables &amp; Devices
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:700, borderRadius:999, padding:'3px 10px',
            background: claimed > 0 ? '#DCFCE7' : '#F3F4F6',
            color: claimed > 0 ? '#15803D' : '#6B7280' }}>
            {claimed} of {total} claimed
          </span>
          <span style={{ fontSize:13, color:'#888', transform: open ? 'rotate(180deg)' : 'none',
            transition:'transform 0.15s', display:'inline-block' }}>▼</span>
        </span>
      </button>

      {open && (
        <div style={{ marginTop:10 }}>
          {rows.length === 0 && (
            <div style={{ fontSize:12, color:'#888', padding:'8px 0' }}>
              No tablet has connected to this event yet.
            </div>
          )}
          {rows.map(r => {
            const on = live(r)
            const seen = r.last_seen_at || r.claimed_at
            return (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, background:'#fff',
                border:'1px solid var(--line)', borderRadius:10, padding:'8px 10px', marginBottom:6 }}>
                <span style={{ flexShrink:0, width:34, fontWeight:900, fontSize:14 }}>{r.table_number}</span>
                <span style={{ flex:1, minWidth:0, fontSize:12,
                  color: on ? '#15803D' : '#888', fontWeight:700 }}>
                  {on ? 'In use' : r.claimed_by_device ? 'Claim expired' : 'Free'}
                  {seen && (
                    <span style={{ fontWeight:500, color:'#999' }}>
                      {' · last seen ' + new Date(seen).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}
                    </span>
                  )}
                </span>
                {r.claimed_by_device && (
                  <button onClick={() => release(r.id)} disabled={busy}
                    style={{ flexShrink:0, background:'#FEF2F2', border:'1px solid #FECACA',
                      color:'#B91C1C', borderRadius:8, padding:'5px 12px', fontSize:11,
                      fontWeight:700, cursor:'pointer' }}>
                    Release
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={load} disabled={busy}
            style={{ marginTop:4, background:'none', border:'none', color:'#888', fontSize:11,
              fontWeight:600, cursor:'pointer', textDecoration:'underline', padding:0 }}>
            Refresh
          </button>
        </div>
      )}
    </div>
  )
}


/* Waiters for one event - the single place they are managed.

   Cards rather than form rows, shaped like the table cards: number and
   status on top, detail below. A grid of input boxes read as a spreadsheet
   next to those cards, which made the two halves of Staff & Tables look
   like different applications.

   Supervisors can edit. They are the person at the venue when someone does
   not turn up or a number is wrong, and routing that through an admin who
   may not be present is the friction Release was added to remove. Nothing
   here can lose data: removal sets is_active false, so delivered orders
   keep the name against them in the reports.

   The mobile is a tel: link so a number can be dialled from the screen. On
   a Mac that opens the Phone app when an iPhone is paired; on Windows it
   opens whatever handles calls, typically Phone Link. */
export function WaiterList({ eventId, embedded = false }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ number:'', name:'', mobile:'' })
  // Who is free right now - the question a supervisor actually has here
  const [busyMap, setBusyMap] = useState({})

  useEffect(() => { loadWaiters() }, [eventId])
  useEffect(() => {
    const t = setInterval(loadWaiters, 20000)
    return () => clearInterval(t)
  }, [eventId])

  async function loadWaiters() {
    if (!eventId) return
    const { data } = await supabase.from('waiters')
      .select('*').eq('event_id', eventId).eq('is_active', true).order('waiter_number')
    setRows(data || [])

    // Orders and help requests both make a waiter busy
    const [{ data: o }, { data: sr }] = await Promise.all([
      supabase.from('orders').select('waiter_id, tables(table_number)')
        .eq('event_id', eventId).eq('status', 'in_progress'),
      supabase.from('sos_requests').select('waiter_id, tables(table_number)')
        .eq('event_id', eventId).eq('status', 'in_progress'),
    ])
    const m = {}
    ;[...(o || []), ...(sr || [])].forEach(x => {
      if (x.waiter_id) m[x.waiter_id] = x.tables?.table_number ?? '?'
    })
    setBusyMap(m)
  }

  // The bracketed number is stripped so editing shows just the person's name
  const bare = w => {
    const n = (w.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
    return n === (w.waiter_number || '') ? '' : n
  }
  const display = (num, nm) => nm ? nm + ' (' + num + ')' : num

  async function patch(w, field, value) {
    const v = (value || '').trim()
    const num = field === 'number' ? v : (w.waiter_number || '')
    const nm  = field === 'name'   ? v : bare(w)
    const upd = field === 'mobile'
      ? { mobile: v || null }
      : { waiter_number: num, name: display(num, nm) }
    setBusy(true)
    await supabase.from('waiters').update(upd).eq('id', w.id)
    setBusy(false); loadWaiters()
  }

  async function removeOne(w) {
    if (!window.confirm('Remove waiter ' + (w.waiter_number || w.name) + '?')) return
    setBusy(true)
    // Soft delete, so delivered orders keep the name in the reports
    await supabase.from('waiters').update({ is_active:false }).eq('id', w.id)
    setBusy(false); loadWaiters()
  }

  async function create() {
    const num = add.number.trim()
    if (!num) return
    setBusy(true)
    await supabase.from('waiters').insert({
      event_id: eventId, waiter_number: num, name: display(num, add.name.trim()),
      mobile: add.mobile.trim() || null, is_active: true
    })
    setAdd({ number:'', name:'', mobile:'' })
    setBusy(false); loadWaiters()
  }

  const fld = { width:'100%', border:'1px solid var(--line)', borderRadius:7,
    padding:'5px 8px', fontSize:12, fontFamily:'Manrope', outline:'none',
    background:'#fff', boxSizing:'border-box' }
  const onJob = rows.filter(w => busyMap[w.id]).length

  return (
    <>
      <style>{`
        /* Three across on a laptop, dropping to two then one rather than
           squeezing three into a phone width. */
        .ss-wgrid { display:grid; gap:6px; grid-template-columns:repeat(3, minmax(0,1fr)); }
        @media (max-width: 900px) { .ss-wgrid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
        @media (max-width: 560px) { .ss-wgrid { grid-template-columns:1fr; } }
      `}</style>

      {/* Same three-card shape as the Tables view, so the two read as one screen */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:6, marginBottom:8 }}>
        {[['Free', rows.length - onJob, '#16A34A'],
          ['On delivery', onJob, '#DC2626'],
          ['Total', rows.length, '#6B7280']].map(([label, n, c]) => (
          <div key={label} style={{ background:'#fff', borderRadius:10, padding:'5px 8px',
            textAlign:'center', boxShadow:'var(--shadow)' }}>
            <div style={{ fontSize:17, fontWeight:900, color:c }}>{n}</div>
            <div style={{ fontSize:9, fontWeight:700, color:'var(--ink2)',
              textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 && (
        <div style={{ textAlign:'center', padding:'28px 0', color:'var(--ink2)', fontSize:13 }}>
          No waiters yet. Add the first one below.
        </div>
      )}

      <div className="ss-wgrid">
        {rows.map(w => {
          const at = busyMap[w.id]
          const tone = at ? { bg:'#FEF2F2', fg:'#B91C1C', bar:'#DC2626' }
                          : { bg:'#F0FDF4', fg:'#15803D', bar:'#16A34A' }
          return (
            <div key={w.id} style={{ background:'#fff', borderRadius:10, padding:'6px 8px',
              boxShadow:'var(--shadow)', borderLeft:'3px solid ' + tone.bar }}>
              {/* Two lines rather than four. Number and status share the top with
                  the remove control; name and mobile sit side by side below. */}
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                <input defaultValue={w.waiter_number || ''} disabled={busy}
                  onBlur={e => { const v = e.target.value.trim()
                    if (v && v !== w.waiter_number) patch(w, 'number', v) }}
                  style={{ ...fld, width:40, fontSize:14, fontWeight:900, padding:'2px 5px' }} />
                <span style={{ background:tone.bg, border:'1px solid ' + tone.bar, color:tone.fg,
                  borderRadius:999, padding:'1px 7px', fontSize:9, fontWeight:800,
                  letterSpacing:'0.3px', whiteSpace:'nowrap' }}>{at ? 'ON T' + at : 'FREE'}</span>
                <button onClick={() => removeOne(w)} disabled={busy}
                  title="Remove waiter"
                  style={{ marginLeft:'auto', background:'none', border:'none', color:'#DC2626',
                    fontSize:14, cursor:'pointer', padding:0, lineHeight:1 }}>&times;</button>
              </div>

              <div style={{ display:'flex', gap:5 }}>
                <input defaultValue={bare(w)} disabled={busy} placeholder="Name"
                  onBlur={e => { if (e.target.value.trim() !== bare(w)) patch(w, 'name', e.target.value) }}
                  style={{ ...fld, flex:1, minWidth:0, fontSize:11, padding:'3px 6px' }} />
                {w.mobile ? (
                  <a href={'tel:' + w.mobile} title={'Call ' + w.mobile}
                    style={{ flexShrink:0, background:'#DCFCE7', border:'1px solid #86EFAC',
                      color:'#15803D', borderRadius:6, padding:'3px 9px', fontSize:10,
                      fontWeight:800, textDecoration:'none', whiteSpace:'nowrap',
                      display:'flex', alignItems:'center' }}>Call</a>
                ) : (
                  <input defaultValue="" placeholder="Mobile" type="tel" disabled={busy}
                    onBlur={e => { if (e.target.value.trim()) patch(w, 'mobile', e.target.value) }}
                    style={{ ...fld, width:78, fontSize:11, padding:'3px 6px' }} />
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display:'flex', gap:6, marginTop:12, paddingTop:12,
        borderTop:'1px solid var(--line)', alignItems:'center', flexWrap:'wrap' }}>
        <input value={add.number} onChange={e => setAdd(p => ({ ...p, number:e.target.value }))}
          placeholder="01" style={{ ...fld, width:64, fontWeight:900 }} />
        <input value={add.name} onChange={e => setAdd(p => ({ ...p, name:e.target.value }))}
          placeholder="Name (optional)" style={{ ...fld, flex:1, minWidth:120 }}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <input value={add.mobile} onChange={e => setAdd(p => ({ ...p, mobile:e.target.value }))}
          placeholder="Mobile" type="tel" style={{ ...fld, width:130 }}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <button onClick={create} disabled={busy || !add.number.trim()}
          style={{ background: add.number.trim() ? 'var(--ink)' : '#E5E7EB', color:'#fff',
            border:'none', borderRadius:8, padding:'8px 18px', fontSize:13, fontWeight:800,
            cursor: add.number.trim() ? 'pointer' : 'not-allowed' }}>Add</button>
      </div>
    </>
  )
}

function HelpItemsEditor({ eventId }) {
  const [items, setItems] = useState([])
  const [isCustom, setIsCustom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQty, setNewQty] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => { load() }, [eventId])

  async function load() {
    setLoading(true)
    const { data: mine } = await supabase.from('help_items')
      .select('*').eq('event_id', eventId).order('sort_order')
    if (mine && mine.length) {
      setItems(mine); setIsCustom(true); setLoading(false); return
    }
    const { data: defaults } = await supabase.from('help_items')
      .select('*').is('event_id', null).order('sort_order')
    setItems(defaults || []); setIsCustom(false); setLoading(false)
  }

  async function customise() {
    setBusy(true)
    const rows = items.map((it, i) => ({
      event_id: eventId, name: it.name,
      has_quantity: it.has_quantity, sort_order: i + 1, is_active: true
    }))
    if (rows.length) await supabase.from('help_items').insert(rows)
    setBusy(false); load()
  }

  async function useDefaults() {
    if (!confirm('Remove this event\'s own help list and go back to the shared default list?')) return
    setBusy(true)
    await supabase.from('help_items').delete().eq('event_id', eventId)
    setBusy(false); load()
  }

  async function patch(id, field, val) {
    setBusy(true)
    await supabase.from('help_items').update({ [field]: val }).eq('id', id)
    setBusy(false); load()
  }

  async function remove(id) {
    setBusy(true)
    await supabase.from('help_items').delete().eq('id', id)
    setBusy(false); load()
  }

  async function move(idx, dir) {
    const j = idx + dir
    if (j < 0 || j >= items.length) return
    setBusy(true)
    const a = items[idx], b = items[j]
    await supabase.from('help_items').update({ sort_order: b.sort_order }).eq('id', a.id)
    await supabase.from('help_items').update({ sort_order: a.sort_order }).eq('id', b.id)
    setBusy(false); load()
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    const max = items.reduce((m, i) => Math.max(m, i.sort_order || 0), 0)
    await supabase.from('help_items').insert({
      event_id: eventId, name, has_quantity: newQty,
      sort_order: max + 1, is_active: true
    })
    setNewName(''); setNewQty(true); setBusy(false); load()
  }

  if (loading) return (
    <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12, fontSize:13, color:'#888' }}>
      Loading help items...
    </div>
  )

  return (
    <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
      {/* Collapsed by default - this list is long and is rarely changed,
          so it should not push the rest of the event settings down. */}
      <button onClick={() => setOpen(!open)}
        style={{ width:'100%', background:'none', border:'none', padding:0, cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
        <span style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', textTransform:'uppercase' }}>
          🔔 Help Items
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:11, fontWeight:700, borderRadius:999, padding:'3px 10px',
            background: isCustom ? '#DCFCE7' : '#F3F4F6',
            color: isCustom ? '#15803D' : '#6B7280' }}>
            {items.length} item{items.length === 1 ? '' : 's'} · {isCustom ? 'custom' : 'default list'}
          </span>
          <span style={{ fontSize:13, color:'#888', transform: open ? 'rotate(180deg)' : 'none',
            transition:'transform 0.15s', display:'inline-block' }}>▼</span>
        </span>
      </button>

      {!open ? null : (
      <div style={{ marginTop:12 }}>

      {!isCustom && (
        <div style={{ background:'#FFF7ED', border:'1px solid #FED7AA', borderRadius:10,
          padding:'10px 12px', marginBottom:10, fontSize:12, color:'#9A3412', lineHeight:1.5 }}>
          This event uses the shared default list. Customise it to give this event its own items —
          other events stay unchanged.
          <button onClick={customise} disabled={busy}
            style={{ display:'block', marginTop:8, background:'var(--ink)', color:'#fff', border:'none',
              borderRadius:8, padding:'8px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            {busy ? 'Working...' : 'Customise for this event'}
          </button>
        </div>
      )}

      {items.map((it, idx) => (
        <div key={it.id} style={{ display:'flex', alignItems:'center', gap:6, background:'#fff',
          border:'1px solid var(--line)', borderRadius:10, padding:'7px 9px', marginBottom:6 }}>
          <input defaultValue={it.name} key={'hi' + it.id} disabled={!isCustom || busy}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.name) patch(it.id, 'name', v) }}
            style={{ flex:1, minWidth:0, border:'none', outline:'none', fontSize:13, fontWeight:700,
              fontFamily:'Manrope', background:'transparent', color: isCustom ? '#1A1A1A' : '#888' }} />

          <button onClick={() => patch(it.id, 'has_quantity', !it.has_quantity)} disabled={!isCustom || busy}
            title="Quantity or tap to add"
            style={{ flexShrink:0, background: it.has_quantity ? '#DCFCE7' : '#F3F4F6',
              border:'1px solid ' + (it.has_quantity ? '#86EFAC' : '#E5E7EB'),
              color: it.has_quantity ? '#15803D' : '#6B7280', borderRadius:999, padding:'4px 10px',
              fontSize:11, fontWeight:700, cursor: isCustom ? 'pointer' : 'not-allowed' }}>
            {it.has_quantity ? '± Qty' : 'Tap only'}
          </button>

          <button onClick={() => move(idx, -1)} disabled={!isCustom || busy || idx === 0}
            style={{ flexShrink:0, background:'none', border:'none', fontSize:14,
              cursor: isCustom && idx > 0 ? 'pointer' : 'not-allowed', color:'#888', padding:'0 3px' }}>▲</button>
          <button onClick={() => move(idx, 1)} disabled={!isCustom || busy || idx === items.length - 1}
            style={{ flexShrink:0, background:'none', border:'none', fontSize:14,
              cursor: isCustom && idx < items.length - 1 ? 'pointer' : 'not-allowed', color:'#888', padding:'0 3px' }}>▼</button>
          <button onClick={() => remove(it.id)} disabled={!isCustom || busy}
            style={{ flexShrink:0, background:'none', border:'none', color: isCustom ? '#DC2626' : '#CCC',
              fontSize:12, fontWeight:700, cursor: isCustom ? 'pointer' : 'not-allowed', padding:'0 3px' }}>✕</button>
        </div>
      ))}

      {isCustom && (
        <>
          <div style={{ display:'flex', gap:6, marginTop:8 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="New item, e.g. Water Bottle"
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              style={{ ...INP, flex:1, fontSize:13, padding:'8px 12px' }} />
            <button onClick={() => setNewQty(!newQty)}
              style={{ flexShrink:0, background: newQty ? '#DCFCE7' : '#F3F4F6',
                border:'1px solid ' + (newQty ? '#86EFAC' : '#E5E7EB'),
                color: newQty ? '#15803D' : '#6B7280', borderRadius:8, padding:'0 12px',
                fontSize:11, fontWeight:700, cursor:'pointer' }}>
              {newQty ? '± Qty' : 'Tap only'}
            </button>
            <button onClick={add} disabled={busy || !newName.trim()}
              style={{ flexShrink:0, background:'var(--ink)', color:'#fff', border:'none',
                borderRadius:8, padding:'0 16px', fontSize:13, fontWeight:700,
                cursor: newName.trim() ? 'pointer' : 'not-allowed' }}>Add</button>
          </div>
          <button onClick={useDefaults} disabled={busy}
            style={{ marginTop:8, background:'none', border:'none', color:'#888', fontSize:11,
              fontWeight:600, cursor:'pointer', textDecoration:'underline', padding:0 }}>
            Go back to the shared default list
          </button>
        </>
      )}
      </div>
      )}
    </div>
  )
}


function EventDateNameEditor({ ev, onSave }) {
  const [name, setName]       = useState(ev.name || '')
  const [venue, setVenue]     = useState(ev.venue || '')
  const [date, setDate]       = useState(ev.date || '')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  // Reset when event changes
  useState(() => { setName(ev.name||''); setDate(ev.date||''); setVenue(ev.venue||'') })

  async function save() {
    if (!name.trim() || !date) { alert('Name and date are required'); return }
    setSaving(true)
    if (name.trim() !== ev.name) await onSave('name', name.trim())
    // null rather than '' so an emptied venue stops rendering the pin row
    if ((venue.trim() || null) !== (ev.venue || null)) await onSave('venue', venue.trim() || null)
    if (date !== ev.date)         await onSave('date', date)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:10, marginBottom:12, alignItems:'flex-end' }}>
      <div>
        <label style={{ fontSize:12, fontWeight:700, color:'#666', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>Event Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Event name"
          style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:13, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', background:'#fff' }} />
      </div>
      <div>
        <label style={{ fontSize:12, fontWeight:700, color:'#666', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>Event Date</label>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)}
          style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:13, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', background:'#fff', cursor:'pointer' }} />
      </div>
      <div>
        <label style={{ fontSize:12, fontWeight:700, color:'#666', display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.04em' }}>Venue</label>
        <input value={venue} onChange={e=>setVenue(e.target.value)}
          placeholder="e.g. Grand Ballroom, Taj Hotel, Pune"
          style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:13, fontFamily:'Manrope', outline:'none', boxSizing:'border-box', background:'#fff' }} />
      </div>
      <button onClick={save} disabled={saving}
        style={{ padding:'10px 18px', background: saved?'#16A34A':'var(--ink)', color: saved?'#fff':'#E8890C',
                 border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', height:42 }}>
        {saving ? 'Saving...' : saved ? '✅ Saved' : '💾 Save'}
      </button>
    </div>
  )
}

export default function EventManager({ onEventChange }) {
  const [events, setEvents] = useState([])
  const [supervisors, setSupervisors] = useState([])
  const [waiters, setWaiters] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showAddSup, setShowAddSup] = useState(false)
  const [showAddWaiter, setShowAddWaiter] = useState(false)
  const [selEvent, setSelEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [uploading, setUploading] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(null)
  const [editingField, setEditingField] = useState({})
  // Help items chosen while creating. There is no event id yet, so these
  // are held here and written straight after the insert. helpTouched stays
  // false unless something is actually changed, so an untouched event is
  // left on the shared defaults rather than silently getting its own copy.
  const [newHelp, setNewHelp] = useState([])
  const [helpTouched, setHelpTouched] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    supabase.from('help_items').select('*').is('event_id', null).eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setNewHelp((data || []).map(d => ({
        name: d.name, has_quantity: d.has_quantity, include: true
      }))))
  }, [])

  const [duplicating, setDuplicating] = useState(null)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'detail'
  const [selectedEvent, setSelectedEvent] = useState(null)

  const [newEvent, setNewEvent] = useState({
    name:'', date:'', venue:'', number_of_tables:'',
    catering_company:'', catering_logo_url:'', welcome_note:'', banner_image_url:'', max_orders_per_table:1,
    video_url:'', call_waiter_enabled:true
  })
  const [createStep, setCreateStep] = useState(1) // 1=basic, 2=config, 3=branding
  const [newLogoFile, setNewLogoFile] = useState(null)
  const [newLogoPreview, setNewLogoPreview] = useState('')
  const [newVideoMode, setNewVideoMode] = useState('url')
  const [newVideoFile, setNewVideoFile] = useState(null)

  const [newSup, setNewSup] = useState({ name:'', pin:'', mobile:'' })
  const [newWaiter, setNewWaiter] = useState({ number:'', name:'', mobile:'' })
  const videoFileRefs = useRef({})
  const logoFileRefs = useRef({})
  const newLogoRef = useRef()
  const newVideoRef = useRef()

  useEffect(() => { loadAll() }, [])


  // Copies the event, its categories and dishes, its help items, its waiters
  // and its supervisors.
  //
  // Orders, feedback and table claims are deliberately NOT copied. They belong
  // to the event that actually happened - carrying them over would corrupt the
  // new event's reports from the moment it is created.
  async function duplicateEvent(ev) {
    if (!window.confirm('Duplicate "' + ev.name + '"?\n\nCopies the menu, help items, waiters and supervisors.\nOrders and feedback are not copied.')) return
    setDuplicating(ev.id)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const { id, created_at, ...rest } = ev
      const { data: nev, error } = await supabase.from('events').insert({
        ...rest, name: ev.name + ' (Copy)', date: today
      }).select().single()
      if (error || !nev) { alert('Could not duplicate: ' + (error?.message || 'unknown error')); setDuplicating(null); return }

      // Categories, keeping a map from old id to new so dishes land correctly
      const { data: cats } = await supabase.from('menu_categories')
        .select('*').eq('event_id', ev.id).order('sort_order')
      const idMap = {}
      if (cats?.length) {
        for (const c of cats) {
          const { id: oldId, created_at: _c, ...crest } = c
          const { data: nc } = await supabase.from('menu_categories')
            .insert({ ...crest, event_id: nev.id }).select().single()
          if (nc) idMap[oldId] = nc.id
        }
        const oldCatIds = cats.map(c => c.id)
        const { data: items } = await supabase.from('menu_items')
          .select('*').in('category_id', oldCatIds)
        if (items?.length) {
          const rows = items
            .filter(i => idMap[i.category_id])
            .map(({ id: _i, created_at: _ic, ...irest }) => ({ ...irest, category_id: idMap[irest.category_id] }))
          // Chunked, because a large menu in one insert can exceed the limit
          for (let i = 0; i < rows.length; i += 200) {
            await supabase.from('menu_items').insert(rows.slice(i, i + 200))
          }
        }
      }

      for (const table of ['help_items', 'waiters', 'supervisors']) {
        const { data: src } = await supabase.from(table).select('*').eq('event_id', ev.id)
        if (src?.length) {
          await supabase.from(table).insert(
            src.map(({ id: _x, created_at: _y, ...r }) => ({ ...r, event_id: nev.id }))
          )
        }
      }

      alert('Duplicated. The copy is dated today - rename and re-date it before use.')
      loadAll()
    } catch (e) {
      console.error('Duplicate error:', e)
      alert('Could not duplicate. Please try again.')
    }
    setDuplicating(null)
  }

  async function loadAll() {
    setLoading(true)
    const [{ data:evs }, { data:sups }, { data:ws }] = await Promise.all([
      supabase.from('events').select('*').order('created_at', { ascending:false }),
      supabase.from('supervisors').select('*').order('name'),
      supabase.from('waiters').select('*').order('name')
    ])
    setEvents(evs||[]); setSupervisors(sups||[]); setWaiters(ws||[])
    setLoading(false)
  }

  function resetCreate() {
    setNewEvent({ name:'', date:'', venue:'', number_of_tables:'', catering_company:'', catering_logo_url:'', welcome_note:'', banner_image_url:'', max_orders_per_table:1, video_url:'', call_waiter_enabled:true })
    setHelpTouched(false); setHelpOpen(false)
    setNewHelp(prev => prev.map(h => ({ ...h, include:true })))
    setCreateStep(1); setNewLogoFile(null); setNewLogoPreview(''); setNewVideoFile(null); setNewVideoMode('url')
    setShowCreate(false)
  }

  function handleNewLogoFile(file) {
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['jpg','jpeg','png','webp','svg'].includes(ext)) { alert('Only JPG, PNG, WebP or SVG'); return }
    if (file.size > 2*1024*1024) { alert('Max 2MB'); return }
    setNewLogoFile(file)
    const reader = new FileReader()
    reader.onload = e => setNewLogoPreview(e.target.result)
    reader.readAsDataURL(file)
  }

  function handleNewVideoFile(file) {
    if (!file) return
    if (file.size > 100*1024*1024) { alert('Max 100MB'); return }
    setNewVideoFile(file)
  }

  async function createEvent() {
    if (!newEvent.name||!newEvent.date) { alert('Event name and date are required'); return }
    // Check for duplicate event name
    const { data: existing } = await supabase.from('events').select('id').ilike('name', newEvent.name.trim()).limit(1)
    if (existing?.length) {
      alert('An event named "' + newEvent.name.trim() + '" already exists. Please use a different name.')
      return
    }
    setSaving(true)
    try {
      // Upload logo if file selected
      let logoUrl = newEvent.catering_logo_url || null
      if (newLogoFile) {
        const path = 'catering-logos/' + Date.now() + '-' + newLogoFile.name.replace(/[^a-zA-Z0-9.]/g,'_')
        const { error: upErr } = await supabase.storage.from('smartserve').upload(path, newLogoFile, { upsert:true })
        if (!upErr) {
          const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
          logoUrl = data.publicUrl
        }
      }

      // Insert event
      const { data: ev } = await supabase.from('events').insert({
        name: newEvent.name.trim(), date: newEvent.date,
        venue: newEvent.venue.trim()||null,
        number_of_tables: newEvent.number_of_tables ? parseInt(newEvent.number_of_tables) : null,
        catering_company: newEvent.catering_company.trim()||null,
        catering_logo_url: logoUrl,
        welcome_note: newEvent.welcome_note.trim()||null,
        banner_image_url: newEvent.banner_image_url.trim()||null,
        max_orders_per_table: parseInt(newEvent.max_orders_per_table)||1,
        video_url: newEvent.video_url.trim()||null,
        call_waiter_enabled: newEvent.call_waiter_enabled,
        is_closed: false, ai_enabled: false
      }).select().single()

      // Help items, only when the default list was actually changed
      if (ev && helpTouched) {
        const rows = newHelp.filter(h => h.include).map((h, i) => ({
          event_id: ev.id, name: h.name, has_quantity: h.has_quantity,
          sort_order: i + 1, is_active: true
        }))
        if (rows.length) await supabase.from('help_items').insert(rows)
      }

      // Upload video if file selected
      if (newVideoFile && ev) {
        const ext = newVideoFile.name.split('.').pop().toLowerCase()
        const path = 'event-videos/' + ev.id + '/' + Date.now() + '.' + ext
        const { error: vErr } = await supabase.storage.from('smartserve').upload(path, newVideoFile, { upsert:true })
        if (!vErr) {
          const { data: vd } = supabase.storage.from('smartserve').getPublicUrl(path)
          await supabase.from('events').update({ video_url: vd.publicUrl }).eq('id', ev.id)
        }
      }

      resetCreate(); loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setSaving(false) }
  }

  async function updateEventField(eventId, field, value) {
    await supabase.from('events').update({ [field]: value }).eq('id', eventId)
    loadAll()
  }

  async function toggleEvent(ev) {
    await supabase.from('events').update({ is_closed:!ev.is_closed }).eq('id', ev.id); loadAll()
  }

  async function uploadLogo(eventId, file) {
    if (!file) return
    setUploadingLogo(eventId)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = 'catering-logos/' + eventId + '-' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
      await supabase.from('events').update({ catering_logo_url: data.publicUrl }).eq('id', eventId)
      loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setUploadingLogo(null) }
  }

  async function uploadVideo(eventId, file) {
    if (!file) return
    setUploading(eventId)
    try {
      const ext = file.name.split('.').pop().toLowerCase()
      const path = 'event-videos/' + eventId + '/' + Date.now() + '.' + ext
      const { error } = await supabase.storage.from('smartserve').upload(path, file, { upsert:true })
      if (error) { alert('Upload failed: ' + error.message); return }
      const { data } = supabase.storage.from('smartserve').getPublicUrl(path)
      await supabase.from('events').update({ video_url: data.publicUrl }).eq('id', eventId)
      loadAll()
    } catch(e) { alert('Error: ' + e.message) }
    finally { setUploading(null) }
  }

  async function addSupervisor() {
    if (!newSup.name.trim()||!newSup.pin.trim()||!selEvent) { alert('Name, PIN and event required'); return }
    setSaving(true)
    const { error } = await supabase.from('supervisors').insert({ event_id:selEvent, name:newSup.name.trim(), pin:newSup.pin.trim(), mobile:newSup.mobile.trim()||null, is_active:true })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewSup({ name:'',pin:'',mobile:'' }); setShowAddSup(false); setSaving(false); loadAll()
  }

  async function addWaiter() {
    // Number is the required one. Name is how staff refer to each other, but
    // the number is what goes on the KOT slip and gets called across a hall.
    if (!newWaiter.number.trim()||!selEvent) { alert('Waiter number and event are required'); return }
    setSaving(true)
    const num = newWaiter.number.trim(), nm = newWaiter.name.trim()
    // name keeps the display string every existing screen already reads
    const { error } = await supabase.from('waiters').insert({
      event_id:selEvent, waiter_number:num, name: nm ? nm + ' (' + num + ')' : num,
      mobile:newWaiter.mobile.trim()||null, is_active:true })
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setNewWaiter({ name:'',mobile:'' }); setShowAddWaiter(false); setSaving(false); loadAll()
  }

  async function removeSup(id) {
    if (!confirm('Remove this supervisor?')) return
    setRemoving(id)
    const { error } = await supabase.from('supervisors').delete().eq('id', id)
    if (error) {
      console.error('Remove supervisor error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }

  async function removeWaiter(id) {
    if (!confirm('Remove this waiter?')) return
    setRemoving(id)
    const { error } = await supabase.from('waiters').delete().eq('id', id)
    if (error) {
      console.error('Remove waiter error:', error)
      alert('Failed to remove: ' + error.message)
    }
    setRemoving(null)
    await loadAll()
  }

  const getSups = eid => supervisors.filter(s=>s.event_id===eid)
  const getWaiters = eid => waiters.filter(w=>w.event_id===eid)

  // ── STEPS for create form ──
  const STEPS = ['Basic Info', 'Configuration', 'Branding & Media']

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Events & Staff</h2>
        {!showCreate && <button onClick={()=>setShowCreate(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>+ New Event</button>}
      </div>

      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12, padding:'10px 16px', marginBottom:16, fontSize:13, color:'#1d4ed8' }}>
        💡 <strong>Supervisor login:</strong> Username = Name · Password = PIN &nbsp;|&nbsp;
        🎯 <strong>Switch events:</strong> Tap event name in the header
      </div>

      {/* ═══ CREATE EVENT — 3-step wizard ═══ */}
      {showCreate && (
        <div style={{ background:'#fff', borderRadius:20, marginBottom:20, boxShadow:'0 4px 24px rgba(0,0,0,0.1)', border:'1px solid var(--line)', overflow:'hidden' }}>
          {/* Step indicator */}
          <div style={{ background:'var(--ink)', padding:'16px 24px' }}>
            <div style={{ color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:8 }}>Create New Event</div>
            <div style={{ display:'flex', gap:0 }}>
              {STEPS.map((s,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }} onClick={()=>createStep>i+1&&setCreateStep(i+1)}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:createStep>i+1?'#16A34A':createStep===i+1?'#E8890C':'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff', flexShrink:0 }}>
                      {createStep>i+1 ? '✓' : i+1}
                    </div>
                    <span style={{ color:createStep===i+1?'#fff':'rgba(255,255,255,0.5)', fontSize:12, fontWeight:createStep===i+1?700:400, whiteSpace:'nowrap' }}>{s}</span>
                  </div>
                  {i<STEPS.length-1 && <div style={{ flex:1, height:1, background:'rgba(255,255,255,0.2)', margin:'0 8px' }}></div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding:'24px' }}>

            {/* STEP 1: Basic Info */}
            {createStep===1 && (
              <div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={LBL}>Event Name *</label>
                    <input value={newEvent.name} onChange={e=>setNewEvent(p=>({...p,name:e.target.value}))} placeholder="e.g. Sharma Wedding Reception" style={INP} autoFocus />
                  </div>
                  <div>
                    <label style={LBL}>Event Date *</label>
                    <input type="date" value={newEvent.date} onChange={e=>setNewEvent(p=>({...p,date:e.target.value}))} style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Number of Tables</label>
                    <input type="number" value={newEvent.number_of_tables} onChange={e=>setNewEvent(p=>({...p,number_of_tables:e.target.value}))} placeholder="e.g. 15" style={INP} />
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label style={LBL}>Venue / Location</label>
                    <input value={newEvent.venue} onChange={e=>setNewEvent(p=>({...p,venue:e.target.value}))} placeholder="e.g. Grand Ballroom, Taj Hotel, Pune" style={INP} />
                  </div>
                </div>
                <div style={{ display:'flex', gap:10, marginTop:8 }}>
                  <button onClick={resetCreate} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>Cancel</button>
                  <button onClick={()=>{ if(!newEvent.name||!newEvent.date){alert('Name and date required');return} setCreateStep(2) }} style={{ flex:2, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>Next: Configuration →</button>
                </div>
              </div>
            )}

            {/* STEP 2: Configuration */}
            {createStep===2 && (
              <div>
                <div style={{ marginBottom:20 }}>
                  <label style={LBL}>Max Orders Per Table</label>
                  <div style={{ fontSize:12, color:'var(--ink2)', marginBottom:10 }}>Guests must wait for delivery before placing another order</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                    {[1,2,3,4,5,6,7,8].map(n => (
                      <button key={n} type="button" onClick={()=>setNewEvent(p=>({...p,max_orders_per_table:n}))}
                        style={{ width:48, height:44, borderRadius:10, border:'1.5px solid', borderColor:newEvent.max_orders_per_table===n?'var(--ink)':'var(--line)', background:newEvent.max_orders_per_table===n?'var(--ink)':'#fff', color:newEvent.max_orders_per_table===n?'#fff':'var(--ink)', fontWeight:700, fontSize:15, cursor:'pointer' }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:13, color:'var(--ink2)' }}>Custom:</span>
                    <input type="number" min="1" max="50" value={newEvent.max_orders_per_table} onChange={e=>setNewEvent(p=>({...p,max_orders_per_table:parseInt(e.target.value)||1}))}
                      style={{ ...INP, width:80, marginBottom:0 }} />
                  </div>
                </div>

                <div style={{ marginBottom:20, background:'#F9FAFB', borderRadius:12, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>🛎️ Enable Call Waiter</div>
                    <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>Guests can request waiter assistance from their tablet</div>
                  </div>
                  <button type="button" onClick={()=>setNewEvent(p=>({...p,call_waiter_enabled:!p.call_waiter_enabled}))}
                    style={{ width:52, height:28, borderRadius:999, border:'none', cursor:'pointer', position:'relative', background:newEvent.call_waiter_enabled?'#16A34A':'#D1D5DB', transition:'background 0.2s', flexShrink:0 }}>
                    <span style={{ position:'absolute', top:3, left:newEvent.call_waiter_enabled?26:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }}></span>
                  </button>
                </div>

                {/* Help items - collapsed, defaults preselected */}
                <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                  <button type="button" onClick={()=>setHelpOpen(!helpOpen)}
                    style={{ width:'100%', background:'none', border:'none', padding:0, cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                    <span style={{ textAlign:'left' }}>
                      <span style={{ display:'block', fontSize:14, fontWeight:700 }}>🔔 Help Items</span>
                      <span style={{ display:'block', fontSize:12, color:'var(--ink2)', marginTop:2 }}>
                        {helpTouched
                          ? newHelp.filter(h=>h.include).length + ' items selected for this event'
                          : 'Using the default list (' + newHelp.length + ' items)'}
                      </span>
                    </span>
                    <span style={{ fontSize:13, color:'#888', flexShrink:0,
                      transform: helpOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.15s',
                      display:'inline-block' }}>▼</span>
                  </button>

                  {helpOpen && (
                    <div style={{ marginTop:10 }}>
                      {newHelp.map((h, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'#fff',
                          border:'1px solid var(--line)', borderRadius:10, padding:'7px 10px', marginBottom:6 }}>
                          <button type="button"
                            onClick={()=>{ setHelpTouched(true); setNewHelp(p=>p.map((x,j)=>j===i?{...x,include:!x.include}:x)) }}
                            style={{ flexShrink:0, width:22, height:22, borderRadius:6, cursor:'pointer',
                              border:'1.5px solid ' + (h.include ? '#16A34A' : '#D1D5DB'),
                              background: h.include ? '#16A34A' : '#fff', color:'#fff',
                              fontSize:13, fontWeight:900, lineHeight:1, padding:0 }}>
                            {h.include ? '✓' : ''}
                          </button>
                          <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:700,
                            color: h.include ? '#1A1A1A' : '#AAA' }}>{h.name}</span>
                          <button type="button"
                            onClick={()=>{ setHelpTouched(true); setNewHelp(p=>p.map((x,j)=>j===i?{...x,has_quantity:!x.has_quantity}:x)) }}
                            style={{ flexShrink:0, background: h.has_quantity ? '#DCFCE7' : '#F3F4F6',
                              border:'1px solid ' + (h.has_quantity ? '#86EFAC' : '#E5E7EB'),
                              color: h.has_quantity ? '#15803D' : '#6B7280', borderRadius:999,
                              padding:'4px 10px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                            {h.has_quantity ? '± Qty' : 'Tap only'}
                          </button>
                        </div>
                      ))}
                      <div style={{ fontSize:11, color:'#888', marginTop:6, lineHeight:1.5 }}>
                        More items can be added after the event is created.
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={()=>setCreateStep(1)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>← Back</button>
                  <button onClick={()=>setCreateStep(3)} style={{ flex:2, background:'var(--ink)', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>Next: Branding →</button>
                </div>
              </div>
            )}

            {/* STEP 3: Branding & Media */}
            {createStep===3 && (
              <div>
                {/* Catering company */}
                <div style={{ marginBottom:16 }}>
                  <label style={LBL}>Catering Company Name</label>
                  <input value={newEvent.catering_company} onChange={e=>setNewEvent(p=>({...p,catering_company:e.target.value}))} placeholder="e.g. Delhi Darbar, Barbeque Nation" style={INP} />
                </div>

                {/* Logo */}
                <div style={{ marginBottom:16 }}>
                  <label style={LBL}>Catering Logo</label>
                  <input ref={newLogoRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e=>handleNewLogoFile(e.target.files[0])} style={{ display:'none' }} />
                  {newLogoPreview && (
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, background:'var(--bg)', borderRadius:10, padding:'8px 12px', border:'1px solid var(--line)' }}>
                      <img src={newLogoPreview} style={{ width:48, height:48, objectFit:'contain', borderRadius:8 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:'#16A34A' }}>✅ Logo ready to upload</div>
                        <div style={{ fontSize:11, color:'var(--ink2)' }}>{newLogoFile?.name}</div>
                      </div>
                      <button onClick={()=>{ setNewLogoFile(null); setNewLogoPreview('') }} style={{ background:'#FEF2F2', border:'none', borderRadius:8, padding:'4px 10px', fontSize:12, color:'#DC2626', cursor:'pointer' }}>Remove</button>
                    </div>
                  )}
                  <button onClick={()=>newLogoRef.current?.click()} style={{ width:'100%', background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer', marginBottom:8 }}>
                    📷 Upload Logo from Device
                  </button>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                    <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
                    <span style={{ fontSize:11, color:'var(--ink2)' }}>or paste URL</span>
                    <div style={{ flex:1, height:1, background:'var(--line)' }}></div>
                  </div>
                  <input value={newEvent.catering_logo_url} onChange={e=>setNewEvent(p=>({...p,catering_logo_url:e.target.value}))} placeholder="https://example.com/logo.png" style={INP} />
                </div>

                {/* ── WELCOME NOTE (3rd carousel panel) ── */}
                <div style={{ marginBottom:20 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'var(--ink2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Welcome Note <span style={{ color:'#888', fontWeight:500, textTransform:'none' }}>(shown on guest tablet banner — max 60 chars)</span></div>
                  <input
                    value={newEvent.welcome_note}
                    onChange={e=>setNewEvent(p=>({...p,welcome_note:e.target.value.slice(0,60)}))}
                    placeholder="e.g. Azeem Weds Neha • Sayyed Family Welcomes You!"
                    maxLength={60}
                    style={INP} />
                  <div style={{ fontSize:11, color: newEvent.welcome_note.length > 50 ? '#D97706' : '#999', marginTop:4, textAlign:'right' }}>
                    {newEvent.welcome_note.length}/60 characters
                  </div>
                </div>

                {/* ── BANNER IMAGE (3rd carousel panel background) ── */}
                <div style={{ marginBottom:20 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'var(--ink2)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Banner Image <span style={{ color:'#888', fontWeight:500, textTransform:'none' }}>(optional — shows behind welcome note)</span></div>
                  {newEvent.banner_image_url && (
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, background:'#fff', borderRadius:8, padding:'6px 10px', border:'1px solid var(--line)' }}>
                      <img src={newEvent.banner_image_url} style={{ width:60, height:36, objectFit:'cover', borderRadius:6 }} onError={e=>e.target.style.display='none'} />
                      <span style={{ fontSize:12, color:'#16A34A', fontWeight:600, flex:1 }}>✅ Banner image set</span>
                      <button type="button" onClick={()=>setNewEvent(p=>({...p,banner_image_url:''}))} style={{ background:'none', border:'none', color:'#DC2626', fontSize:11, cursor:'pointer', fontWeight:600 }}>Remove</button>
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8, marginBottom:4 }}>
                    <label style={{ flex:1, background:'var(--ink)', color:'#fff', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer', textAlign:'center' }}>
                      📷 Upload Image
                      <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display:'none' }} onChange={async e=>{
                        const file = e.target.files[0]; if (!file) return
                        const ext = file.name.split('.').pop()
                        const fname = Date.now()+'-banner.'+ext
                        const { data, error } = await supabase.storage.from('smartserve').upload('catering-logos/'+fname, file, { upsert:true })
                        if (!error) {
                          const { data: pub } = supabase.storage.from('smartserve').getPublicUrl('catering-logos/'+fname)
                          setNewEvent(p=>({...p,banner_image_url:pub.publicUrl}))
                        }
                      }} />
                    </label>
                    <input
                      value={newEvent.banner_image_url}
                      onChange={e=>setNewEvent(p=>({...p,banner_image_url:e.target.value}))}
                      placeholder="or paste image URL"
                      style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                  </div>
                  <div style={{ fontSize:11, color:'#999' }}>JPG, PNG · Recommended: 800×200px landscape</div>
                </div>

                {/* Video */}
                <div style={{ marginBottom:20 }}>
                  <label style={LBL}>Welcome Screen Video (optional)</label>
                  <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                    <button onClick={()=>setNewVideoMode('url')} style={{ flex:1, padding:'8px', borderRadius:8, border:'1.5px solid', borderColor:newVideoMode==='url'?'var(--ink)':'var(--line)', background:newVideoMode==='url'?'var(--ink)':'#fff', color:newVideoMode==='url'?'#fff':'var(--ink)', fontSize:13, fontWeight:700, cursor:'pointer' }}>🔗 Paste URL</button>
                    <button onClick={()=>setNewVideoMode('upload')} style={{ flex:1, padding:'8px', borderRadius:8, border:'1.5px solid', borderColor:newVideoMode==='upload'?'var(--ink)':'var(--line)', background:newVideoMode==='upload'?'var(--ink)':'#fff', color:newVideoMode==='upload'?'#fff':'var(--ink)', fontSize:13, fontWeight:700, cursor:'pointer' }}>📤 Upload File</button>
                  </div>
                  {newVideoMode==='url'
                    ? <input value={newEvent.video_url} onChange={e=>setNewEvent(p=>({...p,video_url:e.target.value}))} placeholder="https://example.com/video.mp4" style={INP} />
                    : <>
                        <input ref={newVideoRef} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>handleNewVideoFile(e.target.files[0])} style={{ display:'none' }} />
                        {newVideoFile && <div style={{ fontSize:12, color:'#16A34A', marginBottom:8, background:'#F0FDF4', padding:'8px 12px', borderRadius:8 }}>✅ {newVideoFile.name}</div>}
                        <button onClick={()=>newVideoRef.current?.click()} style={{ width:'100%', background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700, cursor:'pointer' }}>📤 Choose Video File</button>
                      </>
                  }
                  <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>MP4, WebM, MOV · Max 100MB · Recommended: 16:9, 720p</div>
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={()=>setCreateStep(2)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'12px', fontSize:14, fontWeight:700 }}>← Back</button>
                  <button onClick={createEvent} disabled={saving} style={{ flex:2, background:saving?'#999':'#16A34A', color:'#fff', border:'none', borderRadius:12, padding:'12px', fontSize:14, fontWeight:800 }}>
                    {saving?'Creating...':'✓ Create Event'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Supervisor */}
      {showAddSup && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #E8890C' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Supervisor</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff', marginBottom:10 }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <input value={newSup.name} onChange={e=>setNewSup(p=>({...p,name:e.target.value}))} placeholder="Full name * (username)" style={INP} />
            <input value={newSup.pin} onChange={e=>setNewSup(p=>({...p,pin:e.target.value.replace(/D/g,'').slice(0,6)}))} placeholder="PIN * (password)" style={{ ...INP, letterSpacing:'0.2em' }} />
          </div>
          <input value={newSup.mobile} onChange={e=>setNewSup(p=>({...p,mobile:e.target.value}))} placeholder="Mobile number (optional)" type="tel" style={{ ...INP, marginBottom:10 }} />
          {newSup.name && newSup.pin && <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#15803D', marginBottom:10 }}>Login: <strong>{newSup.name}</strong> / <strong>{newSup.pin}</strong></div>}
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addSupervisor} disabled={saving} style={{ flex:1, background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Supervisor'}</button>
            <button onClick={()=>setShowAddSup(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'11px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add Waiter */}
      {showAddWaiter && (
        <div style={{ background:'#fff', borderRadius:16, padding:20, marginBottom:20, boxShadow:'var(--shadow)', border:'2px solid #2563EB' }}>
          <h3 style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Add Waiter</h3>
          <select value={selEvent||''} onChange={e=>setSelEvent(e.target.value)} style={{ ...INP, background:'#fff', marginBottom:10 }}>
            <option value="">Select Event *</option>
            {events.map(ev=><option key={ev.id} value={ev.id}>{ev.name}</option>)}
          </select>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
            <input value={newWaiter.number} onChange={e=>setNewWaiter(p=>({...p,number:e.target.value}))} placeholder="Waiter number * (e.g. 01)" style={INP} />
            <input value={newWaiter.name} onChange={e=>setNewWaiter(p=>({...p,name:e.target.value}))} placeholder="Waiter name (optional)" style={INP} />
            <input value={newWaiter.mobile} onChange={e=>setNewWaiter(p=>({...p,mobile:e.target.value}))} placeholder="Mobile (optional)" type="tel" style={INP} />
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={addWaiter} disabled={saving} style={{ flex:1, background:'#2563EB', color:'#fff', border:'none', borderRadius:12, padding:'11px', fontSize:14, fontWeight:800 }}>{saving?'Adding...':'Add Waiter'}</button>
            <button onClick={()=>setShowAddWaiter(false)} style={{ flex:1, background:'var(--bg)', border:'1.5px solid var(--line)', borderRadius:12, padding:'11px', fontSize:14, fontWeight:700 }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showAddSup && !showAddWaiter && !showCreate && (
        <div style={{ display:'flex', gap:10, marginBottom:20 }}>
          <button onClick={()=>{ setShowAddSup(true); setShowAddWaiter(false) }} style={{ flex:1, background:'#FEF3C7', border:'1.5px solid #FCD34D', color:'#92400E', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700 }}>+ Add Supervisor</button>
          <button onClick={()=>{ setShowAddWaiter(true); setShowAddSup(false) }} style={{ flex:1, background:'#EFF6FF', border:'1.5px solid #BFDBFE', color:'#2563EB', borderRadius:12, padding:'11px', fontSize:13, fontWeight:700 }}>+ Add Waiter</button>
        </div>
      )}

      {/* ═══ VIEW TOGGLE ═══ */}
      {!loading && events.length > 0 && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <div style={{ fontSize:13, color:'var(--ink2)', fontWeight:600 }}>{events.length} event{events.length!==1?'s':''}</div>
          <div style={{ display:'flex', background:'#F3F4F6', borderRadius:10, padding:3, gap:2 }}>
            <button onClick={()=>setViewMode('list')} style={{ padding:'6px 14px', borderRadius:8, border:'none', fontSize:13, fontWeight:700, cursor:'pointer', background:viewMode==='list'?'#fff':'transparent', color:viewMode==='list'?'var(--ink)':'#888', boxShadow:viewMode==='list'?'0 1px 4px rgba(0,0,0,0.1)':'none', transition:'all 0.15s' }}>
              ☰ List
            </button>
            <button onClick={()=>setViewMode('detail')} style={{ padding:'6px 14px', borderRadius:8, border:'none', fontSize:13, fontWeight:700, cursor:'pointer', background:viewMode==='detail'?'#fff':'transparent', color:viewMode==='detail'?'var(--ink)':'#888', boxShadow:viewMode==='detail'?'0 1px 4px rgba(0,0,0,0.1)':'none', transition:'all 0.15s' }}>
              ⊞ Detail
            </button>
          </div>
        </div>
      )}

      {/* ═══ LIST VIEW ═══ */}
      {!loading && viewMode==='list' && (
        <div style={{ background:'#fff', borderRadius:16, boxShadow:'var(--shadow)', overflow:'hidden', border:'1px solid var(--line)', marginBottom:20 }}>
          {events.map((ev, idx) => {
            const sups = getSups(ev.id)
            const ws = getWaiters(ev.id)
            const st = eventStatus(ev.date)
            return (
              <div key={ev.id} onClick={()=>{ setSelectedEvent(ev.id); setViewMode('detail') }}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 18px', borderBottom: idx<events.length-1?'1px solid var(--line)':'none', cursor:'pointer', transition:'background 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.background='#F9FAFB'}
                onMouseLeave={e=>e.currentTarget.style.background='#fff'}>

                {/* Logo or initial */}
                {ev.catering_logo_url
                  ? <img src={ev.catering_logo_url} alt="" style={{ width:44, height:44, objectFit:'contain', borderRadius:10, background:'#f5f5f5', padding:4, flexShrink:0 }} onError={e=>e.target.style.display='none'} />
                  : <div style={{ width:44, height:44, borderRadius:10, background:'var(--ink)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800, color:'#E8890C', flexShrink:0 }}>
                      {(ev.catering_company||ev.name||'?')[0].toUpperCase()}
                    </div>
                }

                {/* Event info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                    <span style={{ fontWeight:800, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ev.name}</span>
                    <span style={{ flexShrink:0, fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:999, background:STATUS_BG[st], color:STATUS_COLOR[st] }}>{STATUS_LABEL[st]}</span>
                  </div>
                  <div style={{ fontSize:12, color:'var(--ink2)', display:'flex', gap:12, flexWrap:'wrap' }}>
                    <span>📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>
                    {ev.venue && <span>📍 {ev.venue}</span>}
                    {ev.catering_company && <span>🍽️ {ev.catering_company}</span>}
                  </div>
                </div>

                {/* Stats badges */}
                <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                  {ev.number_of_tables && <span style={{ background:'#EFF6FF', color:'#2563EB', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>🪑 {ev.number_of_tables}</span>}
                  <span style={{ background:'#F5F3FF', color:'#7C3AED', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>👔 {sups.length}</span>
                  <span style={{ background:'#FEF3C7', color:'#92400E', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:999 }}>🧑‍🍳 {ws.length}</span>
                </div>

                {/* Duplicate. stopPropagation so it does not open the event. */}
                <button onClick={e => { e.stopPropagation(); duplicateEvent(ev) }}
                  disabled={duplicating === ev.id}
                  title="Duplicate this event"
                  style={{ flexShrink:0, background:'var(--bg)', border:'1px solid var(--line)',
                    borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:700,
                    color:'var(--ink2)', cursor: duplicating === ev.id ? 'wait' : 'pointer' }}>
                  {duplicating === ev.id ? 'Copying...' : '⧉ Duplicate'}
                </button>

                {/* Arrow */}
                <span style={{ color:'#CCC', fontSize:18, flexShrink:0 }}>›</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ DETAIL VIEW ═══ */}
      {!loading && viewMode==='detail' && (
        <>
          {/* Back to list */}
          <button onClick={()=>{ setViewMode('list'); setSelectedEvent(null) }}
            style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:'var(--ink2)', fontSize:13, fontWeight:600, cursor:'pointer', marginBottom:12, padding:0 }}>
            ← Back to list
          </button>
        </>
      )}

      {/* ═══ DETAIL CARDS (shown in detail view) ═══ */}
      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : viewMode==='detail' && events.filter(ev => !selectedEvent || ev.id===selectedEvent).map(ev => {
        const sups = getSups(ev.id)
        const ws = getWaiters(ev.id)
        const st = eventStatus(ev.date)
        const isActive = st === 'active'

        return (
          <div key={ev.id} style={{ background:'#fff', borderRadius:18, marginBottom:14, boxShadow:'var(--shadow)', overflow:'hidden', border:'1px solid var(--line)' }}>

            {/* Event header bar */}
            <div style={{ background:isActive?'#F0FDF4':'#F9FAFB', padding:'14px 18px', borderBottom:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {ev.catering_logo_url && <img src={ev.catering_logo_url} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:8, background:'#fff', padding:3, border:'1px solid var(--line)' }} onError={e=>e.target.style.display='none'} />}
                <div>
                  <div style={{ fontWeight:800, fontSize:16 }}>{ev.name}</div>
                  <div style={{ fontSize:12, color:'var(--ink2)', marginTop:1 }}>
                    📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                    {ev.venue && <span> · 📍 {ev.venue}</span>}
                    {ev.catering_company && <span> · 🍽️ {ev.catering_company}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ background:isActive?'#DCFCE7':'#F3F4F6', color:isActive?'#16A34A':'#6B7280', fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:999 }}>{isActive?'● Active':'○ Closed'}</span>
                <button onClick={()=>toggleEvent(ev)} style={{ background:'#fff', border:'1px solid var(--line)', borderRadius:8, padding:'5px 12px', fontSize:12, fontWeight:600, color:'var(--ink2)', cursor:'pointer' }}>
                  {isActive?'Close':'Reopen'}
                </button>
              </div>
            </div>

            <div style={{ padding:'16px 18px' }}>

              {/* Event Name + Date editable */}
              <EventDateNameEditor ev={ev} onSave={async(field,val)=>{ await updateEventField(ev.id,field,val); loadAll() }} />

              {/* Quick edit fields — tables + max orders + call waiter */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:16 }}>
                <div>
                  <label style={LBL}>Tables</label>
                  <input type="number" defaultValue={ev.number_of_tables||''} placeholder="e.g. 15"
                    onBlur={async e => { if (e.target.value !== String(ev.number_of_tables||'')) await updateEventField(ev.id, 'number_of_tables', parseInt(e.target.value)||null) }}
                    style={{ ...INP, fontSize:13 }} />
                </div>
                <div>
                  <label style={LBL}>Max Orders/Table</label>
                  <input type="number" min="1" max="50" defaultValue={ev.max_orders_per_table||1}
                    onBlur={async e => { await updateEventField(ev.id, 'max_orders_per_table', parseInt(e.target.value)||1) }}
                    style={{ ...INP, fontSize:13 }} />
                </div>
                <div>
                  <label style={LBL}>Call Waiter</label>
                  <div style={{ display:'flex', alignItems:'center', height:40, gap:8 }}>
                    <button type="button" onClick={async()=>{ await updateEventField(ev.id,'call_waiter_enabled',!ev.call_waiter_enabled) }}
                      style={{ width:52, height:28, borderRadius:999, border:'none', cursor:'pointer', position:'relative', background:ev.call_waiter_enabled!==false?'#16A34A':'#D1D5DB', transition:'background 0.2s' }}>
                      <span style={{ position:'absolute', top:3, left:ev.call_waiter_enabled!==false?26:3, width:22, height:22, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 4px rgba(0,0,0,0.2)', transition:'left 0.2s', display:'block' }}></span>
                    </button>
                    <span style={{ fontSize:12, color:'var(--ink2)' }}>{ev.call_waiter_enabled!==false?'On':'Off'}</span>
                  </div>
                </div>
              </div>

              {/* Catering branding */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:10, textTransform:'uppercase' }}>🏷️ Catering Branding</div>
                <input defaultValue={ev.catering_company||''} key={'cn'+ev.id}
                  onBlur={async e=>{ await updateEventField(ev.id,'catering_company',e.target.value||null) }}
                  placeholder="Catering company name" style={{ ...INP, marginBottom:10, fontSize:13 }} />

                <div style={{ fontSize:11, fontWeight:600, color:'var(--ink2)', marginBottom:6 }}>Logo</div>
                <input ref={el=>logoFileRefs.current[ev.id]=el} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={e=>uploadLogo(ev.id,e.target.files[0])} style={{ display:'none' }} />
                {ev.catering_logo_url && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, background:'#fff', borderRadius:8, padding:'6px 10px', border:'1px solid var(--line)' }}>
                    <img src={ev.catering_logo_url} style={{ width:36, height:36, objectFit:'contain', borderRadius:6 }} onError={e=>e.target.style.display='none'} />
                    <span style={{ fontSize:12, color:'#16A34A', fontWeight:600, flex:1 }}>✅ Logo set</span>
                    <button onClick={async()=>{ await updateEventField(ev.id,'catering_logo_url',null) }} style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#DC2626', borderRadius:6, padding:'3px 8px', fontSize:11, cursor:'pointer' }}>Remove</button>
                  </div>
                )}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>logoFileRefs.current[ev.id]?.click()} disabled={uploadingLogo===ev.id}
                    style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {uploadingLogo===ev.id?'⏳ Uploading...':'📷 Upload Logo'}
                  </button>
                  <input defaultValue={ev.catering_logo_url||''} key={'cl'+ev.id}
                    onBlur={async e=>{ if(e.target.value.trim()&&e.target.value!==ev.catering_logo_url){ await updateEventField(ev.id,'catering_logo_url',e.target.value.trim()||null) } }}
                    placeholder="or paste URL" style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                </div>
              </div>

              {/* Which tablet holds which table */}
              <TableClaims eventId={ev.id} tableCount={ev.number_of_tables} />

              {/* Help items — what guests can ask for from the Help panel */}
              <HelpItemsEditor eventId={ev.id} />

              {/* Genie video sound, per event */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12,
                display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', textTransform:'uppercase' }}>🔊 Genie Video Sound</div>
                  <div style={{ fontSize:12, color:'#888', marginTop:3 }}>Turn off for quiet venues or corporate events</div>
                </div>
                <button onClick={async()=>{ await updateEventField(ev.id,'video_sound_enabled', ev.video_sound_enabled===false); loadAll() }}
                  style={{ flexShrink:0, background: ev.video_sound_enabled===false ? '#F3F4F6' : '#DCFCE7',
                    border:'1px solid ' + (ev.video_sound_enabled===false ? '#E5E7EB' : '#86EFAC'),
                    color: ev.video_sound_enabled===false ? '#6B7280' : '#15803D',
                    borderRadius:999, padding:'8px 18px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                  {ev.video_sound_enabled===false ? 'OFF' : 'ON'}
                </button>
              </div>

              {/* Welcome Note + Banner Image edit */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:10, textTransform:'uppercase' }}>🎉 Welcome Note & Banner</div>
                <div style={{ marginBottom:10 }}>
                  <label style={LBL}>Welcome Note (max 60 chars — shows on guest tablet banner)</label>
                  <input defaultValue={ev.welcome_note||''} key={'wn'+ev.id}
                    maxLength={60}
                    onBlur={async e=>{ await updateEventField(ev.id,'welcome_note',e.target.value.trim()||null) }}
                    placeholder="e.g. Azeem Weds Neha · Sayyed Family Welcomes You!"
                    style={{ ...INP, fontSize:13 }} />
                </div>
                <div>
                  <label style={LBL}>Banner Image (optional — shows on 3rd carousel panel)</label>
                  {ev.banner_image_url && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, background:'#fff', borderRadius:8, padding:'5px 10px', border:'1px solid var(--line)' }}>
                      <img src={ev.banner_image_url} style={{ width:60, height:36, objectFit:'cover', borderRadius:6 }} onError={e=>e.target.style.display='none'} />
                      <span style={{ fontSize:12, color:'#16A34A', flex:1 }}>✅ Banner set</span>
                      <button onClick={async()=>updateEventField(ev.id,'banner_image_url',null)} style={{ background:'none', border:'none', color:'#DC2626', fontSize:11, cursor:'pointer', fontWeight:600 }}>Remove</button>
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8 }}>
                    <label style={{ flex:1, background:'var(--ink)', color:'#fff', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer', textAlign:'center' }}>
                      📷 Upload
                      <input type="file" accept="image/jpeg,image/png,image/webp" style={{ display:'none' }} onChange={async e=>{
                        const file = e.target.files[0]; if (!file) return
                        const ext = file.name.split('.').pop()
                        const fname = Date.now()+'-banner.'+ext
                        const { data, error } = await supabase.storage.from('smartserve').upload('catering-logos/'+fname, file, { upsert:true })
                        if (!error) {
                          const { data: pub } = supabase.storage.from('smartserve').getPublicUrl('catering-logos/'+fname)
                          await updateEventField(ev.id,'banner_image_url',pub.publicUrl)
                        }
                      }} />
                    </label>
                    <input defaultValue={ev.banner_image_url||''} key={'bi'+ev.id}
                      onBlur={async e=>{ await updateEventField(ev.id,'banner_image_url',e.target.value.trim()||null) }}
                      placeholder="or paste image URL"
                      style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                  </div>
                </div>
              </div>

              {/* Video */}
              <div style={{ background:'var(--bg)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>🎥 Welcome Video</div>
                <input ref={el=>videoFileRefs.current[ev.id]=el} type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e=>uploadVideo(ev.id,e.target.files[0])} style={{ display:'none' }} />
                {ev.video_url && <div style={{ fontSize:12, color:'#16A34A', marginBottom:6 }}>✅ Video set &nbsp;<button onClick={async()=>updateEventField(ev.id,'video_url',null)} style={{ background:'none', border:'none', color:'#DC2626', fontSize:11, cursor:'pointer', fontWeight:600 }}>Remove</button></div>}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>videoFileRefs.current[ev.id]?.click()} disabled={uploading===ev.id}
                    style={{ flex:1, background:'var(--ink)', color:'#fff', border:'none', borderRadius:8, padding:'8px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    {uploading===ev.id?'⏳ Uploading...':'📤 Upload Video'}
                  </button>
                  <input defaultValue={ev.video_url||''} key={'vd'+ev.id}
                    onBlur={async e=>{ if(e.target.value.trim()!==ev.video_url){ await updateEventField(ev.id,'video_url',e.target.value.trim()||null) } }}
                    placeholder="or paste MP4 URL" style={{ flex:2, border:'1.5px solid var(--line)', borderRadius:8, padding:'8px 10px', fontSize:12, fontFamily:'Manrope', outline:'none' }} />
                </div>
                <div style={{ fontSize:11, color:'var(--ink2)', marginTop:6 }}>MP4/WebM/MOV · Max 100MB · Landscape 16:9 recommended</div>
              </div>

              {/* Supervisors */}
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--ink2)', marginBottom:8, textTransform:'uppercase' }}>👔 Supervisors ({sups.length})</div>
                {sups.length===0 ? <div style={{ fontSize:13, color:'var(--ink2)', fontStyle:'italic' }}>None assigned</div>
                : sups.map(sup => (
                  <div key={sup.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', marginBottom:6, background:'var(--bg)', borderRadius:10 }}>
                    <div>
                      <span style={{ fontWeight:700, fontSize:14 }}>{sup.name}</span>
                      <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>PIN: {sup.pin}</span>
                      {sup.mobile && <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>📞 {sup.mobile}</span>}
                      <div style={{ fontSize:11, color:'var(--ink2)', marginTop:1 }}>Login: <strong>{sup.name}</strong> / <strong>{sup.pin}</strong></div>
                    </div>
                    <button onClick={()=>removeSup(sup.id)} disabled={removing===sup.id}
                      style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, padding:'4px 12px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>
                      {removing===sup.id?'...':'Remove'}
                    </button>
                  </div>
                ))}
              </div>

              {/* The chip list that sat here is gone. Waiters are managed on the
                  Staff tab, which can add and edit as well as remove - two lists
                  that can disagree is worse than one. */}
            </div>
          </div>
        )
      })}
    </div>
  )
}
