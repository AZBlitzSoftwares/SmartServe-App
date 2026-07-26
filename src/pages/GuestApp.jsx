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

// ── Exit Confirmation Dialog ──────────────────────────────────────────────
function ExitConfirmDialog({ onStay, onExit }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.8)', zIndex:999,
      display:'flex', alignItems:'center', justifyContent:'center', padding:'0 24px' }}>
      <div style={{ background:'#fff', borderRadius:24, padding:'32px 28px',
        width:'100%', maxWidth:380, textAlign:'center', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>👋</div>
        <div style={{ fontSize:20, fontWeight:900, color:'#1A0A0A', marginBottom:8 }}>Exit Smart Serve?</div>
        <div style={{ fontSize:14, color:'#888', marginBottom:28, lineHeight:1.6 }}>
          You will lose your cart items if you exit now.
        </div>
        <div style={{ display:'flex', gap:12 }}>
          <button onClick={onStay}
            style={{ flex:1, background:'#1A0A0A', color:'#fff', border:'none', borderRadius:14,
              padding:'16px', fontSize:16, fontWeight:800, cursor:'pointer' }}>
            Stay
          </button>
          <button onClick={onExit}
            style={{ flex:1, background:'#F5F5F5', color:'#888', border:'1.5px solid #E5E7EB',
              borderRadius:14, padding:'16px', fontSize:16, fontWeight:700, cursor:'pointer' }}>
            Exit
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GuestApp() {
  // ── State ──────────────────────────────────────────────────────────────
  const [appState, setAppState] = useState('loading') // 'loading'|'setup'|'welcome'|'menu'|'status'
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
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const cartOpenRef = useRef(false)
  const [activeEventCount, setActiveEventCount] = useState(0)

  // Refs for back button handler (always current values)
  const appStateRef = useRef(appState)
  const showSOSRef = useRef(false)
  const showHistoryRef = useRef(false)
  const showFeedbackRef = useRef(false)
  const showOrderConfirmRef = useRef(false)
  const feedbackTimerRef = useRef(null)
  const orderConfirmTimer = useRef(null)

  useEffect(() => { appStateRef.current = appState }, [appState])
  useEffect(() => { cartOpenRef.current = cartOpen }, [cartOpen])
  useEffect(() => { showSOSRef.current = showSOS }, [showSOS])
  useEffect(() => { showHistoryRef.current = showHistory }, [showHistory])
  useEffect(() => { showFeedbackRef.current = showFeedback }, [showFeedback])
  useEffect(() => { showOrderConfirmRef.current = showOrderConfirm }, [showOrderConfirm])

  // ── On Mount: check if already set up ─────────────────────────────────
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
        setEventData(ev)
        setTableData(td)
        setTableNumber(tNum)
        // Restore last order of today
        const todayKey = 'ss_order_' + tNum + '_' + new Date().toISOString().slice(0,10)
        const lastOrder = localStorage.getItem(todayKey)
        if (lastOrder) setCurrentOrderId(lastOrder)
        setAppState('welcome')
      } catch(e) {
        localStorage.clear()
        setAppState('setup')
      }
    } else {
      setAppState('setup')
    }
  }, [])

  // ── Setup complete callback ────────────────────────────────────────────
  function handleSetupComplete(ev, td) {
    setEventData(ev)
    setTableData(td)
    setTableNumber(td.table_number)
    setCurrentOrderId(null)
    setCart([])
    setAppState('welcome')
  }

  // ── Re-setup (long press on table number) ─────────────────────────────
  function triggerReSetup() {
    localStorage.removeItem('ss_setup_complete')
    localStorage.removeItem('ss_setup_event')
    localStorage.removeItem('ss_setup_table')
    localStorage.removeItem('ss_setup_table_number')
    setEventData(null)
    setTableData(null)
    setTableNumber(null)
    setCart([])
    setCurrentOrderId(null)
    setAppState('setup')
  }

  // ── Online/offline ─────────────────────────────────────────────────────
  useEffect(() => {
    const on = () => { setIsOnline(true); syncOfflineOrders() }
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // ── Save current order ID ──────────────────────────────────────────────
  useEffect(() => {
    if (currentOrderId && tableNumber && !currentOrderId.startsWith('offline-')) {
      const key = 'ss_order_' + tableNumber + '_' + new Date().toISOString().slice(0,10)
      localStorage.setItem(key, currentOrderId)
    }
  }, [currentOrderId, tableNumber])

  // ── Feedback trigger on delivery ──────────────────────────────────────
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

  // ── BACK BUTTON HANDLER ────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    // Priority 1 — close cart if open
    if (cartOpenRef.current) { setCartOpen(false); return }

    // Priority 2 — close overlays
    if (showFeedbackRef.current)    { setShowFeedback(false); return }
    if (showSOSRef.current)         { setShowSOS(false); return }
    if (showHistoryRef.current)     { setShowHistory(false); return }
    if (showOrderConfirmRef.current){ setShowOrderConfirm(false); return }

    // Priority 3 — navigate screens
    const current = appStateRef.current
    if (current === 'status') { setAppState('menu'); return }

    // Priority 4 — on menu or welcome → exit dialog
    // NEVER go back to setup screen
    if (current === 'menu' || current === 'welcome') {
      setShowExitConfirm(true)
    }
  }, [])

  // ── BACK BUTTON INTERCEPT ──────────────────────────────────────────────
  useEffect(() => {
    // Push buffer history entries — URL always stays at /
    window.history.replaceState({ kiosk: true, idx: 0 }, '', '/')
    for (let i = 1; i <= 20; i++) {
      window.history.pushState({ kiosk: true, idx: i }, '', '/')
    }

    const handlePop = () => {
      window.history.pushState({ kiosk: true }, '', '/')
      handleBack()
    }

    // Android hardware back button (keyCode 4 or key 'GoBack')
    const handleKeyDown = (e) => {
      if (e.key === 'GoBack' || e.keyCode === 4) {
        e.preventDefault(); handleBack()
      }
    }

    window.addEventListener('popstate', handlePop)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('popstate', handlePop)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleBack])

  // ── CART HELPERS ───────────────────────────────────────────────────────
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

  function handleExit() {
    setShowExitConfirm(false)
    if (window.Android?.closeApp) window.Android.closeApp()
    else if (window.webkit?.messageHandlers?.closeApp) window.webkit.messageHandlers.closeApp.postMessage('close')
    else setAppState('welcome') // browser fallback
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

  // ── RENDER ─────────────────────────────────────────────────────────────
  if (appState === 'loading') {
    return (
      <div style={{ minHeight:'100vh', background:'#1A0A0A', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ color:'rgba(255,255,255,0.4)', fontSize:14 }}>Loading...</div>
      </div>
    )
  }

  if (appState === 'setup') {
    return <SetupScreen onSetupComplete={handleSetupComplete} />
  }

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
            <button onClick={() => { setShowOrderConfirm(false); setAppState('status') }}
              style={{ width:'100%', background:'#E8890C', color:'#fff', border:'none', borderRadius:12, padding:'13px', fontSize:15, fontWeight:800, cursor:'pointer' }}>
              📦 Track Your Order →
            </button>
          </div>
        </div>
      )}

      {/* Exit dialog */}
      {showExitConfirm && <ExitConfirmDialog onStay={() => setShowExitConfirm(false)} onExit={handleExit} />}
    </div>
  )
}
