import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SupervisorLogin from '../components/supervisor/SupervisorLogin'
import KOTDashboard from '../components/supervisor/KOTDashboard'
import SOSRequests, { useSOSAlert } from '../components/supervisor/SOSRequests'
import MenuManager from '../components/supervisor/MenuManager'
import ReportsDashboard from '../components/supervisor/ReportsDashboard'
import EventManager from '../components/supervisor/EventManager'

const TYPE_LABELS = { sos:'Call Waiter', call_waiter:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }
const TYPE_EMOJI  = { sos:'🆘', clean_table:'🧹', extra_cutlery:'🍴', water_refill:'💧' }

export default function SupervisorApp() {
  const [authed, setAuthed] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [activeTab, setActiveTab] = useState('kot')
  const [eventData, setEventData] = useState(null)
  const [allEvents, setAllEvents] = useState([])
  const [orderCount, setOrderCount] = useState(0)
  const [sosCount, setSosCount] = useState(0)
  const [showEventPicker, setShowEventPicker] = useState(false)

  // SOS alert hook — runs regardless of which tab is active
  const { openRequests, newAlert, clearAlert } = useSOSAlert(eventData)
  const [newOrderAlert, setNewOrderAlert] = useState(null)
  const prevOrderCount = { current: -1 }

  useEffect(() => {
    setSosCount(openRequests.length)
  }, [openRequests])

  // Order alert — poll for new pending orders
  useEffect(() => {
    if (!eventData) return
    async function checkOrders() {
      const { data } = await supabase.from('orders')
        .select('id, created_at, status, tables(table_number)')
        .eq('event_id', eventData.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
      const count = data?.length || 0
      if (prevOrderCount.current >= 0 && count > prevOrderCount.current && data?.[0]) {
        setNewOrderAlert(data[0])
        // alert stays until dismissed manually
      }
      prevOrderCount.current = count
    }
    checkOrders()
    const interval = setInterval(checkOrders, 4000)
    return () => clearInterval(interval)
  }, [eventData])

  useEffect(() => { if (authed) loadEvents() }, [authed])

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending:false })
    const evs = data || []
    setAllEvents(evs)

    if (currentUser?.role === 'supervisor' && currentUser?.assignedEvent) {
      // Supervisor is locked to their assigned event only
      setEventData(currentUser.assignedEvent)
    } else if (!eventData) {
      // Admin: default to first active event
      const active = evs.find(e=>!e.is_closed) || evs[0]
      if (active) setEventData(active)
    }
  }

  if (!authed) return <SupervisorLogin onLogin={(user) => { setCurrentUser(user); setAuthed(true) }} />

  const isAdmin = currentUser?.role === 'admin'

  const TABS = [
    { id:'kot',     label:'Orders',   emoji:'🎫', badge:orderCount },
    { id:'sos',     label:'Requests', emoji:'🆘', badge:sosCount },
    { id:'menu',    label:'Menu',     emoji:'📋', badge:0 },
    { id:'reports', label:'Reports',  emoji:'📊', badge:0 },
    ...(isAdmin ? [{ id:'events', label:'Events', emoji:'📅', badge:0 }] : []),
  ]

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', paddingBottom:80 }}>

      {/* ── FLOATING ORDER ALERT ── */}
      {newOrderAlert && (
        <>
          <style>{`@keyframes orderFlash{0%,100%{opacity:1}50%{opacity:0.85}}.order-alert{animation:orderFlash 0.7s ease-in-out 4}`}</style>
          <div className="order-alert" style={{
            position:'fixed', top:0, left:0, right:0, zIndex:9998,
            background:'#16A34A', padding:'14px 20px',
            display:'flex', alignItems:'center', gap:14, boxShadow:'0 4px 24px rgba(22,163,74,0.6)'
          }}>
            <span style={{ fontSize:32 }}>🎫</span>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>
                🆕 New Order — Table {newOrderAlert.tables?.table_number}
              </div>
              <div style={{ color:'rgba(255,255,255,0.85)', fontSize:13, marginTop:2 }}>
                {new Date(newOrderAlert.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Tap to view
              </div>
            </div>
            <button onClick={() => { setNewOrderAlert(null); setActiveTab('kot') }} style={{ background:'#fff', color:'#16A34A', border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
              View →
            </button>
            <button onClick={() => setNewOrderAlert(null)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:8, padding:'8px 12px', color:'#fff', fontSize:18, cursor:'pointer', lineHeight:1 }}>✕</button>
          </div>
          <div style={{ height:72 }} />
        </>
      )}

      {/* ── FLOATING SOS ALERT — shows on top of everything ── */}
      {newAlert && (
        <>
          <style>{`
            @keyframes sosFlash { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.85;transform:scale(1.02)} }
            .sos-alert { animation: sosFlash 0.6s ease-in-out 5 }
          `}</style>
          <div className="sos-alert" style={{
            position:'fixed', top:0, left:0, right:0, zIndex:9999,
            background:'#DC2626', padding:'16px 20px',
            display:'flex', alignItems:'center', gap:14, boxShadow:'0 4px 24px rgba(220,38,38,0.6)'
          }}>
            <span style={{ fontSize:36 }}>{TYPE_EMOJI[newAlert.request_type]||'🆘'}</span>
            <div style={{ flex:1 }}>
              <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>
                🚨 New Request: {TYPE_LABELS[newAlert.request_type]||newAlert.request_type}
              </div>
              <div style={{ color:'rgba(255,255,255,0.85)', fontSize:13, marginTop:2 }}>
                Table {newAlert.tables?.table_number} · {new Date(newAlert.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
              </div>
            </div>
            <button onClick={() => { clearAlert(); setActiveTab('sos') }} style={{ background:'#fff', color:'#DC2626', border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
              View →
            </button>
            <button onClick={clearAlert} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:8, padding:'8px 12px', color:'#fff', fontSize:18, cursor:'pointer', lineHeight:1 }}>✕</button>
          </div>
          {/* Spacer so content doesn't hide under alert */}
          <div style={{ height:72 }} />
        </>
      )}

      {/* ── HEADER ── */}
      <div style={{ background:'var(--ink)', padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>
            Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
            <span style={{ color:'rgba(255,255,255,0.5)', fontSize:12, fontWeight:500, marginLeft:8 }}>{isAdmin?'Admin':'Supervisor'}</span>
          </div>
          {eventData && (
            isAdmin
              ? <button onClick={() => setShowEventPicker(true)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
                  <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginTop:2 }}>
                    📍 {eventData.name} <span style={{ color:'#E8890C', fontSize:11 }}>▾ change</span>
                  </div>
                </button>
              : <div style={{ color:'rgba(255,255,255,0.6)', fontSize:12, marginTop:2 }}>
                  📍 {eventData.name}
                </div>
          )}
        </div>
        <button onClick={() => setAuthed(false)} style={{ background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', borderRadius:8, padding:'6px 12px', fontSize:12, fontWeight:600 }}>Logout</button>
      </div>

      {/* ── EVENT PICKER MODAL ── */}
      {showEventPicker && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:200, display:'flex', alignItems:'flex-end' }} onClick={() => setShowEventPicker(false)}>
          <div onClick={e=>e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'20px 20px 0 0', padding:'24px 20px 40px', maxHeight:'70vh', overflowY:'auto' }}>
            <div style={{ width:40, height:4, background:'#ddd', borderRadius:999, margin:'0 auto 16px' }}></div>
            <h3 style={{ fontSize:18, fontWeight:800, marginBottom:4 }}>Switch Event</h3>
            <p style={{ fontSize:13, color:'var(--ink2)', marginBottom:16 }}>Select the event you want to manage</p>
            {allEvents.map(ev => (
              <button key={ev.id} onClick={() => { setEventData(ev); setShowEventPicker(false) }} style={{
                width:'100%', background: eventData?.id===ev.id ? 'var(--ink)' : '#f5f5f5',
                color: eventData?.id===ev.id ? '#fff' : '#333',
                border:'none', borderRadius:12, padding:'14px 16px', marginBottom:8,
                textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center'
              }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:15 }}>{ev.name}</div>
                  <div style={{ fontSize:12, opacity:0.7, marginTop:3 }}>
                    📅 {new Date(ev.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}
                    {ev.venue && <span> · 📍 {ev.venue}</span>}
                    <span style={{ marginLeft:8, color:ev.is_closed?'#DC2626':'#16A34A', fontWeight:600 }}>{ev.is_closed?'Closed':'Active'}</span>
                  </div>
                </div>
                {eventData?.id===ev.id && <span style={{ fontSize:20 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CONTENT ── */}
      <div style={{ padding:'16px' }}>
        {activeTab==='kot'     && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} onNewOrder={(order) => { setNewOrderAlert(order); setOrderCount(c=>c+1) }} />}
        {activeTab==='sos'     && <SOSRequests eventData={eventData} onSosCountChange={setSosCount} />}
        {activeTab==='menu'    && <MenuManager eventData={eventData} />}
        {activeTab==='reports' && <ReportsDashboard eventData={eventData} onEventChange={setEventData} />}
        {activeTab==='events'  && <EventManager onEventChange={(ev) => { setEventData(ev); loadEvents() }} />}
      </div>

      {/* ── BOTTOM TABS ── */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'#fff', borderTop:'1px solid var(--line)', display:'flex', zIndex:50 }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ flex:1, padding:'10px 4px', background:'none', border:'none', display:'flex', flexDirection:'column', alignItems:'center', gap:2, cursor:'pointer', borderTop:activeTab===tab.id?'3px solid var(--ink)':'3px solid transparent', position:'relative' }}>
            <span style={{ fontSize:20 }}>{tab.emoji}</span>
            <span style={{ fontSize:10, fontWeight:activeTab===tab.id?800:500, color:activeTab===tab.id?'var(--ink)':'#999' }}>{tab.label}</span>
            {tab.badge>0 && <div style={{ position:'absolute', top:6, right:'18%', background:'#DC2626', color:'#fff', fontSize:9, fontWeight:800, borderRadius:999, minWidth:15, height:15, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' }}>{tab.badge}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
