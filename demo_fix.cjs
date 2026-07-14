const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══ FIX 1: SOSRequests — floating alert visible on ANY screen ═══
fs.writeFileSync(BASE + '/components/supervisor/SOSRequests.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const TYPE_LABELS = { sos:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }
const TYPE_EMOJI  = { sos:'🆘', clean_table:'🧹', extra_cutlery:'🍴', water_refill:'💧' }
const TYPE_COLOR  = { sos:'#DC2626', clean_table:'#2563EB', extra_cutlery:'#7C3AED', water_refill:'#0891B2' }

// This is exported so SupervisorApp can show the floating alert on ALL screens
export function useSOSAlert(eventData) {
  const [openRequests, setOpenRequests] = useState([])
  const [newAlert, setNewAlert] = useState(null)
  const prevCount = { current: 0 }

  useEffect(() => {
    if (!eventData) return
    fetchRequests()
    const interval = setInterval(fetchRequests, 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function fetchRequests() {
    if (!eventData) return
    const { data } = await supabase.from('sos_requests')
      .select('*, tables(table_number)').eq('event_id', eventData.id)
      .eq('status', 'open').order('created_at', { ascending:false })
    const reqs = data || []
    // New open request arrived
    if (reqs.length > prevCount.current && prevCount.current >= 0) {
      const newest = reqs[0]
      if (newest) setNewAlert(newest)
    }
    prevCount.current = reqs.length
    setOpenRequests(reqs)
  }

  return { openRequests, newAlert, clearAlert: () => setNewAlert(null) }
}

export default function SOSRequests({ eventData, onSosCountChange }) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!eventData) return
    loadRequests(true)
    const interval = setInterval(() => loadRequests(false), 4000)
    return () => clearInterval(interval)
  }, [eventData])

  async function loadRequests(showSpinner=false) {
    if (!eventData) return
    if (showSpinner) setLoading(true)
    const { data } = await supabase.from('sos_requests').select('*, tables(table_number)').eq('event_id', eventData.id).order('created_at', { ascending:false })
    const reqs = data||[]
    setRequests(reqs)
    onSosCountChange(reqs.filter(r=>r.status==='open').length)
    if (showSpinner) setLoading(false)
  }

  async function acknowledge(id) {
    await supabase.from('sos_requests').update({ status:'acknowledged', acknowledged_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }
  async function resolve(id) {
    await supabase.from('sos_requests').update({ status:'resolved', resolved_at:new Date().toISOString() }).eq('id', id)
    loadRequests(false)
  }

  const open = requests.filter(r=>r.status==='open')
  const acknowledged = requests.filter(r=>r.status==='acknowledged')
  const resolved = requests.filter(r=>r.status==='resolved')

  function Card({ req }) {
    return (
      <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:10, boxShadow:'var(--shadow)', borderLeft:'4px solid '+(TYPE_COLOR[req.request_type]||'#999') }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:28 }}>{TYPE_EMOJI[req.request_type]}</span>
            <div>
              <div style={{ fontWeight:800, fontSize:15, color:TYPE_COLOR[req.request_type] }}>{TYPE_LABELS[req.request_type]}</div>
              <div style={{ fontSize:13, color:'var(--ink2)', marginTop:2 }}>Table {req.tables?.table_number} · {new Date(req.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
          </div>
          <div style={{ fontSize:12, fontWeight:700, padding:'3px 10px', borderRadius:999, background:req.status==='open'?'#FEF2F2':req.status==='acknowledged'?'#FEF3C7':'#F0FDF4', color:req.status==='open'?'#DC2626':req.status==='acknowledged'?'#D97706':'#16A34A' }}>
            {req.status==='open'?'Open':req.status==='acknowledged'?'Acknowledged':'Resolved'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {req.status==='open' && <button onClick={()=>acknowledge(req.id)} style={{ flex:1, background:'#FEF3C7', border:'1px solid #FCD34D', color:'#92400E', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Acknowledge</button>}
          {req.status!=='resolved' && <button onClick={()=>resolve(req.id)} style={{ flex:1, background:'#F0FDF4', border:'1px solid #BBF7D0', color:'#16A34A', borderRadius:10, padding:'10px', fontSize:13, fontWeight:700 }}>Mark Resolved</button>}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:800 }}>Service Requests</h2>
        <button onClick={()=>loadRequests(true)} style={{ background:'var(--ink)', color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', fontSize:13, fontWeight:700 }}>Refresh</button>
      </div>
      {loading ? <div style={{ textAlign:'center', padding:60, color:'var(--ink2)' }}>Loading...</div>
      : requests.length === 0 ? (
        <div style={{ textAlign:'center', padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ color:'var(--ink2)', fontWeight:600 }}>No requests yet</div>
        </div>
      ) : (
        <>
          {open.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#DC2626', marginBottom:8, textTransform:'uppercase' }}>🔴 Open ({open.length})</div>{open.map(r=><Card key={r.id} req={r}/>)}</>}
          {acknowledged.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#D97706', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟡 Acknowledged ({acknowledged.length})</div>{acknowledged.map(r=><Card key={r.id} req={r}/>)}</>}
          {resolved.length > 0 && <><div style={{ fontWeight:700, fontSize:13, color:'#16A34A', marginBottom:8, marginTop:16, textTransform:'uppercase' }}>🟢 Resolved ({resolved.length})</div>{resolved.map(r=><Card key={r.id} req={r}/>)}</>}
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 1/3 SOSRequests — useSOSAlert hook exported')

// ═══ FIX 2: SupervisorApp — floating SOS alert on ALL tabs + event selector ═══
fs.writeFileSync(BASE + '/pages/SupervisorApp.jsx', `import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import SupervisorLogin from '../components/supervisor/SupervisorLogin'
import KOTDashboard from '../components/supervisor/KOTDashboard'
import SOSRequests, { useSOSAlert } from '../components/supervisor/SOSRequests'
import MenuManager from '../components/supervisor/MenuManager'
import ReportsDashboard from '../components/supervisor/ReportsDashboard'
import EventManager from '../components/supervisor/EventManager'

const TYPE_LABELS = { sos:'Call Waiter', clean_table:'Clean Table', extra_cutlery:'Extra Cutlery', water_refill:'Water Refill' }
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

  useEffect(() => {
    setSosCount(openRequests.length)
  }, [openRequests])

  useEffect(() => { if (authed) loadEvents() }, [authed])

  async function loadEvents() {
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending:false })
    const evs = data || []
    setAllEvents(evs)
    // Default: first non-closed event, or first event
    if (!eventData) {
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

      {/* ── FLOATING SOS ALERT — shows on top of everything ── */}
      {newAlert && (
        <>
          <style>{\`
            @keyframes sosFlash { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.85;transform:scale(1.02)} }
            .sos-alert { animation: sosFlash 0.6s ease-in-out 5 }
          \`}</style>
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
            <button onClick={() => setShowEventPicker(true)} style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
              <div style={{ color:'rgba(255,255,255,0.7)', fontSize:12, marginTop:2 }}>
                📍 {eventData.name} <span style={{ color:'#E8890C', fontSize:11 }}>▾ change</span>
              </div>
            </button>
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
        {activeTab==='kot'     && <KOTDashboard eventData={eventData} onOrderCountChange={setOrderCount} />}
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
`)
console.log('✅ 2/3 SupervisorApp — floating SOS on all screens + event switcher in header')

// ═══ FIX 3: FeedbackModal — show 5s after delivery for demo, floating bubble ═══
fs.writeFileSync(BASE + '/pages/GuestApp.jsx', `import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import OrderStatus from '../components/guest/OrderStatus'
import SOSPanel from '../components/guest/SOSPanel'
import OrderHistory from '../components/guest/OrderHistory'
import FeedbackModal from '../components/guest/FeedbackModal'

function eventKey(t) { return 'ss_event_table_' + t }
function orderKey(t) { return 'ss_order_' + t + '_' + new Date().toISOString().slice(0,10) }

// CONFIGURABLE: seconds after delivery before feedback appears
// Change to 600 for production (10 minutes), 5 for demo
const FEEDBACK_DELAY_SECONDS = 5

export default function GuestApp() {
  const { tableNumber } = useParams()
  const [screen, setScreen] = useState('welcome')
  const [cart, setCart] = useState([])
  const [currentOrderId, setCurrentOrderId] = useState(() => localStorage.getItem(orderKey(tableNumber))||null)
  const [tableData, setTableData] = useState(null)
  const [eventData, setEventData] = useState(() => { try { return JSON.parse(localStorage.getItem(eventKey(tableNumber))) } catch { return null } })
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showFeedbackBubble, setShowFeedbackBubble] = useState(false)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

  useEffect(() => {
    if (currentOrderId && !currentOrderId.startsWith('offline-')) localStorage.setItem(orderKey(tableNumber), currentOrderId)
  }, [currentOrderId, tableNumber])

  useEffect(() => {
    if (eventData?.id) loadEventAndTable(eventData.id)
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      if (retryRef.current) clearTimeout(retryRef.current)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [tableNumber])

  // Watch for delivered status → show feedback bubble after FEEDBACK_DELAY_SECONDS
  useEffect(() => {
    if (!currentOrderId||currentOrderId.startsWith('offline-')) return
    const sub = supabase.channel('feedback-watch-'+currentOrderId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.'+currentOrderId }, payload => {
        if (payload.new.status==='delivered') {
          feedbackTimerRef.current = setTimeout(() => {
            setShowFeedbackBubble(true)
          }, FEEDBACK_DELAY_SECONDS * 1000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [currentOrderId])

  async function loadEventAndTable(eventId) {
    try {
      const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).single()
      if (ev) { setEventData(ev); localStorage.setItem(eventKey(tableNumber), JSON.stringify(ev)) }
      const tNum = parseInt(tableNumber)
      const { data: tables } = await supabase.from('tables').select('*').eq('event_id', eventId).eq('table_number', tNum).limit(1)
      if (tables?.length) { setTableData(tables[0]) }
      else {
        const { data: newTable } = await supabase.from('tables').insert({ event_id:eventId, table_number:tNum, is_active:true }).select().single()
        if (newTable) setTableData(newTable)
      }
    } catch(e) { retryRef.current = setTimeout(()=>loadEventAndTable(eventId), 2000) }
  }

  async function handleEventSelect(ev) {
    localStorage.setItem(eventKey(tableNumber), JSON.stringify(ev))
    setEventData(ev); setTableData(null); setCurrentOrderId(null)
    await loadEventAndTable(ev.id)
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders').insert({ event_id:order.event_id, table_id:order.table_id, status:'pending' }).select().single()
        if (newOrder) { await supabase.from('order_items').insert(order.items.map(i=>({order_id:newOrder.id,menu_item_id:i.id,quantity:i.quantity}))); await clearOrder(order.id) }
      } catch(e) { console.error(e) }
    }
  }

  function addToCart(item) { setCart(prev => { const e=prev.find(c=>c.id===item.id); if(e) return prev.map(c=>c.id===item.id?{...c,quantity:c.quantity+1}:c); return [...prev,{...item,quantity:1}] }) }
  function removeFromCart(itemId) { setCart(prev => { const e=prev.find(c=>c.id===itemId); if(e?.quantity===1) return prev.filter(c=>c.id!==itemId); return prev.map(c=>c.id===itemId?{...c,quantity:c.quantity-1}:c) }) }
  const cartCount = cart.reduce((s,i)=>s+i.quantity,0)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen==='welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={()=>setScreen('menu')} eventData={eventData} onEventSelect={handleEventSelect} />}
      {screen==='menu' && <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber} cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} cartCount={cartCount} isOnline={isOnline} onShowSOS={()=>setShowSOS(true)} onShowHistory={()=>setShowHistory(true)} onShowStatus={()=>setScreen('status')} currentOrderId={currentOrderId} showFeedbackBubble={showFeedbackBubble} onFeedbackBubbleClick={()=>{ setShowFeedbackBubble(false); setShowFeedback(true) }} onShowFeedback={()=>setShowFeedback(true)} />}
      {screen==='status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={()=>setScreen('menu')} />}
      {cartCount>0 && screen==='menu' && <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline} onOrderPlaced={(id)=>{ setCurrentOrderId(id); setCart([]); setScreen('status') }} onRemove={removeFromCart} onAdd={addToCart} />}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={()=>setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={()=>setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={()=>{ setShowFeedback(false); setScreen('menu') }} />}

      {/* ── FEEDBACK BUBBLE — animated, full attention-grabbing ── */}
      {showFeedbackBubble && !showFeedback && (
        <>
          <style>{\`
            @keyframes fbPulse {
              0%   { transform:scale(1) translateY(0); box-shadow:0 8px 24px rgba(232,137,12,0.5); }
              40%  { transform:scale(1.12) translateY(-16px); box-shadow:0 20px 40px rgba(232,137,12,0.7); }
              70%  { transform:scale(1.06) translateY(-8px); box-shadow:0 14px 32px rgba(232,137,12,0.6); }
              100% { transform:scale(1) translateY(0); box-shadow:0 8px 24px rgba(232,137,12,0.5); }
            }
            @keyframes fbBackdrop { from{opacity:0} to{opacity:1} }
            .fb-backdrop { animation: fbBackdrop 0.5s ease forwards }
            .fb-bubble-anim { animation: fbPulse 1.8s ease-in-out infinite }
          \`}</style>
          {/* Semi-transparent overlay to draw attention */}
          <div className="fb-backdrop" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:90 }} onClick={()=>setShowFeedbackBubble(false)} />
          {/* Big bouncing feedback button */}
          <div style={{ position:'fixed', inset:0, zIndex:91, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <button className="fb-bubble-anim" onClick={()=>{ setShowFeedbackBubble(false); setShowFeedback(true) }}
              style={{ pointerEvents:'all', background:'#E8890C', border:'4px solid #fff', borderRadius:100, padding:'32px 40px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, cursor:'pointer', boxShadow:'0 8px 24px rgba(232,137,12,0.5)' }}>
              <span style={{ fontSize:64 }}>⭐</span>
              <span style={{ color:'#fff', fontWeight:800, fontSize:20, whiteSpace:'nowrap' }}>How was your food?</span>
              <span style={{ color:'rgba(255,255,255,0.85)', fontSize:14 }}>Tap to share your experience</span>
            </button>
            <button onClick={()=>setShowFeedbackBubble(false)} style={{ pointerEvents:'all', marginTop:24, background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.4)', borderRadius:999, padding:'10px 24px', color:'#fff', fontSize:14, cursor:'pointer' }}>
              Maybe later
            </button>
          </div>
        </>
      )}
    </div>
  )
}
`)
console.log('✅ 3/3 GuestApp — feedback bubble shows 5s after delivery (configurable constant)')
console.log('\n🎉 ALL DONE! Run: npm run dev')
