import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'
import igQrCode from '../../assets/ig_qr.jpg'


// ─── Event Status Helper ───────────────────────────────────────────────────
// Compares event date (YYYY-MM-DD) to today in local timezone
function eventStatus(dateStr) {
  if (!dateStr) return 'planned'
  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')
  if (dateStr > todayStr) return 'planned'
  if (dateStr === todayStr) return 'active'
  return 'completed'
}
function statusLabel(s) { return { planned:'Planned', active:'Active', completed:'Completed' }[s]||'Unknown' }
function statusColor(s) { return { planned:'#2563EB', active:'#16A34A', completed:'#6B7280' }[s]||'#999' }
function statusBg(s)    { return { planned:'#EFF6FF', active:'#DCFCE7', completed:'#F3F4F6' }[s]||'#F3F4F6' }
function statusEmoji(s) { return { planned:'🔵', active:'🟢', completed:'⚫' }[s]||'⚪' }
// ──────────────────────────────────────────────────────────────────────────

export default function WelcomeScreen({ tableNumber, onStart, eventData, onEventSelect, activeEventCount=0 }) {
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
    const { data } = await supabase.from('events').select('id,name,date,venue').order('date',{ascending:false}).limit(50)
    // Only show active events to guests (today's events only)
    const activeOnly = (data||[]).filter(ev => eventStatus(ev.date) === 'active')
    setEvents(activeOnly.length > 0 ? activeOnly : (data||[]))
    setLoadingEvents(false)
  }

  return (
    <div style={{ minHeight:'100vh', position:'relative', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'40px 24px 24px', overflow:'hidden' }}>
      {eventData?.video_url
        ? <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline style={{ position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:0 }} />
        : <div style={{ position:'absolute',inset:0,background:'linear-gradient(160deg,#1a0a0a 0%,#2d1010 50%,#1a0a0a 100%)',zIndex:0 }} />
      }
      <div style={{ position:'absolute',inset:0,background:'rgba(0,0,0,0.62)',zIndex:1 }} />

      <div style={{ position:'relative',zIndex:2,width:'100%',maxWidth:500 }}>

        {/* DUAL LOGO ROW — Catering + Janu's side by side, equal size */}
        {eventData?.catering_company ? (
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'center', gap:20, marginBottom:20 }}>

            {/* Catering logo */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              {eventData.catering_logo_url ? (
                <img src={eventData.catering_logo_url} alt={eventData.catering_company}
                  style={{ width:120, height:120, objectFit:'contain', borderRadius:26, background:'rgba(255,255,255,0.12)', padding:10, boxShadow:'0 12px 40px rgba(0,0,0,0.55)', border:'2px solid rgba(255,255,255,0.25)' }}
                  onError={e=>e.target.style.opacity='0'} />
              ) : (
                <div style={{ width:120, height:120, borderRadius:26, background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:48 }}>🏷️</div>
              )}
              <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.55)', letterSpacing:'0.5px', textTransform:'uppercase' }}>Catering Partner</div>
            </div>

            {/* × divider */}
            <div style={{ fontSize:28, color:'rgba(255,255,255,0.2)', marginBottom:36, flexShrink:0 }}>×</div>

            {/* Janu's logo — same size as catering */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
              <div style={{ width:120, height:120, borderRadius:26, background:'linear-gradient(135deg,#E8890C,#c97010)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 12px 40px rgba(232,137,12,0.5)', border:'2px solid rgba(255,255,255,0.2)', overflow:'hidden' }}>
                <img src={janusLogo} alt="Janu's Smart Serve" style={{ width:108, height:108, objectFit:'contain', borderRadius:20 }} />
              </div>
              <div style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.55)', letterSpacing:'0.5px', textTransform:'uppercase' }}>Technology Partner</div>
            </div>
          </div>
        ) : (
          /* No catering — just Janu's logo centred */
          <div style={{ marginBottom:16 }}>
            <div style={{ width:120, height:120, borderRadius:28, background:'linear-gradient(135deg,#E8890C,#c97010)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto', boxShadow:'0 12px 40px rgba(232,137,12,0.4)', border:'2px solid rgba(255,255,255,0.2)' }}>
              <img src={janusLogo} alt="Janu's Smart Serve" style={{ width:106, height:106, objectFit:'contain', borderRadius:22 }} />
            </div>
          </div>
        )}

        {/* Catering Name */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:46, fontWeight:900, color:'#fff', marginBottom:4, letterSpacing:'0.5px', lineHeight:1.1, textShadow:'0 3px 16px rgba(0,0,0,0.7)' }}>
            {eventData.catering_company}
          </div>
        ) : (
          <div style={{ fontSize:44, fontWeight:900, color:'#fff', marginBottom:8 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
          </div>
        )}

        {/* Powered by — text only, no tiny logo (logos are above) */}
        {eventData?.catering_company && (
          <div style={{ fontSize:20, fontWeight:700, color:'rgba(255,255,255,0.75)', marginBottom:12, letterSpacing:'0.2px' }}>
            Powered by <span style={{ color:'#E8890C', fontWeight:900 }}>Janu's Smart Serve</span>
          </div>
        )}

        {/* Event name */}
        {eventData?.name && (
          <div style={{ fontSize:22, fontWeight:800, color:'#FFE0A0', marginBottom:5, textShadow:'0 2px 8px rgba(0,0,0,0.6)' }}>{eventData.name}</div>
        )}
        {eventData?.venue && (
          <div style={{ fontSize:16, fontWeight:600, color:'rgba(255,255,255,0.82)', marginBottom:4 }}>📍 {eventData.venue}</div>
        )}
        {!eventData && <div style={{ fontSize:14,color:'rgba(255,255,255,0.5)',marginBottom:4 }}>No event selected</div>}

        {/* Table badge */}
        <div style={{ display:'inline-flex',alignItems:'center',gap:8,background:'rgba(255,255,255,0.15)',border:'1.5px solid rgba(255,255,255,0.3)',borderRadius:999,padding:'10px 28px',margin:'18px auto 20px',fontSize:17,fontWeight:800,color:'#fff' }}>
          <span style={{ width:10,height:10,borderRadius:'50%',background:'#4ADE80',display:'inline-block',boxShadow:'0 0 8px #4ADE80' }}></span>
          TABLE {tableNumber}
        </div>

        <p style={{ fontSize:14,color:'rgba(255,255,255,0.65)',marginBottom:24,maxWidth:300,lineHeight:1.7,margin:'0 auto 24px' }}>
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

        {eventData && activeEventCount > 1 && (
          <button onClick={openEventPicker} style={{ marginTop:16,background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.25)',borderRadius:999,padding:'8px 22px',fontSize:13,fontWeight:600,color:'rgba(255,255,255,0.7)',cursor:'pointer' }}>
            🔄 Change Event
          </button>
        )}

        {/* Instagram QR footer strip */}
        <div style={{ marginTop:28, display:'flex', alignItems:'center', justifyContent:'center', gap:16,
                      background:'rgba(255,255,255,0.07)', borderRadius:20, padding:'14px 20px',
                      border:'1px solid rgba(255,255,255,0.12)' }}>
          <img src={igQrCode} alt="Follow on Instagram"
            style={{ width:68, height:68, borderRadius:12, objectFit:'cover',
                     border:'2px solid rgba(255,255,255,0.2)', flexShrink:0 }} />
          <div style={{ textAlign:'left' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,0.5)', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:3 }}>Follow us on Instagram</div>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="igG" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#F58529"/>
                    <stop offset="50%" stopColor="#DD2A7B"/>
                    <stop offset="100%" stopColor="#515BD4"/>
                  </linearGradient>
                </defs>
                <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#igG)"/>
                <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" fill="none"/>
                <circle cx="17.5" cy="6.5" r="1" fill="white"/>
              </svg>
              <span style={{ fontSize:17, fontWeight:900, color:'#fff', letterSpacing:'0.3px' }}>@janusmartserve</span>
            </div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.45)' }}>Scan QR to follow &amp; stay updated</div>
          </div>
        </div>

      </div>

      {showEventPicker && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:100,display:'flex',alignItems:'flex-end' }} onClick={()=>setShowEventPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%',background:'#1a1a2e',borderRadius:'24px 24px 0 0',padding:'24px 20px 48px',maxHeight:'80vh',overflowY:'auto' }}>
            <div style={{ width:40,height:4,background:'rgba(255,255,255,0.2)',borderRadius:999,margin:'0 auto 20px' }}></div>
            <h3 style={{ color:'#fff',fontSize:20,fontWeight:800,marginBottom:4,textAlign:'center' }}>🟢 Active Events</h3>
            <p style={{ color:'rgba(255,255,255,0.5)',fontSize:13,textAlign:'center',marginBottom:20 }}>Only today's active events are shown</p>
            {loadingEvents
              ? <div style={{ textAlign:'center',padding:40,color:'rgba(255,255,255,0.5)' }}>Loading...</div>
              : events.length === 0
                ? <div style={{ textAlign:'center',padding:40,color:'rgba(255,255,255,0.5)' }}>
                    <div style={{ fontSize:36,marginBottom:12 }}>📅</div>
                    <div style={{ fontWeight:600,color:'#fff' }}>No active events today</div>
                    <div style={{ fontSize:12,marginTop:6,color:'rgba(255,255,255,0.4)' }}>Please contact Janu's team</div>
                  </div>
                : events.map(ev => (
                    <button key={ev.id} onClick={()=>{ onEventSelect(ev); setShowEventPicker(false) }}
                      style={{ width:'100%',background:eventData?.id===ev.id?'#E8890C':'rgba(255,255,255,0.08)',
                        border:eventData?.id===ev.id?'2px solid #fff':'1px solid rgba(255,255,255,0.15)',
                        borderRadius:14,padding:'16px 18px',marginBottom:10,textAlign:'left',cursor:'pointer',
                        display:'flex',justifyContent:'space-between',alignItems:'center' }}>
                      <div>
                        <div style={{ color:'#fff',fontWeight:800,fontSize:16 }}>{ev.name}</div>
                        <div style={{ color:'rgba(255,255,255,0.6)',fontSize:12,marginTop:4 }}>
                          📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                          {ev.venue&&<span> · 📍 {ev.venue}</span>}
                        </div>
                        <div style={{ marginTop:4 }}>
                          <span style={{ fontSize:11,fontWeight:700,color:'#4ADE80',background:'rgba(74,222,128,0.15)',padding:'2px 8px',borderRadius:999 }}>🟢 Active</span>
                        </div>
                      </div>
                      {eventData?.id===ev.id && <span style={{ color:'#fff',fontSize:22,fontWeight:800 }}>✓</span>}
                    </button>
                  ))
            }
            <button onClick={()=>setShowEventPicker(false)}
              style={{ width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.15)',
                borderRadius:14,padding:'14px',color:'rgba(255,255,255,0.5)',fontSize:14,cursor:'pointer',marginTop:8 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
