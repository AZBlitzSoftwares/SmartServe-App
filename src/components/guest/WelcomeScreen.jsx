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
    setShowEventPicker(true)
    setLoadingEvents(true)
    const { data } = await supabase.from('events').select('id, name, date, venue').order('date', { ascending:false }).limit(20)
    setEvents(data||[])
    setLoadingEvents(false)
  }

  async function selectEvent(ev) {
    setShowEventPicker(false)
    if (onEventSelect) onEventSelect(ev)
  }

  return (
    <div style={{ minHeight:'100vh', position:'relative', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center', padding:'40px 24px', overflow:'hidden' }}>

      {/* Background video or gradient */}
      {eventData?.video_url
        ? <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', zIndex:0 }} />
        : <div style={{ position:'absolute', inset:0, background:'linear-gradient(160deg, #2A1B2E 0%, #4A2340 50%, #8E2A5C 100%)', zIndex:0 }} />
      }
      <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1 }} />

      {/* Main content */}
      <div style={{ position:'relative', zIndex:2, color:'#fff', width:'100%', maxWidth:420 }}>

        {/* CATERING LOGO — large, prominent */}
        {eventData?.catering_logo_url ? (
          <img
            src={eventData.catering_logo_url}
            alt={eventData.catering_company||'Catering'}
            style={{ width:120, height:120, objectFit:'contain', borderRadius:20, marginBottom:16,
              background:'rgba(255,255,255,0.12)', padding:10,
              boxShadow:'0 8px 32px rgba(0,0,0,0.3)', border:'2px solid rgba(255,255,255,0.2)' }}
            onError={e=>{ e.target.style.display='none'; e.target.nextSibling.style.display='flex' }} />
        ) : null}
        {/* Fallback plate icon shown only if no logo */}
        <div style={{ fontSize:64, marginBottom:12, display: eventData?.catering_logo_url ? 'none' : 'block' }}>🍽️</div>

        {/* CATERING NAME — biggest text on screen */}
        {eventData?.catering_company ? (
          <div style={{ fontSize:36, fontWeight:900, color:'#fff', marginBottom:6, letterSpacing:'0.5px', lineHeight:1.2, textShadow:'0 2px 12px rgba(0,0,0,0.5)' }}>
            {eventData.catering_company}
          </div>
        ) : null}

        {/* Event name */}
        {eventData?.name && (
          <p style={{ fontSize:15, opacity:0.75, marginBottom:2 }}>{eventData.name}</p>
        )}
        {eventData?.venue && (
          <p style={{ fontSize:13, opacity:0.55, marginBottom:0 }}>📍 {eventData.venue}</p>
        )}
        {!eventData && (
          <p style={{ fontSize:13, opacity:0.6, marginBottom:4 }}>No event selected</p>
        )}

        {/* Table badge */}
        <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)', borderRadius:999, padding:'10px 24px', margin:'20px 0 28px', fontSize:16, fontWeight:700 }}>
          <span style={{ width:8, height:8, borderRadius:'50%', background:'#4ADE80', display:'inline-block', boxShadow:'0 0 8px #4ADE80' }}></span>
          TABLE {tableNumber}
        </div>

        <p style={{ fontSize:14, opacity:0.7, marginBottom:32, maxWidth:260, lineHeight:1.6, margin:'0 auto 32px' }}>
          Browse our menu and place your order directly from this tablet
        </p>

        {/* Start Ordering — only if event is selected */}
        {eventData ? (
          <button onClick={onStart} style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:16, padding:'18px 48px', fontSize:18, fontWeight:800, boxShadow:'0 10px 30px rgba(232,137,12,0.5)', display:'block', margin:'0 auto 20px', cursor:'pointer' }}>
            Start Ordering →
          </button>
        ) : (
          <div style={{ background:'rgba(232,137,12,0.15)', border:'1px solid rgba(232,137,12,0.4)', borderRadius:14, padding:'16px 20px', marginBottom:20 }}>
            <p style={{ fontSize:14, color:'#FFD580', marginBottom:12, fontWeight:600 }}>⚠️ Please select an event to begin</p>
            <button onClick={openEventPicker} style={{ background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'14px 32px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
              Select Event
            </button>
          </div>
        )}

        {/* Change event link — for team use */}
        <button onClick={openEventPicker} style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.6)', borderRadius:999, padding:'8px 20px', fontSize:12, fontWeight:600, cursor:'pointer', marginTop:4 }}>
          {eventData ? '🔄 Change Event' : '📋 Select Event'}
        </button>

        <p style={{ marginTop:24, fontSize:11, opacity:0.3 }}>Technology by Janu's Smart Serve · Table {tableNumber}</p>
      </div>

      {/* Event picker modal */}
      {showEventPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:100, display:'flex', alignItems:'flex-end' }} onClick={() => setShowEventPicker(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', background:'#1a1a2e', borderRadius:'24px 24px 0 0', padding:'24px 20px 48px', maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'rgba(255,255,255,0.2)', borderRadius:999, margin:'0 auto 20px' }}></div>
            <h3 style={{ color:'#fff', fontSize:20, fontWeight:800, marginBottom:6, textAlign:'center' }}>Select Event</h3>
            <p style={{ color:'rgba(255,255,255,0.5)', fontSize:13, textAlign:'center', marginBottom:20 }}>Choose the event this tablet belongs to</p>

            {loadingEvents ? (
              <div style={{ textAlign:'center', padding:40, color:'rgba(255,255,255,0.5)' }}>Loading events...</div>
            ) : events.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'rgba(255,255,255,0.5)' }}>No events found. Create one in the Supervisor app.</div>
            ) : events.map(ev => (
              <button key={ev.id} onClick={() => selectEvent(ev)} style={{
                width:'100%', background: eventData?.id===ev.id ? '#E8890C' : 'rgba(255,255,255,0.08)',
                border: eventData?.id===ev.id ? 'none' : '1px solid rgba(255,255,255,0.15)',
                borderRadius:14, padding:'16px 18px', marginBottom:10,
                textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'
              }}>
                <div>
                  <div style={{ color:'#fff', fontWeight:700, fontSize:15 }}>{ev.name}</div>
                  <div style={{ color:'rgba(255,255,255,0.5)', fontSize:12, marginTop:3 }}>
                    📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                    {ev.venue && <span> · 📍 {ev.venue}</span>}
                  </div>
                </div>
                {eventData?.id===ev.id && <span style={{ color:'#fff', fontSize:18 }}>✓</span>}
              </button>
            ))}

            <button onClick={() => setShowEventPicker(false)} style={{ width:'100%', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:14, padding:'14px', color:'rgba(255,255,255,0.5)', fontSize:14, cursor:'pointer', marginTop:8 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
