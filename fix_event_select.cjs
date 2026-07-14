const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

// ═══════════════════════════════════════════════════════
// FIX: WelcomeScreen — event selection for team setup
// When team places tablet on table, they pick the event
// ═══════════════════════════════════════════════════════
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
      <div style={{ position:'relative', zIndex:2, color:'#fff', width:'100%', maxWidth:400 }}>
        <div style={{ fontSize:56, marginBottom:12 }}>🍽️</div>
        <h1 style={{ fontSize:32, fontWeight:800, marginBottom:4, letterSpacing:'-0.02em' }}>
          Janu's <span style={{ color:'#E8890C' }}>Smart Serve</span>
        </h1>

        {/* Event name */}
        {eventData?.name
          ? <p style={{ fontSize:15, opacity:0.85, marginBottom:4 }}>{eventData.name}</p>
          : <p style={{ fontSize:13, opacity:0.6, marginBottom:4 }}>No event selected</p>
        }
        {eventData?.venue && <p style={{ fontSize:13, opacity:0.6, marginBottom:0 }}>📍 {eventData.venue}</p>}

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

        <p style={{ marginTop:24, fontSize:11, opacity:0.35 }}>Powered by Janu's Smart Serve · Table {tableNumber}</p>
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
`)
console.log('✅ 1/2 WelcomeScreen — event picker for team setup')

// ═══════════════════════════════════════════════════════
// FIX: GuestApp — manage selected event in localStorage
// so it persists across refreshes per tablet
// ═══════════════════════════════════════════════════════
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

// Keys scoped to this tablet number
function eventKey(tableNumber) { return 'ss_event_table_' + tableNumber }
function orderKey(tableNumber) { return 'ss_order_' + tableNumber + '_' + new Date().toISOString().slice(0,10) }

export default function GuestApp() {
  const { tableNumber } = useParams()
  const [screen, setScreen] = useState('welcome')
  const [cart, setCart] = useState([])
  const [currentOrderId, setCurrentOrderId] = useState(() => localStorage.getItem(orderKey(tableNumber)) || null)
  const [tableData, setTableData] = useState(null)
  const [eventData, setEventData] = useState(() => {
    // Load previously selected event from localStorage
    try { return JSON.parse(localStorage.getItem(eventKey(tableNumber))) } catch { return null }
  })
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showFeedbackBubble, setShowFeedbackBubble] = useState(false)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

  // Persist order ID
  useEffect(() => {
    if (currentOrderId && !currentOrderId.startsWith('offline-')) {
      localStorage.setItem(orderKey(tableNumber), currentOrderId)
    }
  }, [currentOrderId, tableNumber])

  // Load full event data (with video_url etc) when eventData changes
  useEffect(() => {
    if (eventData?.id) loadEventAndTable(eventData.id)
  }, [eventData?.id])

  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      if (retryRef.current) clearTimeout(retryRef.current)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [tableNumber])

  useEffect(() => {
    if (!currentOrderId || currentOrderId.startsWith('offline-')) return
    const sub = supabase.channel('feedback-watch-' + currentOrderId)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders', filter:'id=eq.'+currentOrderId }, payload => {
        if (payload.new.status === 'delivered') {
          feedbackTimerRef.current = setTimeout(() => setShowFeedbackBubble(true), 90000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [currentOrderId])

  async function loadEventAndTable(eventId) {
    try {
      // Load full event data (including video_url)
      const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).single()
      if (ev) {
        setEventData(ev)
        localStorage.setItem(eventKey(tableNumber), JSON.stringify(ev))
      }

      const tNum = parseInt(tableNumber)
      const { data: tables } = await supabase.from('tables').select('*').eq('event_id', eventId).eq('table_number', tNum).limit(1)
      if (tables?.length) {
        setTableData(tables[0])
      } else {
        const { data: newTable } = await supabase.from('tables').insert({ event_id:eventId, table_number:tNum, is_active:true }).select().single()
        if (newTable) setTableData(newTable)
      }
    } catch(e) {
      console.error('Load error:', e)
      retryRef.current = setTimeout(() => loadEventAndTable(eventId), 2000)
    }
  }

  async function handleEventSelect(ev) {
    // Team selected an event — save it and load full data
    localStorage.setItem(eventKey(tableNumber), JSON.stringify(ev))
    setEventData(ev)
    setTableData(null)
    setCurrentOrderId(null)
    await loadEventAndTable(ev.id)
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders').insert({ event_id:order.event_id, table_id:order.table_id, status:'pending' }).select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(order.items.map(i => ({ order_id:newOrder.id, menu_item_id:i.id, quantity:i.quantity })))
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  function addToCart(item) {
    setCart(prev => {
      const exists = prev.find(c => c.id === item.id)
      if (exists) return prev.map(c => c.id===item.id ? { ...c, quantity:c.quantity+1 } : c)
      return [...prev, { ...item, quantity:1 }]
    })
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const exists = prev.find(c => c.id === itemId)
      if (exists?.quantity===1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id===itemId ? { ...c, quantity:c.quantity-1 } : c)
    })
  }
  const cartCount = cart.reduce((s,i) => s+i.quantity, 0)

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen==='welcome' && (
        <WelcomeScreen
          tableNumber={tableNumber}
          onStart={() => setScreen('menu')}
          eventData={eventData}
          onEventSelect={handleEventSelect}
        />
      )}
      {screen==='menu' && (
        <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setScreen('status')}
          currentOrderId={currentOrderId}
          showFeedbackBubble={showFeedbackBubble}
          onFeedbackBubbleClick={() => { setShowFeedbackBubble(false); setShowFeedback(true) }}
          onShowFeedback={() => setShowFeedback(true)} />
      )}
      {screen==='status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={() => setScreen('menu')} />}
      {cartCount>0 && screen==='menu' && (
        <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline}
          onOrderPlaced={(id) => { setCurrentOrderId(id); setCart([]); setScreen('status') }}
          onRemove={removeFromCart} onAdd={addToCart} />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={() => { setShowFeedback(false); setScreen('menu') }} />}
    </div>
  )
}
`)
console.log('✅ 2/2 GuestApp — event selection persisted per tablet, reloads full event data')
console.log('\n🎉 Done! Run: npm run dev')
