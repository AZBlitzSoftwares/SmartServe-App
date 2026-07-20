import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function eventStatus(dateStr) {
  if (!dateStr) return 'planned'
  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')
  if (dateStr > todayStr) return 'planned'
  if (dateStr === todayStr) return 'active'
  return 'completed'
}
const S = {
  label: { planned:'Planned', active:'Active', completed:'Completed' },
  color: { planned:'#2563EB', active:'#16A34A', completed:'#6B7280' },
  bg:    { planned:'#EFF6FF', active:'#DCFCE7', completed:'#F3F4F6' },
  emoji: { planned:'🔵', active:'🟢', completed:'⚫' },
}

export default function FeedbackReport() {
  const [allEvents,    setAllEvents]    = useState([])
  const [allFeedback,  setAllFeedback]  = useState([])
  const [displayed,    setDisplayed]    = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selEvent,     setSelEvent]     = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tableFilter,  setTableFilter]  = useState('all')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)

    // Load events
    const { data: evs } = await supabase
      .from('events').select('id,name,date').order('date', { ascending:false })
    setAllEvents(evs || [])

    // Load ALL feedback — no filter at all
    const { data: rows, error } = await supabase
      .from('feedback')
      .select('id,event_id,order_id,table_number,rating,food_rating,service_rating,app_experience_rating,guest_name,guest_email,guest_mobile,comment,created_at')
      .order('created_at', { ascending:false })
      .limit(1000)

    if (error) {
      console.error('Feedback load error:', error)
      setLoading(false)
      return
    }

    console.log('Feedback rows loaded from DB:', rows?.length ?? 0)
    const rowList = rows || []

    // table_number is now stored directly in feedback row
    // For old rows without table_number, try order_id → orders → tables as fallback
    const oldRows = rowList.filter(f => !f.table_number && f.order_id)
    let tableNumMap = {}
    if (oldRows.length > 0) {
      const orderIds = [...new Set(oldRows.map(f => f.order_id).filter(Boolean))]
      const { data: ords } = await supabase
        .from('orders').select('id,tables(table_number)').in('id', orderIds)
      ;(ords||[]).forEach(o => { if (o.id) tableNumMap[o.id] = o.tables?.table_number ?? null })
    }

    const enriched = rowList.map(f => ({
      ...f,
      // Use direct table_number if available, else fall back to order join
      tableNumber: f.table_number ?? (f.order_id ? (tableNumMap[f.order_id] ?? null) : null)
    }))
    setAllFeedback(enriched)
    setDisplayed(enriched)
    setLoading(false)
  }

  useEffect(() => {
    if (!selEvent) {
      setDisplayed(allFeedback)
    } else {
      // Show ONLY selected event's rows
      const matched = allFeedback.filter(r => r.event_id && String(r.event_id) === String(selEvent))
      setDisplayed(matched)
    }
    setTableFilter('all')
  }, [selEvent, allFeedback])

  const visibleEvents = allEvents.filter(ev =>
    statusFilter === 'all' || eventStatus(ev.date) === statusFilter
  )

  const finalRows = tableFilter === 'all'
    ? displayed
    : displayed.filter(f => String(f.order_id) === tableFilter)

  function avg(key) {
    const vals = displayed.filter(f => f[key] > 0).map(f => f[key])
    return vals.length ? (vals.reduce((s,v) => s+v, 0) / vals.length).toFixed(1) : null
  }

  function exportCSV() {
    if (!displayed.length) return
    const H = ['Table No','Name','Mobile','Email','Overall','Food','Service','App','Comment','Date','Time','Event']
    const rows = displayed.map(f => {
      const evName = allEvents.find(e => e.id === f.event_id)?.name || ''
      return [
        f.tableNumber??'', f.guest_name||'Anonymous', f.guest_mobile||'', f.guest_email||'',
        f.rating||'', f.food_rating||'', f.service_rating||'',
        f.app_experience_rating||'',
        (f.comment||'').replace(/,/g,';'),
        new Date(f.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}),
        new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}),
        evName,
      ]
    })
    const csv = [H,...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a')
    const nm = selEvent ? (allEvents.find(e=>e.id===selEvent)?.name||'event') : 'all-events'
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `Feedback_${nm.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  return (
    <div style={{ paddingBottom:40 }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <h2 style={{ fontSize:20, fontWeight:800, margin:0 }}>⭐ Feedback Report</h2>
        {displayed.length > 0 && (
          <button onClick={exportCSV} style={{ background:'#16A34A',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:13,fontWeight:700,cursor:'pointer' }}>
            ⬇️ Export CSV
          </button>
        )}
      </div>

      {/* DB count banner */}
      <div style={{ background:'#FFF8EE',borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:13,color:'#C06A00',fontWeight:600,border:'1px solid #E8890C44' }}>
        📊 Total in database: <strong>{allFeedback.length}</strong> response{allFeedback.length!==1?'s':''}
        {selEvent && allFeedback.length > 0 && (
          <span style={{ marginLeft:8, color:'#666', fontWeight:500 }}>
            · All shown (event rows sorted first)
          </span>
        )}
      </div>

      {/* Status filter pills */}
      <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
        {['all','active','planned','completed'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setSelEvent('') }}
            style={{ padding:'5px 14px', borderRadius:999, fontSize:12, fontWeight:700, cursor:'pointer', border:'1.5px solid',
              borderColor: statusFilter===s ? (s==='all'?'#1A0A0A':S.color[s]) : '#E5E7EB',
              background:  statusFilter===s ? (s==='all'?'#1A0A0A':S.bg[s])    : '#fff',
              color:       statusFilter===s ? (s==='all'?'#fff':S.color[s])    : '#888' }}>
            {s==='all' ? 'All Events' : S.label[s]}
          </button>
        ))}
      </div>

      {/* Event dropdown */}
      <select value={selEvent} onChange={e => { setSelEvent(e.target.value); setTableFilter('all') }}
        style={{ width:'100%',border:'1.5px solid #ddd',borderRadius:10,padding:'10px 14px',fontSize:14,marginBottom:12,background:'#fff',outline:'none' }}>
        <option value="">— All events ({allFeedback.length} responses) —</option>
        {visibleEvents.map(ev => {
          const st = eventStatus(ev.date)
          const cnt = allFeedback.filter(f => f.event_id === ev.id).length
          return (
            <option key={ev.id} value={ev.id}>
              {S.emoji[st]} {ev.name} · {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} [{S.label[st]}] ({cnt} responses)
            </option>
          )
        })}
      </select>

      {loading && <div style={{ textAlign:'center', padding:40, color:'#999' }}>Loading...</div>}

      {/* Summary cards */}
      {!loading && displayed.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:12 }}>
          {[
            { l:'Responses', v:displayed.length,         c:'#E8890C' },
            { l:'Overall',   v:avg('rating'),            c:'#F59E0B' },
            { l:'Food',      v:avg('food_rating'),       c:'#16A34A' },
            { l:'Service',   v:avg('service_rating'),    c:'#2563EB' },
          ].map(({l,v,c}) => (
            <div key={l} style={{ background:'#fff',borderRadius:12,padding:'10px 6px',textAlign:'center',boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize:22, fontWeight:900, color:c }}>{v ?? '—'}</div>
              <div style={{ fontSize:10, color:'#888', fontWeight:600 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && displayed.length === 0 && (
        <div style={{ textAlign:'center', padding:40, color:'#999' }}>
          <div style={{ fontSize:36, marginBottom:8 }}>📋</div>
          <div style={{ fontWeight:600 }}>No feedback found</div>
          <div style={{ fontSize:12, marginTop:6 }}>Total in DB: {allFeedback.length} rows</div>
        </div>
      )}

      {/* Table */}
      {!loading && displayed.length > 0 && (
        <div style={{ background:'#fff', borderRadius:12, overflow:'auto', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:700 }}>
            <thead>
              <tr style={{ background:'#1A0A0A', color:'#fff' }}>
                {['Table','Name','Mobile','Overall','Food','Service','Comment','Date',...(!selEvent?['Event']:[])]
                  .map(h => (
                  <th key={h} style={{ padding:'10px', textAlign:'left', fontWeight:700, fontSize:11, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((f, i) => {
                const evName = allEvents.find(e => e.id === f.event_id)?.name || '—'
                return (
                  <tr key={f.id||i} style={{ borderBottom:'1px solid #F3F4F6', background:i%2===0?'#fff':'#FAFAFA' }}>
                    <td style={{ padding:'9px 10px', fontWeight:800, color:'#2563EB', textAlign:'center' }}>{f.tableNumber ?? '—'}</td>
                    <td style={{ padding:'9px 10px', fontWeight:600 }}>{f.guest_name||'Anon'}</td>
                    <td style={{ padding:'9px 10px', color:'#555' }}>{f.guest_mobile||'—'}</td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>{f.rating ? <span style={{ fontWeight:800, color:'#E8890C' }}>{f.rating}★</span> : '—'}</td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>{f.food_rating||'—'}</td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>{f.service_rating||'—'}</td>
                    <td style={{ padding:'9px 10px', color:'#555', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={f.comment||''}>{f.comment||'—'}</td>
                    <td style={{ padding:'9px 10px', color:'#888', whiteSpace:'nowrap', fontSize:11 }}>
                      {new Date(f.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}<br/>
                      {new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}
                    </td>
                    {!selEvent && <td style={{ padding:'9px 10px', fontSize:11, color:'#7C3AED', fontWeight:600, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{evName}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
