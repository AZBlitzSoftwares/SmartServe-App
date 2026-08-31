import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

/* Captains for one event - the single place they are managed.

   A captain takes orders at the table and nothing else. A waiter carries
   food and nothing else. They are deliberately separate lists rather than
   one staff table with a role column, because the KOT screen puts waiters
   into a delivery rotation and a captain must never land in it.

   Shaped like WaiterList so the two tabs read as one screen. The visible
   difference is the PIN: a captain logs in on a tablet with name and PIN,
   the way a supervisor does, so the PIN is shown here for the admin to
   read out. A waiter has no login and no PIN.

   Removal is a soft delete. Orders keep the captain against them, so the
   end of event report can still answer "who took this order" for someone
   who left at nine. */
export default function CaptainList({ eventId }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ name:'', pin:'', mobile:'' })
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [eventId])

  async function load() {
    if (!eventId) return
    const { data } = await supabase.from('captains')
      .select('*').eq('event_id', eventId).eq('is_active', true).order('name')

    // Same natural sort as the waiter list: the database orders text, so
    // 01, 1, 10, 2 comes out in that order and buries captain 2 after 10.
    const num = c => {
      const m = String(c.name || '').match(/\d+/)
      return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER
    }
    const sorted = [...(data || [])].sort((a, b) => {
      const d = num(a) - num(b)
      if (d !== 0) return d
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
    setRows(sorted)
  }

  async function patch(c, field, value) {
    const v = (value || '').trim()
    if (field === 'pin' && !/^\d{4}$/.test(v)) {
      setErr('The PIN must be exactly 4 digits.')
      setTimeout(() => setErr(''), 3000)
      load() // put the old value back on screen
      return
    }
    if (field === 'name' && !v) { load(); return }
    setBusy(true)
    const upd = field === 'mobile' ? { mobile: v || null } : { [field]: v }
    const { error } = await supabase.from('captains').update(upd).eq('id', c.id)
    setBusy(false)
    if (error) {
      // The unique index on (event_id, name) is what fires here. Two
      // captains with the same name at one event would make the PIN login
      // ambiguous, which is why the database refuses it.
      setErr(error.message.includes('duplicate') || error.code === '23505'
        ? 'Another captain at this event already has that name.'
        : 'Could not save. Check the connection and try again.')
      setTimeout(() => setErr(''), 4000)
    }
    load()
  }

  async function removeOne(c) {
    if (!window.confirm('Remove captain ' + c.name + '?\n\nOrders they already took keep their name in the report.')) return
    setBusy(true)
    await supabase.from('captains').update({ is_active:false }).eq('id', c.id)
    setBusy(false); load()
  }

  async function create() {
    const name = add.name.trim()
    const pin  = add.pin.trim()
    if (!name) return
    if (!/^\d{4}$/.test(pin)) {
      setErr('The PIN must be exactly 4 digits.')
      setTimeout(() => setErr(''), 3000)
      return
    }
    setBusy(true)
    const { error } = await supabase.from('captains').insert({
      event_id: eventId, name, pin, mobile: add.mobile.trim() || null, is_active: true
    })
    setBusy(false)
    if (error) {
      setErr(error.code === '23505'
        ? 'A captain called "' + name + '" already exists at this event.'
        : 'Could not add. ' + error.message)
      setTimeout(() => setErr(''), 4000)
      return
    }
    setAdd({ name:'', pin:'', mobile:'' })
    load()
  }

  const fld = { width:'100%', border:'1px solid var(--line)', borderRadius:7,
    padding:'5px 8px', fontSize:12, fontFamily:'Manrope', outline:'none',
    background:'#fff', boxSizing:'border-box' }

  return (
    <>
      <style>{`
        /* Columns rather than grid, matching the waiter and table lists:
           fills downwards so 01-07 reads as one column instead of zigzagging. */
        .ss-cgrid { column-count:3; column-gap:6px; }
        .ss-cgrid > div {
          break-inside:avoid; -webkit-column-break-inside:avoid; page-break-inside:avoid;
          margin-bottom:6px;
        }
        @media (max-width: 900px) { .ss-cgrid { column-count:2; } }
        @media (max-width: 560px) { .ss-cgrid { column-count:1; } }
      `}</style>

      <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:12,
        padding:'10px 14px', marginBottom:12, fontSize:12, color:'#1d4ed8', lineHeight:1.55 }}>
        💡 <strong>Captain login:</strong> on the tablet, Username = Name · Password = PIN.
        The event is found automatically — captains never type an event name.
      </div>

      {err && (
        <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', color:'#B91C1C',
          borderRadius:10, padding:'9px 13px', fontSize:12, fontWeight:700, marginBottom:12 }}>
          {err}
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:6, marginBottom:8 }}>
        {[['Captains', rows.length, '#2563EB'],
          ['Taking orders', rows.length ? 'Ready' : '—', '#6B7280']].map(([label, n, c]) => (
          <div key={label} style={{ background:'#fff', borderRadius:10, padding:'5px 8px',
            textAlign:'center', boxShadow:'var(--shadow)' }}>
            <div style={{ fontSize:17, fontWeight:900, color:c }}>{n}</div>
            <div style={{ fontSize:9, fontWeight:700, color:'var(--ink2)',
              textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 && (
        <div style={{ textAlign:'center', padding:'28px 0', color:'var(--ink2)', fontSize:13,
          lineHeight:1.6 }}>
          No captains yet. Add the first one below.<br />
          <span style={{ fontSize:12, color:'#999' }}>
            Without a captain, nobody can log in to take orders at this event.
          </span>
        </div>
      )}

      <div className="ss-cgrid">
        {rows.map(c => (
          <div key={c.id} style={{ background:'#fff', borderRadius:10, padding:'6px 8px',
            boxShadow:'var(--shadow)', borderLeft:'3px solid #2563EB' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
              <input defaultValue={c.name || ''} disabled={busy} placeholder="Name"
                onBlur={e => { const v = e.target.value.trim()
                  if (v && v !== c.name) patch(c, 'name', v) }}
                style={{ ...fld, flex:1, minWidth:0, fontSize:13, fontWeight:800, padding:'3px 6px' }} />
              <button onClick={() => removeOne(c)} disabled={busy}
                title="Remove captain"
                style={{ flexShrink:0, background:'none', border:'none', color:'#DC2626',
                  fontSize:14, cursor:'pointer', padding:0, lineHeight:1 }}>&times;</button>
            </div>

            <div style={{ display:'flex', gap:5 }}>
              {/* The PIN is shown, not masked. An admin reading it out to a
                  captain across a room is the actual use, and hiding it would
                  only mean writing it on paper instead. */}
              <input defaultValue={c.pin || ''} disabled={busy} inputMode="numeric" maxLength={4}
                placeholder="PIN"
                onBlur={e => { const v = e.target.value.trim()
                  if (v !== c.pin) patch(c, 'pin', v) }}
                style={{ ...fld, flex:'3 1 0', minWidth:0, fontSize:11, padding:'3px 6px',
                  letterSpacing:'2px', fontWeight:800, textAlign:'center' }} />
              {c.mobile ? (
                <a href={'tel:' + c.mobile} title={'Call ' + c.mobile}
                  style={{ flex:'5 1 0', minWidth:0, background:'#DBEAFE',
                    border:'1px solid #93C5FD', color:'#1d4ed8', borderRadius:6,
                    padding:'3px 6px', fontSize:10, fontWeight:800, textDecoration:'none',
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    textAlign:'center', display:'block', lineHeight:'16px' }}>
                  ☎ {c.mobile}
                </a>
              ) : (
                <input defaultValue="" placeholder="Mobile" type="tel" disabled={busy}
                  onBlur={e => { if (e.target.value.trim()) patch(c, 'mobile', e.target.value) }}
                  style={{ ...fld, flex:'5 1 0', minWidth:0, fontSize:11, padding:'3px 6px' }} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:6, marginTop:12, paddingTop:12,
        borderTop:'1px solid var(--line)', alignItems:'center', flexWrap:'wrap' }}>
        <input value={add.name} onChange={e => setAdd(p => ({ ...p, name:e.target.value }))}
          placeholder="Captain name e.g. C1 or Imran" style={{ ...fld, flex:1, minWidth:140 }}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <input value={add.pin} inputMode="numeric" maxLength={4}
          onChange={e => setAdd(p => ({ ...p, pin:e.target.value.replace(/\D/g,'').slice(0,4) }))}
          placeholder="4-digit PIN" style={{ ...fld, width:110, letterSpacing:'2px', fontWeight:800 }}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <input value={add.mobile} onChange={e => setAdd(p => ({ ...p, mobile:e.target.value }))}
          placeholder="Mobile" type="tel" style={{ ...fld, width:130 }}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <button onClick={create} disabled={busy || !add.name.trim() || add.pin.length !== 4}
          style={{ background: (add.name.trim() && add.pin.length === 4) ? 'var(--ink)' : '#E5E7EB',
            color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', fontSize:13,
            fontWeight:800,
            cursor: (add.name.trim() && add.pin.length === 4) ? 'pointer' : 'not-allowed' }}>Add</button>
      </div>
    </>
  )
}
