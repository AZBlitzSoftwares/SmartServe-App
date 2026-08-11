import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { WaiterList } from './EventManager'

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

export default function TableManager({ eventData }) {
  // Waiters first: the list that changes during an event
  const [view, setView] = useState('waiters')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { load() }, [eventData?.id])

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
        <h2 style={{ fontSize:20, fontWeight:800 }}>Staff &amp; Tables</h2>
        <button onClick={load} style={{ background:'var(--ink)', color:'#fff', border:'none',
          borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700, cursor:'pointer' }}>Refresh</button>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:14 }}>
        {[['waiters','Waiters'],['tables','Tables']].map(([v,label]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ flex:1, padding:'9px 4px', borderRadius:10, fontSize:13, fontWeight:700,
              cursor:'pointer', border:'1.5px solid',
              background: view===v ? 'var(--ink)' : '#fff',
              color: view===v ? '#fff' : 'var(--ink)',
              borderColor: view===v ? 'var(--ink)' : 'var(--line)' }}>{label}</button>
        ))}
      </div>

      {view === 'waiters' && eventData?.id && <WaiterList eventId={eventData.id} />}

      {view === 'tables' && (
      <>

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
        .ss-tgrid { display:grid; gap:6px; grid-template-columns:repeat(3, minmax(0,1fr)); }
        @media (max-width: 900px) { .ss-tgrid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
        @media (max-width: 560px) { .ss-tgrid { grid-template-columns:1fr; } }
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
