import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import janusLogo from '../../assets/janus_logo.jpg'


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

export default function WelcomeScreen({ tableNumber, onStart, eventData, onEventSelect, activeEventCount=0, onLongPressTable }) {
  const longPressTimer = useRef(null)
  const [longPressProgress, setLongPressProgress] = useState(0)

  function startLongPress() {
    let count = 0
    longPressTimer.current = setInterval(() => {
      count += 100
      setLongPressProgress(Math.min(100, (count / 3000) * 100))
      if (count >= 3000) {
        clearInterval(longPressTimer.current)
        setLongPressProgress(0)
        if (onLongPressTable) onLongPressTable()
      }
    }, 100)
  }

  function endLongPress() {
    if (longPressTimer.current) clearInterval(longPressTimer.current)
    setLongPressProgress(0)
  }
  const videoRef = useRef(null)
  const [events, setEvents] = useState([])
  const [showEventPicker, setShowEventPicker] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [tablePinInput, setTablePinInput] = useState('')
  const [tablePinError, setTablePinError] = useState('')
  const [pinVerified, setPinVerified] = useState(false)
  const [selectedTableNum, setSelectedTableNum] = useState(null)
  const [supervisorPins, setSupervisorPins] = useState([])

  useEffect(() => {
    if (videoRef.current && eventData?.video_url) {
      videoRef.current.load()
      videoRef.current.play().catch(()=>{})
    }
  }, [eventData?.video_url])

  async function openTablePicker() {
    setShowTablePicker(true); setTablePinInput(''); setTablePinError(''); setPinVerified(false); setSelectedTableNum(null)
    // Load supervisor PINs for this event
    if (eventData?.id) {
      const { data } = await supabase.from('supervisors').select('pin').eq('event_id', eventData.id).eq('is_active', true)
      setSupervisorPins((data||[]).map(s=>s.pin))
    }
  }

  function verifyPin() {
    if (supervisorPins.includes(tablePinInput.trim())) {
      setPinVerified(true); setTablePinError('')
    } else {
      setTablePinError('Incorrect PIN. Please ask your supervisor.')
    }
  }

  async function claimTable(tNum) {
    if (!eventData?.id) return
    // Check if table is already active on another device
    const { data: existing } = await supabase.from('tables')
      .select('id, table_number').eq('event_id', eventData.id).eq('table_number', tNum).limit(1)
    if (existing?.length) {
      // Table record exists — check if it has recent activity (order in last 2 hours)
      const { data: recentOrders } = await supabase.from('orders')
        .select('id').eq('table_id', existing[0].id)
        .in('status', ['pending','placed','in_progress'])
        .limit(1)
      if (recentOrders?.length) {
        if (!confirm('Table ' + tNum + ' has an active order. Are you sure you want to switch to this table?')) return
      }
    }
    // Save to localStorage and redirect
    const key = 'ss_event_table_' + tNum
    localStorage.setItem(key, JSON.stringify(eventData))
    localStorage.setItem('ss_last_table', String(tNum))
    // Use replace so back button doesn't come back to old table
    window.location.replace('/tablet/' + tNum)
  }

  async function openEventPicker() {
    setShowEventPicker(true); setLoadingEvents(true)
    const { data } = await supabase.from('events').select('id,name,date,venue').order('date',{ascending:false}).limit(50)
    // Only show active events to guests (today's events only)
    const activeOnly = (data||[]).filter(ev => eventStatus(ev.date) === 'active')
    setEvents(activeOnly.length > 0 ? activeOnly : (data||[]))
    setLoadingEvents(false)
  }

  return (
    <div style={{ height:'100dvh', position:'relative', display:'flex', flexDirection:'column',
      alignItems:'center', textAlign:'center', padding:0, overflow:'hidden',
      background:'linear-gradient(160deg,#1a0a0a 0%,#2d1010 50%,#1a0a0a 100%)' }}>
      {/* Top 70% - the video, undimmed. It was previously a full-bleed
          background under a 62% black overlay, which made it almost
          invisible and wasted the asset entirely. */}
      {eventData?.video_url && (
        <div style={{ width:'100%', flex:1, minHeight:0, position:'relative', overflow:'hidden' }}>
          <video ref={videoRef} src={eventData.video_url} autoPlay loop muted playsInline
            style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
          {/* Fades the video into the panel so the two read as one
              surface instead of two blocks butted together. */}
          <div style={{ position:'absolute', left:0, right:0, bottom:0, height:90,
            background:'linear-gradient(to bottom, rgba(26,10,10,0) 0%, rgba(26,10,10,0.75) 62%, #1a0a0a 100%)',
            pointerEvents:'none' }} />
        </div>
      )}

      <style>{`
        @keyframes ssStartFlash {
          0%, 100% { background:#E8890C; box-shadow:0 6px 22px rgba(232,137,12,0.45); }
          50%      { background:#FFB03A; box-shadow:0 8px 32px rgba(232,137,12,0.85); }
        }
        .ss-start { animation: ssStartFlash 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .ss-start { animation:none; } }
        .ss-welcome-panel {
          display:grid; grid-template-columns:1fr 1fr 1fr; align-items:center;
          gap:10px; width:100%; box-sizing:border-box;
          padding:16px 12px calc(16px + env(safe-area-inset-bottom));
          background:linear-gradient(180deg,#1a0a0a 0%,#2d1010 60%,#1a0a0a 100%);
          container-type:inline-size;
        }
        .ss-col { display:flex; flex-direction:column; align-items:center; text-align:center; min-width:0; }
        .ss-name {
          font-weight:900; color:#fff; line-height:1.18; margin-top:9px;
          font-size:clamp(13px, 2.6cqw, 21px);
          display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
          overflow:hidden; word-break:break-word;
        }
        .ss-role { font-size:clamp(9px, 1.5cqw, 11px); font-weight:700; color:rgba(255,255,255,0.42);
          letter-spacing:0.4px; text-transform:uppercase; margin-top:3px; }
        .ss-logo { width:clamp(36px, 8cqw, 56px); height:clamp(36px, 8cqw, 56px);
          border-radius:12px; object-fit:contain; }
        @media (max-width: 560px) {
          .ss-welcome-panel { grid-template-columns:1fr; gap:12px; }
          .ss-col-side { flex-direction:row; gap:10px; justify-content:center; }
          .ss-col-side .ss-name { margin-top:0; text-align:left; }
          .ss-col-side .ss-role { display:none; }
        }
      `}</style>

      <div className="ss-welcome-panel">

        <div className="ss-col ss-col-side">
          {eventData?.catering_company ? (
            <>
              {eventData.catering_logo_url ? (
                <img className="ss-logo" src={eventData.catering_logo_url}
                  alt={eventData.catering_company}
                  style={{ background:'rgba(255,255,255,0.12)', padding:5,
                    border:'2px solid rgba(255,255,255,0.22)' }}
                  onError={e=>e.target.style.opacity='0'} />
              ) : (
                <div className="ss-logo" style={{ background:'rgba(255,255,255,0.1)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🏷️</div>
              )}
              <div className="ss-name">{eventData.catering_company}</div>
              <div className="ss-role">Catering partner</div>
            </>
          ) : (
            <>
              <img className="ss-logo" src={janusLogo} alt="Janu's Smart Serve"
                style={{ background:'linear-gradient(135deg,#E8890C,#c97010)', padding:4,
                  border:'2px solid rgba(255,255,255,0.2)' }} />
              <div className="ss-name">Janu's Smart Serve</div>
            </>
          )}
        </div>

        <div className="ss-col">
          <div
            onMouseDown={startLongPress} onMouseUp={endLongPress} onMouseLeave={endLongPress}
            onTouchStart={startLongPress} onTouchEnd={endLongPress}
            style={{ display:'inline-flex', alignItems:'center', gap:7,
              background:'rgba(255,255,255,0.15)', border:'1.5px solid rgba(255,255,255,0.3)',
              borderRadius:999, padding:'6px 18px', fontSize:'clamp(11px, 1.4vw + 4px, 15px)',
              fontWeight:800, color:'#fff', cursor:'pointer', position:'relative',
              overflow:'hidden', userSelect:'none', whiteSpace:'nowrap' }}>
            {longPressProgress > 0 && (
              <div style={{ position:'absolute', left:0, top:0, height:'100%',
                background:'rgba(232,137,12,0.4)', width:longPressProgress+'%',
                transition:'width 0.1s linear', borderRadius:999 }} />
            )}
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#4ADE80',
              display:'inline-block', boxShadow:'0 0 8px #4ADE80', position:'relative', zIndex:1 }}></span>
            <span style={{ position:'relative', zIndex:1 }}>TABLE {tableNumber}</span>
          </div>

          {eventData?.name && (
            <div style={{ fontSize:'clamp(13px, 1.7vw + 5px, 19px)', fontWeight:800,
              color:'#FFE0A0', marginTop:9, lineHeight:1.2 }}>{eventData.name}</div>
          )}
          {eventData?.venue && (
            <div style={{ fontSize:'clamp(11px, 1.1vw + 4px, 14px)', fontWeight:600,
              color:'rgba(255,255,255,0.7)', marginTop:1 }}>📍 {eventData.venue}</div>
          )}
          {!eventData && (
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.5)', marginTop:6 }}>No event selected</div>
          )}

          {eventData ? (
            <button onClick={onStart} className="ss-start"
              style={{ marginTop:14, color:'#fff', border:'none', borderRadius:14,
                padding:'clamp(12px, 1.6vw + 6px, 20px) clamp(22px, 3vw + 10px, 46px)',
                fontSize:'clamp(14px, 1.6vw + 6px, 21px)', fontWeight:900,
                cursor:'pointer', whiteSpace:'nowrap' }}>
              Start Ordering →
            </button>
          ) : (
            <button onClick={openEventPicker}
              style={{ marginTop:12, background:'#E8890C', color:'#fff', border:'none',
                borderRadius:14, padding:'14px 32px', fontSize:16, fontWeight:900,
                cursor:'pointer', whiteSpace:'nowrap' }}>
              Select Event
            </button>
          )}
        </div>

        <div className="ss-col ss-col-side">
          {eventData?.catering_company ? (
            <>
              <img className="ss-logo" src={janusLogo} alt="Janu's Smart Serve"
                style={{ background:'linear-gradient(135deg,#E8890C,#c97010)', padding:4,
                  border:'2px solid rgba(255,255,255,0.2)' }} />
              <div className="ss-name">Janu's Smart Serve</div>
              <div className="ss-role">Technology partner</div>
            </>
          ) : null}
        </div>
      </div>

      {showTablePicker && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:100,display:'flex',alignItems:'flex-end' }} onClick={()=>setShowTablePicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%',background:'#1a1a2e',borderRadius:'24px 24px 0 0',padding:'24px 20px 48px',maxHeight:'85vh',overflowY:'auto' }}>
            <div style={{ width:40,height:4,background:'rgba(255,255,255,0.2)',borderRadius:999,margin:'0 auto 20px' }}></div>
            <h3 style={{ color:'#fff',fontSize:20,fontWeight:800,marginBottom:4,textAlign:'center' }}>🔢 Change Table</h3>

            {!pinVerified ? (
              <div style={{ maxWidth:320, margin:'0 auto', marginTop:16 }}>
                <p style={{ color:'rgba(255,255,255,0.6)',fontSize:13,textAlign:'center',marginBottom:20 }}>Enter supervisor PIN to change table</p>
                <input
                  value={tablePinInput}
                  onChange={e=>setTablePinInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&verifyPin()}
                  placeholder="Enter PIN"
                  type="password"
                  maxLength={6}
                  style={{ width:'100%',background:'rgba(255,255,255,0.1)',border:'1.5px solid rgba(255,255,255,0.2)',borderRadius:12,padding:'14px 18px',fontSize:18,color:'#fff',textAlign:'center',letterSpacing:8,fontWeight:800,outline:'none',boxSizing:'border-box',marginBottom:10 }} />
                {tablePinError && <div style={{ color:'#FC8181',fontSize:13,textAlign:'center',marginBottom:10 }}>{tablePinError}</div>}
                <button onClick={verifyPin} style={{ width:'100%',background:'#E8890C',color:'#fff',border:'none',borderRadius:12,padding:'14px',fontSize:16,fontWeight:800,cursor:'pointer' }}>
                  Verify PIN →
                </button>
              </div>
            ) : (
              <div style={{ marginTop:16 }}>
                <p style={{ color:'rgba(255,255,255,0.6)',fontSize:13,textAlign:'center',marginBottom:16 }}>
                  Select table for this device · {eventData?.number_of_tables||'?'} tables in this event
                </p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
                  {Array.from({ length: eventData?.number_of_tables||0 }, (_,i)=>i+1).map(tNum => {
                    const currentTable = parseInt(window.location.pathname.split('/').pop())
                    const isCurrent = tNum === currentTable
                    return (
                      <button key={tNum} onClick={()=>claimTable(tNum)}
                        style={{ background: isCurrent?'#E8890C':'rgba(255,255,255,0.08)', border:'1.5px solid', borderColor: isCurrent?'#E8890C':'rgba(255,255,255,0.2)', borderRadius:12, padding:'16px 8px', color:'#fff', fontSize:20, fontWeight:900, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                        {tNum}
                        {isCurrent && <span style={{ fontSize:9, color:'#fff', fontWeight:600, opacity:0.8 }}>CURRENT</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <button onClick={()=>setShowTablePicker(false)}
              style={{ width:'100%',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.15)',borderRadius:14,padding:'14px',color:'rgba(255,255,255,0.5)',fontSize:14,cursor:'pointer',marginTop:20 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
