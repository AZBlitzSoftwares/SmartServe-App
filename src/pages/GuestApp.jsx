import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import SetupScreen from '../components/guest/SetupScreen'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import OrderStatus from '../components/guest/OrderStatus'
import SOSPanel from '../components/guest/SOSPanel'
import OrderHistory from '../components/guest/OrderHistory'
import FeedbackModal from '../components/guest/FeedbackModal'

const FEEDBACK_DELAY_SECONDS = 5

export default function GuestApp() {

  const [appState, setAppState] = useState('loading')
  const [eventData, setEventData] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [tableNumber, setTableNumber] = useState(null)
  const [cart, setCart] = useState([])
  const [currentOrderId, setCurrentOrderId] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showOrderConfirm, setShowOrderConfirm] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [activeEventCount, setActiveEventCount] = useState(0)

  // Always-current refs — back handler reads these
  const appStateRef = useRef('loading')
  const cartOpenRef = useRef(false)
  const showSOSRef = useRef(false)
  const showHistoryRef = useRef(false)
  const showFeedbackRef = useRef(false)
  const showOrderConfirmRef = useRef(false)
  const feedbackTimerRef = useRef(null)
  const orderConfirmTimer = useRef(null)
  const backHandlerRef = useRef(null)

  useEffect(() => { appStateRef.current = appState }, [appState])
  useEffect(() => { cartOpenRef.current = cartOpen }, [cartOpen])
  useEffect(() => { showSOSRef.current = showSOS }, [showSOS])
  useEffect(() => { showHistoryRef.current = showHistory }, [showHistory])
  useEffect(() => { showFeedbackRef.current = showFeedback }, [showFeedback])
  useEffect(() => { showOrderConfirmRef.current = showOrderConfirm }, [showOrderConfirm])

  // ── BACK BUTTON — PERMANENT INTERCEPT ─────────────────────────────────
  // Strategy: use a permanent interval to keep history buffer always full.
  // Every back press: intercept → handle → immediately refill buffer.
  // Buffer never depletes — back can never exit the app.

  const goToMenu = useCallback(() => {
    setShowFeedback(false)
    setShowSOS(false)
    setShowHistory(false)
    setShowOrderConfirm(false)
    setCartOpen(false)
    setAppState('menu')
    appStateRef.current = 'menu'
  }, [])

  const handleBack = useCallback(() => {
    const state = appStateRef.current

    // If on setup screen — do nothing, cannot go back from setup
    if (state === 'setup' || state === 'loading') return

    // Close cart first if open
    if (cartOpenRef.current) {
      setCartOpen(false)
      return
    }

    // Close any open overlay — then go to menu
    if (showOrderConfirmRef.current) { setShowOrderConfirm(false); setAppState('menu'); return }
    if (showFeedbackRef.current)     { setShowFeedback(false);     setAppState('menu'); return }
    if (showSOSRef.current)          { setShowSOS(false);          setAppState('menu'); return }
    if (showHistoryRef.current)      { setShowHistory(false);      setAppState('menu'); return }

    // On status/track order screen — go to menu
    if (state === 'status') { setAppState('menu'); return }

    // On menu — do nothing (already on menu)
    if (state === 'menu') return

    // On welcome — do nothing (guest cannot go behind welcome)
    if (state === 'welcome') return

  }, [])

  // Store latest handleBack in ref so popstate always calls latest version
  useEffect(() => { backHandlerRef.current = handleBack }, [handleBack])

  // ── PERMANENT HISTORY BUFFER ───────────────────────────────────────────
  useEffect(() => {
    // Fill buffer immediately
    function fillBuffer() {
      window.history.pushState({ kiosk: true }, '', '/')
      window.history.pushState({ kiosk: true }, '', '/')
      window.history.pushState({ kiosk: true }, '', '/')
    }

    fillBuffer()

    // On every back press: handle it + immediately refill buffer
    function handlePop() {
      // Handle the back action
      backHandlerRef.current?.()
      // Refill buffer so next back press is also intercepted
      setTimeout(() => fillBuffer(), 0)
    }

    // Android hardware back (keyCode 4)
    function handleKeyDown(e) {
      if (e.key === 'GoBack' || e.keyCode === 4) {
        e.preventDefault()
        e.stopPropagation()
        backHandlerRef.current?.()
      }
    }

    window.addEventListener('popstate', handlePop)
    document.addEventListener('keydown', handleKeyDown, true)

    // Keep buffer topped up every 2 seconds as extra safety
    const keepAlive = setInterval(fillBuffer, 2000)

    return () => {
      window.removeEventListener('popstate', handlePop)
      document.removeEventListener('keydown', handleKeyDown, true)
      clearInterval(keepAlive)
    }
  }, []) // runs once on mount — always uses latest handleBack via ref

  // ── LOAD SAVED SETUP ──────────────────────────────────────────────────
  useEffect(() => {
    const setupComplete = localStorage.getItem('ss_setup_complete')
    const savedEvent = localStorage.getItem('ss_setup_event')
    const savedTable = localStorage.getItem('ss_setup_table')
    const savedTableNum = localStorage.getItem('ss_setup_table_number')

    if (setupComplete && savedEvent && savedTable) {
      try {
        const ev = JSON.parse(savedEvent)
        const td = JSON.parse(savedTable)
        const tNum = parseInt(savedTableNum)
        setEventData(ev); setTableData(td); setTableNumber(tNum)
        const todayKey = 'ss_order_' + tNum + '_' + new Date().toISOString().slice(0,10)
        const lastOrder = localStorage.getItem(todayKey)
        if (lastOrder) setCurrentOrderId(lastOrder)
        setAppState('welcome')
      } catch(e) {
        localStorage.clear(); setAppState('setup')
      }
    } else {
      setAppState('setup')
    }
  }, [])

  function handleSetupComplete(ev, td) {
    setEventData(ev); setTableData(td); setTableNumber(td.table_number)
    setCurrentOrderId(null); setCart([])
    setAppState('welcome')
  }

  function triggerReSetup() {
    localStorage.removeItem('ss_setup_complete')
    localStorage.removeItem('ss_setup_event')
    localStorage.removeItem('ss_setup_table')
    localStorage.removeItem('ss_setup_table_number')
    setEventData(null); setTableData(null); setTableNumber(null)
    setCart([]); setCurrentOrderId(null)
    setAppState('setup')
  }

  // ── ONLINE/OFFLINE ────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── SAVE ORDER ID ─────────────────────────────────────────────────────
  useEffect(() => {
    if (currentOrderId && tableNumber && !currentOrderId.startsWith('offline-')) {
      const key = 'ss_order_' + tableNumber + '_' + new Date().toISOString().slice(0,10)
      localStorage.setItem(key, currentOrderId)
    }
  }, [currentOrderId, tableNumber])

  // ── FEEDBACK ON DELIVERY ──────────────────────────────────────────────
  useEffect(() => {
    if (!tableData?.id) return
    const sub = supabase.channel('feedback-watch-' + tableData.id)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, payload => {
        if (payload.new.table_id === tableData.id && payload.new.status === 'delivered') {
          if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
          feedbackTimerRef.current = setTimeout(() => setShowFeedback(true), FEEDBACK_DELAY_SECONDS * 1000)
        }
      }).subscribe()
    return () => supabase.removeChannel(sub)
  }, [tableData?.id])

  // ── CART HELPERS ──────────────────────────────────────────────────────
  function addToCart(item) {
    setCart(prev => {
      const e = prev.find(c => c.id === item.id)
      if (e) return prev.map(c => c.id === item.id ? {...c, quantity: c.quantity+1} : c)
      return [...prev, {...item, quantity: 1}]
    })
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const e = prev.find(c => c.id === itemId)
      if (e?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? {...c, quantity: c.quantity-1} : c)
    })
  }
  const cartCount = cart.reduce((s,i) => s + i.quantity, 0)

  function handleOrderPlaced(id) {
    setCurrentOrderId(id); setCart([])
    setShowOrderConfirm(true)
    if (orderConfirmTimer.current) clearTimeout(orderConfirmTimer.current)
    orderConfirmTimer.current = setTimeout(() => setShowOrderConfirm(false), 10000)
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders')
          .insert({ event_id: order.event_id, table_id: order.table_id, status: 'pending' }).select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(order.items.map(i => ({
            order_id: newOrder.id, menu_item_id: i.id, quantity: i.quantity
          })))
          await clearOrder(order.id)
        }
      } catch(e) { console.error(e) }
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────
  if (appState === 'loading') return (
    <div style={{ minHeight:'100vh', background:'#1A0A0A', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:'rgba(255,255,255,0.4)', fontSize:14 }}>Loading...</div>
    </div>
  )

  if (appState === 'setup') return (
    <SetupScreen
      onSetupComplete={handleSetupComplete}
      currentTableNumber={tableNumber}
      currentEventId={eventData?.id}
    />
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', position:'relative' }}>

      {appState === 'welcome' && (
        <WelcomeScreen
          tableNumber={tableNumber}
          onStart={() => setAppState('menu')}
          eventData={eventData}
          onEventSelect={() => {}}
          activeEventCount={1}
          onLongPressTable={triggerReSetup}
        />
      )}

      {appState === 'menu' && (
        <MenuScreen
          tableData={tableData}
          eventData={eventData}
          tableNumber={tableNumber}
          cart={cart}
          addToCart={addToCart}
          removeFromCart={removeFromCart}
          cartCount={cartCount}
          isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setAppState('status')}
          currentOrderId={currentOrderId}
          showFeedbackBubble={false}
          onFeedbackBubbleClick={() => {}}
          onShowFeedback={() => setShowFeedback(true)}
        />
      )}

      {appState === 'status' && (
        <OrderStatus
          orderId={currentOrderId}
          tableNumber={tableNumber}
          onBack={() => setAppState('menu')}
        />
      )}

      {cartCount > 0 && appState === 'menu' && (
        <CartDrawer
          cart={cart}
          tableData={tableData}
          eventData={eventData}
          isOnline={isOnline}
          onOrderPlaced={handleOrderPlaced}
          onRemove={removeFromCart}
          onAdd={addToCart}
          cartOpen={cartOpen}
          onCartOpenChange={setCartOpen}
        />
      )}

      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
      {showFeedback && <FeedbackModal orderId={currentOrderId} tableData={tableData} eventData={eventData} onClose={() => setShowFeedback(false)} />}

      {/* Order placed popup */}
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
            <button
              onClick={() => { setShowOrderConfirm(false); setAppState('status') }}
              style={{ width:'100%', background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'13px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
              📦 Track Your Order →
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
