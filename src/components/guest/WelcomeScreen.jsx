import { useEffect, useRef, useState } from 'react'
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

        {/* DUAL LOGO ROW — Janu + Catering side by side, equal size */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'center', gap:24, marginBottom:18 }}>
          {/* Janu's Smart Serve */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
            <div style={{ width:90, height:90, borderRadius:20, background:'linear-gradient(135deg,#E8890C,#c97010)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 8px 24px rgba(232,137,12,0.5)', border:'2px solid rgba(255,255,255,0.2)' }}>
              <span style={{ fontSize:46 }}>🍽️</span>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:15, fontWeight:900, color:'#E8890C', letterSpacing:'0.5px' }}>JANU'S</div>
              <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)', letterSpacing:'0.3px' }}>SMART SERVE</div>
            </div>
          </div>

          {/* × divider — only when catering logo exists */}
          {eventData?.catering_logo_url && (
            <div style={{ fontSize:24, color:'rgba(255,255,255,0.25)', marginTop:32 }}>×</div>
          )}

          {/* Catering company */}
          {eventData?.catering_logo_url && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
              <img src={eventData.catering_logo_url} alt={eventData.catering_company||''}
                style={{ width:90, height:90, objectFit:'contain', borderRadius:20, background:'rgba(255,255,255,0.1)', padding:8, boxShadow:'0 8px 24px rgba(0,0,0,0.4)', border:'2px solid rgba(255,255,255,0.2)' }}
                onError={e=>e.target.parentElement.style.display='none'} />
              {eventData.catering_company && (
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:15, fontWeight:900, color:'#fff', letterSpacing:'0.3px' }}>{eventData.catering_company.toUpperCase().split(' ')[0]}</div>
                  {eventData.catering_company.split(' ').length > 1 && (
                    <div style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,0.6)' }}>{eventData.catering_company.toUpperCase().split(' ').slice(1).join(' ')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

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

        {/* Powered by — bigger and clearer */}
        {eventData?.catering_company && (
          <div style={{ fontSize:17, fontWeight:700, color:'rgba(255,255,255,0.85)', marginBottom:12, letterSpacing:'0.3px' }}>
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
