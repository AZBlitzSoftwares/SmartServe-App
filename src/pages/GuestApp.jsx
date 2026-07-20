import { useState, useEffect, useRef } from 'react'
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


function eventStatus(dateStr) {
  if (!dateStr) return 'planned'
  const today = new Date()
  const todayStr = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')
  if (dateStr > todayStr) return 'planned'
  if (dateStr === todayStr) return 'active'
  return 'completed'
}

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
  const [activeEventCount, setActiveEventCount] = useState(0)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

  useEffect(() => {
    if (currentOrderId && !currentOrderId.startsWith('offline-')) localStorage.setItem(orderKey(tableNumber), currentOrderId)
  }, [currentOrderId, tableNumber])

  useEffect(() => {
    if (eventData?.id) {
      loadEventAndTable(eventData.id)
    } else {
      // No stored event — auto-find today's active event
      autoLoadActiveEvent()
    }
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      if (retryRef.current) clearTimeout(retryRef.current)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [tableNumber])

  async function autoLoadActiveEvent() {
    try {
      const { data: evs } = await supabase.from('events').select('*').order('date', { ascending:false }).limit(50)
      const active = (evs||[]).filter(e => eventStatus(e.date) === 'active')
      setActiveEventCount(active.length)
      if (active.length === 1) {
        handleEventSelect(active[0])
      }
    } catch(e) { console.error('Auto event load failed:', e) }
  }

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
      {screen==='welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={()=>setScreen('menu')} eventData={eventData} onEventSelect={handleEventSelect} activeEventCount={activeEventCount} />}
      {screen==='menu' && <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber} cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} cartCount={cartCount} isOnline={isOnline} onShowSOS={()=>setShowSOS(true)} onShowHistory={()=>setShowHistory(true)} onShowStatus={()=>setScreen('status')} currentOrderId={currentOrderId} showFeedbackBubble={showFeedbackBubble} onFeedbackBubbleClick={()=>{ setShowFeedbackBubble(false); setShowFeedback(true) }} onShowFeedback={()=>setShowFeedback(true)} />}
      {screen==='status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={()=>setScreen('menu')} />}
      {cartCount>0 && screen==='menu' && <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline} onOrderPlaced={(id)=>{ setCurrentOrderId(id); setCart([]); setScreen('status') }} onRemove={removeFromCart} onAdd={addToCart} />}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={()=>setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={()=>setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={()=>{ setShowFeedback(false); setScreen('menu') }} />}

      {/* ── FEEDBACK BUBBLE — animated, full attention-grabbing ── */}
      {showFeedbackBubble && !showFeedback && (
        <>
          <style>{`
            @keyframes fbPulse {
              0%   { transform:scale(1) translateY(0); box-shadow:0 8px 24px rgba(232,137,12,0.5); }
              40%  { transform:scale(1.12) translateY(-16px); box-shadow:0 20px 40px rgba(232,137,12,0.7); }
              70%  { transform:scale(1.06) translateY(-8px); box-shadow:0 14px 32px rgba(232,137,12,0.6); }
              100% { transform:scale(1) translateY(0); box-shadow:0 8px 24px rgba(232,137,12,0.5); }
            }
            @keyframes fbBackdrop { from{opacity:0} to{opacity:1} }
            .fb-backdrop { animation: fbBackdrop 0.5s ease forwards }
            .fb-bubble-anim { animation: fbPulse 1.8s ease-in-out infinite }
          `}</style>
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
