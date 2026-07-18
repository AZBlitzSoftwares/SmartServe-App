const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const emPath = BASE + '/components/supervisor/EventManager.jsx'
let content = fs.readFileSync(emPath, 'utf8')

// Add view toggle state after existing state declarations
content = content.replace(
  `  const [editingField, setEditingField] = useState({}) // { eventId_field: value }`,
  `  const [editingField, setEditingField] = useState({})
  const [viewMode, setViewMode] = useState('list') // 'list' | 'detail'
  const [selectedEvent, setSelectedEvent] = useState(null)`
)

// Replace the entire events rendering section (after the Add Waiter form)
// with the new dual-view rendering
content = content.replace(
  `      {/* ═══ EVENT CARDS ═══ */}
      {loading ? <div style={{ textAlign:'center', padding:40, color:'var(--ink2)' }}>Loading...</div>
      : events.map(ev => {`,
  `      {/* ═══ VIEW TOGGLE ═══ */}
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
            const isActive = !ev.is_closed
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
                    <span style={{ flexShrink:0, fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:999, background:isActive?'#DCFCE7':'#F3F4F6', color:isActive?'#16A34A':'#6B7280' }}>{isActive?'Active':'Closed'}</span>
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
      : viewMode==='detail' && events.filter(ev => !selectedEvent || ev.id===selectedEvent).map(ev => {`
)

// Close the map properly — find the last closing of the event cards section
// and add the closing for the new conditional
content = content.replace(
  `        )
      })}
    </div>
  )
}`,
  `        )
      })}
    </div>
  )
}`
)

fs.writeFileSync(emPath, content)
console.log('✅ EventManager — List view + Detail view toggle added')
console.log('List: compact rows with logo, status, badges, click to open detail')
console.log('Detail: full management view, with back button')
console.log('Run: npm run dev')
