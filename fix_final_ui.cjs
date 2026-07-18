const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: WelcomeScreen — remove duplicate branding, add logo ═══
fs.writeFileSync(BASE + '/components/guest/WelcomeScreen.jsx', `import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function WelcomeScreen({ tableNumber, onStart, eventData, onEventSelect }) {
  const videoRef = useRef(null)
  const [events, setEvents] = useState([])
  const [showEventPicker, setShowEventPicker] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)

  useEffect(() => {
    if (videoRef.current && eventData?.video_url) {
      videoRef.current.load()
      videoRef.current.play().catch(()=>{})
    }
  }, [eventData?.video_url])

  async function openEventPicker() {
    setShowEventPicker(true); setLoadingEvents(true)
    const { data } = await supabase.from('events').select('id,name,date,venue').order('date',{ascending:false}).limit(20)
    setEvents(data||[]); setLoadingEvents(false)
  }

  return (
    <div style={{ minHeight:'100vh', position:'relative', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'40px 24px', overflow:'hidden' }}>
      {eventData?.video_url
        ? <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:0 }} />
        : <div style={{ position:'absolute',inset:0,background:'linear-gradient(160deg,#1a0a0a 0%,#2d1010 50%,#1a0a0a 100%)',zIndex:0 }} />
      }
      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.62)',zIndex:1 }} />

      <div style={{ position:'relative',zIndex:2,width:'100%',maxWidth:440 }}>

        {/* Catering Logo */}
        {eventData?.catering_logo_url && (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
            style={{ width:110,height:110,objectFit:'contain',borderRadius:20,marginBottom:14,background:'rgba(255,255,255,0.12)',padding:10,boxShadow:'0 8px 32px rgba(0,0,0,0.4)',border:'2px solid rgba(255,255,255,0.25)',display:'block',margin:'0 auto 14px' }}
            onError={e=>e.target.style.display='none'} />
        )}
        {!eventData?.catering_logo_url && (
          <div style={{ fontSize:64,marginBottom:14 }}>🍽️</div>
        )}

        {/* Catering Name — LARGEST, most important */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:44,fontWeight:900,color:'#fff',marginBottom:6,letterSpacing:'0.5px',lineHeight:1.1,textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        ) : (
          <div style={{ fontSize:40,fontWeight:900,color:'#fff',marginBottom:6 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
          </div>
        )}

        {/* Janu's Smart Serve — ONE LINE only, clearly readable */}
        {eventData?.catering_company && (
          <div style={{ fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.7)',marginBottom:12,letterSpacing:'0.3px' }}>
            Powered by <span style={{ color:'#E8890C',fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}

        {/* Event name */}
        {eventData?.name && (
          <div style={{ fontSize:18,fontWeight:700,color:'#FFE0A0',marginBottom:4,textShadow:'0 2px 8px rgba(0,0,0,0.6)' }}>{eventData.name}</div>
        )}
        {eventData?.venue && (
          <div style={{ fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.75)',marginBottom:4 }}>📍 {eventData.venue}</div>
        )}
        {!eventData && <div style={{ fontSize:14,color:'rgba(255,255,255,0.5)',marginBottom:4 }}>No event selected</div>}

        {/* Table badge */}
        <div style={{ display:'inline-flex',alignItems:'center',gap:8,background:'rgba(255,255,255,0.15)',border:'1.5px solid rgba(255,255,255,0.3)',borderRadius:999,padding:'10px 28px',margin:'18px auto 24px',fontSize:17,fontWeight:800,color:'#fff' }}>
          <span style={{ width:10,height:10,borderRadius:'50%',background:'#4ADE80',display:'inline-block',boxShadow:'0 0 8px #4ADE80' }}></span>
          TABLE {tableNumber}
        </div>

        <p style={{ fontSize:14,color:'rgba(255,255,255,0.65)',marginBottom:28,maxWidth:280,lineHeight:1.7,margin:'0 auto 28px' }}>
          Browse our menu and place your order directly from this tablet
        </p>

        {eventData ? (
          <button onClick={onStart} style={{ background:'#E8890C',color:'#fff',border:'none',borderRadius:16,padding:'20px 56px',fontSize:20,fontWeight:800,boxShadow:'0 10px 30px rgba(232,137,12,0.5)',display:'block',margin:'0 auto',cursor:'pointer' }}>
            Start Ordering →
          </button>
        ) : (
          <button onClick={openEventPicker} style={{ background:'#E8890C',color:'#fff',border:'none',borderRadius:16,padding:'18px 48px',fontSize:18,fontWeight:800,display:'block',margin:'0 auto',cursor:'pointer' }}>
            Select Event
          </button>
        )}

        {eventData && (
          <button onClick={openEventPicker} style={{ marginTop:18,background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:999,padding:'8px 22px',fontSize:13,fontWeight:600,color:'rgba(255,255,255,0.7)',cursor:'pointer' }}>
            🔄 Change Event
          </button>
        )}
      </div>

      {showEventPicker && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:100,display:'flex',alignItems:'flex-end' }} onClick={()=>setShowEventPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%',background:'#1a1a2e',borderRadius:'24px 24px 0 0',padding:'24px 20px 48px',maxHeight:'80vh',overflowY:'auto' }}>
            <div style={{ width:40,height:4,background:'rgba(255,255,255,0.2)',borderRadius:999,margin:'0 auto 20px' }}></div>
            <h3 style={{ color:'#fff',fontSize:20,fontWeight:800,marginBottom:4,textAlign:'center' }}>Select Event</h3>
            <p style={{ color:'rgba(255,255,255,0.5)',fontSize:13,textAlign:'center',marginBottom:20 }}>Choose the event for this tablet</p>
            {loadingEvents ? <div style={{ textAlign:'center',padding:40,color:'rgba(255,255,255,0.5)' }}>Loading...</div>
            : events.map(ev => (
              <button key={ev.id} onClick={()=>{ onEventSelect(ev); setShowEventPicker(false) }} style={{ width:'100%',background:eventData?.id===ev.id?'#E8890C':'rgba(255,255,255,0.08)',border:eventData?.id===ev.id?'none':'1px solid rgba(255,255,255,0.15)',borderRadius:14,padding:'16px 18px',marginBottom:10,textAlign:'left',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                <div>
                  <div style={{ color:'#fff',fontWeight:700,fontSize:15 }}>{ev.name}</div>
                  <div style={{ color:'rgba(255,255,255,0.5)',fontSize:12,marginTop:3 }}>📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}{ev.venue&&<span> · 📍 {ev.venue}</span>}</div>
                </div>
                {eventData?.id===ev.id && <span style={{ color:'#fff',fontSize:18 }}>✓</span>}
              </button>
            ))}
            <button onClick={()=>setShowEventPicker(false)} style={{ width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:14,padding:'14px',color:'rgba(255,255,255,0.5)',fontSize:14,cursor:'pointer',marginTop:8 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
`)
console.log('✅ 1/3 WelcomeScreen — single "Powered by" line, no duplicate')

// ═══ FIX 2: MenuScreen — MENU button bottom-right, bold dark category headers ═══
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

// Move MENU button to bottom-right
msContent = msContent.replace(
  `      {/* FLOATING MENU BUTTON — Swiggy style */}
      {search.length === 0 && categories.length > 0 && (
        <MenuModal categories={categories} items={items} onSelect={scrollToCategory} />
      )}`,
  `      {/* FLOATING MENU BUTTON — bottom right */}
      {search.length === 0 && categories.length > 0 && (
        <MenuModal categories={categories} items={items} onSelect={scrollToCategory} cartCount={cartCount} />
      )}`
)

// Fix MenuModal — bottom right position
msContent = msContent.replace(
  `function MenuModal({ categories, items, onSelect }) {`,
  `function MenuModal({ categories, items, onSelect, cartCount }) {`
).replace(
  `      {/* Floating MENU pill button */}
      <button onClick={()=>setOpen(true)} style={{
        position:'fixed', bottom:90, left:'50%', transform:'translateX(-50%)',
        background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
        padding:'12px 28px', fontSize:15, fontWeight:800, cursor:'pointer',
        boxShadow:'0 6px 20px rgba(0,0,0,0.4)', zIndex:60,
        display:'flex', alignItems:'center', gap:8, letterSpacing:'0.5px'
      }}>`,
  `      {/* Floating MENU button — bottom RIGHT corner */}
      <button onClick={()=>setOpen(true)} style={{
        position:'fixed', bottom: cartCount>0 ? 110 : 28, right:16,
        background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
        padding:'12px 22px', fontSize:14, fontWeight:800, cursor:'pointer',
        boxShadow:'0 6px 20px rgba(0,0,0,0.4)', zIndex:60,
        display:'flex', alignItems:'center', gap:8, letterSpacing:'0.5px'
      }}>`
)

// Fix category section headers — dark background, bold, clearly visible
msContent = msContent.replace(
  `                {/* Sticky category header */}
                <div style={{ position:'sticky', top:0, zIndex:10, background:'#EEEEF0', padding:'8px 16px', borderBottom:'1px solid #E0E0E0', borderTop:'1px solid #E0E0E0' }}>
                  <span style={{ fontWeight:800, fontSize:14, color:'#1A1A1A' }}>{cat.name}</span>
                  <span style={{ fontSize:12, color:'#888', marginLeft:8 }}>{catItems.length} item{catItems.length!==1?'s':''}</span>
                </div>`,
  `                {/* Sticky category header — dark, bold, unmissable */}
                <div style={{ position:'sticky', top:0, zIndex:10, background:'#1A0A0A', padding:'10px 16px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontWeight:900, fontSize:15, color:'#E8890C', letterSpacing:'0.5px', textTransform:'uppercase' }}>{cat.name}</span>
                  <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)', background:'rgba(255,255,255,0.1)', padding:'2px 8px', borderRadius:999, fontWeight:600 }}>{catItems.length} item{catItems.length!==1?'s':''}</span>
                </div>`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 2/3 MenuScreen — MENU button bottom-right, dark orange category headers')

// ═══ FIX 3: KOTDashboard — timer in header row, table/waiter click filter ═══
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

// Add table filter state
kotContent = kotContent.replace(
  `  const [waiterFilter, setWaiterFilter] = useState(null) // waiter id to filter by`,
  `  const [waiterFilter, setWaiterFilter] = useState(null)
  const [tableFilter, setTableFilter] = useState(null) // table number to filter`
)

// Apply table filter
kotContent = kotContent.replace(
  `  const filtered = orders.filter(o => {
    const matchFilter = filter==='active' ? !['delivered','cancelled'].includes(o.status) : filter==='delivered' ? o.status==='delivered' : true
    const matchWaiter = !waiterFilter || o.waiter_id===waiterFilter
    return matchFilter && matchWaiter
  })`,
  `  const filtered = orders.filter(o => {
    const matchFilter = filter==='active' ? !['delivered','cancelled'].includes(o.status) : filter==='delivered' ? o.status==='delivered' : true
    const matchWaiter = !waiterFilter || o.waiter_id===waiterFilter
    const matchTable = !tableFilter || o.tables?.table_number===tableFilter
    return matchFilter && matchWaiter && matchTable
  })`
)

// Move timer INTO the header row + make table number clickable
kotContent = kotContent.replace(
  `          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div>
              <div style={{ fontSize:22, fontWeight:800 }}>Table {order.tables?.table_number}</div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:2 }}>
                {new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}
              </div>
              {order.waiters?.name && <div style={{ fontSize:12, color:'#2563EB', marginTop:2, fontWeight:600 }}>👤 {order.waiters.name}</div>}
              {order.status==='in_progress' && order.assigned_at && (() => {
                const t = formatTimer(order.assigned_at)
                if (!t) return null
                const bg = t.mins>=15?'#FEF2F2':t.mins>=10?'#FEF3C7':'#F0FDF4'
                const col = t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A'
                const bord = t.mins>=15?'#FECACA':t.mins>=10?'#FCD34D':'#BBF7D0'
                return (
                  <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:bg, border:'2px solid '+bord, borderRadius:12, padding:'8px 16px', marginTop:8 }}>
                    <span style={{ fontSize:20 }}>⏱</span>
                    <span style={{ fontSize:26, fontWeight:900, color:col, fontVariantNumeric:'tabular-nums', letterSpacing:'0.5px' }}>{t.str}</span>
                    {t.mins>=15 && <span style={{ fontSize:12, background:'#DC2626', color:'#fff', padding:'2px 8px', borderRadius:999, fontWeight:700 }}>⚠️ Slow</span>}
                    {t.mins>=10 && t.mins<15 && <span style={{ fontSize:12, color:'#D97706', fontWeight:700 }}>Check</span>}
                  </div>
                )
              })()}
            </div>`,
  `          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
            <div style={{ flex:1 }}>
              {/* Top row: Table + Timer side by side */}
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                {/* Clickable table number */}
                <button onClick={()=>setTableFilter(tableFilter===order.tables?.table_number?null:order.tables?.table_number)}
                  style={{ fontSize:22, fontWeight:900, background: tableFilter===order.tables?.table_number?'#1A0A0A':'transparent', color:tableFilter===order.tables?.table_number?'#E8890C':'#1A1A1A', border:'none', padding:tableFilter===order.tables?.table_number?'2px 10px':'0', borderRadius:8, cursor:'pointer', lineHeight:1 }}>
                  Table {order.tables?.table_number}
                </button>
                {/* Timer inline */}
                {order.status==='in_progress' && order.assigned_at && (() => {
                  const t = formatTimer(order.assigned_at)
                  if (!t) return null
                  const bg = t.mins>=15?'#FEF2F2':t.mins>=10?'#FEF3C7':'#F0FDF4'
                  const col = t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A'
                  const bord = t.mins>=15?'#FECACA':t.mins>=10?'#FCD34D':'#BBF7D0'
                  return (
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:bg, border:'2px solid '+bord, borderRadius:10, padding:'5px 14px' }}>
                      <span style={{ fontSize:16 }}>⏱</span>
                      <span style={{ fontSize:24, fontWeight:900, color:col, fontVariantNumeric:'tabular-nums' }}>{t.str}</span>
                      {t.mins>=15 && <span style={{ fontSize:11, background:'#DC2626', color:'#fff', padding:'1px 7px', borderRadius:999, fontWeight:700 }}>⚠️ Slow</span>}
                      {t.mins>=10 && t.mins<15 && <span style={{ fontSize:11, color:'#D97706', fontWeight:700 }}>Check</span>}
                    </div>
                  )
                })()}
              </div>
              <div style={{ fontSize:12, color:'var(--ink2)', marginTop:4 }}>
                {new Date(order.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · #{order.id.slice(-6).toUpperCase()}
              </div>
              {/* Clickable waiter name */}
              {order.waiters?.name && (
                <button onClick={()=>setWaiterFilter(waiterFilter===order.waiter_id?null:order.waiter_id)}
                  style={{ fontSize:14, fontWeight:800, color: waiterFilter===order.waiter_id?'#fff':'#2563EB', background: waiterFilter===order.waiter_id?'#2563EB':'#EFF6FF', border:'none', borderRadius:8, padding:'3px 12px', marginTop:4, cursor:'pointer' }}>
                  👤 {order.waiters.name} {waiterFilter===order.waiter_id?'✕':''}
                </button>
              )}
            </div>`
)

// Add table filter clear indicator
kotContent = kotContent.replace(
  `      {/* Waiter filter active indicator */}
      {waiterFilter && (`,
  `      {/* Table + Waiter filter indicators */}
      {(waiterFilter || tableFilter) && (`
)
kotContent = kotContent.replace(
  `          <span style={{ fontWeight:700, color:'#92400E' }}>🔍 Filtered by: {waiters.find(w=>w.id===waiterFilter)?.name}</span>
          <button onClick={()=>setWaiterFilter(null)} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer', fontSize:13 }}>Clear ✕</button>`,
  `          <span style={{ fontWeight:700, color:'#92400E' }}>
            🔍 {waiterFilter && <>Waiter: {waiters.find(w=>w.id===waiterFilter)?.name}</>}
            {waiterFilter && tableFilter && <span> · </span>}
            {tableFilter && <>Table: {tableFilter}</>}
          </span>
          <button onClick={()=>{ setWaiterFilter(null); setTableFilter(null) }} style={{ background:'none', border:'none', color:'#92400E', fontWeight:700, cursor:'pointer', fontSize:13 }}>Clear All ✕</button>`
)

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 3/3 KOTDashboard — timer in header row, table click filter, waiter click filter')
console.log('\nRun: npm run dev')
