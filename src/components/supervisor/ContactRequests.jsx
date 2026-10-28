import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { showPhone } from '../../lib/contactOutbox'

/* Feedback › Contact requests: the name, WhatsApp number and email guests left
   on the guest tablet's Contact us page (newest first), for the selected event or all of
   them, with a CSV download for the team to message them. */
export default function ContactRequests({ events, eventId }) {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')   // loading | ok | missing | error
  const [open, setOpen] = useState(false)

  const fetchRows = () => supabase.from('contact_requests')
    .select('id,event_id,table_number,phone,email,name,created_at')
    .order('created_at', { ascending: false }).limit(2000)
  const apply = ({ data, error }) => {
    if (error) { setState(/^(42P01|PGRST20[05])$/.test(String(error.code)) || /does not exist|could not find the table/i.test(error.message || '') ? 'missing' : 'error'); return }
    setRows(data || []); setState('ok')
  }
  async function load() { setState('loading'); apply(await fetchRows()) }
  useEffect(() => {
    let off = false
    fetchRows().then(r => { if (!off) apply(r) })
    return () => { off = true }
  }, [])

  const shown = eventId ? rows.filter(r => r.event_id === eventId) : rows
  const evName = id => (events || []).find(e => e.id === id)?.name || ''
  const when = ts => new Date(ts).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'numeric', minute:'2-digit', hour12:true })

  function exportCSV() {
    const H = ['Name', 'Mobile (WhatsApp)', 'Email', 'Table No', 'Event', 'Date & time']
    const out = shown.map(r => [r.name || '', showPhone(r.phone), r.email || '', r.table_number ?? '', evName(r.event_id), when(r.created_at)])
    // A name or email typed starting = + - @ would run as a formula in Excel: kept as text.
    // The number (column 2) goes as ="+91 98765 43210" so Excel shows it exactly as written.
    const cell = (v, i) => {
      const t = String(v)
      if (i === 1 && t) return '"=""' + t.replace(/"/g, '') + '"""'
      return '"' + (/^[=+\-@]/.test(t) ? "'" + t : t).replace(/"/g, '""') + '"'
    }
    // BOM: Excel then reads Hindi / Arabic names correctly
    const csv = '\uFEFF' + [H, ...out].map((r, n) => r.map((v, i) => n === 0 ? '"' + v + '"' : cell(v, i)).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'Contact_requests_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
  }

  return (
    <div data-testid="contact-requests" style={{ background:'#fff', borderRadius:12, padding:'12px 14px', marginBottom:12,
      border:'1px solid #D6DAE8', boxShadow:'var(--shadow)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <b style={{ fontSize:15, color:'#1B2559', flex:1 }}>
          📞 Contact requests {state === 'ok' && <span style={{ color:'#16A34A' }}>({shown.length})</span>}
        </b>
        {state === 'ok' && shown.length > 0 && (
          <>
            <button onClick={() => setOpen(o => !o)} style={{ background:'#EEF0F6', color:'#1B2559', border:'none', borderRadius:8,
              padding:'7px 12px', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>{open ? 'Hide ▲' : 'Show ▼'}</button>
            <button onClick={exportCSV} style={{ background:'#16A34A', color:'#fff', border:'none', borderRadius:8,
              padding:'7px 12px', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>⬇️ CSV</button>
          </>
        )}
        <button onClick={load} title="Refresh" style={{ background:'none', border:'1px solid #E5E7EB', borderRadius:8,
          padding:'6px 9px', fontSize:12, cursor:'pointer' }}>🔄</button>
      </div>
      {state === 'loading' && <div style={{ fontSize:12.5, color:'#888', marginTop:6 }}>Loading…</div>}
      {state === 'missing' && <div style={{ fontSize:12.5, color:'#B45309', marginTop:6 }}>
        The database update for Contact us has not been run yet (db/2026-10-29_contact_requests.sql). Details wait on the tablets until it is.</div>}
      {state === 'error' && <div style={{ fontSize:12.5, color:'#B91C1C', marginTop:6 }}>Could not load the contact requests. Tap 🔄.</div>}
      {state === 'ok' && !shown.length && <div style={{ fontSize:12.5, color:'#888', marginTop:6 }}>None yet. Guests leave their details on the tablet's "📞 Contact us" page.</div>}
      {state === 'ok' && open && shown.length > 0 && (
        <div style={{ marginTop:10, maxHeight:320, overflowY:'auto', borderTop:'1px solid #F1F5F9' }}>
          {shown.map(r => (
            <div key={r.id} style={{ display:'flex', gap:10, alignItems:'baseline', padding:'7px 2px', borderBottom:'1px solid #F1F5F9', fontSize:13 }}>
              <b style={{ minWidth:130, fontVariantNumeric:'tabular-nums', color:'#1B2559' }}>{r.phone ? showPhone(r.phone) : <span style={{ color:'#aaa' }}>—</span>}</b>
              <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {r.name || <span style={{ color:'#aaa' }}>—</span>}
                {r.email && <span style={{ color:'#2563EB' }}> · {r.email}</span>}
                {!eventId && evName(r.event_id) && <span style={{ color:'#888' }}> · {evName(r.event_id)}</span>}
              </span>
              <span style={{ color:'#64748B', whiteSpace:'nowrap' }}>{r.table_number != null ? 'T' + r.table_number + ' · ' : ''}{when(r.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
