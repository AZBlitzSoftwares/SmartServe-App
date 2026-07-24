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
  const [showOrderConfirm, setShowOrderConfirm] = useState(false)
  const orderConfirmTimer = useRef(null)
  const feedbackTimerRef = useRef(null)
  const retryRef = useRef(null)

  // Back button suppression — kiosk mode
  useEffect(() => {
    window.history.pushState({ kiosk: true }, '')
    const handlePop = () => window.history.pushState({ kiosk: true }, '')
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  useEffect(() => {
    if (currentOrderId && !currentOrderId.startsWith('offline-')) localStorage.setItem(orderKey(tableNumber), currentOrderId)
  }, [currentOrderId, tableNumber])

  useEffect(() => {
    autoLoadActiveEvent()
    // Silent background poll every 30s — picks up new events without manual refresh
    const eventPoll = setInterval(() => autoLoadActiveEvent(), 30000)
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => {
      clearInterval(eventPoll)
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      if (retryRef.current) clearTimeout(retryRef.current)
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
      if (orderConfirmTimer.current) clearTimeout(orderConfirmTimer.current)
    }
  }, [tableNumber])

  async function autoLoadActiveEvent() {
    try {
      const { data: evs } = await supabase.from('events').select('*').order('date', { ascending:false }).limit(50)
      const active = (evs||[]).filter(e => eventStatus(e.date) === 'active')
      setActiveEventCount(active.length)
      if (active.length === 1) {
        const activeEv = active[0]
        if (!eventData || eventData.id !== activeEv.id) handleEventSelect(activeEv)
        else loadEventAndTable(activeEv.id)
      } else if (active.length === 0 && eventData?.id) {
        loadEventAndTable(eventData.id)
      }
    } catch(e) { if (eventData?.id) loadEventAndTable(eventData.id) }
  }

  // Watch ALL orders for this table — feedback triggers after every delivery
  useEffect(() => {
    if (!tableData?.id) return
    const sub = supabase.channel('feedback-watch-table-'+tableData.id)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, payload => {
        if (payload.new.table_id === tableData.id && payload.new.status === 'delivered') {
          if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
          feedbackTimerRef.current = setTimeout(() => setShowFeedback(true), FEEDBACK_DELAY_SECONDS * 1000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [tableData?.id])

  async function loadEventAndTable(eventId) {
    try {
      const { data: ev } = await supabase.from('events').select('*').eq('id', eventId).single()
      if (ev) { setEventData(ev); localStorage.setItem(eventKey(tableNumber), JSON.stringify(ev)) }
      const tNum = parseInt(tableNumber)
      // Try to find existing table record
      const { data: tables } = await supabase.from('tables').select('*').eq('event_id', eventId).eq('table_number', tNum).limit(1)
      if (tables?.length) {
        setTableData(tables[0])
      } else {
        // Try insert — if it fails (RLS or duplicate), try select again
        const { data: newTable, error: insertErr } = await supabase.from('tables')
          .insert({ event_id:eventId, table_number:tNum, is_active:true }).select().single()
        if (newTable) {
          setTableData(newTable)
        } else {
          // Insert may have failed due to race — try select once more
          const { data: retry } = await supabase.from('tables').select('*').eq('event_id', eventId).eq('table_number', tNum).limit(1)
          if (retry?.length) setTableData(retry[0])
          else retryRef.current = setTimeout(()=>loadEventAndTable(eventId), 2000)
        }
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

  function handleOrderPlaced(id) {
    setCurrentOrderId(id); setCart([])
    setShowOrderConfirm(true)
    if (orderConfirmTimer.current) clearTimeout(orderConfirmTimer.current)
    orderConfirmTimer.current = setTimeout(() => setShowOrderConfirm(false), 10000)
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>
      {screen==='welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={()=>setScreen('menu')} eventData={eventData} onEventSelect={handleEventSelect} activeEventCount={activeEventCount} />}
      {screen==='menu' && <MenuScreen tableData={tableData} eventData={eventData} tableNumber={tableNumber} cart={cart} addToCart={addToCart} removeFromCart={removeFromCart} cartCount={cartCount} isOnline={isOnline} onShowSOS={()=>setShowSOS(true)} onShowHistory={()=>setShowHistory(true)} onShowStatus={()=>setScreen('status')} currentOrderId={currentOrderId} showFeedbackBubble={showFeedbackBubble} onFeedbackBubbleClick={()=>{ setShowFeedbackBubble(false); setShowFeedback(true) }} onShowFeedback={()=>setShowFeedback(true)} />}
      {screen==='status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={()=>setScreen('menu')} />}
      {cartCount>0 && screen==='menu' && <CartDrawer cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline} onOrderPlaced={handleOrderPlaced} onRemove={removeFromCart} onAdd={addToCart} />}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={()=>setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={()=>setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={()=>setShowFeedback(false)} />}

      {showOrderConfirm && (
        <div style={{ position:'fixed', inset:0, zIndex:95, display:'flex', alignItems:'flex-end', justifyContent:'center', pointerEvents:'none' }}>
          <div style={{ pointerEvents:'all', background:'#1A0A0A', borderRadius:'24px 24px 0 0', padding:'28px 24px 40px', width:'100%', maxWidth:520, boxShadow:'0 -8px 32px rgba(0,0,0,0.4)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:48, height:48, background:'#16A34A', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:'#fff' }}>✓</div>
                <div>
                  <div style={{ color:'#fff', fontWeight:900, fontSize:19 }}>Order Placed! 🎉</div>
                  <div style={{ color:'rgba(255,255,255,0.6)', fontSize:13, marginTop:2 }}>Sit back and relax — your food is on its way.</div>
                </div>
              </div>
              <button onClick={() => { setShowOrderConfirm(false); clearTimeout(orderConfirmTimer.current) }}
                style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:999, width:32, height:32, color:'rgba(255,255,255,0.7)', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
            </div>
            <button onClick={() => { setShowOrderConfirm(false); setScreen('status') }}
              style={{ width:'100%', background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'13px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
              📦 Track Your Order →
            </button>
          </div>
        </div>
      )}

      {showFeedbackBubble && !showFeedback && (
        <>
          <style>{`
            @keyframes fbPulse{0%,100%{transform:scale(1) translateY(0)}40%{transform:scale(1.1) translateY(-14px)}70%{transform:scale(1.05) translateY(-6px)}}
            @keyframes fbBackdrop{from{opacity:0}to{opacity:1}}
            .fb-backdrop{animation:fbBackdrop 0.5s ease forwards}
            .fb-bubble-anim{animation:fbPulse 1.8s ease-in-out infinite}
          `}</style>
          <div className="fb-backdrop" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:90 }} onClick={()=>setShowFeedbackBubble(false)} />
          <div style={{ position:'fixed', inset:0, zIndex:91, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
            <button className="fb-bubble-anim" onClick={()=>{ setShowFeedbackBubble(false); setShowFeedback(true) }}
              style={{ pointerEvents:'all', background:'#E8890C', border:'4px solid #fff', borderRadius:100, padding:'28px 36px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, cursor:'pointer', boxShadow:'0 8px 24px rgba(232,137,12,0.5)' }}>
              <span style={{ fontSize:56 }}>😊</span>
              <span style={{ color:'#fff', fontWeight:800, fontSize:18, whiteSpace:'nowrap' }}>How was your food?</span>
              <span style={{ color:'rgba(255,255,255,0.85)', fontSize:13 }}>Tap to share your experience</span>
            </button>
            <button onClick={()=>setShowFeedbackBubble(false)} style={{ pointerEvents:'all', marginTop:24, background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.4)', borderRadius:999, padding:'10px 24px', color:'#fff', fontSize:14, cursor:'pointer' }}>Maybe later</button>
          </div>
        </>
      )}
    </div>
  )
}
