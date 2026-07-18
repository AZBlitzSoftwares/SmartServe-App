import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function FeedbackReport({ eventData: defaultEvent }) {
  const [allEvents, setAllEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(defaultEvent?.id||null)
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(false)
  const [tableFilter, setTableFilter] = useState('all')

  useEffect(() => {
    supabase.from('events').select('id,name,date').order('created_at',{ascending:false})
      .then(({data})=>{ setAllEvents(data||[]); if(!selectedEventId&&data?.length) setSelectedEventId(data[0].id) })
  },[])

  useEffect(() => { if(selectedEventId) loadFeedback() },[selectedEventId])

  async function loadFeedback() {
    setLoading(true)
    try {
      // Simple query — no joins that could fail
      const { data: allFb, error } = await supabase
        .from('feedback')
        .select('*')
        .order('created_at', { ascending:false })
        .limit(200)

      if (error) { console.error('Feedback query error:', error); setFeedback([]); setLoading(false); return }

      // Now enrich with table numbers via separate query
      const orderIds = [...new Set((allFb||[]).map(f=>f.order_id).filter(Boolean))]
      let tableMap = {}
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, table_id, tables(table_number)')
          .in('id', orderIds)
        ;(orders||[]).forEach(o => { if(o.id) tableMap[o.id] = o.tables?.table_number })
      }

      // Attach table number to each feedback
      const enriched = (allFb||[]).map(f => ({
        ...f,
        tableNumber: f.order_id ? tableMap[f.order_id] : null
      }))

      // Filter by selected event
      const forEvent = enriched.filter(f =>
        f.event_id === selectedEventId ||
        (!f.event_id && orderIds.length > 0) // show unlinked ones too
      )

      setFeedback(forEvent.length > 0 ? forEvent : enriched)
    } catch(e) {
      console.error('Feedback load error:', e)
      setFeedback([])
    }
    setLoading(false)
  }

  const tables = [...new Set(feedback.map(f=>f.tableNumber||f.orders?.tables?.table_number).filter(Boolean))].sort((a,b)=>a-b)
  const filtered = tableFilter==='all' ? feedback : feedback.filter(f=>(f.tableNumber||f.orders?.tables?.table_number)===parseInt(tableFilter))

  const avg = (key) => {
    const vals = filtered.filter(f=>f[key]>0).map(f=>f[key])
    return vals.length ? (vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(1) : null
  }

  function Stars({ n }) {
    return <span style={{ color:'#E8890C', fontSize:14 }}>{'⭐'.repeat(Math.round(n||0))}</span>
  }

  function RatingBar({ label, value, total=5 }) {
    if (!value) return null
    const pct = (parseFloat(value)/total)*100
    const col = pct>=80?'#16A34A':pct>=60?'#D97706':'#DC2626'
    return (
      <div style={{ marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4 }}>
          <span style={{ fontWeight:600, color:'var(--ink2)' }}>{label}</span>
          <span style={{ fontWeight:800, color:col }}>{value} / 5</span>
        </div>
        <div style={{ height:8, background:'#F3F4F6', borderRadius:999, overflow:'hidden' }}>
          <div style={{ height:'100%', width:pct+'%', background:col, borderRadius:999, transition:'width 0.6s ease' }}></div>
        </div>
      </div>
    )
  }

  // Table-wise summary
  const tableSummary = tables.map(t => {
    const rows = feedback.filter(f=>(f.tableNumber||f.orders?.tables?.table_number)===t)
    const avgRating = rows.filter(f=>f.rating>0).reduce((s,f)=>s+f.rating,0) / (rows.filter(f=>f.rating>0).length||1)
    return { table:t, count:rows.length, avg:avgRating.toFixed(1) }
  })

  return (
    <div>
      <h2 style={{ fontSize:20, fontWeight:800, marginBottom:16 }}>Feedback Report</h2>

      {/* Event selector */}
      <div style={{ background:'#fff', borderRadius:14, padding:'12px 16px', marginBottom:14, boxShadow:'var(--shadow)' }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--ink2)', marginBottom:6 }}>SELECT EVENT</div>
        <select value={selectedEventId||''} onChange={e=>setSelectedEventId(e.target.value)}
          style={{ width:'100%', border:'1.5px solid var(--line)', borderRadius:10, padding:'10px 14px', fontSize:14, fontFamily:'Manrope', outline:'none', background:'#fff' }}>
          <option value="">Choose event...</option>
          {allEvents.map(ev=><option key={ev.id} value={ev.id}>{ev.name} · {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</option>)}
        </select>
      </div>

      {loading && <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading feedback...</div>}

      {!loading && feedback.length===0 && selectedEventId && (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
          <div style={{ fontWeight:600, color:'var(--ink2)', marginBottom:8 }}>No feedback found for this event</div>
          <div style={{ fontSize:13, color:'var(--ink2)' }}>Submit feedback from the guest tablet to see it here</div>
          <div style={{ fontSize:12, color:'#E8890C', marginTop:8, fontWeight:600 }}>
            Tip: Go to tablet → ⭐ Feedback button → submit → refresh this page
          </div>
        </div>
      )}

      {!loading && feedback.length > 0 && (
        <>
          {/* Summary cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
            <div style={{ background:'#fff', borderRadius:14, padding:'14px 16px', boxShadow:'var(--shadow)', textAlign:'center' }}>
              <div style={{ fontSize:28, fontWeight:900, color:'#E8890C' }}>{feedback.length}</div>
              <div style={{ fontSize:11, color:'var(--ink2)', fontWeight:600, marginTop:2 }}>Total Responses</div>
            </div>
            <div style={{ background:'#fff', borderRadius:14, padding:'14px 16px', boxShadow:'var(--shadow)', textAlign:'center' }}>
              <div style={{ fontSize:28, fontWeight:900, color:'#16A34A' }}>{avg('rating')||'—'}</div>
              <div style={{ fontSize:11, color:'var(--ink2)', fontWeight:600, marginTop:2 }}>Avg Rating ⭐</div>
            </div>
            <div style={{ background:'#fff', borderRadius:14, padding:'14px 16px', boxShadow:'var(--shadow)', textAlign:'center' }}>
              <div style={{ fontSize:28, fontWeight:900, color:'#2563EB' }}>{tables.length}</div>
              <div style={{ fontSize:11, color:'var(--ink2)', fontWeight:600, marginTop:2 }}>Tables Rated</div>
            </div>
          </div>

          {/* Average ratings */}
          <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:14, boxShadow:'var(--shadow)' }}>
            <div style={{ fontWeight:800, fontSize:15, marginBottom:14 }}>Average Ratings</div>
            <RatingBar label="Overall Experience" value={avg('rating')} />
            <RatingBar label="🍛 Food Quality" value={avg('food_rating')} />
            <RatingBar label="⚡ Service Speed" value={avg('service_rating')} />
            <RatingBar label="📱 App Ease of Use" value={avg('app_experience_rating')} />
          </div>

          {/* Table-wise summary */}
          {tableSummary.length > 0 && (
            <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:14, boxShadow:'var(--shadow)' }}>
              <div style={{ fontWeight:800, fontSize:15, marginBottom:12 }}>Table-wise Feedback</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
                <button onClick={()=>setTableFilter('all')} style={{ padding:'6px 14px', borderRadius:999, border:'1.5px solid', borderColor:tableFilter==='all'?'var(--ink)':'var(--line)', background:tableFilter==='all'?'var(--ink)':'#fff', color:tableFilter==='all'?'#fff':'var(--ink)', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  All Tables
                </button>
                {tableSummary.map(t=>(
                  <button key={t.table} onClick={()=>setTableFilter(String(t.table))}
                    style={{ padding:'6px 14px', borderRadius:999, border:'1.5px solid', borderColor:tableFilter===String(t.table)?'var(--ink)':'var(--line)', background:tableFilter===String(t.table)?'var(--ink)':'#fff', color:tableFilter===String(t.table)?'#fff':'var(--ink)', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                    Table {t.table} ({t.count})
                  </button>
                ))}
              </div>
              {tableSummary.map(t=>(
                <div key={t.table} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:'1px solid var(--line)' }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:14 }}>Table {t.table}</span>
                    <span style={{ fontSize:12, color:'var(--ink2)', marginLeft:8 }}>{t.count} response{t.count!==1?'s':''}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <Stars n={parseFloat(t.avg)} />
                    <span style={{ fontWeight:800, fontSize:15, color:'#E8890C' }}>{t.avg}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Individual feedback cards */}
          <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:14, boxShadow:'var(--shadow)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontWeight:800, fontSize:15 }}>All Responses ({filtered.length})</div>
            </div>

            {filtered.length===0 ? <div style={{ color:'var(--ink2)', fontSize:13 }}>No feedback for this table yet</div>
            : filtered.map((f,i) => (
              <div key={f.id||i} style={{ padding:'14px 0', borderBottom:'1px solid var(--line)' }}>
                {/* Row 1: Name + Table + Time + Overall rating */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                  <div>
                    <span style={{ fontWeight:800, fontSize:15 }}>{f.guest_name||'Anonymous'}</span>
                    {(f.tableNumber || f.orders?.tables?.table_number) && (
                      <span style={{ fontSize:12, background:'#EFF6FF', color:'#2563EB', fontWeight:700, padding:'2px 8px', borderRadius:999, marginLeft:8 }}>
                        Table {f.tableNumber || f.orders?.tables?.table_number}
                      </span>
                    )}
                    <div style={{ fontSize:12, color:'var(--ink2)', marginTop:4, display:'flex', gap:12, flexWrap:'wrap' }}>
                      {f.guest_email && <span>✉️ {f.guest_email}</span>}
                      {f.guest_mobile && <span>📞 {f.guest_mobile}</span>}
                      <span>🕐 {new Date(f.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})} · {new Date(f.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ color:'#E8890C', fontWeight:900, fontSize:18 }}>{f.rating}⭐</div>
                    <div style={{ fontSize:11, color:'var(--ink2)', marginTop:2 }}>Overall</div>
                  </div>
                </div>

                {/* Sub-ratings */}
                {(f.food_rating||f.service_rating||f.app_experience_rating) && (
                  <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                    {f.food_rating>0 && <span style={{ fontSize:12, background:'#FEF3C7', color:'#92400E', padding:'3px 10px', borderRadius:999, fontWeight:600 }}>🍛 Food: {f.food_rating}/5</span>}
                    {f.service_rating>0 && <span style={{ fontSize:12, background:'#EFF6FF', color:'#2563EB', padding:'3px 10px', borderRadius:999, fontWeight:600 }}>⚡ Service: {f.service_rating}/5</span>}
                    {f.app_experience_rating>0 && <span style={{ fontSize:12, background:'#F5F3FF', color:'#7C3AED', padding:'3px 10px', borderRadius:999, fontWeight:600 }}>📱 App: {f.app_experience_rating}/5</span>}
                  </div>
                )}

                {/* Comment */}
                {f.comment && (
                  <div style={{ background:'#F9FAFB', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#444', fontStyle:'italic', lineHeight:1.6, borderLeft:'3px solid #E8890C' }}>
                    "{f.comment}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
