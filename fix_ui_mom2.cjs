const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════════════════
// FIX 1: WelcomeScreen — all text clearly visible, proper hierarchy
// ═══════════════════════════════════════════════════════════════════
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
      {/* Background */}
      {eventData?.video_url
        ? <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', zIndex:0 }} />
        : <div style={{ position:'absolute', inset:0, background:'linear-gradient(160deg,#1a0a0a 0%,#2d1010 50%,#1a0a0a 100%)', zIndex:0 }} />
      }
      {/* Dark overlay */}
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.62)', zIndex:1 }} />

      {/* Content */}
      <div style={{ position:'relative', zIndex:2, width:'100%', maxWidth:440 }}>

        {/* Catering Logo */}
        {eventData?.catering_logo_url && (
          <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
            style={{ width:110, height:110, objectFit:'contain', borderRadius:20, marginBottom:16, background:'rgba(255,255,255,0.12)', padding:10, boxShadow:'0 8px 32px rgba(0,0,0,0.4)', border:'2px solid rgba(255,255,255,0.25)', display:'block', margin:'0 auto 16px' }}
            onError={e=>e.target.style.display='none'} />
        )}

        {/* Catering Name — LARGEST */}
        {eventData?.catering_company && (
          <div style={{ fontSize:42, fontWeight:900, color:'#fff', marginBottom:6, letterSpacing:'0.5px', lineHeight:1.1, textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        )}

        {/* Janu's Smart Serve — clearly visible but secondary */}
        {!eventData?.catering_logo_url && !eventData?.catering_company && (
          <div style={{ fontSize:38, fontWeight:900, color:'#fff', marginBottom:6 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
          </div>
        )}
        {eventData?.catering_company && (
          <div style={{ fontSize:15, fontWeight:600, color:'rgba(255,255,255,0.75)', marginBottom:10, letterSpacing:'0.3px' }}>
            Technology by <span style={{ color:'#E8890C', fontWeight:800 }}>Janu's Smart Serve</span>
          </div>
        )}

        {/* Event name — clearly visible */}
        {eventData?.name && (
          <div style={{ fontSize:18, fontWeight:700, color:'#FFE0A0', marginBottom:4, textShadow:'0 2px 8px rgba(0,0,0,0.6)' }}>
            {eventData.name}
          </div>
        )}

        {/* Venue — clearly visible */}
        {eventData?.venue && (
          <div style={{ fontSize:15, fontWeight:600, color:'rgba(255,255,255,0.8)', marginBottom:4, textShadow:'0 2px 8px rgba(0,0,0,0.5)' }}>
            📍 {eventData.venue}
          </div>
        )}

        {!eventData && (
          <div style={{ fontSize:14, color:'rgba(255,255,255,0.5)', marginBottom:4 }}>No event selected</div>
        )}

        {/* Table badge */}
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.15)', border:'1.5px solid rgba(255,255,255,0.3)', borderRadius:999, padding:'10px 28px', margin:'20px auto 28px', fontSize:17, fontWeight:800, color:'#fff' }}>
          <span style={{ width:10, height:10, borderRadius:'50%', background:'#4ADE80', display:'inline-block', boxShadow:'0 0 8px #4ADE80' }}></span>
          TABLE {tableNumber}
        </div>

        <p style={{ fontSize:14, color:'rgba(255,255,255,0.65)', marginBottom:32, maxWidth:280, lineHeight:1.7, margin:'0 auto 32px' }}>
          Browse our menu and place your order directly from this tablet
        </p>

        {eventData ? (
          <button onClick={onStart} style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'20px 56px', fontSize:20, fontWeight:800, boxShadow:'0 10px 30px rgba(232,137,12,0.5)', display:'block', margin:'0 auto', cursor:'pointer' }}>
            Start Ordering →
          </button>
        ) : (
          <button onClick={openEventPicker} style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'18px 48px', fontSize:18, fontWeight:800, display:'block', margin:'0 auto', cursor:'pointer' }}>
            Select Event
          </button>
        )}

        {/* Technology by — clearly readable */}
        {eventData && (
          <button onClick={openEventPicker} style={{ marginTop:20, background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:999, padding:'8px 22px', fontSize:13, fontWeight:600, color:'rgba(255,255,255,0.75)', cursor:'pointer' }}>
            🔄 Change Event
          </button>
        )}

        <p style={{ marginTop:20, fontSize:12, color:'rgba(255,255,255,0.35)', fontWeight:500 }}>
          Powered by Janu's Smart Serve · Table {tableNumber}
        </p>
      </div>

      {/* Event picker modal */}
      {showEventPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.85)', zIndex:100, display:'flex', alignItems:'flex-end' }} onClick={()=>setShowEventPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%', background:'#1a1a2e', borderRadius:'24px 24px 0 0', padding:'24px 20px 48px', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'rgba(255,255,255,0.2)', borderRadius:999, margin:'0 auto 20px' }}></div>
            <h3 style={{ color:'#fff', fontSize:20, fontWeight:800, marginBottom:4, textAlign:'center' }}>Select Event</h3>
            <p style={{ color:'rgba(255,255,255,0.5)', fontSize:13, textAlign:'center', marginBottom:20 }}>Choose the event for this tablet</p>
            {loadingEvents ? <div style={{ textAlign:'center', padding:40, color:'rgba(255,255,255,0.5)' }}>Loading...</div>
            : events.map(ev => (
              <button key={ev.id} onClick={()=>{ onEventSelect(ev); setShowEventPicker(false) }} style={{ width:'100%', background:eventData?.id===ev.id?'#E8890C':'rgba(255,255,255,0.08)', border:eventData?.id===ev.id?'none':'1px solid rgba(255,255,255,0.15)', borderRadius:14, padding:'16px 18px', marginBottom:10, textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:'#fff', fontWeight:700, fontSize:15 }}>{ev.name}</div>
                  <div style={{ color:'rgba(255,255,255,0.5)', fontSize:12, marginTop:3 }}>📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}{ev.venue&&<span> · 📍 {ev.venue}</span>}</div>
                </div>
                {eventData?.id===ev.id && <span style={{ color:'#fff', fontSize:18 }}>✓</span>}
              </button>
            ))}
            <button onClick={()=>setShowEventPicker(false)} style={{ width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:14, padding:'14px', color:'rgba(255,255,255,0.5)', fontSize:14, cursor:'pointer', marginTop:8 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
`)
console.log('✅ 1/4 WelcomeScreen — all text clearly visible, proper size hierarchy')

// ═══════════════════════════════════════════════════════════════════
// FIX 2: MenuScreen — Swiggy-style floating MENU button + header fix
// ═══════════════════════════════════════════════════════════════════
const msPath = BASE + '/components/guest/MenuScreen.jsx'
let msContent = fs.readFileSync(msPath, 'utf8')

// Fix header — make catering name bigger and clearer
msContent = msContent.replace(
  `      {/* HEADER */}
      <div style={{ background:'#1A0A0A', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          {eventData?.catering_logo_url && <img src={eventData.catering_logo_url} alt="" style={{ width:36, height:36, objectFit:'contain', borderRadius:8, background:'rgba(255,255,255,0.1)', padding:3, flexShrink:0 }} onError={e=>e.target.style.display='none'} />}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company
              ? <><div style={{ color:'#fff', fontWeight:800, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{eventData.catering_company}</div>
                  <div style={{ color:'rgba(255,255,255,0.4)', fontSize:10 }}>by Janu's Smart Serve</div></>
              : <div style={{ color:'#fff', fontWeight:800, fontSize:17 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
            }
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>`,
  `      {/* HEADER */}
      <div style={{ background:'#1A0A0A', padding:'11px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          {eventData?.catering_logo_url && (
            <img src={eventData.catering_logo_url} alt=""
              style={{ width:42, height:42, objectFit:'contain', borderRadius:10, background:'rgba(255,255,255,0.1)', padding:4, flexShrink:0, border:'1px solid rgba(255,255,255,0.15)' }}
              onError={e=>e.target.style.display='none'} />
          )}
          <div style={{ minWidth:0 }}>
            {eventData?.catering_company ? (
              <>
                <div style={{ color:'#fff', fontWeight:900, fontSize:18, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>{eventData.catering_company}</div>
                <div style={{ color:'rgba(255,255,255,0.55)', fontSize:11, fontWeight:600, marginTop:1 }}>by Janu's Smart Serve</div>
              </>
            ) : (
              <div style={{ color:'#fff', fontWeight:800, fontSize:18 }}>Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span></div>
            )}
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          {isOnline===false && <span style={{ background:'#DC2626', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 6px', borderRadius:999 }}>OFFLINE</span>}
          <div style={{ background:'rgba(255,255,255,0.15)', color:'#fff', fontSize:12, fontWeight:800, padding:'6px 14px', borderRadius:999 }}>TABLE {tableNumber}</div>
        </div>
      </div>`
)

// Add floating MENU button and category modal
// Insert before the closing return tag
msContent = msContent.replace(
  `      {/* FEEDBACK BUBBLE */}`,
  `      {/* FLOATING MENU BUTTON — Swiggy style */}
      {search.length === 0 && categories.length > 0 && (
        <MenuModal categories={categories} items={items} onSelect={scrollToCategory} />
      )}

      {/* FEEDBACK BUBBLE */}`
)

fs.writeFileSync(msPath, msContent)

// Add MenuModal component to the file
msContent = fs.readFileSync(msPath, 'utf8')
msContent = msContent.replace(
  `export default function MenuScreen(`,
  `function MenuModal({ categories, items, onSelect }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* Floating MENU pill button */}
      <button onClick={()=>setOpen(true)} style={{
        position:'fixed', bottom:90, left:'50%', transform:'translateX(-50%)',
        background:'#1A0A0A', color:'#fff', border:'none', borderRadius:999,
        padding:'12px 28px', fontSize:15, fontWeight:800, cursor:'pointer',
        boxShadow:'0 6px 20px rgba(0,0,0,0.4)', zIndex:60,
        display:'flex', alignItems:'center', gap:8, letterSpacing:'0.5px'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        MENU
      </button>

      {/* Category picker modal */}
      {open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', alignItems:'flex-end' }} onClick={()=>setOpen(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'20px 20px 0 0', padding:'20px 16px 40px', maxHeight:'70vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#ddd', borderRadius:999, margin:'0 auto 16px' }}></div>
            <h3 style={{ fontSize:18, fontWeight:800, marginBottom:16, textAlign:'center' }}>Browse Menu</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {categories.map(cat => {
                const count = items.filter(i=>i.category_id===cat.id).length
                return (
                  <button key={cat.id} onClick={()=>{ onSelect(cat.id); setOpen(false) }}
                    style={{ background:'#F8F8F8', border:'1.5px solid #EBEBEB', borderRadius:14, padding:'16px 12px', textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontWeight:700, fontSize:14, color:'#1A1A1A' }}>{cat.name}</span>
                    <span style={{ fontSize:12, color:'#888', fontWeight:600 }}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function MenuScreen(`
)

fs.writeFileSync(msPath, msContent)
console.log('✅ 2/4 MenuScreen — floating MENU button + header catering name bigger')

// ═══════════════════════════════════════════════════════════════════
// FIX 3: KOTDashboard — bigger timer, better visibility
// ═══════════════════════════════════════════════════════════════════
const kotPath = BASE + '/components/supervisor/KOTDashboard.jsx'
let kotContent = fs.readFileSync(kotPath, 'utf8')

kotContent = kotContent.replace(
  `              {order.status==='in_progress' && order.assigned_at && (() => {
                const t = formatTimer(order.assigned_at)
                return t ? (
                  <div style={{ fontSize:13, fontWeight:800, marginTop:4, color: t.mins>=15?'#DC2626':t.mins>=10?'#D97706':'#16A34A', display:'flex', alignItems:'center', gap:4 }}>
                    <span>⏱</span>
                    <span>{t.str}</span>
                    {t.mins>=15 && <span style={{ fontSize:11, background:'#FEF2F2', color:'#DC2626', padding:'1px 6px', borderRadius:999, marginLeft:4 }}>Taking long</span>}
                  </div>
                ) : null
              })()}`,
  `              {order.status==='in_progress' && order.assigned_at && (() => {
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
              })()}`
)

fs.writeFileSync(kotPath, kotContent)
console.log('✅ 3/4 KOTDashboard — timer bigger (26px bold), coloured background box')

// ═══════════════════════════════════════════════════════════════════
// FIX 4: FeedbackModal — proper rating modules
// ═══════════════════════════════════════════════════════════════════
const fbPath = BASE + '/components/guest/FeedbackModal.jsx'
let fbContent = fs.readFileSync(fbPath, 'utf8')

fbContent = fbContent.replace(
  `{[['Food Quality',food,hf,setFood,setHf],['Service Speed',service,hs,setService,setHs],["Janu's App Experience",appExp,happ,setAppExp,setHapp]].map(([label,val,hov,setVal,setHov]) => (`,
  `{[
              ['🍛 Food Quality', food, hf, setFood, setHf],
              ['⚡ Service Speed', service, hs, setService, setHs],
              ['📱 App Ease of Use', appExp, happ, setAppExp, setHapp],
            ].map(([label,val,hov,setVal,setHov]) => (`
)

fs.writeFileSync(fbPath, fbContent)
console.log('✅ 4/4 FeedbackModal — proper labelled rating modules with icons')
console.log('\n🎉 All fixes done! Run: npm run dev')
