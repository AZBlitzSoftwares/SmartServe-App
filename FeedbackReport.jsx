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

function sentimentStyle(s) {
  if (s === 'excellent') return { label:'Excellent', color:'#16A34A', bg:'#DCFCE7' }
  if (s === 'good')      return { label:'Good',      color:'#65A30D', bg:'#ECFCCB' }
  if (s === 'average')   return { label:'Average',   color:'#D97706', bg:'#FEF3C7' }
  return { label:'—', color:'#9CA3AF', bg:'#F3F4F6' }
}

function deriveSentiment(rating) {
  if (!rating) return null
  if (rating >= 5) return 'excellent'
  if (rating >= 3) return 'good'
  return 'average'
}

export default function FeedbackReport() {
  const [allEvents,   setAllEvents]   = useState([])
  const [allRows,     setAllRows]     = useState([])   // raw from DB, never filtered
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(null)
  const [selEvent,    setSelEvent]    = useState('')
  const [statusFilter,setStatusFilter]= useState('all')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true); setLoadError(null)

    const { data: evs } = await supabase
      .from('events').select('id,name,date').order('date', { ascending:false })
    setAllEvents(evs || [])

    const { data: rows, error } = await supabase
      .from('feedback')
      .select('id,event_id,order_id,table_number,rating,food_rating,service_rating,guest_name,guest_mobile,comment,created_at')
      .order('created_at', { ascending:false })
      .limit(2000)

    if (error) {
      console.error('Feedback load error:', error)
      setLoadError(error.message || 'Failed to load feedback')
      setLoading(false)
      return
    }

    console.log('Feedback loaded:', rows?.length, 'rows')
    setAllRows(rows || [])
    setLoading(false)
  }

  // Derive which rows to show — pure computation, no setState chain
  const visibleEvents = allEvents.filter(ev =>
    statusFilter === 'all' || eventStatus(ev.date) === statusFilter
  )

  // Rows filtered by selected event
  const displayedRows = selEvent
    ? allRows.filter(f => f.event_id === selEvent)
    : allRows

  // Count per event for dropdown
  function countForEvent(evId) {
    return allRows.filter(f => f.event_id === evId).length
  }

  function avg(rows, key) {
    const vals = rows.filter(f => f[key] > 0).map(f => f[key])
    return vals.length ? (vals.reduce((s,v) => s+v, 0) / vals.length).toFixed(1) : null
  }

  function exportCSV() {
    if (!displayedRows.length) return
    const sl = (r) => { const s = deriveSentiment(r); return s==='excellent'?'Excellent':s==='good'?'Good':s==='average'?'Average':'—' }
    const H = ['Table No','Name','Mobile','Overall','Food','Service','Comment','Date','Time','Event']
    const rows = displayedRows.map(f => {
      const evName = allEvents.find(e => e.id === f.event_id)?.name || ''
      return [
        f.table_number??'', f.guest_name||'', f.guest_mobile||'',
        sl(f.rating), sl(f.food_rating), sl(f.service_rating),
        (f.comment||'').replace(/,/g,';'),
        new Date(f.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}),
        new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}),
        evName,
      ]
    })
    const csv = [H,...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `Feedback_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  return (
    <div style={{ paddingBottom:40 }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <h2 style={{ fontSize:20, fontWeight:800, margin:0 }}>⭐ Feedback Report</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={loadAll} style={{ background:'var(--ink)',color:'#fff',border:'none',borderRadius:8,padding:'8px 14px',fontSize:13,fontWeight:700,cursor:'pointer' }}>
            🔄 Refresh
          </button>
          {displayedRows.length > 0 && (
            <button onClick={exportCSV} style={{ background:'#16A34A',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',fontSize:13,fontWeight:700,cursor:'pointer' }}>
              ⬇️ CSV
            </button>
          )}
        </div>
      </div>

      {/* DB count banner */}
      <div style={{ background:'#FFF8EE',borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:13,color:'#C06A00',fontWeight:600,border:'1px solid #E8890C44' }}>
        📊 Total in database: <strong>{allRows.length}</strong> response{allRows.length!==1?'s':''}
        {selEvent && <span style={{ marginLeft:8, fontWeight:400, color:'#888' }}>· Showing {displayedRows.length} for selected event</span>}
      </div>

      {/* Error state */}
      {loadError && (
        <div style={{ background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:10,padding:'12px 16px',marginBottom:12,color:'#DC2626',fontSize:13 }}>
          ⚠️ Error loading feedback: {loadError}
          <br/><span style={{ fontSize:11, opacity:.7 }}>Run the Supabase SQL fix: CREATE POLICY feedback_select_all ON feedback FOR SELECT USING (true);</span>
        </div>
      )}

      {/* Status filter */}
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
      <select value={selEvent} onChange={e => setSelEvent(e.target.value)}
        style={{ width:'100%',border:'1.5px solid #ddd',borderRadius:10,padding:'10px 14px',fontSize:14,marginBottom:12,background:'#fff',outline:'none' }}>
        <option value="">— All events ({allRows.length} responses) —</option>
        {visibleEvents.map(ev => {
          const st = eventStatus(ev.date)
          const cnt = countForEvent(ev.id)
          return (
            <option key={ev.id} value={ev.id}>
              {S.emoji[st]} {ev.name} · {new Date(ev.date+' ').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} ({cnt} responses)
            </option>
          )
        })}
      </select>

      {loading && <div style={{ textAlign:'center', padding:40, color:'#999' }}>Loading feedback...</div>}

      {/* Summary cards */}
      {!loading && displayedRows.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:12 }}>
          {[
            { l:'Responses', v:displayedRows.length, c:'#E8890C' },
            { l:'Food avg',  v:avg(displayedRows,'food_rating'),    c:'#16A34A' },
            { l:'Service avg',v:avg(displayedRows,'service_rating'),c:'#2563EB' },
          ].map(({l,v,c}) => (
            <div key={l} style={{ background:'#fff',borderRadius:12,padding:'12px 8px',textAlign:'center',boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize:24, fontWeight:900, color:c }}>{v ?? '—'}</div>
              <div style={{ fontSize:11, color:'#888', fontWeight:600 }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !loadError && displayedRows.length === 0 && (
        <div style={{ textAlign:'center', padding:48, color:'#999' }}>
          <div style={{ fontSize:36, marginBottom:8 }}>📋</div>
          <div style={{ fontWeight:600, marginBottom:4 }}>No feedback found</div>
          <div style={{ fontSize:12 }}>
            {allRows.length > 0
              ? `${allRows.length} responses exist but none match this filter. Try "All Events".`
              : 'No feedback has been submitted yet.'}
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && displayedRows.length > 0 && (
        <div style={{ background:'#fff', borderRadius:12, overflow:'auto', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:600 }}>
            <thead>
              <tr style={{ background:'#1A0A0A', color:'#fff' }}>
                {['Table','Name','Mobile','Overall','Food','Service','Comment','Date',...(!selEvent?['Event']:[])].map(h => (
                  <th key={h} style={{ padding:'10px', textAlign:'left', fontWeight:700, fontSize:11, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((f, i) => {
                const overall = sentimentStyle(deriveSentiment(f.rating))
                const food    = sentimentStyle(deriveSentiment(f.food_rating))
                const service = sentimentStyle(deriveSentiment(f.service_rating))
                const evName  = allEvents.find(e => e.id === f.event_id)?.name || '—'
                return (
                  <tr key={f.id||i} style={{ borderBottom:'1px solid #F3F4F6', background:i%2===0?'#fff':'#FAFAFA' }}>
                    <td style={{ padding:'9px 10px', fontWeight:800, color:'#2563EB', textAlign:'center' }}>
                      {f.table_number ?? '—'}
                    </td>
                    <td style={{ padding:'9px 10px', fontWeight:600 }}>{f.guest_name||'—'}</td>
                    <td style={{ padding:'9px 10px', color:'#555' }}>{f.guest_mobile||'—'}</td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>
                      <span style={{ background:overall.bg, color:overall.color, padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700 }}>
                        {overall.label}
                      </span>
                    </td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>
                      <span style={{ background:food.bg, color:food.color, padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700 }}>
                        {food.label}
                      </span>
                    </td>
                    <td style={{ padding:'9px 10px', textAlign:'center' }}>
                      <span style={{ background:service.bg, color:service.color, padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700 }}>
                        {service.label}
                      </span>
                    </td>
                    <td style={{ padding:'9px 10px', color:'#555', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={f.comment||''}>
                      {f.comment||'—'}
                    </td>
                    <td style={{ padding:'9px 10px', color:'#888', whiteSpace:'nowrap', fontSize:11 }}>
                      {new Date(f.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}<br/>
                      {new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}
                    </td>
                    {!selEvent && (
                      <td style={{ padding:'9px 10px', fontSize:11, color:'#7C3AED', fontWeight:600, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {evName}
                      </td>
                    )}
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
